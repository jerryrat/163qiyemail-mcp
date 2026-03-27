import { createImapConnection } from "./imapClient.js";
import { simpleParser } from "mailparser";
import { isWebApiAvailable, webSearchMessages } from "./webApiClient.js";

interface SearchEmailsArgs {
  query: string;
  limit: number;
  folder: string;
  searchBody?: boolean;
}

interface EmailResult {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  folder?: string;
}

function formatAddress(addr: any): string {
  return (addr || [])
    .map((a: any) => `${a.name ? a.name + " " : ""}<${a.address}>`)
    .join(", ");
}

// Web API 搜索（毫秒级，服务端全文检索）
async function searchViaWebApi(args: SearchEmailsArgs): Promise<EmailResult[]> {
  const result = await webSearchMessages({
    pattern: args.query,
    windowSize: args.limit,
  });

  return result.emails.map((email) => ({
    id: email.id,
    from: email.from,
    to: email.to,
    subject: email.subject,
    date: email.date || "",
    snippet: email.summary || "",
    folder: email.fid,
  }));
}

// IMAP 搜索（回退方案）
async function searchViaIMAP(args: SearchEmailsArgs): Promise<EmailResult[]> {
  const client = await createImapConnection();
  const emails: EmailResult[] = [];
  const keyword = args.query.toLowerCase();

  const foldersToSearch: string[] = [];
  if (args.folder === "ALL") {
    const allFolders = await client.list();
    for (const f of allFolders) foldersToSearch.push(f.path);
  } else {
    foldersToSearch.push(args.folder);
  }

  const matchedUids = new Set<string>();

  try {
    for (const folder of foldersToSearch) {
      if (emails.length >= args.limit) break;

      let lock;
      try {
        lock = await client.getMailboxLock(folder);
      } catch {
        continue;
      }

      try {
        const exists = (client.mailbox as any).exists as number;
        if (exists === 0) continue;

        for await (const msg of client.fetch("1:*", { envelope: true, uid: true })) {
          if (emails.length >= args.limit) break;
          const env = msg.envelope;
          if (!env) continue;

          const uidKey = `${folder}:${msg.uid}`;
          if (matchedUids.has(uidKey)) continue;

          const envelopeText = [
            env.subject || "",
            ...(env.from || []).map((a: any) => `${a.name || ""} ${a.address || ""}`),
            ...(env.to || []).map((a: any) => `${a.name || ""} ${a.address || ""}`),
            ...(env.cc || []).map((a: any) => `${a.name || ""} ${a.address || ""}`),
          ].join(" ").toLowerCase();

          if (envelopeText.includes(keyword)) {
            emails.push({
              id: String(msg.uid),
              from: formatAddress(env.from),
              to: formatAddress(env.to),
              subject: env.subject || "(无主题)",
              date: env.date?.toLocaleString("zh-CN") || "",
              snippet: env.subject || "",
              folder,
            });
            matchedUids.add(uidKey);
          }
        }

        if (args.searchBody && emails.length < args.limit) {
          const unmatchedUids: number[] = [];
          for await (const msg of client.fetch("1:*", { uid: true })) {
            if (!matchedUids.has(`${folder}:${msg.uid}`)) unmatchedUids.push(msg.uid);
          }
          unmatchedUids.reverse();
          for (const uid of unmatchedUids) {
            if (emails.length >= args.limit) break;
            let fetchResult;
            try {
              fetchResult = await client.fetchOne(String(uid), { source: true, envelope: true, uid: true }) as any;
            } catch { continue; }
            if (!fetchResult?.source) continue;
            const parsed = await simpleParser(fetchResult.source);
            let bodyText = (parsed.text || "").toLowerCase();
            if (parsed.html) bodyText += " " + parsed.html.replace(/<[^>]*>/g, "").toLowerCase();
            if (bodyText.includes(keyword)) {
              const env = fetchResult.envelope || {};
              const idx = bodyText.indexOf(keyword);
              const start = Math.max(0, idx - 50);
              emails.push({
                id: String(uid),
                from: formatAddress(env.from),
                to: formatAddress(env.to),
                subject: env.subject || "(无主题)",
                date: env.date?.toLocaleString("zh-CN") || "",
                snippet: bodyText.substring(start, start + 150).replace(/\n/g, " "),
                folder,
              });
              matchedUids.add(`${folder}:${uid}`);
            }
          }
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout();
  }

  return emails.slice(0, args.limit);
}

export function createSearchEmailsTool() {
  return async (args: SearchEmailsArgs) => {
    try {
      let emails: EmailResult[];
      let method: string;

      if (isWebApiAvailable()) {
        try {
          emails = await searchViaWebApi(args);
          method = "Web API";
        } catch (e: any) {
          if (e.message?.includes("会话已失效")) {
            try {
              emails = await searchViaWebApi(args);
              method = "Web API (重新登录)";
            } catch {
              emails = await searchViaIMAP(args);
              method = "IMAP (回退)";
            }
          } else {
            emails = await searchViaIMAP(args);
            method = "IMAP (回退)";
          }
        }
      } else {
        emails = await searchViaIMAP(args);
        method = "IMAP";
      }

      const resultText =
        emails.length > 0
          ? `搜索 "${args.query}" 找到 ${emails.length} 封邮件 [${method}]:\n\n` +
            emails
              .map(
                (email, i) =>
                  `${i + 1}. **${email.subject}**\n` +
                  (email.folder ? `   文件夹: ${email.folder}\n` : "") +
                  `   发件人: ${email.from}\n` +
                  `   收件人: ${email.to}\n` +
                  `   日期: ${email.date}\n` +
                  (email.snippet ? `   摘要: ${email.snippet}\n` : "") +
                  `   邮件ID: ${email.id}\n` +
                  `   ---\n`
              )
              .join("\n")
          : `搜索 "${args.query}" 没有找到邮件 [${method}]`;

      return { content: [{ type: "text", text: resultText }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      return { content: [{ type: "text", text: `搜索邮件失败: ${msg}` }] };
    }
  };
}
