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

/*
 * B2. 转发响应头净化
 *
 * 这是一条防回归断言，对应一个真实踩过的坑：上游返回 gzip 实体时，Node 的
 * undici 会把 body 自动解开，却把 content-encoding: gzip 留在响应头里。
 * 原样转发出去，下游就拿明文去按 gzip 解 —— curl 报 61，浏览器报
 * "Failed to fetch"。workerd 会自己剥掉这个头，所以只在 exe 形态下暴露，
 * 极易漏测。这里直接对净化函数下断言，不依赖网络。
 */
const dirty = new Headers({
  "content-type": "application/json;charset=UTF-8",
  "content-encoding": "gzip",
  "content-length": "196",
  "transfer-encoding": "chunked",
  vary: "Accept-Encoding",
});
const clean = handler.sanitizeProxyHeaders(dirty);
ok("净化：剥掉 content-encoding", !clean.has("content-encoding"));
ok("净化：剥掉过期的 content-length", !clean.has("content-length"));
ok("净化：剥掉逐跳的 transfer-encoding", !clean.has("transfer-encoding"));
ok("净化：保留 content-type 等业务头", clean.get("content-type") === "application/json;charset=UTF-8");
ok("净化：补上 CORS 放行头", clean.get("access-control-allow-origin") === "*");
ok("净化：不改动原对象", dirty.has("content-encoding"));

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
    // 前端靠 index.html 里这句把接口根置空，从而走同源转发；
    // 少了它，页面会直连学校域名，浏览器侧立刻产生跨域预检。
    ok("GET / → 200 且声明同源接口根", home.status === 200 && html.includes("__PADK_ORIGIN__"));
    ok("GET /__auth/login → 405", (await fetch(base + "/__auth/login")).status === 405);
    const r = await fetch(base + "/__auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    ok("POST 空参 → 400", r.status === 400);
    ok("未知路径 → 404", (await fetch(base + "/no-such-file.txt")).status === 404);

    // 端到端回归：带 Accept-Encoding 打一次真实转发，检查响应头与实体是否自洽。
    // 这条断言要联网，断网时跳过 —— 它捕捉的是「两个运行时对压缩体的处置不一致」
    // 这个只在真实上游返回 gzip 时才现形的缺陷。
    try {
      const up = await fetch(base + "/znzhxgpt/ssgl/ss-ldxx/findLdzbCjList", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", "Accept-Encoding": "gzip, deflate, br" },
        body: "{}",
        signal: AbortSignal.timeout(15000),
      });
      const ce = up.headers.get("content-encoding");
      const buf = Buffer.from(await up.arrayBuffer());
      ok("转发：响应头不自称压缩（否则下游解压必炸）", !ce, ce ? "content-encoding=" + ce : "");
      ok("转发：实体是可读 JSON", buf.length > 0 && buf[0] === 0x7b, "首字节 0x" + buf.subarray(0, 2).toString("hex"));
      // 复现浏览器行为：头声明与实体自洽时，undici 才肯解码
      const dec = await new Response(buf, { headers: up.headers }).json();
      ok("转发：响应可被标准解码链路消费", typeof dec?.code === "string");
    } catch (e) {
      console.log("  · 跳过转发端到端断言（需要联网）：" + (e?.message || e));
    }
  } catch (e) {
    fails.push("本机服务断言中断：" + (e?.message || e));
    console.log("  ✗ 本机服务断言中断 —— " + (e?.message || e));
  } finally {
    child.kill();
  }
}

/* ── D. EdgeOne 适配层 ── */
console.log("\nD. EdgeOne 适配层");
const eoLogin = path.join(ROOT, "edge-functions", "__auth", "login.js");
const eoProxy = path.join(ROOT, "edge-functions", "znzhxgpt", "[[default]].js");
ok("EdgeOne 登录入口存在", fs.existsSync(eoLogin));
ok("EdgeOne 转发入口存在", fs.existsSync(eoProxy));
ok(
  "edgeone.json 指向 dist/ 且声明构建命令",
  await (async () => {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "edgeone.json"), "utf8"));
      return cfg.outputDirectory === "./dist" && !!cfg.buildCommand;
    } catch {
      return false;
    }
  })()
);

/*
 * EdgeOne 的 edge-functions/ 是「目录即路由」，平台自己编译，所以这两个文件
 * 直接 import 了 src/edge/handler.js。它们最容易在改名或挪目录时静默失效 ——
 * 平台侧要等真部署才报错。这里用 esbuild 把它们打成临时 ESM 直接调用，
 * 在本地就把接线错误挡下来。
 */
if (fs.existsSync(eoLogin) && fs.existsSync(eoProxy)) {
  const l = await import(asUrl(await bundle(eoLogin, "eo-login.mjs")));
  const p = await import(asUrl(await bundle(eoProxy, "eo-proxy.mjs")));
  const ctx = (req) => ({ request: req, params: {}, env: {}, waitUntil() {} });
  ok("EdgeOne 登录入口：GET → 405", (await l.onRequest(ctx(new Request(H + "/__auth/login")))).status === 405);
  const eoEmpty = await l.onRequest(ctx(post("/__auth/login", "{}")));
  ok("EdgeOne 登录入口：空参 → 400", eoEmpty.status === 400 && (await eoEmpty.json()).error === "缺少账号或密码");
  ok("EdgeOne 转发入口：非转发路径 → 404", (await p.onRequest(ctx(new Request(H + "/nope")))).status === 404);
}

