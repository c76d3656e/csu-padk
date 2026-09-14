/**
 * 视觉快照：把关键界面状态截到 shots/
 *
 *   node e2e-visual.mjs
 *   PADK_BASE=http://localhost:5199 node e2e-visual.mjs
 *
 * 接口全部走 e2e-fixtures 的桩数据，不打真实服务端。
 * 截图用来看观感，规范符合性交给 e2e-audit.mjs。
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import {
  EDGE,
  BASE,
  installStubs,
  enterReady,
  clickByText,
  sleep,
} from "./e2e-fixtures.mjs";

const SHOT = process.env.PADK_SHOT_DIR || "shots";
mkdirSync(SHOT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});

const shot = async (page, name) => {
  await page.screenshot({ path: `${SHOT}/${name}.png` });
  console.log(`  ${SHOT}/${name}.png`);
};

/* ① 登录页 —— 清空凭据 */
const lp = await browser.newPage();
await lp.setViewport({ width: 960, height: 900, deviceScaleFactor: 2 });
await lp.goto(BASE, { waitUntil: "domcontentloaded" });
await lp.evaluate(() => localStorage.clear());
await lp.reload({ waitUntil: "networkidle2" });
await sleep(1000);
await shot(lp, "1-login");
await lp.close();

/* ② 打卡页 */
const page = await browser.newPage();
await page.setViewport({ width: 980, height: 1180, deviceScaleFactor: 2 });
await installStubs(page);
await enterReady(page);
await shot(page, "2-padk-live");

await clickByText(page, "设置");
await sleep(500);
await shot(page, "3-settings");

/* 选宿舍楼：必须在设置展开时操作 */
const buildingValue = await page.$$eval("select", (els) => {
  for (const s of els) {
    const o = [...s.options].find((x) => x.value);
    if (o) return o.value;
  }
  return "";
});
if (buildingValue) await page.select("select", buildingValue);
await sleep(600);

await clickByText(page, "收起设置");
await sleep(300);
await clickByText(page, "虚拟落点");
await sleep(300);
await clickByText(page, "生成落点");
await sleep(900);
await shot(page, "4-virtual-landing");

await clickByText(page, "地图选点");
await sleep(6000);
await shot(page, "5-map");

await clickByText(page, "提交虚拟落点");
await sleep(1500);
await shot(page, "6-success");

await page.close();

/* ③ 窄屏 */
const mob = await browser.newPage();
await mob.setViewport({
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await installStubs(mob);
await enterReady(mob);
await shot(mob, "7-mobile");
await mob.close();

/* ④ 注入模式：host.html 载入 inject.js，面板浮在宿主页上 */
const inj = await browser.newPage();
await inj.setViewport({ width: 1180, height: 820, deviceScaleFactor: 2 });
await installStubs(inj);
await inj.goto(`${BASE}/host.html`, { waitUntil: "domcontentloaded" });
await inj.evaluate(() => {
  const t = "e".repeat(64);
  const c = "abcdefgh12345678";
  document.getElementById("tok").value = t;
  document.getElementById("cas").value = c;
  localStorage.setItem("token", t);
  localStorage.setItem("casual", c);
  document.getElementById("go").click();
});
await sleep(3500);
await shot(inj, "8-inject-shadow-dom");
await inj.close();

await browser.close();
console.log("done");
