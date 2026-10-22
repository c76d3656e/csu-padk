/**
 * 本地环境声明
 *
 * 本项目刻意不引入 @types/node —— 共享代码（src/core、src/edge、api/）
 * 要在浏览器、Node、边缘运行时三处运行，依赖 Node 的类型会让共享层
 * 悄悄长出平台耦合。这里只补上确有需要的一点点声明。
 * 资源模块（*.css 等）由 vite/client 提供，见 vite-env.d.ts。
 */

interface Window {
  /** 自托管形态（本机服务 / 边缘部署）把接口根置空，走同源转发 */
  __PADK_ORIGIN__?: string;
}
