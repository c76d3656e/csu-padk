/**
 * Cloudflare Workers 入口
 *
 * 打包成 dist/_worker.js（见 vite.config.ts 的 padk-worker 插件），
 * 与静态资源一起部署：wrangler.jsonc 里 run_worker_first 只把
 * /__auth/login 与 /znzhxgpt/** 交给它，其余请求由静态资源直接返回。
 *
 * 业务逻辑全在 ./handler.js，本文件只做平台接线。
 */
import { handleApi } from "./handler.js";

export default {
  async fetch(request, env) {
    const res = await handleApi(request);
    if (res) return res;
    // 兜底：未命中的路径交给静态资源（SPA 回落也在这一步完成）
    return env.ASSETS.fetch(request);
  },
};
