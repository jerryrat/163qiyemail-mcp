# 163 企业邮箱 MCP Server

网易企业邮箱 (qiye.163.com) 的 MCP Server，为 AI 助手提供邮件操作能力。

**核心特性：** 搜索通过逆向网页端 Web API 实现，纯 HTTP 自动登录获取 session，无需浏览器，毫秒级全文检索。

## 功能列表

| 工具 | 说明 |
|------|------|
| `send_email` | 发送邮件（支持 HTML、附件） |
| `read_emails` | 读取收件箱或指定文件夹的邮件 |
| `search_emails` | 全文搜索邮件（发件人、收件人、主题、正文、附件名） |
| `delete_email` | 删除指定邮件 |
| `reply_email` | 回复邮件（支持回复全部） |
| `list_folders` | 列出所有邮箱文件夹及邮件数量 |
| `find_email_folder` | 搜索邮件并显示其所在文件夹 |
| `get_correspondence` | 获取与指定邮箱的所有往来邮件（收发双向） |

## 快速开始

### 1. 安装

```bash
git clone https://github.com/jerryrat/163qiyemail-mcp.git
cd 163qiyemail-mcp
npm install
npm run build
```

### 2. 配置

```bash
cp env.example .env
```

编辑 `.env`，填写企业邮箱账号和密码：

```env
SMTP_HOST=smtphz.qiye.163.com
SMTP_PORT=994
SMTP_SECURE=true
IMAP_HOST=imaphz.qiye.163.com
IMAP_PORT=993
IMAP_SECURE=true

SMTP_USER=your-email@your-domain.com
SMTP_PASS="your-password"
DEFAULT_FROM_EMAIL=your-email@your-domain.com

WEB_HOST=mail.qiye.163.com
```

> **注意：** 密码中含 `#` 等特殊字符时必须用双引号包裹。

### 3. 接入 Claude

**Claude Desktop** — 编辑 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "163qiyemail": {
      "command": "node",
      "args": ["/path/to/163qiyemail-mcp/dist/index.js"],
      "cwd": "/path/to/163qiyemail-mcp"
    }
  }
}
```

**Claude Code** — 编辑 `.claude/settings.json`：

```json
{
  "mcpServers": {
    "163qiyemail": {
      "command": "node",
      "args": ["/path/to/163qiyemail-mcp/dist/index.js"],
      "cwd": "/path/to/163qiyemail-mcp"
    }
  }
}
```

## 服务器部署（SSE 模式）

适用于远程服务器或多客户端场景：

```bash
npm run start-gateway
# 监听 http://localhost:3200
```

客户端配置：

```json
{
  "mcpServers": {
    "163qiyemail": {
      "url": "http://your-server:3200/sse"
    }
  }
}
```

## 技术架构

```
搜索请求
  │
  ├─ 有 SMTP_USER/SMTP_PASS？
  │   ├─ 是 → 纯 HTTP 自动登录 → Web API 全文检索（~350ms）
  │   └─ 否 → 报错
  │
  └─ Web API 失败？
      └─ 自动回退 IMAP 逐封扫描
```

### 搜索性能对比

| 方案 | 耗时 | 结果覆盖 |
|------|------|----------|
| IMAP 逐封扫描 | ~67,000ms | 仅主题/信封匹配 |
| **Web API** | **~350ms** | **全文检索（含正文、附件名）** |

### 自动登录原理

1. `GET /login/prelogin.jsp` → 获取 RSA 公钥 (modulus, exponent) + 随机数 (rand)
2. Node.js `crypto.publicEncrypt` → RSA PKCS1 加密 `password#rand`
3. `POST /login/domainEntLogin` → 获取 sid + Cookie
4. Session 缓存 20 小时，过期自动刷新

**无需浏览器、无需手动提供 Cookie，Linux/Windows/Mac 均可运行。**

## 数据中心配置

| 机房 | SMTP | IMAP | WEB_HOST |
|------|------|------|----------|
| 杭州 | smtphz.qiye.163.com:994 | imaphz.qiye.163.com:993 | mail.qiye.163.com |
| 北京 | smtp.qiye.163.com:994 | imap.qiye.163.com:993 | mail.qiye.163.com |

## License

ISC
