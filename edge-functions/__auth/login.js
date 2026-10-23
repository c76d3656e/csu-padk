/**
 * EdgeOne Makers Edge Function 入口 —— 登录
 *
 * 目录即路由：本文件对应 POST /__auth/login。
 * 业务逻辑全在 ../../src/edge/handler.js，本文件只做平台接线。
 */
import { handleApi } from "../../src/edge/handler.js";

export async function onRequest(context) {
  const res = await handleApi(context.request);
  if (res) return res;
  return new Response("Not Found", { status: 404 });
}
