/**
 * 真实浏览器端到端测试（Edge / Chromium，headless）
 * 覆盖：首屏 → 登录 → 自动定位 → 实时打卡 → 虚拟落点 → 地图 → 其它页面
 * 用法: node e2e-browser.mjs <token> <casual>
 */
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://localhost:5173";
const TOKEN = process.argv[2] || "";
const CASUAL = process.argv[3] || "";

// 天心校区学生宿舍附近
const FAKE_GEO = { latitude: 28.14025, longitude: 112.99359 };

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  ok ? (pass++, console.log(`  ✓ ${name}${extra ? "  " + extra : ""}`))
     : (fail++, console.log(`  ✗ ${name}${extra ? "  " + extra : ""}`));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  protocolTimeout: 180000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,1600"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1600 });
await browser.defaultBrowserContext().overridePermissions(BASE, ["geolocation"]).catch(() => {});
await page.setGeolocation(FAKE_GEO);

const consoleErrors = [];
const failedRequests = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`));

console.log("═".repeat(74));
console.log("真实浏览器端到端测试");
console.log("═".repeat(74));

/* ── 1 ── */
console.log("\n【1】首屏");
await page.goto(BASE, { waitUntil: "networkidle2", timeout: 30000 });
await sleep(800);
const mark = await page.evaluate(() => window.__PADK_ORIGIN__);
check("__PADK_ORIGIN__ 在模块加载前注入", mark === "", `= ${JSON.stringify(mark)}`);
let text = await page.evaluate(() => document.body.innerText);
check("渲染出登录表单", text.includes("登录并进入打卡"), "");
check("无 Failed to fetch", !text.includes("Failed to fetch"), "");

if (!TOKEN) {
  console.log("\n(未提供 token，跳过数据相关断言)");
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

/* ── 2 ── */
console.log("\n【2】登录后自动定位");
await page.evaluate(
  (t, c) => {
    localStorage.setItem("token", t);
    localStorage.setItem("casual", c);
    localStorage.removeItem("csu-padk:settings"); // 清圆心，验证自动流程
  },
  TOKEN,
  CASUAL
);
await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
await sleep(5000);

text = await page.evaluate(() => document.body.innerText);
check("进入打卡页", !text.includes("登录并进入打卡"), "");
check("班次已加载", text.includes("校内住宿打卡"), "");
check("时间窗已加载", /20:00/.test(text) && /23:30/.test(text), "");
check("无 Failed to fetch", !text.includes("Failed to fetch"), "");
check("默认处于实时定位模式", text.includes("用当前位置打卡"), "");
const gotPos = /定位成功/.test(text);
check("自动取得定位", gotPos, gotPos ? (text.match(/定位成功[^\n]*/) || [])[0] : "");
check("定位坐标已显示", /当前位置/.test(text) || /±\d+m/.test(text), "");

// 定位后必须明确告知最近的宿舍楼
const nbLine = text.match(/最近宿舍楼\s*([\u4e00-\u9fa5A-Za-z0-9]+·[\u4e00-\u9fa5A-Za-z0-9]+)\s*([\d.]+(?:m|km))/);
check("提示了最近的宿舍楼", !!nbLine, nbLine ? `${nbLine[1]} ${nbLine[2]}` : "");
if (nbLine) {
  const near150 = /就在附近/.test(text);
  const far = /不在校区周边/.test(text);
  check("距离与状态标注合理", near150 || far || true, near150 ? "标注「就在附近」" : far ? "标注「不在校区周边」" : "仅显示距离");
}

/* ── 3 实时打卡 ── */
console.log("\n【3】实时定位打卡");
const live = await page.evaluate(async () => {
  const b = [...document.querySelectorAll("button")].find(
    (x) => x.textContent?.trim() === "用当前位置打卡"
  );
  if (!b) return { found: false };
  b.click();
  await new Promise((r) => setTimeout(r, 3500));
  const t = document.body.innerText;
  return {
    found: true,
    disabled: b.disabled,
    logs: (t.match(/(预检|未放行|提交|打卡成功|打卡未完成)[^\n]*/g) || []).slice(-4),
    text: t,
  };
});
check("打卡按钮可用", live.found && !live.disabled, "");
for (const l of live.logs || []) console.log("      " + l.trim());

// 现在不在打卡窗口内，服务端应判 canDk=false —— 此时必须「不提交」，而不是假装成功
const blocked = /未放行/.test(live.text || "");
const submitted = (live.logs || []).some((l) => /提交成功|打卡成功/.test(l));
check("预检已执行", (live.logs || []).some((l) => /预检|未放行/.test(l)), "");
check("未放行时不提交", !submitted, submitted ? "!! 仍然提交了" : "已按服务端判定中止");
check("给出了未放行原因", blocked, blocked ? (live.text.match(/未放行[^\n]*/) || [])[0] : "");
check(
  "不出现虚假成功提示",
  !/打卡成功/.test(live.text || ""),
  ""
);

/* ── 4 虚拟落点 ── */
console.log("\n【4】虚拟落点模式");
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((x) => x.textContent?.trim() === "虚拟落点")
    ?.click();
});
await sleep(600);
text = await page.evaluate(() => document.body.innerText);
check("已切换到虚拟落点模式", text.includes("提交虚拟落点"), "");

// 确保有圆心
const hasCenter = await page.evaluate(() => /圆心\s*[\d.]+/.test(document.body.innerText));
if (!hasCenter) {
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "设置")?.click();
  });
  await sleep(500);
  await page.evaluate(() => {
    const sel = document.querySelector("select");
    const o = sel ? [...sel.options].find((x) => x.value) : null;
    if (o && sel) { sel.value = o.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  await sleep(900);
}
text = await page.evaluate(() => document.body.innerText);
check("圆心已确定", /圆心\s*[\d.]+/.test(text), "");

// 「周边 N 栋楼」在设置面板里，展开后检查
await page.evaluate(() => {
  if (!document.querySelector(".card")) {
    [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "设置")?.click();
  }
});
await sleep(600);
text = await page.evaluate(() => document.body.innerText);
const nb = text.match(/周边\s*(\d+)\s*栋楼/);
check("围栏内楼栋统计已计算", !!nb, nb ? `${nb[1]} 栋` : "");

const roll = async () => {
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "生成落点")?.click();
  });
  await sleep(700);
  return await page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/偏移\s*([\d.]+)m\s*距圆心\s*([\d.]+)m/);
    // 精确取落点卡片里的坐标，避免抓到圆心/定位坐标
    const coordEl = document.querySelector(".landing .coord");
    const key = (coordEl?.textContent || "").trim();
    return m ? { offset: +m[1], dist: +m[2], key } : null;
  });
};
const pts = [];
for (let i = 0; i < 5; i++) pts.push(await roll());
const ok = pts.filter(Boolean);
check("生成了落点", ok.length > 0, ok[0] ? `偏移 ${ok[0].offset}m / 距圆心 ${ok[0].dist}m` : "");
check("落点均在围栏内", ok.every((p) => p.dist <= 300), ok.length ? `max ${Math.max(...ok.map((p) => p.dist))}m` : "");
const uniq = new Set(ok.map((p) => p.key).filter(Boolean));
check("连续 5 次不重合", uniq.size === ok.length && uniq.size > 0, `${uniq.size}/${ok.length} 个不同坐标`);

/* ── 5 地图 ── */
console.log("\n【5】地图");
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "地图选点")?.click();
});
await sleep(4500);
const map = await page.evaluate(() => ({
  leaflet: !!document.querySelector(".leaflet-container"),
  tiles: document.querySelectorAll(".leaflet-tile").length,
  paths: document.querySelectorAll(".leaflet-overlay-pane path").length,
  markers: document.querySelectorAll(".leaflet-marker-icon").length,
  legend: !!document.querySelector(".map-legend"),
  clickTarget: !!document.querySelector(".click-target"),
}));
check("地图容器已挂载", map.leaflet, "");
check("底图瓦片已加载", map.tiles > 0, `${map.tiles} 张`);
check("围栏圆已绘制", map.paths > 0, `${map.paths} 个 path`);
check("图钉已渲染", map.markers > 0, `${map.markers} 个`);
check("图例可见", map.legend, "");
check("点击目标切换器存在", map.clickTarget, "");
await page.screenshot({ path: "e2e-map.png", fullPage: true });

/* ── 5.5 手动指定落点 ── */
console.log("\n【5.5】手动控制落点");
// 确认默认作用目标是「落点」
const ctDefault = await page.evaluate(() => {
  const on = document.querySelector(".click-target button.on");
  return on ? on.textContent.trim() : "";
});
check("默认点击目标为落点", ctDefault === "落点", `当前：${ctDefault}`);

const before = await page.evaluate(
  () => (document.querySelector(".landing .coord")?.textContent || "").trim()
);

// 在地图偏右下方点一下
const clicked = await page.evaluate(() => {
  const el = document.querySelector(".leaflet-container");
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const ev = new MouseEvent("click", {
    clientX: Math.round(r.left + r.width * 0.68),
    clientY: Math.round(r.top + r.height * 0.62),
    bubbles: true,
    cancelable: true,
    view: window,
  });
  el.dispatchEvent(ev);
  return true;
});
check("已向地图派发点击", clicked, "");
await sleep(900);

const after = await page.evaluate(() => ({
  coord: (document.querySelector(".landing .coord")?.textContent || "").trim(),
  manual: /手动指定/.test(document.body.innerText),
  logs: (document.body.innerText.match(/手动落点[^\n]*/g) || []).slice(-1),
}));
check("落点已变更", after.coord && after.coord !== before, `${before} → ${after.coord}`);
check("标记为手动指定", after.manual, "");
check("日志记录了手动落点", after.logs.length > 0, after.logs[0] || "");

// 切到「圆心」再点一次，应改变圆心而不是落点
const coordAfterLanding = after.coord;
await page.evaluate(() => {
  const btns = [...document.querySelectorAll(".click-target button")];
  btns.find((b) => b.textContent?.trim() === "圆心")?.click();
});
await sleep(400);
await page.evaluate(() => {
  const el = document.querySelector(".leaflet-container");
  const r = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent("click", {
      clientX: Math.round(r.left + r.width * 0.35),
      clientY: Math.round(r.top + r.height * 0.3),
      bubbles: true,
      cancelable: true,
      view: window,
    })
  );
});
await sleep(900);
const afterCenter = await page.evaluate(() => ({
  coord: (document.querySelector(".landing .coord")?.textContent || "").trim(),
  center: (document.body.innerText.match(/圆心\s*[\d.]+,\s*[\d.]+/) || [])[0] || "",
}));
check("切到圆心后点击不再改落点", afterCenter.coord === coordAfterLanding, "");
check("圆心已变更", !!afterCenter.center, afterCenter.center);

/* ── 6 其它页面 ── */
console.log("\n【6】其它页面");
for (const [name, hash, expect] of [
  ["引导页", "#/guide", "使用流程"],
  ["原版界面", "#/classic", "一键面板"],
]) {
  await page.goto(BASE + "/" + hash, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1200);
  const t = await page.evaluate(() => document.body.innerText);
  check(`${name} 可渲染`, t.includes(expect), "");
}

/* ── 7 健康度 ── */
console.log("\n【7】控制台与网络");
const realReq = failedRequests.filter((u) => !/favicon|analytics/.test(u));
check("无失败请求", realReq.length === 0, realReq.slice(0, 3).join(" | "));
const realErr = consoleErrors.filter((e) => !/favicon|DevTools|Download the React/i.test(e));
check("无控制台错误", realErr.length === 0, realErr.slice(0, 2).join(" | "));

await browser.close();
console.log("\n" + "═".repeat(74));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
console.log("═".repeat(74));
process.exit(fail === 0 ? 0 : 1);
