import nodemailer from "nodemailer";

interface SendEmailArgs {
  to: string;
  subject: string;
  body: string;
  from?: string;
  html?: boolean;
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: string;
  }>;
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST || "smtphz.qiye.163.com";
  const port = parseInt(process.env.SMTP_PORT || "994");
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER!;
  const pass = process.env.SMTP_PASS!;
  const defaultFrom = process.env.DEFAULT_FROM_EMAIL!;

  if (!user || !pass) {
    throw new Error("SMTP 配置缺失，请设置 SMTP_USER 和 SMTP_PASS");
  }
  if (!defaultFrom) {
    throw new Error("DEFAULT_FROM_EMAIL 未配置");
  }

  return { host, port, secure, auth: { user, pass }, defaultFrom };
}

export function createSendEmailTool() {
  return async (args: SendEmailArgs) => {
    try {
      const config = getSmtpConfig();
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.auth,
      });

      const attachments = [];
      if (args.attachments) {
        for (const att of args.attachments) {
          if (att.path) {
            attachments.push({ filename: att.filename, path: att.path });
          } else if (att.content) {
            attachments.push({ filename: att.filename, content: att.content });
          }
        }
      }

      const result = await transporter.sendMail({
        from: args.from || config.defaultFrom,
        to: args.to,
        subject: args.subject,
        [args.html ? "html" : "text"]: args.body,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      return {
        content: [{
          type: "text",
          text: `邮件发送成功！\n\n- 收件人: ${args.to}\n- 主题: ${args.subject}\n- 消息ID: ${result.messageId}\n- 格式: ${args.html ? "HTML" : "纯文本"}${args.attachments ? `\n- 附件: ${args.attachments.length} 个` : ""}`,
        }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      return { content: [{ type: "text", text: `邮件发送失败: ${msg}` }] };
    }
  };
}
