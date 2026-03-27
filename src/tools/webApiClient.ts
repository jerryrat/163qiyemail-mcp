/**
 * 网易企业邮箱 Web API 客户端
 * 使用 sid + Cookie 调用服务端 API，实现毫秒级搜索
 */

export interface WebApiConfig {
  host: string;       // mail.qiye.163.com 或 mailh.qiye.163.com
  sid: string;        // Session ID
  cookie: string;     // 浏览器 Cookie
  deviceId?: string;
}

export interface SearchParams {
  pattern: string;
  start?: number;
  windowSize?: number;
  order?: string;
  desc?: boolean;
  fids?: string[];
  fields?: string;     // 搜索字段: from,to,subj,cont,aname
}

export interface SearchResult {
  total: number;
  emails: WebEmailItem[];
}

export interface WebEmailItem {
  id: string;
  fid: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  date: string;
  size?: number;
  read?: boolean;
  hasAttachment?: boolean;
  summary?: string;
}

export interface ListMessagesParams {
  fid: string;
  start?: number;
  limit?: number;
  order?: string;
  desc?: boolean;
}

export interface ReadMessageParams {
  id: string;
  fid: string;
}

import { getValidSession, loadSession } from "./webLogin.js";

function getWebApiConfigSync(): WebApiConfig | null {
  // 同步检查：.env 配置或缓存的 session
  const sid = process.env.WEB_SID;
  const cookie = process.env.WEB_COOKIE;
  if (sid && cookie) {
    return {
      host: process.env.WEB_HOST || "mail.qiye.163.com",
      sid,
      cookie,
      deviceId: process.env.WEB_DEVICE_ID || "mcp-email-client",
    };
  }

  // 检查 session 缓存文件
  const cached = loadSession();
  if (cached) {
    return {
      host: process.env.WEB_HOST || "mail.qiye.163.com",
      sid: cached.sid,
      cookie: cached.cookie,
    };
  }

  return null;
}

async function getWebApiConfig(): Promise<WebApiConfig> {
  // 先检查同步配置
  const syncConfig = getWebApiConfigSync();
  if (syncConfig) return syncConfig;

  // 自动登录获取 session
  const session = await getValidSession();
  return {
    host: process.env.WEB_HOST || "mail.qiye.163.com",
    sid: session.sid,
    cookie: session.cookie,
  };
}

export function isWebApiAvailable(): boolean {
  // 只要有 SMTP 凭据就可以自动登录
  return !!(
    (process.env.WEB_SID && process.env.WEB_COOKIE) ||
    loadSession() ||
    (process.env.SMTP_USER && process.env.SMTP_PASS)
  );
}

function buildUrl(config: WebApiConfig, func: string): string {
  const params = new URLSearchParams({
    _host: config.host,
    func: func,
    sid: config.sid,
    p: "web",
    _deviceId: config.deviceId || "mcp-email-client",
    _device: "chrome",
    _systemVersion: "10.0",
    _system: "web",
    _manufacturer: "chrome",
    _deviceName: "chrome",
    _appName: "sirius-web",
    _version: "1.60.2",
  });
  return `https://${config.host}/bjjs6/s?${params.toString()}`;
}

async function callApi(config: WebApiConfig, func: string, body: any): Promise<string> {
  const url = buildUrl(config, func);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "Cookie": config.cookie,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/146.0.0.0",
      "Origin": `https://${config.host}`,
      "Referer": `https://${config.host}/`,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  if (text.includes("FA_INVALID_SESSION")) {
    // 清除缓存的 session，下次调用会自动重新登录
    const fs = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    const sessionFile = path.default.join(
      path.default.dirname(fileURLToPath(import.meta.url)),
      "../../.session.json"
    );
    try { fs.default.unlinkSync(sessionFile); } catch {}
    throw new Error("Web API 会话已失效，将在下次请求时自动重新登录。");
  }

  return text;
}

// 解码 HTML 实体
function decodeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

// 将 XML 中的顶层 <object> 拆分出来（处理嵌套 <object>）
function splitTopLevelObjects(xml: string): string[] {
  const blocks: string[] = [];
  const tag = "<object>";
  const closeTag = "</object>";
  let pos = 0;

  while (true) {
    const start = xml.indexOf(tag, pos);
    if (start === -1) break;

    // 用计数器匹配对应的 </object>
    let depth = 0;
    let i = start;
    let end = -1;
    while (i < xml.length) {
      if (xml.startsWith(tag, i) || xml.startsWith('<object ', i)) {
        depth++;
        i = xml.indexOf('>', i) + 1;
      } else if (xml.startsWith(closeTag, i)) {
        depth--;
        if (depth === 0) {
          end = i + closeTag.length;
          break;
        }
        i += closeTag.length;
      } else {
        i++;
      }
    }

    if (end > start) {
      blocks.push(xml.substring(start, end));
      pos = end;
    } else {
      break;
    }
  }

  return blocks;
}

