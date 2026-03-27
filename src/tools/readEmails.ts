import { createImapConnection } from "./imapClient.js";
import { simpleParser } from "mailparser";

interface ReadEmailsArgs {
  limit: number;
  folder: string;
  unreadOnly: boolean;
}

interface EmailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  isUnread: boolean;
  body?: string;
}

async function readViaIMAP(args: ReadEmailsArgs): Promise<EmailMessage[]> {
  const client = await createImapConnection();
  const emails: EmailMessage[] = [];

  try {
    const lock = await client.getMailboxLock(args.folder);
    try {
      const status = client.mailbox;
      if (!status || status.exists === 0) return emails;

      const searchCriteria = args.unreadOnly ? { seen: false } : { all: true };
      const searchResult = await client.search(searchCriteria) as number[] | false;
      if (!searchResult) return emails;

      const targetUids = searchResult.slice(-args.limit);

      for (const uid of targetUids) {
        const fetchResult = await client.fetchOne(String(uid), {
          source: true, flags: true, uid: true,
        }) as any;

        if (!fetchResult?.source) continue;

        const parsed = await simpleParser(fetchResult.source);
        const isUnread = !(fetchResult.flags?.has("\\Seen"));
        const fromAddr = parsed.from?.text || "";
        const toAddr = parsed.to
          ? (Array.isArray(parsed.to) ? parsed.to.map((a) => a.text).join(", ") : parsed.to.text)
          : "";

        let body = parsed.text || "";
        if (!body && parsed.html) {
          body = parsed.html.replace(/<[^>]*>/g, "").substring(0, 1000);
        }

        emails.push({
          id: String(uid),
          from: fromAddr,
          to: toAddr,
          subject: parsed.subject || "(无主题)",
          date: parsed.date?.toLocaleString("zh-CN") || "",
          isUnread,
          body: body.length > 1000 ? body.substring(0, 1000) + "..." : body,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return emails.reverse();
}

export function createReadEmailsTool() {
  return async (args: ReadEmailsArgs) => {
    try {
      const emails = await readViaIMAP(args);

      const resultText =
        emails.length > 0
          ? `共找到 ${emails.length} 封邮件:\n\n` +
            emails
              .map(
                (email, i) =>
                  `${i + 1}. ${email.isUnread ? "[未读] " : ""}**${email.subject}**\n` +
                  `   发件人: ${email.from}\n` +
                  `   收件人: ${email.to}\n` +
                  `   日期: ${email.date}\n` +
                  `   邮件ID: ${email.id}\n` +
                  (email.body ? `   内容预览: ${email.body.substring(0, 200)}...\n` : "") +
                  `   ---\n`
              )
              .join("\n")
          : `在 ${args.folder} 中没有找到邮件${args.unreadOnly ? " (仅未读)" : ""}`;

      return { content: [{ type: "text", text: resultText }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      return { content: [{ type: "text", text: `读取邮件失败: ${msg}` }] };
    }
  };
}
