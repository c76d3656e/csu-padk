/**
 * 布局与视觉健康度检查（DOM 层面）
 * 用法: node e2e-layout.mjs <token> <casual>
 */
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://localhost:5173";
const [TOKEN, CASUAL] = [process.argv[2], process.argv[3]];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--window-size=1440,1800"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1800 });
await page.goto(BASE, { waitUntil: "networkidle2" });
await page.evaluate((t, c) => {
  localStorage.setItem("token", t);
  localStorage.setItem("casual", c);
}, TOKEN, CASUAL);
await page.reload({ waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 2500));

// 选楼 + 展开地图
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "设置")?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  const sel = document.querySelector("select");
  const opt = [...sel.options].find((o) => o.value);
  if (opt) {
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
await new Promise((r) => setTimeout(r, 700));
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => b.textContent?.trim() === "地图选点")
    ?.click();
});
await new Promise((r) => setTimeout(r, 4500));
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "生成落点")?.click();
});
await new Promise((r) => setTimeout(r, 900));

const report = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) };
  };
  const root = q(".root.page-mode");
  const map = q(".mapbox");
  const btn = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "立即打卡"
  );
  const primary = q(".mapwrap");
  const legend = q(".map-legend");
  const landing = q(".landing");

  return {
    root: r(root),
    map: r(map),
    primaryBtn: r(btn),
    legend: r(legend),
    landingCard: r(landing),
    bodyScrollW: document.body.scrollWidth,
    winW: window.innerWidth,
    overflowX: document.body.scrollWidth > window.innerWidth + 2,
    // 关键文案是否齐全
    texts: {
      shift: /校内住宿打卡/.test(document.body.innerText),
      window: /20:00-23:30/.test(document.body.innerText),
      landing: /偏移|距圆心/.test(document.body.innerText),
      coord: /[\d]{3}\.[\d]+,\s*[\d]{2}\.[\d]+/.test(document.body.innerText),
    },
    // 面板本身是否被裁剪
    rootVisible: root ? root.getBoundingClientRect().height > 300 : false,
    // 地图是否是有效尺寸
    mapUsable: map ? map.getBoundingClientRect().height >= 200 : false,
    tileCount: document.querySelectorAll(".leaflet-tile").length,
    cssVars: (() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        brass: cs.getPropertyValue("--brass").trim(),
        ink: cs.getPropertyValue("--ink").trim(),
      };
    })(),
  };
});

console.log(JSON.stringify(report, null, 2));

/* 移动端视口复查 */
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await new Promise((r) => setTimeout(r, 1200));
const mob = await page.evaluate(() => ({
  overflowX: document.body.scrollWidth > window.innerWidth + 2,
  scrollW: document.body.scrollWidth,
  winW: window.innerWidth,
  mapH: Math.round(document.querySelector(".mapbox")?.getBoundingClientRect().height || 0),
  btnH: Math.round(
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === "立即打卡")
      ?.getBoundingClientRect().height || 0
  ),
}));
console.log("\n移动端 390×844:", JSON.stringify(mob));
await page.screenshot({ path: "e2e-mobile.png", fullPage: true });

await browser.close();