// 解析 XML 响应中的邮件列表
function parseSearchXml(xml: string): SearchResult {
  const emails: WebEmailItem[] = [];

  // 提取 total
  const totalMatch = xml.match(/<int name="total">(\d+)<\/int>/);
  const total = totalMatch ? parseInt(totalMatch[1]) : 0;

  // 提取 <array name="var"> 内容
  const arrayMatch = xml.match(/<array name="var">([\s\S]*)<\/array>/);
  if (!arrayMatch) return { total, emails };

  const objects = splitTopLevelObjects(arrayMatch[1]);

  for (const block of objects) {
    const getString = (name: string): string => {
      const m = block.match(new RegExp(`<string name="${name}"><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/string>`));
      if (m) return m[1];
      const m2 = block.match(new RegExp(`<string name="${name}">(.*?)<\\/string>`));
      return m2 ? m2[1] : "";
    };
    const getInt = (name: string): string => {
      const m = block.match(new RegExp(`<int name="${name}">(\\d+)<\\/int>`));
      return m ? m[1] : "";
    };
    const getDate = (name: string): string => {
      const m = block.match(new RegExp(`<date name="${name}">(.*?)<\\/date>`));
      return m ? m[1] : "";
    };
    const getBool = (name: string): boolean => {
      const m = block.match(new RegExp(`<boolean name="${name}">(.*?)<\\/boolean>`));
      return m ? m[1] === "true" : false;
    };

    const id = getString("id");
    if (!id) continue;

    emails.push({
      id,
      fid: getInt("fid"),
      from: decodeHtml(getString("from")),
      to: decodeHtml(getString("to")),
      cc: decodeHtml(getString("cc")),
      subject: decodeHtml(getString("subject")),
      date: getDate("sentDate") || getDate("receivedDate"),
      size: parseInt(getInt("size")) || 0,
      read: getBool("read"),
      hasAttachment: getBool("hasAttach") || getBool("hasRealAttach"),
      summary: decodeHtml(getString("summary")),
    });
  }

  return { total, emails };
}

/**
 * 通过 Web API 搜索邮件（服务端全文检索，毫秒级）
 */
export async function webSearchMessages(params: SearchParams): Promise<SearchResult> {
  const config = await getWebApiConfig();

  const body = {
    "fts.ext": true,
    "fts.fields": params.fields || "from,to,subj,cont,aname",
    "conditions": [],
    "groupings": {
      "fid": "",
      "flags.read": "",
      "sentDate": "",
      "flags.attached": "",
      "fromAddress": "",
    },
    "order": params.order || "date",
    "operator": "and",
    "desc": params.desc !== false,
    "start": params.start || 0,
    "windowSize": params.windowSize || 20,
    "pattern": params.pattern,
    "summaryWindowSize": params.windowSize || 20,
    "returnAttachments": true,
    "returnTotal": true,
    "returnTag": true,
    "fids": params.fids || [],
  };

  const xml = await callApi(config, "mbox:searchMessages", body);
  return parseSearchXml(xml);
}

/**
 * 通过 Web API 列出文件夹邮件
 */
export async function webListMessages(params: ListMessagesParams): Promise<SearchResult> {
  const config = await getWebApiConfig();

  const body = {
    fid: params.fid,
    start: params.start || 0,
    limit: params.limit || 20,
    order: params.order || "date",
    desc: params.desc !== false,
    returnTag: true,
    returnTotal: true,
  };

  const xml = await callApi(config, "mbox:listMessages", body);
  return parseSearchXml(xml);
}

/**
 * 通过 Web API 读取邮件详情
 */
export async function webReadMessage(params: ReadMessageParams): Promise<string> {
  const config = await getWebApiConfig();

  const body = {
    id: params.id,
    fid: params.fid,
    returnHeaders: true,
    returnBody: true,
  };

  return await callApi(config, "mbox:readMessage", body);
}

/**
 * 通过 Web API 获取所有文件夹
 */
export async function webGetAllFolders(): Promise<string> {
  const config = await getWebApiConfig();

  return await callApi(config, "mbox:getAllFolders", {});
}
