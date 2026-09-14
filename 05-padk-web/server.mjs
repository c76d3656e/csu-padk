/**
 * 单机一体服务
 *
 *   npm start              默认 5173
 *   PORT=5180 npm start    换端口
 *
 * 一个进程同时提供三件事，缺一不可：
 *   1. 静态服务   dist/                已经构建好的前端
 *   2. CAS 登录   POST /__auth/login   协议登录编排
 *   3. API 代理   /znzhxgpt/**         转发到学校服务端
 *
 * 为什么必须有这个进程，而不是「丢到静态托管就完事」：
 *   · 独立打卡页要 postDes 到 /znzhxgpt/**，离开 localhost 就属于跨域，
 *     浏览器先发 OPTIONS 预检，而学校 nginx 不放行 → 请求全部失败；
 *     由本方进程同源转发即可绕过，浏览器侧始终同源。
 *   · /__auth/login 是服务端逻辑（CAS 票据 → uid/lzc → token 兑换），
 *     静态托管没有地方执行它，登录表单会直接报「登录服务不可用」。
 *
 * 想真正零服务端，只有注入形态：把 dist/inject.js 当书签脚本，
 * 在已登录的 zhxg.csu.edu.cn 页面里跑 —— 那里本来就同源。
 *
 * 本进程不落盘、不记录任何凭据，只在内存里做一次协议转发。
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { isSea, getAsset } from "node:sea";

/**
 * 是否跑在打包好的单文件 exe 里。
 *
 * 这个判断必须排在解析路径之前：SEA 下 import.meta.url 指向的
 * 不是磁盘上任何真实位置，而且根本没有 dist/ —— 前端产物全在
 * exe 的内嵌资源里，只能靠 getAsset 取。
 */
const IN_SEA = (() => {
  try {
    return isSea();
  } catch {
    return false;
  }
})();

// 非 SEA 才去解析磁盘路径；三元短路保证 SEA 下不会碰到 import.meta.url
const HERE = IN_SEA ? "" : path.dirname(fileURLToPath(import.meta.url));
const DIST = IN_SEA ? "" : path.join(HERE, "dist");
const PORT = Number(process.env.PORT || 5173);

/** 读一份前端产物；SEA 走内嵌资源，否则走磁盘 */
function readAsset(rel) {
  const key = rel.replace(/\\/g, "/");
  if (IN_SEA) {
    try {
      return Buffer.from(getAsset(key));
    } catch {
      return null;
    }
  }
  try {
    const full = path.join(DIST, key);
    if (full !== DIST && !full.startsWith(DIST + path.sep)) return null;
    return fs.statSync(full).isFile() ? fs.readFileSync(full) : null;
  } catch {
    return null;
  }
}

const CAS = "https://ca.csu.edu.cn";
const ZHXG = "https://zhxg.csu.edu.cn";
const SERVICE = ZHXG + "/fdcwonsun/caslogin_h5.jsp";
const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40";

/* ───────────── 金智密码加密（AES-128-CBC）───────────── */
const AES_CHARS = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
const rand = (n) => {
  let s = "";
  for (let i = 0; i < n; i++) s += AES_CHARS.charAt(Math.floor(Math.random() * AES_CHARS.length));
  return s;
};

function encryptPassword(plain, salt) {
  if (!salt) return plain;
  const key = Buffer.from(salt.trim(), "utf8");
  const iv = Buffer.from(rand(16), "utf8");
  const data = Buffer.from(rand(64) + plain, "utf8");
  const c = crypto.createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([c.update(data), c.final()]).toString("base64");
}

const generateCasual = (n = 16) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
};

