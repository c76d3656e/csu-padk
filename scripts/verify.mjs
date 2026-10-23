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

// CAS 拒绝登录时回的登录页正文（实测 35560 字节，这里只留特征变量）
const LOGIN_PAGE_BODY =
  "<html><head><title>统一身份认证平台</title></head><body><script>" +
  'var inputUserNameTip = "请输入用户名";' +
  'var inputPasswordTip = "请输入密码";' +
  'var inputCodeTip = "请输入验证码";' +
  "</script></body></html>";

// 回调页拿不到 uid 时回的那段跳转脚本（实测 167 字节），它把客户端送回 CAS 登录页
const CB_REDIRECT =
  "<script languge='javascript'>window.location.href='" +
  casMod.CAS +
  "/authserver/login?service=" +
  encodeURIComponent(casMod.SERVICE) +
  "'</script>";

/** 用路由表模拟学校侧；hits 记录实际请求过的 URL */
function mockFetch(routes, hits = []) {
  return async (url, init = {}) => {
    const u = String(url);
    hits.push((init.method || "GET") + " " + u);
    for (const [re, make] of routes) if (re.test(u)) return make(u, init);
    throw new Error("mock 未匹配：" + u);
  };
}

// 学校网关的「仅限校园网访问」提示页。状态码是 200，只能认正文 ——
// 线上偶发出现，且重试一次就能过，所以它必须是可重试的
const GATEWAY_PAGE =
  "<!DOCTYPE html><html lang=\"zh-CN\"><head><title>系统访问提示</title></head><body>" +
  "<h1>系统访问提示</h1><p>您访问的系统（网站）因工作需要仅限校园网访问，" +
  "如需访问请先注册登录学校VPN。</p></body></html>";

