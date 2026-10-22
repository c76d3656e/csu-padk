/**
 * Cloudflare Workers 入口
 *
 * wrangler.jsonc 里 main 直接指向本文件，wrangler 自己会编译 TypeScript
 * 与相对导入，不需要预先打包。assets.directory 指向 dist/，静态资源与
 * Worker 一次性上传。
 *
 * run_worker_first 只把 /__auth/login 与 /znzhxgpt/* 交给它，其余请求
 * 由静态资源直接返回，不消耗 Worker 调用。
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
