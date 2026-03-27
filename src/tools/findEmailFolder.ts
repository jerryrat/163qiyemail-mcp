/**
 * 搜索邮件所在的文件夹
 */

import { isWebApiAvailable, webSearchMessages } from "./webApiClient.js";
import { createImapConnection } from "./imapClient.js";
import { getFolderMap } from "./listFolders.js";

interface FindEmailFolderArgs {
  query: string;
  limit: number;
}

export function createFindEmailFolderTool() {
  return async (args: FindEmailFolderArgs) => {
    try {
      if (isWebApiAvailable()) {
        try {
          return await findViaWebApi(args);
        } catch (e: any) {
          if (e.message?.includes("会话已失效")) {
            try { return await findViaWebApi(args); } catch {}
          }
        }
      }
      return await findViaIMAP(args);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      return { content: [{ type: "text", text: `查找邮件文件夹失败: ${msg}` }] };
    }
  };
}

async function findViaWebApi(args: FindEmailFolderArgs) {
  const [searchResult, folderMap] = await Promise.all([
    webSearchMessages({ pattern: args.query, windowSize: args.limit }),
    getFolderMap(),
  ]);

  if (searchResult.emails.length === 0) {
    return { content: [{ type: "text", text: `搜索 "${args.query}" 未在任何文件夹中找到邮件` }] };
  }

  const text = `搜索 "${args.query}" 找到 ${searchResult.emails.length} 封邮件 [Web API]:\n\n` +
    searchResult.emails
      .map((e, i) => {
        const folderName = folderMap.get(e.fid) || `文件夹${e.fid}`;
        return `${i + 1}. **${e.subject}**\n` +
          `   📁 文件夹: ${folderName} (ID: ${e.fid})\n` +
          `   发件人: ${e.from}\n` +
          `   收件人: ${e.to}\n` +
          `   日期: ${e.date}\n` +
          `   ---`;
      })
      .join("\n");

  return { content: [{ type: "text", text }] };
}

async function findViaIMAP(args: FindEmailFolderArgs) {
  const client = await createImapConnection();
  const results: Array<{ folder: string; subject: string; from: string; date: string; uid: number }> = [];
  const keyword = args.query.toLowerCase();

  try {
    const allFolders = await client.list();
    for (const folder of allFolders) {
      if (results.length >= args.limit) break;
      let lock;
      try { lock = await client.getMailboxLock(folder.path); } catch { continue; }
      try {
        if ((client.mailbox as any).exists === 0) continue;
        for await (const msg of client.fetch("1:*", { envelope: true, uid: true })) {
          if (results.length >= args.limit) break;
          const env = msg.envelope;
          if (!env) continue;
          const text = [
            env.subject || "",
            ...(env.from || []).map((a: any) => `${a.name || ""} ${a.address || ""}`),
            ...(env.to || []).map((a: any) => `${a.name || ""} ${a.address || ""}`),
          ].join(" ").toLowerCase();
          if (text.includes(keyword)) {
            results.push({
              folder: folder.path,
              subject: env.subject || "(无主题)",
              from: (env.from || []).map((a: any) => a.address).join(", "),
              date: env.date?.toLocaleString("zh-CN") || "",
              uid: msg.uid,
            });
          }
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout();
  }

  if (results.length === 0) {
    return { content: [{ type: "text", text: `搜索 "${args.query}" 未在任何文件夹中找到邮件 [IMAP]` }] };
  }

  const text = `搜索 "${args.query}" 找到 ${results.length} 封邮件 [IMAP]:\n\n` +
    results
      .map((r, i) => `${i + 1}. **${r.subject}**\n   📁 文件夹: ${r.folder}\n   发件人: ${r.from}\n   日期: ${r.date}\n   ---`)
      .join("\n");

  return { content: [{ type: "text", text }] };
}
