/**
 * 边缘接口层 —— 一份实现，三个运行环境共用
 *
 * 只处理两条路径，其余交给各平台自己的静态资源服务：
 *   POST /__auth/login   统一身份认证协议登录（实现在 ../core/casLogin.ts）
 *   /znzhxgpt/**         转发到学校服务端，使浏览器侧始终同源、不触发预检
 *
 * 这一层不认识任何平台 API：入参是标准 Request，出参是标准 Response。
 * 平台差异（静态资源从哪取、请求怎么进来）全部由更外层的适配文件吸收：
 *   src/edge/worker.js     Cloudflare Workers（wrangler.jsonc 的 main）
 *   api/edge.js            Vercel Edge Function
 *   src/server/server.mjs  本机 exe（把 Node 的 http 对象转成 Request/Response）
 */
// 不带扩展名：Cloudflare 的 wrangler 与 Vercel 的 Edge 打包器都能解析到
// src/core/casLogin.ts，换成带 .ts 的写法会限制它们的解析策略。
import { protocolLogin, ZHXG } from "../core/casLogin";

/** 登录接口路径 */
export const LOGIN_PATH = "/__auth/login";
/** 需要同源转发的路径前缀 */
export const PROXY_PREFIX = "/znzhxgpt/";

/**
 * Vercel 会把请求重写到固定入口 /api/edge，原始路径由 __padk 参数带回。
 * 这里把它还原成真正的 pathname 与 search —— 其余平台不带该参数，
 * 直接使用 URL 本身即可，行为完全一致。
 */
function resolveTarget(url) {
  const carried = url.searchParams.get("__padk");
  if (!carried) return { pathname: url.pathname, search: url.search };

  const q = new URLSearchParams(url.search);
  q.delete("__padk");
  const s = q.toString();
  return { pathname: carried, search: s ? "?" + s : "" };
}

/** 该路径是否由本层处理 */
export function isApiPath(pathname) {
  return pathname === LOGIN_PATH || pathname.startsWith(PROXY_PREFIX);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function handleLogin(request) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }
  let body;
  try {
    body = JSON.parse((await request.text()) || "{}");
  } catch {
    return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
  }
  const { username, password } = body || {};
  if (!username || !password) return json({ ok: false, error: "缺少账号或密码" }, 400);

  try {
    const out = await protocolLogin(String(username).trim(), String(password));
    return json({ ok: true, ...out });
  } catch (e) {
    // 业务失败也回 200，由 ok 字段区分 —— 前端按这个约定解析
    return json({ ok: false, error: (e && e.message) || "登录失败" });
  }
}

async function handleProxy(request, pathname, search) {
  const target = new URL(pathname + search, ZHXG);
  const headers = new Headers(request.headers);
  headers.set("host", target.host);
  // 先读成字节再转发：Node 侧流式转发需要 duplex 支持，统一缓冲更稳
  const payload =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  const up = await fetch(target, {
    method: request.method,
    headers,
    body: payload,
    redirect: "manual",
  });

  const out = new Headers(up.headers);
  out.set("Access-Control-Allow-Origin", "*");
  return new Response(up.body, { status: up.status, headers: out });
}

/**
 * 处理一条请求。
 * @returns {Promise<Response|null>} 不属于本层的路径返回 null，由调用方接管
 */
export async function handleApi(request) {
  const url = new URL(request.url);
  const { pathname, search } = resolveTarget(url);
  if (!isApiPath(pathname)) return null;

  if (pathname === LOGIN_PATH) return handleLogin(request);

  try {
    return await handleProxy(request, pathname, search);
  } catch (e) {
    return new Response("上游请求失败：" + ((e && e.message) || e), {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
