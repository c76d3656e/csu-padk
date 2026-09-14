/**
 * 把 inject.js 合并进 dist/，让静态站自包含：
 *   dist/inject.js   ← 书签引用的固定路径（不带 hash）
 *
 * 同时回填一份到 public/：
 *   dev server 下的 host.html 通过 /inject.js 取包，
 *   那个路径由 public/ 提供。不同步的话本地调试看到的是旧产物。
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = path.join(root, "dist-inject", "inject.js");
const dstDir = path.join(root, "dist");
const dst = path.join(dstDir, "inject.js");

if (!fs.existsSync(src)) {
  console.error("[merge] 找不到 dist-inject/inject.js，请先构建注入包");
  process.exit(1);
}
fs.mkdirSync(dstDir, { recursive: true });
fs.copyFileSync(src, dst);

const kb = (fs.statSync(dst).size / 1024).toFixed(1);
console.log(`[merge] dist/inject.js  (${kb} kB)`);

const pubDir = path.join(root, "public");
fs.mkdirSync(pubDir, { recursive: true });
fs.copyFileSync(src, path.join(pubDir, "inject.js"));
console.log(`[merge] public/inject.js  (${kb} kB) —— 供 dev 下的 host.html 使用`);

console.log("[merge] 静态站点已自包含，直接把 dist/ 整个上传即可");
