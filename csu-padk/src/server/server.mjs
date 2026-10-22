/**
 * 本机服务入口 —— 单机形态（也是 exe 的唯一入口）
 *
 *   npm start              默认 5173
 *   PORT=5180 npm start    换端口
 *
 * 一个进程同时提供三件事：
 *   1. 静态服务   dist/                已经构建好的前端
 *   2. 登录接口   POST /__auth/login   统一身份认证协议（实现在 src/core/casLogin.ts）
 *   3. 同源转发   /znzhxgpt/**         转发到学校服务端
 *
 * 为什么打卡页需要一个进程而不是「丢到静态托管就完事」：
 *   · 业务接口要 POST 到 /znzhxgpt/**，页面不在学校域内就属于跨域，
 *     浏览器会先发 OPTIONS 预检，而学校网关不放行 → 请求全部失败；
 *     由本方同源转发即可，浏览器侧始终同源。
 *   · /__auth/login 是服务端逻辑（票据 → uid/lzc → token 兑换），
 *     纯静态托管没有地方执行它。
 *
 * 部署到边缘（Cloudflare / Vercel）时，第 2、3 件事由 src/edge/handler.js
 * 承担 —— 与这里共用同一份实现。本文件只保留「本机怎么接 HTTP」。
 *
 * 本进程不落盘、不记录任何凭据，只在内存里做一次协议转发。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSea, getAsset } from "node:sea";
import { handleApi } from "../edge/handler.js";

/**
 * 是否跑在打包好的单文件 exe 里。
 * 必须排在解析路径之前：SEA 下 import.meta.url 指向的不是磁盘上任何真实
 * 位置，而且根本没有 dist/ —— 前端产物全在 exe 的内嵌资源里。
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
// 直接 node 运行源码时用相对位置；经 scripts/serve.mjs 打包后由 PADK_DIST 指定
const DIST = IN_SEA ? "" : process.env.PADK_DIST || path.resolve(HERE, "..", "..", "dist");
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
    // 目录穿越防护
    if (full !== DIST && !full.startsWith(DIST + path.sep)) return null;
    return fs.statSync(full).isFile() ? fs.readFileSync(full) : null;
  } catch {
    return null;
  }
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

  // index.html 要注入「本机托管」标记：前端据此把接口请求打到本服务上（同源）。
  // 手机连同一 WiFi、用局域网 IP 打开时，这一步尤其重要。
  // 标记必须排在页面自己的判断脚本之前，因此插在 <head> 的最前面。
  if (path.basename(served) === "index.html") {
    const html = buf
      .toString("utf8")
      .replace(/<head>/i, '<head>\n    <script>window.__PADK_SELF_HOSTED__=true</script>');
    return sendBuffer(Buffer.from(html, "utf8"), served, res);
  }

  sendBuffer(buf, served, res);
}

/* ───────────── 把 Node 的 http 对象转成标准 Request/Response ───────────── */
async function toRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const one of v) headers.append(k, one);
    else if (v !== undefined) headers.set(k, v);
  }
  return new Request(new URL(req.url || "/", `http://localhost:${PORT}`), {
    method: req.method,
    headers,
    body,
  });
}

async function sendResponse(out, res) {
  const buf = Buffer.from(await out.arrayBuffer());
  const headers = {};
  out.headers.forEach((v, k) => {
    // 长度由本层按实际字节数给出，避免与解码后的 body 不一致
    if (k.toLowerCase() === "content-length") return;
    headers[k] = v;
  });
  headers["Content-Length"] = buf.length;
  res.writeHead(out.status, headers);
  res.end(buf);
}

/* ───────────── 路由 ───────────── */
const server = http.createServer(async (req, res) => {
  const url = req.url || "/";
  const pathname = url.split("?")[0];

  if (pathname === "/__auth/login" || pathname.startsWith("/znzhxgpt/")) {
    try {
      const out = await handleApi(await toRequest(req));
      if (out) return await sendResponse(out, res);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      return res.end("服务内部错误：" + ((e && e.message) || e));
    }
  }

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
  const ready = IN_SEA || fs.existsSync(path.join(DIST, "index.html"));
  console.log("");
  console.log("  平安打卡 · 本机服务");
  console.log(`  →  http://localhost:${PORT}/`);
  console.log("");
  if (!ready) {
    console.log("  没找到 dist/index.html，先执行一次 npm run build");
    console.log("");
  }
  console.log(`  静态  ${IN_SEA ? "（已内嵌进 exe）" : DIST}`);
  console.log("  登录  POST /__auth/login");
  console.log("  转发  /znzhxgpt/**");
  console.log("");
});
