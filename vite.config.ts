import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { casAuthPlugin } from "./vite.casAuth";

/**
 * 站点构建 —— 产出 dist/（静态资源）
 *
 * 边缘侧不需要这里额外做打包：Cloudflare 的 wrangler 与 Vercel 的
 * Edge Function 都会自己把 src/edge/ 下的入口连同共享模块一起编译。
 * 两种运行形态共用 src/core 里的同一份实现，本文件不参与业务逻辑。
 */
export default defineConfig({
  plugins: [react(), casAuthPlugin()],
  base: "./",
  server: {
    port: 5173,
    // 构建产物与 exe 中间产物会在源码目录旁反复重写，
    // 被 chokidar 监听会抛 EBUSY 并打挂 dev server
    watch: {
      ignored: [
        "**/.*.tmpdir/**",
        "**/*.tmp",
        "**/dist/**",
        "**/padk.exe",
        "**/server.sea.cjs",
        "**/sea-prep.blob",
        "**/sea-config.json",
      ],
    },
    // 开发时把业务接口代理到学校服务端，浏览器侧仍是同源
    proxy: {
      "/znzhxgpt": {
        target: "https://zhxg.csu.edu.cn",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
