// XML 解析自检：node test/check.mjs（先 npm run build）
import assert from "assert";
import { parseSearchXml } from "../dist/tools/webApiClient.js";
import { parseFoldersXml } from "../dist/tools/listFolders.js";

// --- parseSearchXml ---
const searchXml = `
<result>
<int name="total">42</int>
<array name="var">
<object>
<string name="id"><![CDATA[AAAbBBB]]></string>
<int name="fid">1</int>
<string name="from"><![CDATA[张三 &lt;zhang@ex.com&gt;]]></string>
<string name="to"><![CDATA[me@ex.com]]></string>
<string name="subject"><![CDATA[测试 &amp; 报告]]></string>
<date name="sentDate">2026-09-01 10:00:00</date>
<int name="size">1024</int>
<boolean name="read">true</boolean>
<boolean name="hasAttach">false</boolean>
<object name="tag"><int name="x">9</int></object>
<string name="summary"><![CDATA[摘要内容]]></string>
</object>
<object>
<string name="id">SECOND</string>
<int name="fid">3</int>
<string name="from">a@b.com</string>
<string name="to">c@d.com</string>
<string name="subject">plain</string>
<date name="receivedDate">2026-09-02 11:00:00</date>
</object>
</array>
</result>`;

const r = parseSearchXml(searchXml);
assert.strictEqual(r.total, 42);
assert.strictEqual(r.emails.length, 2);
assert.strictEqual(r.emails[0].id, "AAAbBBB");
assert.strictEqual(r.emails[0].fid, "1");
assert.strictEqual(r.emails[0].from, "张三 <zhang@ex.com>");   // HTML 实体已解码
assert.strictEqual(r.emails[0].subject, "测试 & 报告");
assert.strictEqual(r.emails[0].date, "2026-09-01 10:00:00");
assert.strictEqual(r.emails[0].read, true);
assert.strictEqual(r.emails[1].id, "SECOND");
assert.strictEqual(r.emails[1].date, "2026-09-02 11:00:00");  // receivedDate 回退

// 空结果
const empty = parseSearchXml("<result><int name=\"total\">0</int></result>");
assert.strictEqual(empty.total, 0);
assert.strictEqual(empty.emails.length, 0);

// --- parseFoldersXml ---
const foldersXml = `
<result>
<array name="var">
<object>
<int name="id">1</int>
<string name="name">收件箱</string>
<object name="flags"><boolean name="system">true</boolean></object>
<object name="stats">
<int name="messageCount">100</int>
<int name="unreadMessageCount">5</int>
</object>
</object>
<object>
<int name="id">3</int>
<string name="name">已发送</string>
<object name="stats">
<int name="messageCount">50</int>
<int name="unreadMessageCount">0</int>
</object>
</object>
</array>
</result>`;

const folders = parseFoldersXml(foldersXml);
assert.strictEqual(folders.length, 2);
assert.deepStrictEqual(folders[0], { id: "1", name: "收件箱", unread: 5, total: 100 });
assert.deepStrictEqual(folders[1], { id: "3", name: "已发送", unread: 0, total: 50 });

// --- extractMessageText ---
const { extractMessageText } = await import("../dist/tools/webApiClient.js");

// 实体转义形态（真实 API 返回的样子）
const readXml = `<result><code>S_OK</code><object name="var">
<object name="html"><string name="contentType">text/html</string>
<string name="content">&lt;HTML&gt;&lt;BODY&gt;你好 &amp;amp; 世界&lt;br&gt;第二行&lt;/BODY&gt;&lt;/HTML&gt;</string>
</object></object></result>`;
assert.strictEqual(extractMessageText(readXml), "你好 & 世界 第二行");

// CDATA 形态
const readXml2 = `<object name="html"><string name="content"><![CDATA[<p>plain <b>text</b></p>]]></string></object>`;
assert.strictEqual(extractMessageText(readXml2), "plain text");

// 无正文
assert.strictEqual(extractMessageText("<result>FS_UNKNOWN</result>"), null);

console.log("✓ 全部断言通过 (parseSearchXml + parseFoldersXml + extractMessageText)");
