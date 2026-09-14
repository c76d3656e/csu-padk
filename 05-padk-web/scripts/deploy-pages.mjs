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

/** 推送对网络波动敏感，失败重试几次再放弃 */
const pushWithRetry = (attempts = 4) => {
  for (let i = 1; i <= attempts; i++) {
    console.log(`  $ git push -f origin main:gh-pages   （第 ${i}/${attempts} 次）`);
    try {
      execSync("git push -f origin main:gh-pages", { cwd: DIST, stdio: "inherit" });
      return true;
    } catch {
      if (i < attempts) {
        const wait = i * 3;
        console.log(`  推送失败（多为网络重置），${wait}s 后重试…`);
        execSync(`ping -n ${wait + 1} 127.0.0.1 > nul`, { stdio: "ignore", shell: "cmd.exe" });
      }
    }
  }
  return false;
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

if (!pushWithRetry()) {
  console.error("\n推送失败——通常是网络重置。可以稍后单独重试：");
  console.error("  cd 05-padk-web/dist");
  console.error("  git push -f origin main:gh-pages");
  process.exit(1);
}

console.log(`\n已推送。Pages 通常 1 分钟内生效：`);
console.log(`  引导页（含书签）  ${PAGES_URL}#/guide`);
console.log(`  注入包            ${PAGES_URL}inject.js`);
