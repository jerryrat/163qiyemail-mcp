import { createImapConnection } from "./imapClient.js";

interface DeleteEmailArgs {
  messageId: string;
  folder?: string;
}

async function deleteViaIMAP(args: DeleteEmailArgs): Promise<void> {
  const client = await createImapConnection();
  try {
    const folder = args.folder || "INBOX";
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageDelete(args.messageId, { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

export function createDeleteEmailTool() {
  return async (args: DeleteEmailArgs) => {
    try {
      await deleteViaIMAP(args);
      return {
        content: [{ type: "text", text: `邮件删除成功！\n\n邮件ID: ${args.messageId}` }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      return { content: [{ type: "text", text: `删除邮件失败: ${msg}` }] };
    }
  };
}
