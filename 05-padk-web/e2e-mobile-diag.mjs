/** 移动端地图高度异常诊断 */
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://localhost:5173";
const [TOKEN, CASUAL] = [process.argv[2], process.argv[3]];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();

async function setup(w, h, mobile) {
  await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.evaluate((t, c) => {
    localStorage.setItem("token", t);
    localStorage.setItem("casual", c);
  }, TOKEN, CASUAL);
  await page.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2000));

  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "设置")?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const sel = document.querySelector("select");
    const o = [...sel.options].find((x) => x.value);
    if (o) { sel.value = o.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "地图选点")?.click();
  });
  await new Promise((r) => setTimeout(r, 4000));
}

async function diag(label) {
  const d = await page.evaluate(() => {
    const wrap = document.querySelector(".mapwrap");
    const box = document.querySelector(".mapbox");
    const shell = document.querySelector(".padk-shell");
    const root = document.querySelector(".root.page-mode");
    const cs = box ? getComputedStyle(box) : null;
    return {
      exists: { shell: !!shell, root: !!root, wrap: !!wrap, box: !!box },
      wrapRect: wrap ? wrap.getBoundingClientRect().height : null,
      boxRect: box ? box.getBoundingClientRect().height : null,
      boxInlineH: box ? box.style.height : null,
      boxComputedH: cs ? cs.height : null,
      boxDisplay: cs ? cs.display : null,
      matchMobileMQ: window.matchMedia("(max-width: 640px)").matches,
      leafletSize: (() => {
        const el = document.querySelector(".leaflet-container");
        return el ? { w: el.clientWidth, h: el.clientHeight } : null;
      })(),
      tiles: document.querySelectorAll(".leaflet-tile").length,
    };
  });
  console.log(`\n[${label}]`);
  console.log(JSON.stringify(d, null, 2));
}

console.log("════ 桌面 1440×900 ════");
await setup(1440, 900, false);
await diag("桌面");

console.log("\n════ 移动 390×844 ════");
await setup(390, 844, true);
await diag("移动");

console.log("\n════ 从桌面切到移动（不重载，模拟旋转/缩放）════");
await setup(1440, 900, false);
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await new Promise((r) => setTimeout(r, 1500));
await diag("切换后");

await browser.close();
