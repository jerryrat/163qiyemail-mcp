/**
 * 网易企业邮箱纯 HTTP 登录
 * 无需浏览器，通过 prelogin API 获取 RSA 公钥，加密密码后登录获取 sid 和 Cookie
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, "../../.session.json");

export interface SessionData {
  sid: string;
  cookie: string;
  timestamp: number;
  expiresAt: number;
}

export function loadSession(): SessionData | null {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8")) as SessionData;
    if (Date.now() > data.expiresAt) {
      try { fs.unlinkSync(SESSION_FILE); } catch {}
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveSession(data: SessionData): void {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
}

export function clearSession(): void {
  try { fs.unlinkSync(SESSION_FILE); } catch {}
}

/**
 * 从 modulus (hex) 和 exponent (hex) 构建 PEM 格式 RSA 公钥
 */
function buildPublicKeyPem(modHex: string, expHex: string): string {
  const mod = Buffer.from(modHex, "hex");
  const exp = Buffer.from(expHex, "hex");

  function asn1Length(len: number): Buffer {
    if (len < 128) return Buffer.from([len]);
    if (len < 256) return Buffer.from([0x81, len]);
    return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  }

  function asn1Integer(buf: Buffer): Buffer {
    const needPad = buf[0] & 0x80;
    const content = needPad ? Buffer.concat([Buffer.from([0x00]), buf]) : buf;
    return Buffer.concat([Buffer.from([0x02]), asn1Length(content.length), content]);
  }

  const modInt = asn1Integer(mod);
  const expInt = asn1Integer(exp);
  const seqContent = Buffer.concat([modInt, expInt]);
  const seq = Buffer.concat([Buffer.from([0x30]), asn1Length(seqContent.length), seqContent]);

  const bitString = Buffer.concat([
    Buffer.from([0x03]),
    asn1Length(seq.length + 1),
    Buffer.from([0x00]),
    seq,
  ]);

  // RSA algorithm OID
  const algOid = Buffer.from([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);

  const outerContent = Buffer.concat([algOid, bitString]);
  const outer = Buffer.concat([Buffer.from([0x30]), asn1Length(outerContent.length), outerContent]);

  const b64 = outer.toString("base64");
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

/**
 * 纯 HTTP 登录网易企业邮箱
 */
export async function webLogin(): Promise<SessionData> {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    throw new Error("SMTP_USER 和 SMTP_PASS 未配置");
  }

  const host = process.env.WEB_HOST || "mail.qiye.163.com";
  const domain = user.split("@")[1];
  const accountName = user.split("@")[0];
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/146.0.0.0";

  // 1. prelogin: 获取 RSA 公钥和随机数
  const preUrl = `https://${host}/login/prelogin.jsp?uid=${encodeURIComponent(user)}&sdid=1`;
  const preRes = await fetch(preUrl, { headers: { "User-Agent": ua } });
  const preData = (await preRes.json()) as {
    code: number;
    data: { modulus: string; exponent: string; rand: string; pubid: string; _sDeviceId?: string };
  };

  if (preData.code !== 200 || !preData.data?.modulus) {
    throw new Error(`prelogin 失败: ${JSON.stringify(preData)}`);
  }

  const { modulus, exponent, rand, pubid, _sDeviceId } = preData.data;

  // 2. RSA 加密: password + "#" + rand
  const pem = buildPublicKeyPem(modulus, exponent);
  const plaintext = `${pass}#${rand}`;
  const encrypted = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(plaintext)
  );
  const encHex = encrypted.toString("hex");

  // 3. POST 登录
  const loginParams = new URLSearchParams({
    domain,
    account_name: accountName,
    secure: "1",
    all_secure: "1",
    language: "0",
    pubid,
    passtype: "3",
    accname: user,
    password: encHex,
    ..._sDeviceId ? { _sDeviceId } : {},
  });

  const loginRes = await fetch(
    `https://${host}/login/domainEntLogin?autoEntry=true`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": ua,
      },
      body: loginParams.toString(),
      redirect: "manual",
    }
  );

  // 4. 提取 sid
  const location = loginRes.headers.get("location") || "";
  const sidMatch = location.match(/sid=([^&]+)/);
  if (!sidMatch) {
    if (location.includes("PASSERR")) {
      throw new Error("登录失败: 账号或密码错误");
    }
    throw new Error(`登录失败，未获取到 sid。redirect: ${location.substring(0, 200)}`);
  }

  // 5. 提取 Cookie
  const setCookies: string[] = [];
  // Node.js fetch 支持 getSetCookie() 获取多个 Set-Cookie 头
  const rawSetCookies = (loginRes.headers as any).getSetCookie?.() as string[] | undefined;
  if (rawSetCookies) {
    for (const c of rawSetCookies) {
      setCookies.push(c.split(";")[0]);
    }
  } else {
    // 回退: 遍历 headers
    loginRes.headers.forEach((value, name) => {
      if (name.toLowerCase() === "set-cookie") {
        // 可能多个 cookie 被合并，按逗号分割（但要注意 expires 中的逗号）
        for (const part of value.split(/,(?=[^ ])/)) {
          setCookies.push(part.split(";")[0].trim());
        }
      }
    });
  }
  const cookieString = setCookies.join("; ");

  const session: SessionData = {
    sid: sidMatch[1],
    cookie: cookieString,
    timestamp: Date.now(),
    expiresAt: Date.now() + 20 * 60 * 60 * 1000, // 20 小时
  };

  saveSession(session);
  return session;
}

/**
 * 获取有效的 session（优先缓存 → .env → 自动登录）
 */
export async function getValidSession(): Promise<SessionData> {
  // 1. .env 手动配置
  if (process.env.WEB_SID && process.env.WEB_COOKIE) {
    return {
      sid: process.env.WEB_SID,
      cookie: process.env.WEB_COOKIE,
      timestamp: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
  }

  // 2. 缓存 session
  const cached = loadSession();
  if (cached) return cached;

  // 3. 自动登录
  return await webLogin();
}
