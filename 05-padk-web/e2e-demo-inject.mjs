/**
 * 注入演示：把 inject.js 打到**真实的官方页面**上，看面板能否浮出来
 *
 *   node e2e-demo-inject.mjs
 *
 * 与「点一下书签」完全等价 —— 书签做的就是「在当前的官方页面里执行这段脚本」。
 * 不需要真实凭据：凭据缺失时面板照常渲染，只是日志里会提示未读到 token，
 * 这足以验证「注入是否成功、面板是否浮出、宿主是否被污染」。
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const TARGET = process.env.PADK_TARGET || "https://zhxg.csu.edu.cn/znzhxgpt_h5/";
const INJECT = fs.readFileSync("dist/inject.js", "utf8");

// 必须「iPhone 但不带 MicroMessenger」：带 MicroMessenger 会被判定成微信环境，
// 跳去 open.weixin.qq.com 走 OAuth
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  protocolTimeout: 120000,
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});

const page = await browser.newPage();
await page.setUserAgent(UA_IPHONE);
await page.setViewport({
  width: 420,
  height: 900,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

console.log(`打开官方页面：${TARGET}`);
await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(5000);

const before = await page.evaluate(() => ({
  url: location.href,
  title: document.title,
  host: location.hostname,
  text: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 80),
}));
console.log("  落地地址:", before.url);
console.log("  页面标题:", before.title || "(空)");
console.log("  可见文字:", before.text || "(空)");

console.log("\n注入 inject.js —— 这一步等价于点一下书签");
await page.evaluate(INJECT);
await sleep(3500);

const after = await page.evaluate(() => {
  const host = document.getElementById("csu-padk-panel-host");
  const sr = host?.shadowRoot;
  const root = sr?.querySelector(".root");
  const b = root?.getBoundingClientRect();
  return {
    注入宿主: !!host,
    shadowRoot: !!sr,
    面板位置与尺寸: b
      ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
      : null,
    面板标题: sr?.querySelector(".head .title")?.textContent || "",
    标题字体: sr?.querySelector(".head .title")
      ? getComputedStyle(sr.querySelector(".head .title")).fontFamily.split(",")[0].replace(/["']/g, "")
      : "",
    面板底色: sr?.querySelector(".root") ? getComputedStyle(sr.querySelector(".root")).backgroundColor : "",
    玻璃: sr?.querySelector(".root") ? getComputedStyle(sr.querySelector(".root")).backdropFilter : "",
    日志: [...(sr?.querySelectorAll(".log div") || [])].slice(0, 3).map((d) => d.textContent.trim()),
    宿主页body未被污染: getComputedStyle(document.body).backgroundColor,
  };
});

console.log("  注入结果:");
for (const [k, v] of Object.entries(after)) {
  console.log(`    ${k}: ${Array.isArray(v) ? JSON.stringify(v) : v}`);
}

fs.mkdirSync("shots", { recursive: true });
await page.screenshot({ path: "shots/9-inject-on-official.png" });
console.log("\n  截图 → shots/9-inject-on-official.png");

await browser.close();
