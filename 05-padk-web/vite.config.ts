import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { casAuthPlugin } from "./vite.casAuth";

// 引导站：标准 SPA
export default defineConfig({
  plugins: [react(), casAuthPlugin()],
  base: "./",
  server: {
    port: 5173,
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
