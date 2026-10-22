/**
 * 注入入口 —— 由 bookmarklet 动态加载
 *
 * 设计要点：
 *   1. 挂载在 Shadow DOM 内，样式与宿主页面完全隔离，不会污染 zhxg 的原 UI
 *   2. 所有请求在宿主域内同源发出，不受 CORS 限制
 *   3. token / casual 只从宿主 localStorage 读取，绝不上传到任何第三方
 */
import { createRoot } from "react-dom/client";
import Panel from "./panel/Panel";
import css from "./panel/panel.css?inline";

const HOST_ID = "csu-padk-panel-host";
const ALLOWED_HOST = /(^|\.)csu\.edu\.cn$/i;

/**
 * 登录回跳自愈
 *
 * 统一身份认证回跳后，uid / lzc 是挂在 **query**（window.location.search）上的，
 * 而应用内路由停在公开的错误页：
 *   https://zhxg.csu.edu.cn/znzhxgpt_h5/?uid=…&lzc=…#/pages/public/error
 *
 * 登录回调页 /pages/login/myindex 正是从 location.search 读取这两个值的。
 * 所以只要把 hash 换到回调页（不刷新页面），就能直接接着走完登录流程。
 */
function healGate(): boolean {
  const inError = location.hash.includes("/pages/public/error");
  const hasCred = /[?&]uid=/.test(location.search) && /[?&]lzc=/.test(location.search);
  if (inError && hasCred) {
    console.log("%c[平安打卡] 正在接续登录回跳…", "color:#0a84ff;font-weight:700");
    location.hash = "#/pages/login/myindex";
    return true;
  }
  return false;
}

function mount() {
  // 面板需要读取同源的会话凭据，因此只在体系内域生效
  if (!ALLOWED_HOST.test(location.hostname)) {
    const go = confirm(
      "「平安打卡」需要在已登录的官方页面里运行。\n\n" +
        "现在为你打开智慧学工移动端首页，登录完成后再点一次本书签即可。"
    );
    if (go) window.open("https://zhxg.csu.edu.cn/znzhxgpt_h5/", "_blank", "noopener");
    return;
  }

  // 若停在回跳页，先接续再说
  if (healGate()) return;

  // 重复点击书签时重新挂载，保证拿到最新 bundle
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;pointer-events:none;";

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = css;
  shadow.appendChild(style);

  const mountPoint = document.createElement("div");
  mountPoint.style.cssText = "pointer-events:none;";
  shadow.appendChild(mountPoint);

  document.documentElement.appendChild(host);
  createRoot(mountPoint).render(<Panel />);

  console.log("%c[平安打卡] 面板已注入", "color:#0a84ff;font-weight:700;font-size:14px");
  console.log("%c  数据全部保留在你本机，未向任何服务器上传", "color:#8e8e93");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
