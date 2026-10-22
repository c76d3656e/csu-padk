import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import PadkPage from "./padk/PadkPage";
import Landing from "./landing/Landing";
import Classic from "./landing/Classic";
import "./landing/landing.css";
import "./landing/classic.css";
import "./padk/padk.css";

/**
 * 极简 hash 路由 —— 静态托管无需服务端 rewrite
 *
 *   /           打卡页（默认入口，登录后直接就是它）
 *   #/guide     使用说明 / 自行部署
 *   #/classic   紧凑版界面
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
