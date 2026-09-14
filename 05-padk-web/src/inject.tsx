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
 * 门禁自愈
 *
 * zhxg 的 App.vue onLaunch 只在**页面启动时**检查一次 UA：
 *   非移动端 → uni.reLaunch('/pages/public/error')
 *
 * 但 CAS 回调后 uid / lzc 是挂在 **query**（window.location.search）上的，不在 hash：
 *   https://zhxg.csu.edu.cn/znzhxgpt_h5/?uid=…&lzc=…#/pages/public/error
 *
 * 而登录回调页 /pages/login/myindex 正是从 location.search 读取 uid/lzc 的。
 * 因此只要在 error 页**改 hash 而不刷新**，就能绕过 UA 检查直接进入登录回调流程。
 */
function healGate(): boolean {
  const inError = location.hash.includes("/pages/public/error");
  const hasCred = /[?&]uid=/.test(location.search) && /[?&]lzc=/.test(location.search);
  if (inError && hasCred) {
    console.log("%c[平安打卡] 检测到 UA 门禁拦截，正在绕过…", "color:#2278fd;font-weight:700");
    location.hash = "#/pages/login/myindex";
    return true;
  }
  return false;
}

function mount() {
  // host.html 会预设该标记：本地调试时跳过域名校验（请求走 Vite 反向代理，仍为同源）
  const isLocal = (window as any).__PADK_LOCAL__ === true;

  // 正式场景只在体系内域生效：面板需要读取同源的会话凭据
  if (!isLocal && !ALLOWED_HOST.test(location.hostname)) {
    const go = confirm(
      "「平安打卡」需要在已登录的官方页面里运行。\n\n" +
        "现在为你打开智慧学工移动端首页，登录完成后再点一次本书签即可。"
    );
    if (go) window.open("https://zhxg.csu.edu.cn/znzhxgpt_h5/", "_blank", "noopener");
    return;
  }

  // 若卡在错误页，先自愈再说
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

  console.log("%c[平安打卡] 面板已注入", "color:#2278fd;font-weight:700;font-size:14px");
  console.log("%c  数据全部保留在你本机，未向任何服务器上传", "color:#9096a2");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