// F1：CAS 把 302 指向登录页 → 必须报「被退回登录页」，而不是 uid 缺失
{
  const hits = [];
  globalThis.fetch = mockFetch(
    [
      [/authserver\/login\?/, (u, init) =>
        init.method === "POST"
          ? new Response("", { status: 302, headers: { location: casMod.CAS + "/authserver/login?service=x" } })
          : new Response(LOGIN_HTML, { status: 200, headers: { "Set-Cookie": "JSESSIONID=mock-sid; Path=/" } })],
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
  ok(
    "302 退回登录页 → 报「退回了登录页」并说明已重试",
    /退回了登录页/.test(msg) && /重试过一次/.test(msg),
    msg.slice(0, 110)
  );
  ok("退回登录页时不再走回调步骤", !hits.some((u) => /caslogin_h5\.jsp\?ticket=/.test(u)));
}

// F1b：第 1 步没拿到登录页（既无加密盐也无会话 cookie）—— 会话层失败，
// 必须在提交前就重来，绝不带着空 cookie 去 POST（只会被 CAS 退回，白白多一次失败计数）
{
  const hits = [];
  globalThis.fetch = mockFetch(
    [
      [/authserver\/login\?/, () => new Response("<html><body>维护中</body></html>", { status: 200 })],
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
  ok("第 1 步没拿到登录页 → 报「没有返回登录页」", /没有返回登录页/.test(msg), msg.slice(0, 110));
  ok(
    "登录页没给 cookie 时不提交密码",
    !hits.some((u) => /^POST /.test(u) && /authserver\/login\?/.test(u)),
    "POST 次数 " + hits.filter((u) => /^POST /.test(u) && /authserver\/login\?/.test(u)).length
  );
}

// F1c：网关拦截页（状态码 200）→ 必须重试一次；两次都被拦才报错
{
  const hits = [];
  globalThis.fetch = mockFetch([[/authserver\/login\?/, () => new Response(GATEWAY_PAGE, { status: 200 })]], hits);
  let msg = "";
  try {
    await casMod.protocolLogin("2020000000", "pw");
  } catch (e) {
    msg = e.message;
  }
  globalThis.fetch = realFetch;
  ok("网关拦截页 → 报「仅限校园网访问」", /仅限校园网访问/.test(msg), msg.slice(0, 110));
  ok(
    "网关拦截页 → 确实重试了一次",
    hits.filter((u) => /authserver\/login\?/.test(u)).length === 2,
    "登录页请求次数 " + hits.filter((u) => /authserver\/login\?/.test(u)).length
  );
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
          : new Response(LOGIN_HTML, { status: 200, headers: { "Set-Cookie": "JSESSIONID=mock-sid; Path=/" } })],
      [/checkNeedCaptcha/, () => new Response('{"isNeed":false}', { status: 200 })],
      // 顺序要紧：serviceValidate 的 URL 里带着 service 参数（含 fdcwonsun 字样），
      // 排在回调页规则之后就会被截获
      [/serviceValidate/, () =>
        new Response(
          "<cas:serviceResponse><cas:authenticationSuccess><cas:user>2020000000</cas:user></cas:authenticationSuccess></cas:serviceResponse>",
          { status: 200 }
        )],
      // 回调页的真实形态：无 CAS 会话时回 403 空体（三种 UA 实测都是如此）
      [/caslogin_h5\.jsp/, () => new Response("", { status: 403 })],
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
  ok("回调页 403 空体 → serviceValidate 兜底成功", !!out && out.token === "a.b.c", msg.slice(0, 120));
  ok("兜底路径确实调用了 serviceValidate", hits.some((u) => /serviceValidate/.test(u)));
  ok(
    "403 空体后立即停止跟随（回调页只被请求一次）",
    hits.filter((u) => /caslogin_h5\.jsp\?ticket=/.test(u)).length === 1,
    "次数 " + hits.filter((u) => /caslogin_h5\.jsp\?ticket=/.test(u)).length
  );
  ok("回调页 403 时不误判为登录失败", !/没有接受这次登录/.test(msg));
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
          : new Response(LOGIN_HTML, { status: 200, headers: { "Set-Cookie": "JSESSIONID=mock-sid; Path=/" } })],
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

// F4：CAS 拒绝登录 —— 200 + 登录页正文，不重定向。必须报「没有接受这次登录」，
// 且不能被 checkNeedCaptcha 的结果带偏成「需要验证码」（这才是线上那条错误文案的来源）
{
  const hits = [];
  globalThis.fetch = mockFetch(
    [
      [/authserver\/login\?/, (u, init) =>
        init.method === "POST"
          ? new Response(LOGIN_PAGE_BODY, { status: 200 })
          : new Response(LOGIN_HTML, { status: 200, headers: { "Set-Cookie": "JSESSIONID=mock-sid; Path=/" } })],
      // 故意说需要验证码：顺序错了就会报成验证码问题
      [/checkNeedCaptcha/, () => new Response('{"isNeed":true}', { status: 200 })],
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
  ok("CAS 拒绝登录 → 报「没有接受这次登录」", /没有接受这次登录/.test(msg), msg.slice(0, 100));
  ok("拒绝登录时不误报成「需要验证码」", !/需要验证码/.test(msg), msg.slice(0, 100));
  // 注意：第 1 步的登录页 URL 里就带着 percent-encoded 的 service（含 caslogin_h5.jsp 字样），
  // 所以要按「带 ticket 的回调请求」判断，不能按文件名判断
  ok("拒绝登录时不再走回调步骤", !hits.some((u) => /caslogin_h5\.jsp\?ticket=/.test(u)));
}

// F5：回调链被送回 CAS 登录页 → 提前退出，绝不跟进企业微信授权
// 真实线上形态：回调页 302 到 /authserver/login?service=…，CAS 又按 UA 跳到
// weixinQYLogin.do，最后落到 open.weixin.qq.com —— 这条链越走越远，且永远
// 拿不到 uid。提前退出后由 serviceValidate 收尾。
{
  const hits = [];
  globalThis.fetch = mockFetch(
    [
      [/authserver\/login\?/, (u, init) =>
        init.method === "POST"
          ? new Response("", {
              status: 302,
              headers: { location: casMod.SERVICE + "?ticket=ST-OK-0003" },
            })
          : new Response(LOGIN_HTML, { status: 200, headers: { "Set-Cookie": "JSESSIONID=mock-sid; Path=/" } })],
      [/checkNeedCaptcha/, () => new Response('{"isNeed":false}', { status: 200 })],
      // 同 F2：serviceValidate 的 URL 里含 caslogin_h5.jsp 字样，必须排在回调页规则之前
      [/serviceValidate/, () =>
        new Response(
          "<cas:serviceResponse><cas:authenticationSuccess><cas:user>2020000000</cas:user></cas:authenticationSuccess></cas:serviceResponse>",
          { status: 200 }
        )],
      [/caslogin_h5\.jsp/, () =>
        new Response("", {
          status: 302,
          headers: {
            location: casMod.CAS + "/authserver/login?service=" + encodeURIComponent(casMod.SERVICE),
          },
        })],
      // 没有为 weixinQYLogin / open.weixin.qq.com 准备路由：一旦代码继续跟随，mock 会抛未匹配
      [/login-other/, () =>
        new Response(JSON.stringify({ data: { token: "p.q.r", yhzh: "2020000000", yhxm: "测试", bmid: "1" } }), {
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
  ok("回调链回到 CAS 登录页时停止跟随", !hits.some((u) => /weixinQYLogin|open\.weixin/.test(u)), hits.length + " 次请求");
  ok("提前退出后仍能完成登录", !!out && out.token === "p.q.r", msg.slice(0, 140));
}

// F6：账号密码错误（200 + 登录页正文）绝不能重试 —— 重试只会把失败次数推高，
// 反倒更容易触发学校的验证码策略
{
  const hits = [];
  globalThis.fetch = mockFetch(
    [
      [/authserver\/login\?/, (u, init) =>
        init.method === "POST"
          ? new Response(LOGIN_PAGE_BODY, { status: 200 })
          : new Response(LOGIN_HTML, { status: 200, headers: { "Set-Cookie": "JSESSIONID=mock-sid; Path=/" } })],
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
  ok(
    "账号密码错误不重试（只提交一次）",
    hits.filter((u) => /^POST /.test(u) && /authserver\/login\?/.test(u)).length === 1,
    "POST 次数 " + hits.filter((u) => /^POST /.test(u) && /authserver\/login\?/.test(u)).length
  );
  ok("账号密码错误 → 文案带诊断串", /诊断 status=200/.test(msg), msg.slice(0, 110));
}

// F7：cookie 必须按域分发 —— 统一认证的会话（CASTGC）属于 ca 域，
// 回调页与业务接口在 zhxg 域。把 ca 域的会话发给 zhxg 是无意义的越界发送，
// 而把 zhxg 的 cookie 漏掉则会让业务接口认不出会话。
{
  const hits = [];
  let cbCookie = "";
  let loginOtherCookie = "";
  globalThis.fetch = mockFetch(
    [
      [/authserver\/login\?/, (u, init) =>
        init.method === "POST"
          ? new Response("", {
              status: 302,
              headers: { location: casMod.SERVICE + "?ticket=ST-OK-0004" },
            })
          : new Response(LOGIN_HTML, {
              status: 200,
              headers: { "Set-Cookie": "JSESSIONID=mock-sid; Path=/authserver" },
            })],
      [/checkNeedCaptcha/, () => new Response('{"isNeed":false}', { status: 200 })],
      // 回调页在 zhxg 域：只应收到 zhxg 域自己的 cookie，绝不该收到 ca 域的会话
      [/caslogin_h5\.jsp/, (u, init) => {
        cbCookie = (init.headers || {}).Cookie || "";
        return new Response("var uid = '2020000000'; var lzc = 'LZC1';", {
          status: 200,
          headers: { "Set-Cookie": "SERVERID=zhxg-sid; Path=/" },
        });
      }],
      [/login-other/, (u, init) => {
        loginOtherCookie = (init.headers || {}).Cookie || "";
        return new Response(JSON.stringify({ data: { token: "s.t.u", yhzh: "2020000000", yhxm: "测试", bmid: "1" } }), {
          status: 200,
        });
      }],
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
  ok("回调页不带 ca 域的会话（跨域越界发送）", !/JSESSIONID/.test(cbCookie), String(cbCookie).slice(0, 80) || "(无 cookie)");
  ok("回调页建立了 zhxg 域会话后，换 token 会带上它", /SERVERID=zhxg-sid/.test(loginOtherCookie), String(loginOtherCookie).slice(0, 80) || "(无 cookie)");
  ok("会话连续时登录一次走通", !!out && out.token === "s.t.u", msg.slice(0, 140));
}

// F7b：反向的域隔离 —— 回调页在 zhxg 域建立的会话，绝不能跟着跑到 ca 域去。
// 两个方向的越界发送都要挡住，否则「按域分发」只是单向的。
{
  const hits = [];
  let svCookie = "";
  globalThis.fetch = mockFetch(
    [
      [/authserver\/login\?/, (u, init) =>
        init.method === "POST"
          ? new Response("", {
              status: 302,
              headers: {
                location: casMod.SERVICE + "?ticket=ST-OK-0006",
                "Set-Cookie": "CASTGC=TGT-1-mock-session; Path=/authserver",
              },
            })
          : new Response(LOGIN_HTML, {
              status: 200,
              headers: { "Set-Cookie": "JSESSIONID=mock-sid; Path=/authserver" },
            })],
      [/checkNeedCaptcha/, () => new Response('{"isNeed":false}', { status: 200 })],
      // 顺序要紧：serviceValidate 的 URL 里带着 service 参数（含 fdcwonsun 字样），
      // 排在回调页规则之后就会被截获
      [/serviceValidate/, (u, init) => {
        svCookie = (init.headers || {}).Cookie || "";
        return new Response(
          "<cas:serviceResponse><cas:authenticationSuccess><cas:user>2020000000</cas:user></cas:authenticationSuccess></cas:serviceResponse>",
          { status: 200 }
        );
      }],
      // 回调页就地换票失败，但顺手在 zhxg 域种了一个会话 cookie
      [/caslogin_h5\.jsp/, () =>
        new Response("", {
          status: 302,
          headers: {
            location: casMod.CAS + "/authserver/login?service=" + encodeURIComponent(casMod.SERVICE),
            "Set-Cookie": "SERVERID=zhxg-sid; Path=/",
          },
        })],
      [/login-other/, () =>
        new Response(JSON.stringify({ data: { token: "u.v.w", yhzh: "2020000000", yhxm: "测试", bmid: "1" } }), {
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
  ok("serviceValidate（ca 域）不带 zhxg 域的会话", !/SERVERID/.test(svCookie), String(svCookie).slice(0, 60) || "(无 cookie)");
  ok("回调链提前退出后由 serviceValidate 收尾", !!out && out.token === "u.v.w", msg.slice(0, 140));
}

// F8：302 没带 ticket → 必须归入可重试一类，重走完整流程，而不是把
// 伪成功带到第 4 步再报「未取得 uid」。这是线上「ticket 缺失」那条报错的源头。
{
  const hits = [];
  globalThis.fetch = mockFetch(
    [
      [/authserver\/login\?/, (u, init) =>
        init.method === "POST"
          ? new Response("", { status: 302, headers: { location: casMod.SERVICE } })
          : new Response(LOGIN_HTML, { status: 200, headers: { "Set-Cookie": "JSESSIONID=mock-sid; Path=/" } })],
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
  ok("302 无 ticket → 报「没有带回票据」并说明已重试", /没有带回票据/.test(msg) && /重试过一次/.test(msg), msg.slice(0, 120));
  ok(
    "302 无 ticket → 确实重走了一遍完整流程",
    hits.filter((u) => /^POST /.test(u) && /authserver\/login\?/.test(u)).length === 2,
    "POST 次数 " + hits.filter((u) => /^POST /.test(u) && /authserver\/login\?/.test(u)).length
  );
  ok("302 无 ticket → 不再报「未取得登录凭据」", !/未取得登录凭据/.test(msg), msg.slice(0, 120));
}

// F9：表单字段与参考实现对齐 —— rememberMe 必须在，它是 CAS 签发长期会话的依据
{
  const hits = [];
  let posted = "";
  globalThis.fetch = mockFetch(
    [
      [/authserver\/login\?/, (u, init) => {
        if (init.method === "POST") {
          posted = String(init.body || "");
          return new Response("", { status: 302, headers: { location: casMod.SERVICE + "?ticket=ST-OK-0005" } });
        }
        return new Response(LOGIN_HTML, { status: 200, headers: { "Set-Cookie": "JSESSIONID=mock-sid; Path=/" } });
      }],
      [/checkNeedCaptcha/, () => new Response('{"isNeed":false}', { status: 200 })],
      [/caslogin_h5\.jsp/, () => new Response("var uid = '2020000000';", { status: 200 })],
      [/login-other/, () =>
        new Response(JSON.stringify({ data: { token: "m.n.o", yhzh: "2020000000", yhxm: "测试", bmid: "1" } }), {
          status: 200,
        })],
    ],
    hits
  );
  try {
    await casMod.protocolLogin("2020000000", "pw");
  } catch {
    /* 断言只看提交内容 */
  }
  globalThis.fetch = realFetch;
  ok("提交字段含 rememberMe（CAS 据此签发长期会话）", /(^|&)rememberMe=true(&|$)/.test(posted), posted.slice(0, 60));
  ok(
    "提交字段与参考实现一致",
    /(^|&)cllt=userNameLogin(&|$)/.test(posted) &&
      /(^|&)dllt=generalLogin(&|$)/.test(posted) &&
      /(^|&)_eventId=submit(&|$)/.test(posted),
    posted.slice(0, 80)
  );
}

/* ── G. 手动导入凭据 ── */
/*
 * 学校要求验证码时协议登录无解，手动导入是唯一出路。这里断言的是「成对校验」：
 * token 与 casual 拆开配会 400，所以格式不对必须整体拒绝，绝不能写半截。
 */
console.log("\nG. 手动导入凭据");
{
  /*
   * cred.ts 用 storage 存凭据；Node 里没有 window，它按约定回退到 globalThis 上的
   * 同名对象。这里补一个最小的内存实现，让「写入 → 读回」这段真实逻辑被测到。
   */
  const mkStorage = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      clear: () => m.clear(),
      key: (i) => [...m.keys()][i] ?? null,
      get length() {
        return m.size;
      },
    };
  };
  globalThis.localStorage = mkStorage();
  globalThis.sessionStorage = mkStorage();
  const credMod = await import(asUrl(await bundle(path.join(ROOT, "src/core/cred.ts"), "cred.mjs")));
  const TOK = "eyJhbGciOiJSUzI1NiJ9." + "a".repeat(60) + ".sig";

  const bad = credMod.setManualCred(TOK, "短");
  ok("casual 不合法 → 整体拒绝", !bad.ok && bad.reason === "casual-invalid", bad.reason);
  const bad2 = credMod.setManualCred("eyJx", "AbCdEfGhIjKlMnOp");
  ok("token 过短 → 整体拒绝", !bad2.ok && bad2.reason === "token-invalid", bad2.reason);
  const bad3 = credMod.setManualCred(TOK + " 带中文", "AbCdEfGhIjKlMnOp");
  ok("token 含非法字符 → 整体拒绝", !bad3.ok, bad3.reason);

  // 合法一对：写入后必须能被 readCred 整对读回，且来源标记为 self
  const okr = credMod.setManualCred("  " + TOK + "  ", "  AbCdEfGhIjKlMnOp  ");
  ok("合法一对 → 写入成功（含首尾空白自动裁剪）", okr.ok, okr.reason || okr.detail);
  const back = credMod.readCred();
  ok(
    "写入后整对读回且来源为 self",
    back.ok && back.cred.token === TOK && back.cred.casual === "AbCdEfGhIjKlMnOp" && back.cred.src === "self",
    back.ok ? back.cred.src : back.reason
  );
  credMod.clearCred();
  ok("clearCred 后回到无凭据", credMod.readCred().ok === false);
}

/* ── 汇总 ── */
console.log("");
if (fails.length) {
  console.log(`${pass} 项通过，${fails.length} 项失败：`);
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`全部 ${pass} 项通过。`);
