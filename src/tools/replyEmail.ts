import nodemailer from "nodemailer";
import { createImapConnection } from "./imapClient.js";
import { simpleParser } from "mailparser";

interface ReplyEmailArgs {
  messageId: string;
  body: string;
  replyAll: boolean;
  html: boolean;
  folder?: string;
}

export function createReplyEmailTool() {
  return async (args: ReplyEmailArgs) => {
    try {
      // 1. 通过 IMAP 获取原始邮件
      const client = await createImapConnection();
      let originalFrom = "";
      let originalTo = "";
      let originalCc = "";
      let originalSubject = "";
      let originalMessageId = "";
      let originalReferences = "";

      try {
        const folder = args.folder || "INBOX";
        const lock = await client.getMailboxLock(folder);
        try {
          const fetchResult = await client.fetchOne(args.messageId, {
            source: true, uid: true,
          }) as any;

          if (!fetchResult?.source) {
            throw new Error(`找不到邮件ID: ${args.messageId}`);
          }

          const parsed = await simpleParser(fetchResult.source);
          originalFrom = parsed.from?.text || "";
          originalTo = parsed.to
            ? (Array.isArray(parsed.to) ? parsed.to.map((a) => a.text).join(", ") : parsed.to.text)
            : "";
          originalCc = parsed.cc
            ? (Array.isArray(parsed.cc) ? parsed.cc.map((a) => a.text).join(", ") : parsed.cc.text)
            : "";
          originalSubject = parsed.subject || "";
          originalMessageId = parsed.messageId || "";
          originalReferences = (parsed.references
            ? (Array.isArray(parsed.references) ? parsed.references.join(" ") : parsed.references)
            : "") as string;
        } finally {
          lock.release();
        }
      } finally {
        await client.logout();
      }

      // 2. 通过 SMTP 发送回复
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST!,
        port: parseInt(process.env.SMTP_PORT || "994"),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
      });

      const replySubject = originalSubject.startsWith("Re:")
        ? originalSubject
        : `Re: ${originalSubject}`;

      let toAddresses = originalFrom;
      if (args.replyAll) {
        toAddresses = [originalFrom, originalTo, originalCc]
          .filter((addr) => addr)
          .join(", ");
      }

      const result = await transporter.sendMail({
        from: process.env.DEFAULT_FROM_EMAIL!,
        to: toAddresses,
        subject: replySubject,
        [args.html ? "html" : "text"]: args.body,
        inReplyTo: originalMessageId,
        references: originalReferences
          ? `${originalReferences} ${originalMessageId}`
          : originalMessageId,
      });

      return {
        content: [{
          type: "text",
          text: `回复发送成功！\n\n- 收件人: ${toAddresses}\n- 主题: ${replySubject}\n- 消息ID: ${result.messageId}\n- 回复全部: ${args.replyAll ? "是" : "否"}`,
        }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      return { content: [{ type: "text", text: `回复邮件失败: ${msg}` }] };
    }
  };
}
