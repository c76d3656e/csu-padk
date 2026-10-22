import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 注入脚本构建 —— 单文件 IIFE，供书签 / 油猴脚本动态加载
 *
 * 产出一份自包含的 inject.js，挂载 Shadow DOM 面板，不污染宿主页面样式。
 * 它随主站点一起产出（见 package.json 的 build 脚本），
 * 部署后位于站点根目录，书签代码直接引用这个固定路径。
 */
export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist-inject",
    emptyOutDir: true,
    target: "es2020",
    lib: {
      entry: "src/inject.tsx",
      name: "CSUPadkPanel",
      formats: ["iife"],
      fileName: () => "inject.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: "inject[extname]",
      },
    },
  },
});
