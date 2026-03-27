/**
 * 列出邮箱中的所有文件夹
 */

import { isWebApiAvailable, webGetAllFolders } from "./webApiClient.js";
import { createImapConnection } from "./imapClient.js";

export interface FolderInfo {
  id: string;
  name: string;
  unread: number;
  total: number;
}

/**
 * 解析文件夹 XML，处理嵌套 <object> 结构
 */
export function parseFoldersXml(xml: string): FolderInfo[] {
  const folders: FolderInfo[] = [];

  // 提取 <array name="var"> 内容
  const arrayMatch = xml.match(/<array name="var">([\s\S]*)<\/array>/);
  if (!arrayMatch) return folders;

  const content = arrayMatch[1];

  // 手动拆分顶层 <object>（处理嵌套的 <object name="flags"> 和 <object name="stats">）
  const blocks: string[] = [];
  let depth = 0;
  let start = -1;
  let i = 0;
  while (i < content.length) {
    if (content.startsWith("<object>", i) || (content.startsWith("<object ", i) && depth === 0 && content.charAt(i + 7) === ">")) {
      // 顶层 <object> 开始（无 name 属性）
      if (content.startsWith("<object>", i)) {
        if (depth === 0) start = i;
        depth++;
        i += 8;
        continue;
      }
    }
    if (content.startsWith("<object ", i)) {
      // 嵌套 <object name="...">
      depth++;
      i = content.indexOf(">", i) + 1;
      continue;
    }
    if (content.startsWith("</object>", i)) {
      depth--;
      if (depth === 0 && start >= 0) {
        blocks.push(content.substring(start, i + 9));
        start = -1;
      }
      i += 9;
      continue;
    }
    i++;
  }

  for (const block of blocks) {
    const getString = (name: string): string => {
      const m = block.match(new RegExp(`<string name="${name}">([^<]*)<\\/string>`));
      return m ? m[1] : "";
    };
    const getInt = (name: string): number => {
      // 可能有多个同名 int（顶层和嵌套的），取所有匹配
      const re = new RegExp(`<int name="${name}">(\\d+)<\\/int>`, "g");
      let m;
      let val = 0;
      while ((m = re.exec(block)) !== null) {
        val = parseInt(m[1]);
        // 对于 id，取第一个顶层的
        if (name === "id") return val;
      }
      return val;
    };

    const name = getString("name");
    if (!name) continue;

    const id = String(getInt("id"));

    // 从 stats 中提取数据
    const statsMatch = block.match(/<object name="stats">([\s\S]*?)<\/object>/);
    let total = 0;
    let unread = 0;
    if (statsMatch) {
      const stats = statsMatch[1];
      const mc = stats.match(/<int name="messageCount">(\d+)<\/int>/);
      const uc = stats.match(/<int name="unreadMessageCount">(\d+)<\/int>/);
      if (mc) total = parseInt(mc[1]);
      if (uc) unread = parseInt(uc[1]);
    }

    folders.push({ id, name, unread, total });
  }

  return folders;
}

/**
 * 构建 fid → 文件夹名 的映射表
 */
export async function getFolderMap(): Promise<Map<string, string>> {
  try {
    const xml = await webGetAllFolders();
    const folders = parseFoldersXml(xml);
    const map = new Map<string, string>();
    for (const f of folders) map.set(f.id, f.name);
    return map;
  } catch {
    return new Map();
  }
}

async function listViaWebApi(): Promise<FolderInfo[]> {
  const xml = await webGetAllFolders();
  return parseFoldersXml(xml);
}

async function listViaIMAP(): Promise<FolderInfo[]> {
  const client = await createImapConnection();
  try {
    const folders = await client.list();
    return folders.map((f) => ({
      id: f.path,
      name: f.name || f.path,
      unread: 0,
      total: 0,
    }));
  } finally {
    await client.logout();
  }
}

export function createListFoldersTool() {
  return async () => {
    try {
      let folders: FolderInfo[];
      let method: string;

      if (isWebApiAvailable()) {
        try {
          folders = await listViaWebApi();
          method = "Web API";
        } catch {
          folders = await listViaIMAP();
          method = "IMAP";
        }
      } else {
        folders = await listViaIMAP();
        method = "IMAP";
      }

      const text = folders.length > 0
        ? `邮箱文件夹列表 [${method}]:\n\n` +
          folders
            .map((f) => `- **${f.name}** (ID: ${f.id})  邮件: ${f.total}  未读: ${f.unread}`)
            .join("\n")
        : "未找到文件夹";

      return { content: [{ type: "text", text }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      return { content: [{ type: "text", text: `获取文件夹列表失败: ${msg}` }] };
    }
  };
}