/* ── F. 登录协议：出口被风控时的分支 ── */
/*
 * 这两条断言对应一个真实的线上故障：Cloudflare 边缘出口访问学校系统时，
 * 出口 IP 被风控区别对待，CAS 会以 302 把请求**退回登录页**。旧实现只看
 * 「状态码是不是 302」，于是把伪成功一路带到回调步骤，最后只报
 * 「未取得登录凭据（uid）」—— 真正的原因（登录根本没被接受）被藏掉了。
 *
 * 这里用替换 globalThis.fetch 的方式驱动协议分支，不联网、不需要账号。
 */
console.log("\nF. 登录协议分支");
const casMod = await import(asUrl(await bundle(path.join(ROOT, "src/core/casLogin.ts"), "casLogin.mjs")));
const realFetch = globalThis.fetch;
const LOGIN_HTML =
  '<input id="pwdEncryptSalt" value="AbCdEfGhIjKlMnOp">' +
  '<input id="execution" name="execution" value="e1s1">';

/** 用路由表模拟学校侧；hits 记录实际请求过的 URL */
function mockFetch(routes, hits = []) {
  return async (url, init = {}) => {
    const u = String(url);
    hits.push(u);
    for (const [re, make] of routes) if (re.test(u)) return make(u, init);
    throw new Error("mock 未匹配：" + u);
  };
}

// F1：CAS 把 302 指向登录页 → 必须报「被退回登录页」，而不是 uid 缺失
{
  const hits = [];
  globalThis.fetch = mockFetch(
    [
      [/authserver\/login\?/, (u, init) =>
        init.method === "POST"
          ? new Response("", { status: 302, headers: { location: casMod.CAS + "/authserver/login?service=x" } })
          : new Response(LOGIN_HTML, { status: 200 })],
      [/checkNeedCaptcha/, () => new Response('{"isNeed":false}', { status: 200 })],
    ],
    hits
  );
  let msg = "";
  try {
    await casMod.protocolLogin("2020000000", "pw");
  } catch (e) {
    msg = e.message;
  }
  globalThis.fetch = realFetch;
  ok("302 退回登录页 → 明确报「被退回登录页」", /被退回登录页/.test(msg), msg.slice(0, 90));
  ok("退回登录页时不再走回调步骤", !hits.some((u) => /caslogin_h5\.jsp\?ticket=/.test(u)));
}

// F2：回调页拿不到 uid（边缘出口的形态）→ 用 serviceValidate 兜底换回账号
{
  const hits = [];
  globalThis.fetch = mockFetch(
    [
      [/authserver\/login\?/, (u, init) =>
        init.method === "POST"
          ? new Response("", {
              status: 302,
              headers: { location: casMod.SERVICE + "?ticket=ST-OK-0001" },
            })
          : new Response(LOGIN_HTML, { status: 200 })],
      [/checkNeedCaptcha/, () => new Response('{"isNeed":false}', { status: 200 })],
      // 顺序要紧：serviceValidate 的 URL 里带着 service 参数（含 fdcwonsun 字样），
      // 排在回调页规则之后就会被截获
      [/serviceValidate/, () =>
        new Response(
          "<cas:serviceResponse><cas:authenticationSuccess><cas:user>2020000000</cas:user></cas:authenticationSuccess></cas:serviceResponse>",
          { status: 200 }
        )],
      [/caslogin_h5\.jsp/, () => new Response("<html>登录成功</html>", { status: 200 })],
      [/login-other/, () =>
        new Response(JSON.stringify({ data: { token: "a.b.c", yhzh: "2020000000", yhxm: "测试", bmid: "1" } }), {
          status: 200,
        })],
    ],
    hits
  );
  let out = null;
  let msg = "";
  try {
    out = await casMod.protocolLogin("2020000000", "pw");
  } catch (e) {
    msg = e.message;
  }
  globalThis.fetch = realFetch;
  ok("回调页无 uid → serviceValidate 兜底成功", !!out && out.token === "a.b.c", msg.slice(0, 120));
  ok("兜底路径确实调用了 serviceValidate", hits.some((u) => /serviceValidate/.test(u)));
}

// F3：回调页本身有 uid → 不应多余地再打 serviceValidate
{
  const hits = [];
  globalThis.fetch = mockFetch(
    [
      [/authserver\/login\?/, (u, init) =>
        init.method === "POST"
          ? new Response("", {
              status: 302,
              headers: { location: casMod.SERVICE + "?ticket=ST-OK-0002" },
            })
          : new Response(LOGIN_HTML, { status: 200 })],
      [/checkNeedCaptcha/, () => new Response('{"isNeed":false}', { status: 200 })],
      [/caslogin_h5\.jsp/, () => new Response("var uid = '2020000000'; var lzc = 'LZC1';", { status: 200 })],
      [/login-other/, () =>
        new Response(JSON.stringify({ data: { token: "x.y.z", yhzh: "2020000000", yhxm: "测试", bmid: "1" } }), {
          status: 200,
        })],
    ],
    hits
  );
  let out = null;
  let msg = "";
  try {
    out = await casMod.protocolLogin("2020000000", "pw");
  } catch (e) {
    msg = e.message;
  }
  globalThis.fetch = realFetch;
  ok("回调页有 uid → 正常登录", !!out && out.token === "x.y.z", msg.slice(0, 120));
  ok("有 uid 时不额外调用 serviceValidate", !hits.some((u) => /serviceValidate/.test(u)));
}

/* ── 汇总 ── */
console.log("");
if (fails.length) {
  console.log(`${pass} 项通过，${fails.length} 项失败：`);
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`全部 ${pass} 项通过。`);
