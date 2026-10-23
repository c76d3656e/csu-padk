/**
 * EdgeOne Makers Edge Function 入口 —— 同源转发
 *
 * [[default]] 是目录级兜底：/znzhxgpt/ 下的任意层级都落到本文件，
 * 包括 /znzhxgpt/qxj/qxj-padkglxx/xspadk 这种多级路径。
 *
 * 业务逻辑全在 ../../src/edge/handler.js，本文件只做平台接线。
 */
import { handleApi } from "../../src/edge/handler.js";

export async function onRequest(context) {
  const res = await handleApi(context.request);
  if (res) return res;
  return new Response("Not Found", { status: 404 });
}
