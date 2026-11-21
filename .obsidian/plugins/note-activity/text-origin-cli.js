#!/usr/bin/env node
// Apply explicitly recorded Codex edits through the running Obsidian plugin.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");

const root = fs.realpathSync(path.resolve(__dirname, "../../.."));
const vaultName = path.basename(root);
const requestDirectory = path.join(root, ".obsidian/plugins/note-activity");
const command = process.argv[2];
const requestedPath = process.argv[3];

function vaultPath(input) {
  if (!input) throw new Error("请提供笔记路径");
  const candidate = path.resolve(root, input);
  let ancestor = candidate;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error("找不到笔记目录");
    ancestor = parent;
  }
  const realAncestor = fs.realpathSync(ancestor);
  const absolute = path.resolve(realAncestor, path.relative(ancestor, candidate));
  const relative = path.relative(root, absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !relative.toLowerCase().endsWith(".md")) {
    throw new Error("笔记必须是知识库内的 Markdown 文件");
  }
  return { absolute, relative: relative.split(path.sep).join("/") };
}

function invoke(expression) {
  const code = `(async () => { const fs = require("node:fs"); const openedRoot = fs.realpathSync(app.vault.adapter.getBasePath()); if (openedRoot !== ${JSON.stringify(root)}) return JSON.stringify({ok:false,error:"Obsidian 打开的库与脚本所在目录不一致"}); const plugin = app.plugins.plugins["note-activity"]; if (!plugin?.textOrigin) return JSON.stringify({ok:false,error:"个人工作台插件未启用"}); ${expression} })()`;
  const output = execFileSync("obsidian", [`vault=${vaultName}`, "eval", `code=${code}`], { encoding: "utf8", timeout: 30000 });
  const line = output.trim().match(/^=>\s*(\{.*\})$/s);
  if (!line) throw new Error(`无法读取 Obsidian 的响应：${output.trim()}`);
  return JSON.parse(line[1]);
}

function run() {
  const note = vaultPath(requestedPath);
  if (command === "status") {
    const result = invoke(`return JSON.stringify({ok:true,tracked:!!plugin.textOrigin.record(${JSON.stringify(note.relative)}),readOnly:!!plugin.textOrigin.readOnly});`);
    if (!result.ok) throw new Error(result.error);
    if (result.readOnly) throw new Error("文字来源数据无法读取，不能确认笔记是否加入试用");
    console.log(JSON.stringify(result));
    return;
  }
  if (command !== "apply" || !process.argv[4]) {
    throw new Error("用法：text-origin-cli.js status 笔记路径，或 apply 笔记路径 修改列表.json");
  }
  if (!fs.existsSync(note.absolute)) throw new Error("笔记尚不存在，无法应用修改");
  const changes = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
  if (!Array.isArray(changes) || !changes.length) throw new Error("修改列表必须是非空数组");
  const request = { path: note.relative, expected: fs.readFileSync(note.absolute, "utf8"), changes };
  const requestName = `text-origin-${randomUUID()}.tmp`;
  const requestFile = path.join(requestDirectory, requestName);
  const adapterPath = `.obsidian/plugins/note-activity/${requestName}`;
  const responseName = `text-origin-${randomUUID()}.tmp`;
  const responseFile = path.join(requestDirectory, responseName);
  const adapterResponse = `.obsidian/plugins/note-activity/${responseName}`;
  try {
    fs.writeFileSync(requestFile, JSON.stringify(request), { flag: "wx", mode: 0o600 });
    let result;
    try {
      result = invoke(`const request = JSON.parse(await app.vault.adapter.read(${JSON.stringify(adapterPath)})); const response = await plugin.textOrigin.applyCodexChanges(request); await app.vault.adapter.write(${JSON.stringify(adapterResponse)}, JSON.stringify(response)); return JSON.stringify(response);`);
    } catch (_error) {
      // Obsidian's eval can return before an asynchronous operation has finished.
      // A receipt distinguishes a completed edit from an ambiguous outcome.
      const deadline = Date.now() + 10000;
      const wait = new Int32Array(new SharedArrayBuffer(4));
      while (Date.now() < deadline) {
        if (fs.existsSync(responseFile)) {
          try { result = JSON.parse(fs.readFileSync(responseFile, "utf8")); break; }
          catch (_parseError) { /* The receipt may still be writing. */ }
        }
        Atomics.wait(wait, 0, 0, 100);
      }
      if (!result) throw new Error("无法确认修改是否完成，请检查笔记和来源记录后再操作");
    }
    if (!result.ok) {
      const prefix = result.applied ? "笔记已修改，但文字来源记录保存失败：" : "修改未完成：";
      throw new Error(prefix + result.error);
    }
    console.log(JSON.stringify(result));
  } finally {
    if (fs.existsSync(requestFile)) fs.unlinkSync(requestFile);
    if (fs.existsSync(responseFile)) fs.unlinkSync(responseFile);
  }
}

try { run(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
