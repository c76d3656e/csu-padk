/**
 * Vercel Edge Function 入口
 *
 * vercel.json 把 /__auth/login 与 /znzhxgpt/** 重写到本函数，
 * 其余路径由 Vercel 的静态托管直接返回 dist/ 里的文件。
 *
 * 业务逻辑全在 ../src/edge/handler.js，本文件只做平台接线。
 */
import { handleApi } from "../src/edge/handler.js";

export const config = { runtime: "edge" };

export default async function handler(request) {
  const res = await handleApi(request);
  if (res) return res;
  return new Response("Not Found", { status: 404 });
}
