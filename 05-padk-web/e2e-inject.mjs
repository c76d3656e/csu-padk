/**
 * 注入形态验证：在真实官方页面上加载 inject.js
 * 用 iPhone UA 通过门禁，预置登录态避免跳 CAS
 * 用法: node e2e-inject.mjs <token> <casual>
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const TARGET = "https://zhxg.csu.edu.cn/znzhxgpt_h5/";
const [TOKEN, CASUAL] = [process.argv[2], process.argv[3]];
const INJECT = fs.readFileSync("dist/inject.js", "utf8");

let pass = 0, fail = 0;
const check = (n, ok, ex = "") => {
  ok ? (pass++, console.log(`  ✓ ${n}${ex ? "  " + ex : ""}`))
     : (fail++, console.log(`  ✗ ${n}${ex ? "  " + ex : ""}`));
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  protocolTimeout: 120000,
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});
const page = await browser.newPage();
// 关键：必须是「移动端但不带 MicroMessenger」。
// 带 MicroMessenger 会被官方 H5 判定为微信环境 → 跳 open.weixin.qq.com OAuth 授权。
const SAFARI_IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
await page.setUserAgent(SAFARI_IPHONE_UA);
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

// 预置登录态，避免被重定向到 CAS
// 注意：官方 H5 的 index.html 引导脚本读的是 **sessionStorage**（PC 端亦是），
// 而 uni-app 业务层用 localStorage —— 两处都要写
await page.evaluateOnNewDocument(
  (t, c) => {
    window.__PADK_PROBE__ = { ran: true, at: Date.now() };
    try {
      sessionStorage.setItem("token", t);
      localStorage.setItem("token", t);
      localStorage.setItem("casual", c);
      localStorage.setItem("H5_AUTHED", "1");
      window.__PADK_PROBE__.ok = true;
    } catch (e) {
      window.__PADK_PROBE__.err = String(e);
    }
  },
  TOKEN,
  CASUAL
);

console.log("═".repeat(72));
console.log("注入形态验证（真实官方页面）");
console.log("═".repeat(72));

// 先在同源的其他路径落地写入存储，再导航到 H5 —— sessionStorage 同源共享且不跨导航丢失
console.log("\n【0】预置登录态");
try {
  await page.goto("https://zhxg.csu.edu.cn/znzhxgptpublic/", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  const set = await page.evaluate(
    (t, c) => {
      try {
        sessionStorage.setItem("token", t);
        localStorage.setItem("token", t);
        localStorage.setItem("casual", c);
        localStorage.setItem("H5_AUTHED", "1");
        return {
          ss: sessionStorage.getItem("token")?.length || 0,
          ls: localStorage.getItem("token")?.length || 0,
        };
      } catch (e) {
        return { err: String(e) };
      }
    },
    TOKEN,
    CASUAL
  );
  check("登录态已写入同源存储", (set.ss || 0) > 30 && (set.ls || 0) > 30, `session=${set.ss} local=${set.ls}`);
} catch (e) {
  console.log("  ! 预置失败：" + e.message);
}

console.log("\n【1】打开官方移动端");
try {
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 45000 });
} catch (e) {
  console.log("  ! 页面加载受限：" + e.message);
}
await new Promise((r) => setTimeout(r, 4000));

const url1 = page.url();
check("未跳转到 CAS 登录页", !url1.includes("ca.csu.edu.cn"), url1.slice(0, 70));
check("未被 UA 门禁拦到 error 页", !url1.includes("public/error"), "");
check("UA 已伪装为移动端", (await page.evaluate(() => navigator.userAgent)).includes("iPhone"), "");

// 诊断：注入脚本是否在 document 创建时执行
const probe = await page.evaluate(() => window.__PADK_PROBE__ || null);
console.log("  · 注入探针:", JSON.stringify(probe));
const lsState = await page.evaluate(() => {
  try {
    return {
      host: location.hostname,
      h5authed: localStorage.getItem("H5_AUTHED"),
      tokenLen: (localStorage.getItem("token") || "").length,
      ssTokenLen: (sessionStorage.getItem("token") || "").length,
    };
  } catch (e) {
    return { err: String(e) };
  }
});
console.log("  · 当前存储:", JSON.stringify(lsState));

console.log("\n【2】注入 inject.js");
await page.evaluate((code) => {
  const s = document.createElement("script");
  s.textContent = code;
  document.documentElement.appendChild(s);
}, INJECT);
await new Promise((r) => setTimeout(r, 3500));

const state = await page.evaluate(() => {
  const host = document.getElementById("csu-padk-panel-host");
  const shadow = host?.shadowRoot;
  const root = shadow?.querySelector(".root");
  const head = shadow?.querySelector(".head .title");
  const btn = shadow ? [...shadow.querySelectorAll("button")].find((b) => b.textContent?.includes("立即打卡")) : null;
  return {
    hostExists: !!host,
    hasShadow: !!shadow,
    shadowStyleCount: shadow ? shadow.querySelectorAll("style").length : 0,
    rootExists: !!root,
    panelTitle: head?.textContent || "",
    punchBtn: !!btn,
    rect: root ? root.getBoundingClientRect().width : 0,
    leakedGlobal: !!document.querySelector("head style[data-leaflet-css]"),
    shadowText: (shadow?.textContent || "").slice(0, 400),
  };
});

check("宿主容器已挂载", state.hostExists, "");
check("Shadow DOM 已建立", state.hasShadow, "");
check("样式表已注入到 Shadow 内", state.shadowStyleCount > 0, `${state.shadowStyleCount} 份`);
check("面板已渲染", state.rootExists, state.panelTitle ? `标题「${state.panelTitle}」` : "");
check("打卡按钮存在", state.punchBtn, "");
check("浮层宽度合理", state.rect > 200, `${Math.round(state.rect)}px`);
check("未污染宿主页面全局样式", !state.leakedGlobal, "");

console.log("\n【3】面板实际工作（读取真实数据）");
await page.evaluate(() => {
  const shadow = document.getElementById("csu-padk-panel-host")?.shadowRoot;
  [...(shadow?.querySelectorAll("button") || [])]
    .find((b) => b.textContent?.trim() === "设置")
    ?.click();
});
await new Promise((r) => setTimeout(r, 700));

const work2 = await page.evaluate(() => {
  const shadow = document.getElementById("csu-padk-panel-host")?.shadowRoot;
  if (!shadow) return null;
  const txt = shadow.textContent || "";
  const sel = shadow.querySelector("select");
  return {
    shiftLoaded: txt.includes("校内住宿打卡"),
    window: /20:00/.test(txt),
    optionCount: sel ? sel.options.length : 0,
  };
});
check("班次数据已加载", work2?.shiftLoaded, "");
check("时间窗已加载", work2?.window, "");
check("宿舍楼下拉已填充", (work2?.optionCount || 0) > 1, `${work2?.optionCount || 0} 项`);

// 选一栋楼 → 地图入口才出现
const mapEntry = await page.evaluate(async () => {
  const shadow = document.getElementById("csu-padk-panel-host")?.shadowRoot;
  const sel = shadow?.querySelector("select");
  const opt = sel ? [...sel.options].find((o) => o.value) : null;
  if (opt && sel) {
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 1200));
  const btns = [...(shadow?.querySelectorAll("button") || [])].map((b) => b.textContent?.trim());
  return { building: opt?.textContent || "", hasMapBtn: btns.includes("地图选点"), btns };
});
check("选择宿舍楼后出现地图入口", mapEntry.hasMapBtn, mapEntry.building ? `(${mapEntry.building})` : "");

await page.screenshot({ path: "e2e-inject.png", fullPage: false });

await browser.close();
console.log("\n" + "═".repeat(72));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
console.log("═".repeat(72));
process.exit(fail === 0 ? 0 : 1);
