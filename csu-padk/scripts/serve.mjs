/**
 * 本机服务启动器 —— npm start
 *
 * 为什么要先编译一步：src/server/server.mjs 直接 import 了 src/core 下的
 * TypeScript 模块（与边缘入口共用同一份实现）。Node 只有在 22.6+ 才能
 * 直接加载 .ts，这里用 esbuild 先打成一个临时 ESM 文件再启动，
 * 任何 Node 20.12+ 都能跑，也保证了本机形态与 exe 形态走同一条编译路径。
 *
 * 产物写在 .build/ 下，已被 .gitignore 忽略。
 */
import { build } from "esbuild";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const OUT_DIR = path.join(ROOT, ".build");
const OUT = path.join(OUT_DIR, "server.mjs");

fs.mkdirSync(OUT_DIR, { recursive: true });

await build({
  entryPoints: [path.join(ROOT, "src/server/server.mjs")],
  outfile: OUT,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["node:*"],
  logLevel: "warning",
  logOverride: { "empty-import-meta": "silent" },
});

const child = spawn(process.execPath, [OUT], {
  stdio: "inherit",
  env: { ...process.env, PADK_DIST: path.join(ROOT, "dist") },
});
child.on("exit", (code) => process.exit(code ?? 0));
