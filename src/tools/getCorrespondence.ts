/**
 * 获取与指定邮箱地址的所有往来邮件
 */

import { isWebApiAvailable, webSearchMessages } from "./webApiClient.js";
import { createImapConnection } from "./imapClient.js";
import { simpleParser } from "mailparser";

interface GetCorrespondenceArgs {
  email: string;
  limit: number;
}

export function createGetCorrespondenceTool() {
  return async (args: GetCorrespondenceArgs) => {
    try {
      if (isWebApiAvailable()) {
        try {
          return await correspondenceViaWebApi(args);
        } catch (e: any) {
          if (e.message?.includes("会话已失效")) {
            try { return await correspondenceViaWebApi(args); } catch {}
          }
        }
      }
      return await correspondenceViaIMAP(args);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      return { content: [{ type: "text", text: `获取往来邮件失败: ${msg}` }] };
    }
  };
}

async function correspondenceViaWebApi(args: GetCorrespondenceArgs) {
  const result = await webSearchMessages({
    pattern: args.email,
    windowSize: args.limit,
    fields: "from,to",  // 只搜索发件人和收件人字段
  });

  if (result.emails.length === 0) {
    return { content: [{ type: "text", text: `与 ${args.email} 没有往来邮件记录` }] };
  }

  const myEmail = (process.env.DEFAULT_FROM_EMAIL || process.env.SMTP_USER || "").toLowerCase();

  const text = `与 ${args.email} 的往来邮件 (${result.emails.length} 封) [Web API]:\n\n` +
    result.emails
      .map((e, i) => {
        const fromLower = e.from.toLowerCase();
        const direction = fromLower.includes(args.email.toLowerCase()) ? "⬅️ 收到" : "➡️ 发出";
        return `${i + 1}. ${direction} **${e.subject}**\n` +
          `   发件人: ${e.from}\n` +
          `   收件人: ${e.to}\n` +
          `   日期: ${e.date}\n` +
          (e.summary ? `   摘要: ${e.summary.substring(0, 120)}\n` : "") +
          `   邮件ID: ${e.id}\n` +
          `   ---`;
      })
      .join("\n");

  return { content: [{ type: "text", text }] };
}

async function correspondenceViaIMAP(args: GetCorrespondenceArgs) {
  const client = await createImapConnection();
  const emails: Array<{ direction: string; subject: string; from: string; to: string; date: string; uid: string; folder: string }> = [];
  const keyword = args.email.toLowerCase();

  try {
    // 搜索收件箱（收到的）和已发送（发出的）
    const folders = ["INBOX", "已发送"];

    for (const folder of folders) {
      if (emails.length >= args.limit) break;
      let lock;
      try { lock = await client.getMailboxLock(folder); } catch { continue; }
      try {
        if ((client.mailbox as any).exists === 0) continue;
        for await (const msg of client.fetch("1:*", { envelope: true, uid: true })) {
          if (emails.length >= args.limit) break;
          const env = msg.envelope;
          if (!env) continue;

          const allAddresses = [
            ...(env.from || []).map((a: any) => (a.address || "").toLowerCase()),
            ...(env.to || []).map((a: any) => (a.address || "").toLowerCase()),
            ...(env.cc || []).map((a: any) => (a.address || "").toLowerCase()),
          ];

          if (allAddresses.some(addr => addr.includes(keyword))) {
            const fromAddr = (env.from || []).map((a: any) => a.address || "").join(", ");
            const toAddr = (env.to || []).map((a: any) => a.address || "").join(", ");
            const direction = fromAddr.toLowerCase().includes(keyword) ? "⬅️ 收到" : "➡️ 发出";

            emails.push({
              direction,
              subject: env.subject || "(无主题)",
              from: fromAddr,
              to: toAddr,
              date: env.date?.toLocaleString("zh-CN") || "",
              uid: String(msg.uid),
              folder,
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

  if (emails.length === 0) {
    return { content: [{ type: "text", text: `与 ${args.email} 没有往来邮件记录 [IMAP]` }] };
  }

  const text = `与 ${args.email} 的往来邮件 (${emails.length} 封) [IMAP]:\n\n` +
    emails
      .map((e, i) => `${i + 1}. ${e.direction} **${e.subject}**\n   发件人: ${e.from}\n   收件人: ${e.to}\n   日期: ${e.date}\n   文件夹: ${e.folder}\n   ---`)
      .join("\n");

  return { content: [{ type: "text", text }] };
}
