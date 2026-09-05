// 只读联调：登录 + 文件夹 + 搜索 + 读件（不发送、不删除）
// node test/live.mjs
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env"), override: true });

const { createListFoldersTool } = await import("../dist/tools/listFolders.js");
const { createSearchEmailsTool } = await import("../dist/tools/searchEmails.js");
const { createReadEmailsTool } = await import("../dist/tools/readEmails.js");

function show(name, res) {
  const text = res.content[0].text;
  console.log(`\n===== ${name} =====`);
  console.log(text.length > 600 ? text.slice(0, 600) + "\n...(截断)" : text);
}

show("list_folders", await createListFoldersTool()());
show("search_emails(发票)", await createSearchEmailsTool()({ query: "发票", limit: 3, folder: "ALL" }));
show("read_emails(INBOX x2)", await createReadEmailsTool()({ limit: 2, folder: "INBOX", unreadOnly: false }));