/* ───────────── 极简 cookie jar ───────────── */
class Jar {
  constructor() {
    this.m = new Map();
  }
  set(res) {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const pair = String(line).split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) this.m.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() {
    return [...this.m].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

/* ───────────── 协议登录 ───────────── */
async function protocolLogin(username, password) {
  const jar = new Jar();
  const loginUrl = `${CAS}/authserver/login?service=${encodeURIComponent(SERVICE)}`;

  // 1. 取登录页 → salt / execution
  let res = await fetch(loginUrl, {
    redirect: "manual",
    headers: { "User-Agent": UA_DESKTOP },
  });
  jar.set(res);
  const html = await res.text();
  const salt = (html.match(/id="pwdEncryptSalt"\s+value="([^"]*)"/) || [])[1] || "";
  const exec =
    (html.match(/id="execution"\s+name="execution"\s+value="([^"]*)"/) || [])[1] || "e1s1";

  if (!salt && res.headers.get("location")?.includes("weixinQYLogin")) {
    throw new Error("CAS 走了企业微信授权分支，请稍后重试");
  }
  if (!salt) throw new Error("未能从登录页解析加密盐，页面结构可能已变更");

  // 2. 是否需要验证码
  res = await fetch(
    `${CAS}/authserver/checkNeedCaptcha.htl?username=${encodeURIComponent(username)}&_=${Date.now()}`,
    { headers: { "User-Agent": UA_DESKTOP, Cookie: jar.header() } }
  );
  jar.set(res);
  const needCaptcha = (await res.json().catch(() => ({}))).isNeed === true;

  // 3. 提交登录
  res = await fetch(loginUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA_DESKTOP,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jar.header(),
    },
    body: new URLSearchParams({
      username,
      password: encryptPassword(password, salt),
      lt: "",
      execution: exec,
      _eventId: "submit",
      cllt: "userNameLogin",
      dllt: "generalLogin",
      captcha: "",
      rmShown: "1",
    }).toString(),
  });
  jar.set(res);

  if (res.status !== 302) {
    const body = await res.text();
    const tip = (body.match(/id="showErrorTip"[^>]*>([^<]*)</) || [])[1];
    if (needCaptcha) throw new Error("该账号需要验证码，请改用官方页面登录");
    throw new Error(tip?.trim() || "账号或密码不正确");
  }

  let ticketUrl = res.headers.get("location") || "";
  if (ticketUrl.startsWith("/")) ticketUrl = ZHXG + ticketUrl;

  // 4. 跟随回调拿 uid / lzc
  const wxJar = new Jar();
  let cur = ticketUrl;
  let body = "";
  for (let hop = 0; hop < 5 && cur; hop++) {
    const r = await fetch(cur, {
      redirect: "manual",
      headers: { "User-Agent": UA_MOBILE, Cookie: wxJar.header() },
    });
    wxJar.set(r);
    const t = await r.text();
    if (t.includes("uid")) body = t;
    const next = r.headers.get("location");
    if (!next) break;
    cur = next.startsWith("/") ? ZHXG + next : next;
  }

  const uid = (body.match(/uid\s*=\s*['"]([^'"]+)['"]/) || [])[1] || "";
  const lzc = (body.match(/lzc\s*=\s*['"]([^'"]*)['"]/) || [])[1] || "";
  if (!uid) throw new Error("未取得登录凭据（uid）");

  // 5. 换 token
  const casual = generateCasual(16);
  const r5 = await fetch(`${ZHXG}/znzhxgpt/basesys/rbac-yh/login-other`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      deviceType: "4",
      AppCode: "znzhxgpt",
      "User-Agent": UA_MOBILE,
      Origin: ZHXG,
      Referer: ZHXG + "/znzhxgpt_h5/",
      Cookie: wxJar.header(),
    },
    body: JSON.stringify({
      tyrzpt: "1",
      channeld: "1",
      yhzh: encodeURIComponent(encodeURIComponent(uid)),
      lzc: encodeURIComponent(encodeURIComponent(lzc || "")),
      caasual: casual,
    }),
  });

  const j = await r5.json().catch(() => null);
  if (!j?.data?.token) throw new Error(j?.message || "换取 token 失败");

  // 院系名藏在 token 的 user_info 里
  let bmmc;
  try {
    const payload = JSON.parse(
      Buffer.from(j.data.token.split(".")[1], "base64").toString("utf8")
    );
    bmmc = JSON.parse(payload.user_info || "{}").bmmc;
  } catch {
    /* 拿不到就算了，不影响登录 */
  }

  return {
    token: j.data.token,
    casual,
    user: { xh: j.data.yhzh, xm: j.data.yhxm, bmid: j.data.bmid, bmmc },
  };
}

