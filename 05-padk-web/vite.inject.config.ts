import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 注入脚本：单文件 IIFE，供 bookmarklet 动态加载
// 产出一份自包含的 inject.js，挂载 Shadow DOM 面板，不污染宿主页面样式
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
