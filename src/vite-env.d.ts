/// <reference types="vite/client" />

// Vite 的 ?inline 后缀会把 CSS 作为字符串导出
declare module "*.css?inline" {
  const css: string;
  export default css;
}
