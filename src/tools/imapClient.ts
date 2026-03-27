import { ImapFlow } from "imapflow";

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export function getImapConfig(): ImapConfig {
  const host = process.env.IMAP_HOST;
  const port = parseInt(process.env.IMAP_PORT || "993");
  const secure = process.env.IMAP_SECURE !== "false";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("IMAP配置缺失。请设置 IMAP_HOST, SMTP_USER 和 SMTP_PASS");
  }

  return { host, port, secure, auth: { user, pass } };
}

export async function createImapConnection(): Promise<ImapFlow> {
  const config = getImapConfig();
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    logger: false,
  });
  await client.connect();
  return client;
}