/* ───────────── 静态资源 ───────────── */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function sendBuffer(buf, rel, res, status = 200) {
  const ext = path.extname(rel).toLowerCase();
  // 带内容 hash 的产物可以长缓存；inject.js 是固定路径，必须每次回源校验
  const hashed = /-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(path.basename(rel));
  res.writeHead(status, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    "Content-Length": buf.length,
  });
  res.end(buf);
}

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400);
    return res.end("Bad Request");
  }
  if (pathname === "/") pathname = "/index.html";

  const rel = pathname.replace(/^\/+/, "");
  // 目录穿越防护
  if (rel.includes("..")) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  let buf = readAsset(rel);
  let served = rel;

  // 本项目用 hash 路由，正常不会走到这里；
  // 给无扩展名的路径回落 index.html，避免手输地址时 404
  if (!buf && !path.extname(rel)) {
    buf = readAsset("index.html");
    served = "index.html";
  }

  if (!buf) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("404 Not Found");
  }

  // index.html 要注入「自托管」标记：前端据此把接口请求打到本服务上（同源），
  // 否则通过局域网 IP（手机连同一 WiFi）访问时会被误判成跨域直连。
  // 标记必须排在页面自己的判断脚本之前，因此插在 <head> 的最前面。
  if (path.basename(served) === "index.html") {
    const html = buf
      .toString("utf8")
      .replace(/<head>/i, '<head>\n    <script>window.__PADK_SELF_HOSTED__=true</script>');
    return sendBuffer(Buffer.from(html, "utf8"), served, res);
  }

  sendBuffer(buf, served, res);
}

/* ───────────── 登录接口 ───────────── */
function handleLogin(req, res) {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    try {
      const { username, password } = JSON.parse(raw || "{}");
      if (!username || !password) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: "缺少账号或密码" }));
      }
      const t0 = Date.now();
      const out = await protocolLogin(String(username).trim(), String(password));
      console.log(`[cas-auth] ${out.user.xh} 登录成功 (${Date.now() - t0}ms)`);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...out }));
    } catch (e) {
      console.warn(`[cas-auth] 失败: ${e?.message}`);
      // 业务失败也回 200，由 ok 字段区分 —— 与前端约定一致
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: false, error: e?.message || "登录失败" }));
    }
  });
}

/* ───────────── 同源反向代理 ───────────── */
function proxy(req, res) {
  let target;
  try {
    target = new URL(req.url, ZHXG);
  } catch {
    res.writeHead(400);
    return res.end("Bad Request");
  }

  const isHttps = target.protocol === "https:";
  const mod = isHttps ? https : http;
  const headers = { ...req.headers, host: target.host };
  const t0 = Date.now();

  const up = mod.request(
    {
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers,
      // 与 vite dev 的 proxy（secure:false）保持一致
      rejectUnauthorized: false,
    },
    (upRes) => {
      // 只记路径与状态码，不碰 body（里面是密文与凭据）
      console.log(
        `[proxy] ${req.method} ${target.pathname} → ${upRes.statusCode} (${Date.now() - t0}ms)`
      );
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    }
  );

  up.on("error", (e) => {
    console.log(`[proxy] ${req.method} ${target.pathname} → 上游失败: ${e.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("上游请求失败：" + e.message);
  });

  req.pipe(up);
}

/* ───────────── 路由 ───────────── */
const server = http.createServer((req, res) => {
  const url = req.url || "/";

  if (url === "/__auth/login" || url.startsWith("/__auth/login?")) {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      return res.end("Method Not Allowed");
    }
    return handleLogin(req, res);
  }

  if (url.startsWith("/znzhxgpt/")) return proxy(req, res);

  return serveStatic(req, res);
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\n  端口 ${PORT} 已被占用。换个端口：PORT=5180 npm start\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => {
  // SEA 模式下前端产物在 exe 里，磁盘上没有 dist/
  const ready = IN_SEA || fs.existsSync(path.join(DIST, "index.html"));
  console.log("");
  console.log("  平安打卡 · 单机服务");
  console.log(`  →  http://localhost:${PORT}/`);
  console.log("");
  if (!ready) {
    console.log("  ⚠ 没找到 dist/index.html，先执行一次 npm run build");
    console.log("");
  }
  console.log(`  静态  ${IN_SEA ? "（已内嵌进 exe）" : DIST}`);
  console.log("  登录  POST /__auth/login");
  console.log(`  代理  /znzhxgpt/**  →  ${ZHXG}`);
  console.log("");
});
