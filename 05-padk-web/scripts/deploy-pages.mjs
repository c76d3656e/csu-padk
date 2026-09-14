/**
 * 把 dist/ 发布到 GitHub Pages（gh-pages 分支）
 *
 *   npm run build
 *   npm run deploy
 *
 * 用 gh CLI 的凭据推送（本机需已 gh auth login）。
 * 仓库地址可用 PADK_PAGES_REMOTE 覆盖。
 *
 * 说明：dist/ 在项目根 .gitignore 里，它自己是独立仓库，
 * 不会污染主仓库；这里推的是它的内容到远端 gh-pages 分支。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DIST = path.join(ROOT, "dist");
const REMOTE =
  process.env.PADK_PAGES_REMOTE || "https://github.com/c76d3656e/csu-padk.git";
const PAGES_URL = process.env.PADK_PAGES_URL || "https://c76d3656e.github.io/csu-padk/";

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("找不到 dist/index.html —— 先执行 npm run build");
  process.exit(1);
}

const run = (cmd, allowFail = false) => {
  console.log(`  $ ${cmd}`);
  try {
    execSync(cmd, { cwd: DIST, stdio: "inherit" });
  } catch (e) {
    if (!allowFail) throw e;
  }
};

console.log("发布 dist/ 到 gh-pages\n");

if (!fs.existsSync(path.join(DIST, ".git"))) {
  run("git init -b main");
  run(`git remote add origin ${REMOTE}`);
} else {
  run(`git remote set-url origin ${REMOTE}`);
}

run("git add -A");
// 没有变更时 commit 会返回非零，属正常
run(`git commit -m "deploy: ${new Date().toISOString().slice(0, 19).replace("T", " ")}"`, true);
run("git push -f origin main:gh-pages");

console.log(`\n已推送。Pages 通常 1 分钟内生效：`);
console.log(`  引导页（含书签）  ${PAGES_URL}#/guide`);
console.log(`  注入包            ${PAGES_URL}inject.js`);
