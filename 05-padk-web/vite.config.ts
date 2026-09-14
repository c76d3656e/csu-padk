import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { casAuthPlugin } from "./vite.casAuth";

// 引导站：标准 SPA
export default defineConfig({
  plugins: [react(), casAuthPlugin()],
  base: "./",
  server: {
    port: 5173,
    // 编辑器/工具写入时会在源目录留下临时目录，
    // 被 chokidar 监听会抛 EBUSY 并打挂 dev server
    watch: {
      // 编辑器/工具写入时会在源目录留下临时目录，
      // 被 chokidar 监听会抛 EBUSY 并打挂 dev server。
      // 构建产物目录同样排除 —— npm run build 会整目录重写，
      // 触发的 page reload 没有意义，还会和 watcher 抢文件句柄。
      ignored: [
        "**/.*.tmpdir/**",
        "**/*.tmp",
        "**/dist/**",
        "**/dist-inject/**",
        // 截图目录整批删改会引发 watcher 事件风暴，且没有 HMR 价值
        "**/shots/**",
      ],
    },
    // 本地调试用反向代理：浏览器侧仍是同源，绕开 CORS 预检
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
