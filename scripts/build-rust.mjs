/**
 * 把整个服务编译成 Rust standalone 单文件（axum + 内嵌前端）
 *
 *   npm run build        # 先产出 dist/
 *   npm run build:rust   # 再产出 padk-rs.exe
 *
 * 与 build-exe.mjs（Node SEA）的区别：
 *   SEA 把 node.exe 整个复制一份（90 MB，UPX 后 22 MB）；
 *   Rust 版只链进 TLS 客户端 + AES + 前端资源，产物 ~2.2 MB。
 *
 * 前端资源不是运行时读盘，而是 build.rs 扫描 ../dist 后用 include_bytes!
 * 编进二进制 —— 换 dist 必须重新 cargo build，脚本已把 rerun-if-changed 挂上。
 * 产物与构建平台架构绑定（本机 win32-x64），跨平台要各自构建。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DIST = path.join(ROOT, "dist");
const CRATE = path.join(ROOT, "rust");
const OUT = path.join(ROOT, "padk-rs.exe");

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("找不到 dist/index.html —— 先执行 npm run build");
  process.exit(1);
}
if (!fs.existsSync(path.join(CRATE, "Cargo.toml"))) {
  console.error("找不到 rust/Cargo.toml —— rust 子工程缺失");
  process.exit(1);
}

function walk(dir, prefix = "") {
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) n += walk(full, prefix + name + "/");
    else n += 1;
  }
  return n;
}
console.log(`内嵌前端 ${walk(DIST)} 个文件，开始 cargo build --release…`);

const t0 = Date.now();
try {
  execFileSync("cargo", ["build", "--release"], { cwd: CRATE, stdio: "inherit" });
} catch (e) {
  console.error("cargo build 失败：", e.message);
  process.exit(1);
}

const built = path.join(CRATE, "target", "release", process.platform === "win32" ? "padk.exe" : "padk");
if (!fs.existsSync(built)) {
  console.error("构建成功但找不到产物：" + built);
  process.exit(1);
}
fs.copyFileSync(built, OUT);

const mb = fs.statSync(OUT).size / 1024 / 1024;
console.log(`\n产出 ${path.relative(ROOT, OUT)}  ${mb.toFixed(2)} MB  （${((Date.now() - t0) / 1000).toFixed(1)}s）`);
const sea = path.join(ROOT, "padk.exe");
if (fs.existsSync(sea)) {
  const smb = fs.statSync(sea).size / 1024 / 1024;
  console.log(`对比 Node SEA 版 padk.exe：${smb.toFixed(2)} MB → 缩小 ${(smb / mb).toFixed(1)}×`);
}
console.log("直接运行：.\\padk-rs.exe    （默认 0.0.0.0:5173，PORT/HOST 可覆盖）");
