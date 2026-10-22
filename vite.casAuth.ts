/**
 * 开发服务器的登录中间件（只在 vite dev 生效，生产构建不含）
 *
 * 只做一件事：把 Connect 的 req/res 接到共享的登录实现上。
 * 协议流程在 src/core/casLogin.ts，密码加密在 src/core/kcipher.ts ——
 * 与边缘函数、本机服务完全同一份代码，这里没有业务逻辑。
 *
 *   POST /__auth/login  { username, password }  →  { ok, token, casual, user }
 *
 * 中间件只在内存中转发，不落盘、不记录凭据。
 */
import type { Plugin } from "vite";
import { protocolLogin } from "./src/core/casLogin.ts";

export function casAuthPlugin(): Plugin {
  return {
    name: "padk-cas-auth",
    apply: "serve",
    configureServer(server) {
      // req / res 是 Node 的 http 对象。本项目刻意不引入 @types/node
      // （见 src/types.d.ts），这里按实际用到的成员就地取型。
      const handler = (req: any, res: any, next: () => void) => {
        if (!req.url?.startsWith("/__auth/login")) return next();

        let raw = "";
        req.on("data", (c: any) => (raw += c));
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
            server.config.logger.info(`[cas-auth] ${out.user.xh} 登录成功 (${Date.now() - t0}ms)`);
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, ...out }));
          } catch (e: any) {
            server.config.logger.warn(`[cas-auth] 失败: ${e?.message}`);
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: false, error: e?.message || "登录失败" }));
          }
        });
      };
      server.middlewares.use(handler);
    },
  };
}
