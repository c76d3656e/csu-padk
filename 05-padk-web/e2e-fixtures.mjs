/**
 * e2e 共享夹具：浏览器路径、接口桩数据、进入打卡页的通用步骤
 *
 * 被 e2e-visual.mjs 与 e2e-audit.mjs 共用。
 * 所有请求都用桩数据喂满，不触达真实服务端。
 */

export const EDGE =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

export const BASE = process.env.PADK_BASE || "http://localhost:5173";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 形状对齐 src/core/api.ts 的 ShiftInfo */
export const SHIFT = {
  dksjfw: "20:00-23:30",
  dksj: null,
  gz: "请每位学生在每晚 10:30 前到达宿舍用智慧学工系统打卡报平安；学院负责老师每晚 11:00 前确认本院学生平安并提交至学工部。",
  kdk: true,
  dkbc: "校内住宿打卡",
  bkyy: "",
  kqfwxx: [
    {
      mc: "校内住宿打卡范围（全校统一）",
      dkfw: 300,
      jd: null,
      wd: null,
      kqdz: "学生所住宿舍楼栋坐标（自动取）",
    },
  ],
  sfydk: 0,
  lx: 0,
};

/** 形状对齐 src/core/api.ts 的 Building */
export const BUILDINGS = [
  ["1", "升华公寓 12 栋", "112.99210", "28.14280"],
  ["2", "升华公寓 13 栋", "112.99340", "28.14310"],
  ["3", "升华公寓 14 栋", "112.99462", "28.14255"],
  ["4", "升华公寓 15 栋", "112.99188", "28.14402"],
  ["5", "升华公寓 16 栋", "112.99540", "28.14380"],
  ["6", "升华公寓 17 栋", "112.99060", "28.14230"],
].map(([id, ldmc, jd, wd]) => ({
  id,
  xqmc: "南校区",
  xqdm: "01",
  ldmc,
  lddm: "01" + id,
  lcs: "6",
  jd,
  wd,
}));

/**
 * 在页面脚本执行前覆写 fetch —— 必须走 evaluateOnNewDocument，
 * 否则模块级请求已经发出去了。
 */
export function installStubs(page) {
  return page.evaluateOnNewDocument(
    (shift, buildings) => {
      const realFetch = window.fetch.bind(window);
      const json = (body) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });

      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        if (url.includes("/__auth/")) {
          return json({
            ok: true,
            token: "e".repeat(64),
            casual: "abcdefgh12345678",
            user: { xh: "8200000000", xm: "同学", bmmc: "计算机学院" },
          });
        }
        if (url.includes("queryKqDkbc"))
          return json({ code: "200", message: "成功", data: shift });
        if (url.includes("findLdzbCjList"))
          return json({
            code: "200",
            message: "成功",
            data: { list: buildings, zs: buildings.length, xqList: ["南校区"] },
          });
        if (url.includes("jcqqwzsjsfndk"))
          return json({
            code: "200",
            message: "成功",
            data: { canDk: true, pcMi: 118, fwMi: 300, msg: "" },
          });
        if (url.includes("xspadk"))
          return json({ code: "200", message: "打卡成功", data: null });
        return realFetch(input, init);
      };
    },
    SHIFT,
    BUILDINGS
  );
}

/** 写入假凭据并重载，使页面进入 ready 态 */
export async function enterReady(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("token", "e".repeat(64));
    localStorage.setItem("casual", "abcdefgh12345678");
    // 页眉要展示身份信息，这里补上登录时才会写入的档案
    localStorage.setItem(
      "csu-padk:profile",
      JSON.stringify({ xh: "8200000000", xm: "同学", bmmc: "计算机学院" })
    );
  });
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(2000);
}

/** 按可见文本点按钮，返回是否命中 */
export function clickByText(page, label) {
  return page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.textContent?.trim() === t
    );
    if (b) b.click();
    return !!b;
  }, label);
}
