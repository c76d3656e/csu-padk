/**
 * 把整个单机服务打包成一个 exe（Node SEA）
 *
 *   npm run build        # 先产出 dist/
 *   npm run build:exe    # 再打包成 padk.exe
 *
 * 原理：Node 20.12+ 支持 Single Executable Application。
 *   1. 生成 sea-config.json，把 dist/ 下每个文件声明成 asset
 *   2. node --experimental-sea-config 生成注入用的 blob
 *   3. 复制一份 node.exe，把 blob 注进去
 *   4. 产物就是单文件，双击即用，目标机器不需要装 Node
 *
 * 注意：SEA 产物与构建平台的架构绑定（本机是 win32-x64），
 * 换个平台要重新构建，不能跨平台复制。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(ROOT, "padk.exe");

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("找不到 dist/index.html —— 先执行 npm run build");
  process.exit(1);
}

/** 递归收集 dist 下的文件，键名用正斜杠（与运行时 readAsset 的 key 一致） */
function collect(dir, prefix = "") {
  const out = {};
  for (const name of fs.readdirSync(dir)) {
    // 跳过隐藏项：dist/ 里可能残留 .git（推送静态托管时留下的），
    // 它是完整仓库，打进去既白增体积又会把 git 历史一起泄露出去
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(full).isDirectory()) Object.assign(out, collect(full, rel));
    else out[rel] = full;
  }
  return out;
}

const assets = collect(DIST);
const assetKeys = Object.keys(assets);
console.log(`打包 ${assetKeys.length} 个前端文件：`);
for (const k of assetKeys) console.log(`  ${k}`);

// ── 0) 入口编译成 CJS ──
// Node SEA 用 CommonJS 加载入口（embedderRunCjs），
// 直接拿 .mjs 当 main 会报「Cannot use import statement outside a module」。
console.log("\n把 server.mjs 编译成 CommonJS 入口…");
const esbuild = await import("esbuild");
const entryCjs = path.join(ROOT, "server.sea.cjs");
await esbuild.build({
  entryPoints: [path.join(ROOT, "server.mjs")],
  outfile: entryCjs,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["node:*"],
  // server.mjs 里那句 import.meta.url 只在非 SEA 分支执行（三元短路），
  // CJS 下转换它没有意义，这里静音掉对应告警，别让它干扰构建输出
  logOverride: { "empty-import-meta": "silent" },
  logLevel: "warning",
});

// ── 1) sea-config ──
const cfgPath = path.join(ROOT, "sea-config.json");
const blobPath = path.join(ROOT, "sea-prep.blob");
fs.writeFileSync(
  cfgPath,
  JSON.stringify(
    {
      main: entryCjs,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      assets,
    },
    null,
    2
  ),
  "utf8"
);

// ── 2) 生成 blob ──
console.log("\n生成 SEA blob…");
execFileSync(process.execPath, ["--experimental-sea-config", cfgPath], {
  cwd: ROOT,
  stdio: "inherit",
});

// ── 3) 复制 node.exe ──
console.log("\n复制运行时…");
fs.rmSync(OUT, { force: true });
fs.copyFileSync(process.execPath, OUT);

// ── 4) 注入 ──
// 直接调 postject 的 API，不走 npx 命令：
// Node 20+ 在 Windows 上 spawn .cmd 会抛 EINVAL（CVE-2024-27980 的修复），
// 而且 postject 已经装在本地依赖里，没必要再绕层。
console.log("注入 blob（postject）…");
const SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const { inject } = await import("postject");
await inject(OUT, "NODE_SEA_BLOB", fs.readFileSync(blobPath), {
  sentinelFuse: SENTINEL,
});

// ── 收尾 ──
fs.rmSync(blobPath, { force: true });
fs.rmSync(cfgPath, { force: true });
fs.rmSync(entryCjs, { force: true });

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log(`\n完成 → ${OUT}  (${mb} MB)`);
console.log("双击即可运行，目标机器无需安装 Node。");
