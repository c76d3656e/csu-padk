/**
 * 自检 —— npm run verify
 *
 * 只断言「同一份实现在不同运行时下行为一致」这件事，不联网、不需要账号。
 * 覆盖三块：
 *   A. 加密等价性：共享实现与参考实现（node:crypto 复刻）逐字节相同
 *   B. 接口层路由：handler.js 对各种请求的响应形态
 *   C. 本机服务：真实起一个进程，跑一遍静态与接口路由
 */
import { build } from "esbuild";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const TMP = path.join(ROOT, ".build", "verify");

let pass = 0;
const fails = [];
function ok(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fails.push(name + (detail ? " —— " + detail : ""));
    console.log("  ✗ " + name + (detail ? " —— " + detail : ""));
  }
}

/**
 * 把入口连同它引用的 .ts 共享模块打成一个临时 ESM，便于在任意 Node 上 import。
 * 返回磁盘路径；import 时需转成 file:// URL（Windows 下否则会被当成协议名）。
 */
async function bundle(entry, name) {
  fs.mkdirSync(TMP, { recursive: true });
  const out = path.join(TMP, name);
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["node:*"],
    logLevel: "warning",
  });
  return out;
}

/** 把磁盘路径转成可 import 的 URL */
const asUrl = (p) => pathToFileURL(p).href;

/* ── A. 加密等价性 ── */
console.log("\nA. 加密等价性");
const kc = await import(asUrl(await bundle(path.join(ROOT, "src/core/kcipher.ts"), "kcipher.mjs")));

/** 参考实现：用 node:crypto 复刻同一套算法 */
function refEncrypt(plain, salt, ivStr, pad64) {
  const key = Buffer.from(salt.trim().slice(0, 16), "utf8");
  const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.from(ivStr, "utf8"));
  return Buffer.concat([
    cipher.update(Buffer.from(pad64 + plain, "utf8")),
    cipher.final(),
  ]).toString("base64");
}

const IV = "0123456789abcdef";
const PAD = "x".repeat(64);
const CASES = [
  ["12345678", "AbCdEfGhIjKlMnOp"],
  ["P@ssw0rd 带空格", "ZzYyXxWwVvUuTtSs"],
  ["中文密码测试", "qwertyuiopasdfgh"],
  ["a".repeat(40), "ABCDEFGH12345678"],
  ["simple", "MNBVCXZLKJHGFDS2"],
];
for (const [pw, salt] of CASES) {
  const a = await kc.encryptPasswordFixed(pw, salt, IV, PAD);
  const b = refEncrypt(pw, salt, IV, PAD);
  ok("密文一致 · " + JSON.stringify(pw).slice(0, 14), a === b, a === b ? "" : a + " ≠ " + b);
}
ok("随机版本产出合法 base64 且非明文", await (async () => {
  const c = await kc.encryptPassword("secret123", "AbCdEfGhIjKlMnOp");
  return /^[A-Za-z0-9+/]+=*$/.test(c) && c.length > 40 && !c.includes("secret123");
})());
ok("盐值长度异常给出可读报错", await (async () => {
  try {
    await kc.encryptPassword("x", "短盐");
    return false;
  } catch (e) {
    return /登录盐值长度异常/.test(e.message);
  }
})());
ok("casual 为 16 位字母数字", /^[A-Za-z0-9]{16}$/.test(kc.generateCasual(16)));

/* ── B. 接口层路由 ── */
console.log("\nB. 接口层路由");
const handler = await import(asUrl(await bundle(path.join(ROOT, "src/edge/handler.js"), "handler.mjs")));

const H = "http://localhost:5173";
const post = (p, body) =>
  new Request(H + p, { method: "POST", headers: { "Content-Type": "application/json" }, body });

ok("非接口路径返回 null（交给静态资源）", (await handler.handleApi(new Request(H + "/"))) === null);
ok("GET 登录接口 → 405", (await handler.handleApi(new Request(H + "/__auth/login"))).status === 405);
const empty = await handler.handleApi(post("/__auth/login", "{}"));
ok("POST 空参 → 400 缺少账号或密码", empty.status === 400 && (await empty.json()).error === "缺少账号或密码");
const bad = await handler.handleApi(post("/__auth/login", "not json"));
ok("POST 非法 JSON → 400", bad.status === 400);
const carried = await handler.handleApi(
  new Request(H + "/api/edge?__padk=%2F__auth%2Flogin", { method: "POST", body: "{}" })
);
ok("Vercel 重写路径可还原（__padk 参数）", carried.status === 400);

/* ── C. 本机服务 ── */
console.log("\nC. 本机服务");
if (!fs.existsSync(path.join(ROOT, "dist", "index.html"))) {
  console.log("  · 跳过：还没有 dist/，先跑 npm run build");
} else {
  const entry = await bundle(path.join(ROOT, "src/server/server.mjs"), "server.mjs");
  const PORT = 5199;
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(PORT), PADK_DIST: path.join(ROOT, "dist") },
    stdio: ["ignore", "ignore", "inherit"],
  });
  child.on("error", (e) => console.log("  · 子进程启动失败：" + e.message));
  const base = `http://127.0.0.1:${PORT}`;
  const wait = async () => {
    for (let i = 0; i < 80; i++) {
      try {
        await fetch(base + "/");
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    return false;
  };
  try {
    const up = await wait();
    ok("服务启动", up);
    if (!up) throw new Error("本机服务未在 20 秒内就绪，跳过后续断言");
    const home = await fetch(base + "/");
    const html = await home.text();
    ok("GET / → 200 且注入自托管标记", home.status === 200 && html.includes("__PADK_SELF_HOSTED__"));
    const inj = await fetch(base + "/inject.js");
    ok("GET /inject.js → 200", inj.status === 200);
    ok("GET /__auth/login → 405", (await fetch(base + "/__auth/login")).status === 405);
    const r = await fetch(base + "/__auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    ok("POST 空参 → 400", r.status === 400);
    ok("未知路径 → 404", (await fetch(base + "/no-such-file.txt")).status === 404);
  } catch (e) {
    fails.push("本机服务断言中断：" + (e?.message || e));
    console.log("  ✗ 本机服务断言中断 —— " + (e?.message || e));
  } finally {
    child.kill();
  }
}

/* ── 汇总 ── */
console.log("");
if (fails.length) {
  console.log(`${pass} 项通过，${fails.length} 项失败：`);
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`全部 ${pass} 项通过。`);
