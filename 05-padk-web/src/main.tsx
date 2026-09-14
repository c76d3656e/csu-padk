import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import PadkPage from "./padk/PadkPage";
import Landing from "./landing/Landing";
import Classic from "./landing/Classic";
import "./landing/landing.css";
import "./landing/classic.css";
import "./padk/padk.css";

/**
 * 本地站点通过 Vite 反向代理访问真实接口，保持浏览器侧同源
 * —— 否则会因 OPTIONS 预检被 nginx 拒绝（403）而报 "Failed to fetch"
 *
 * 只在开发环境覆盖；生产构建沿用 api.ts 里的真实域名
 * （注入形态下页面本身就在 zhxg.csu.edu.cn，天然同源）
 */
if (import.meta.env.DEV) {
  (window as any).__PADK_ORIGIN__ = "";
  (window as any).__PADK_LOCAL__ = true;
}

/**
 * 极简 hash 路由 —— 静态托管无需服务端 rewrite
 *
 *   /           打卡页（默认入口，登录后直接就是它）
 *   #/guide     勘测图纸版引导页
 *   #/classic   原版界面
 */
function Router() {
  const [hash, setHash] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash
  );

  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  if (hash.startsWith("#/guide")) return <Landing />;
  if (hash.startsWith("#/classic")) return <Classic />;
  return <PadkPage />;
}

createRoot(document.getElementById("root")!).render(<Router />);
