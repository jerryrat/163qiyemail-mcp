#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import dotenv from "dotenv";

import { createSendEmailTool } from "./tools/sendEmail.js";
import { createReadEmailsTool } from "./tools/readEmails.js";
import { createSearchEmailsTool } from "./tools/searchEmails.js";
import { createDeleteEmailTool } from "./tools/deleteEmail.js";
import { createReplyEmailTool } from "./tools/replyEmail.js";
import { createListFoldersTool } from "./tools/listFolders.js";
import { createFindEmailFolderTool } from "./tools/findEmailFolder.js";
import { createGetCorrespondenceTool } from "./tools/getCorrespondence.js";

dotenv.config();

// Validation schemas
const SendEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string(),
  body: z.string(),
  from: z.string().email().optional(),
  html: z.coerce.boolean().optional(),
  attachments: z.array(z.object({
    filename: z.string(),
    path: z.string().optional(),
    content: z.string().optional(),
  })).optional(),
});

const ReadEmailsSchema = z.object({
  limit: z.coerce.number().optional().default(10),
  folder: z.string().optional().default("INBOX"),
  unreadOnly: z.coerce.boolean().optional().default(false),
});

const SearchEmailsSchema = z.object({
  query: z.string(),
  limit: z.coerce.number().optional().default(10),
  folder: z.string().optional().default("ALL"),
  searchBody: z.coerce.boolean().optional().default(false),
});

const DeleteEmailSchema = z.object({
  messageId: z.string(),
  folder: z.string().optional().default("INBOX"),
});

const ReplyEmailSchema = z.object({
  messageId: z.string(),
  body: z.string(),
  replyAll: z.coerce.boolean().optional().default(false),
  html: z.coerce.boolean().optional().default(false),
  folder: z.string().optional().default("INBOX"),
});

const ListFoldersSchema = z.object({});

const FindEmailFolderSchema = z.object({
  query: z.string(),
  limit: z.coerce.number().optional().default(10),
});

const GetCorrespondenceSchema = z.object({
  email: z.string(),
  limit: z.coerce.number().optional().default(20),
});

class EmailMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      { name: "163qiyemail-mcp", version: "2.0.0" },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = [
        {
          name: "send_email",
          description: "发送邮件",
          inputSchema: {
            type: "object",
            properties: {
              to: { type: "string", description: "收件人邮箱地址" },
              subject: { type: "string", description: "邮件主题" },
              body: { type: "string", description: "邮件正文" },
              from: { type: "string", description: "发件人邮箱（可选）" },
              html: { type: "boolean", description: "是否 HTML 格式" },
              attachments: {
                type: "array", description: "附件列表",
                items: {
                  type: "object",
                  properties: {
                    filename: { type: "string" },
                    path: { type: "string" },
                    content: { type: "string" },
                  },
                },
              },
            },
            required: ["to", "subject", "body"],
          },
        },
        {
          name: "read_emails",
          description: "读取收件箱或指定文件夹的邮件",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", description: "读取数量（默认10）" },
              folder: { type: "string", description: "文件夹名称（默认 INBOX）" },
              unreadOnly: { type: "boolean", description: "仅读取未读邮件" },
            },
          },
        },
        {
          name: "search_emails",
          description: "全文搜索邮件（支持发件人、收件人、主题、正文、附件名）",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "搜索关键词" },
              limit: { type: "number", description: "返回数量（默认10）" },
              folder: { type: "string", description: "搜索范围，ALL=所有文件夹（默认 ALL）" },
              searchBody: { type: "boolean", description: "搜索正文内容（IMAP 回退时使用）" },
            },
            required: ["query"],
          },
        },
        {
          name: "delete_email",
          description: "删除指定邮件",
          inputSchema: {
            type: "object",
            properties: {
              messageId: { type: "string", description: "邮件 ID (UID)" },
              folder: { type: "string", description: "邮件所在文件夹（默认 INBOX）" },
            },
            required: ["messageId"],
          },
        },
        {
          name: "reply_email",
          description: "回复邮件",
          inputSchema: {
            type: "object",
            properties: {
              messageId: { type: "string", description: "原邮件 ID (UID)" },
              body: { type: "string", description: "回复正文" },
              replyAll: { type: "boolean", description: "回复所有人" },
              html: { type: "boolean", description: "是否 HTML 格式" },
              folder: { type: "string", description: "原邮件所在文件夹（默认 INBOX）" },
            },
            required: ["messageId", "body"],
          },
        },
        {
          name: "list_folders",
          description: "列出邮箱中所有文件夹及其邮件数量",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "find_email_folder",
          description: "搜索邮件并显示其所在的文件夹",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "搜索关键词（主题、发件人、收件人等）" },
              limit: { type: "number", description: "返回数量（默认10）" },
            },
            required: ["query"],
          },
        },
        {
          name: "get_correspondence",
          description: "获取与指定邮箱地址的所有往来邮件（收发双向）",
          inputSchema: {
            type: "object",
            properties: {
              email: { type: "string", description: "对方邮箱地址" },
              limit: { type: "number", description: "返回数量（默认20）" },
            },
            required: ["email"],
          },
        },
      ];

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case "send_email": {
            const args = SendEmailSchema.parse(request.params.arguments);
            return await createSendEmailTool()(args);
          }
          case "read_emails": {
            const args = ReadEmailsSchema.parse(request.params.arguments || {});
            return await createReadEmailsTool()(args);
          }
          case "search_emails": {
            const args = SearchEmailsSchema.parse(request.params.arguments);
            return await createSearchEmailsTool()(args);
          }
          case "delete_email": {
            const args = DeleteEmailSchema.parse(request.params.arguments);
            return await createDeleteEmailTool()(args);
          }
          case "reply_email": {
            const args = ReplyEmailSchema.parse(request.params.arguments);
            return await createReplyEmailTool()(args);
          }
          case "list_folders": {
            ListFoldersSchema.parse(request.params.arguments || {});
            return await createListFoldersTool()();
          }
          case "find_email_folder": {
            const args = FindEmailFolderSchema.parse(request.params.arguments);
            return await createFindEmailFolderTool()(args);
          }
          case "get_correspondence": {
            const args = GetCorrespondenceSchema.parse(request.params.arguments);
            return await createGetCorrespondenceTool()(args);
          }
          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return { content: [{ type: "text", text: `Error: ${errorMessage}` }] };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("163 企业邮箱 MCP Server 已启动 (stdio)");
  }
}

const server = new EmailMCPServer();
server.run().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
