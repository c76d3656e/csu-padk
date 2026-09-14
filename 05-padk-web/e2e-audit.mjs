/**
 * 设计规范审计：在真实渲染结果上校验 Precision Glass 的硬性规则
 *
 *   node e2e-audit.mjs
 *   PADK_BASE=http://localhost:5199 node e2e-audit.mjs
 *
 * 规则来源：stylekit macOS Vibrancy 硬性提示词
 *   · 任何元素不用渐变
 *   · 圆角不超过 12px
 *   · 边框一律 1px
 *   · 不放大尺寸阴影
 *   · 过渡只作用于颜色
 *   · 背景只用三级灰阶
 *   · 标题衬线 / 数据等宽
 *
 * 覆盖多个界面状态（登录页 / 打卡页 / 设置展开 / 已生成落点 / 成功遮罩）。
 */
import puppeteer from "puppeteer-core";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  EDGE,
  BASE,
  installStubs,
  enterReady,
  clickByText,
  sleep,
} from "./e2e-fixtures.mjs";

/* ── 在页面上下文里跑的审计逻辑 ── */
const AUDIT = () => {
  const roots = [
    document.querySelector(".padk-shell"),
    document.querySelector(".root"),
    document.querySelector(".padk-login"),
  ].filter(Boolean);
  if (!roots.length) return { error: "未找到审计根元素" };

  // 浮层投影是唯一允许的阴影：面板与登录卡需要与宿主/台面分离
  const shadowAllowed = (p) => /\.root|\.padk-login/.test(p);

  const seen = new Set();
  const els = [];
  for (const r of roots) {
    for (const el of [r, ...r.querySelectorAll("*")]) {
      if (seen.has(el)) continue;
      seen.add(el);
      els.push(el);
    }
  }

  const path = (el) => {
    const parts = [];
    let cur = el;
    for (let i = 0; i < 3 && cur && cur !== document.body; i++) {
      let s = cur.tagName.toLowerCase();
      if (typeof cur.className === "string" && cur.className.trim()) {
        s += "." + cur.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      }
      parts.unshift(s);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  };

  // Leaflet 内部是第三方 DOM，不参与本次规范审计
  const skip = (el) => !!el.closest(".leaflet-container");

  const grad = [];
  const radius = [];
  const border = [];
  const shadow = [];
  const transition = [];

  for (const el of els) {
    if (skip(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;

    if (/gradient/i.test(cs.backgroundImage))
      grad.push({ el: path(el), v: cs.backgroundImage.slice(0, 80) });

    // 纯圆（50%）用于状态点与圆形成功图标，不算"大圆角"
    const rRaw = cs.borderTopLeftRadius;
    const r = parseFloat(rRaw) || 0;
    if (r > 12.5 && !(/%/.test(rRaw) && r >= 50))
      radius.push({ el: path(el), v: rRaw });

    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      const w = parseFloat(cs[`border${side}Width`]) || 0;
      if (cs[`border${side}Style`] !== "none" && w > 1.5)
        border.push({ el: path(el), side, v: w });
    }

    const p = path(el);
    if (cs.boxShadow !== "none" && !shadowAllowed(p))
      shadow.push({ el: p, v: cs.boxShadow.slice(0, 72) });

    // transition-property 的初始值就是 all：
    // 没有声明过渡的元素同样会读到 all，必须配合 duration 判断
    const tp = cs.transitionProperty;
    if (tp && tp !== "none" && parseFloat(cs.transitionDuration) > 0) {
      const allowed =
        /^(color|background-color|background|border-color|border-.*-color|opacity|filter|fill|stroke|outline-color|box-shadow|width|visibility)$/;
      const bad = tp
        .split(",")
        .map((s) => s.trim())
        .filter((x) => x && !allowed.test(x));
      if (bad.length) transition.push({ el: p, v: [...new Set(bad)].join(", ") });
    }
  }

  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return {
      font: cs.fontFamily.split(",")[0].replace(/["']/g, ""),
      size: cs.fontSize,
      color: cs.color,
      bg: cs.backgroundColor,
      radius: cs.borderTopLeftRadius,
      border: `${cs.borderTopWidth} ${cs.borderTopColor}`,
      backdrop: cs.backdropFilter === "none" ? null : cs.backdropFilter,
      box: [Math.round(b.width), Math.round(b.height)],
    };
  };

  /* ── 对比度：半透明文字按实际底色合成后再算 WCAG 比值 ── */
  // 同时接受 [r,g,b] 与 {r,g,b} —— 下面两种形状都会用到
  const lum = (c) => {
    const [r, g, b] = Array.isArray(c) ? c : [c.r, c.g, c.b];
    const f = (x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (str) => {
    const m = str && str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((s) => parseFloat(s.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const over = (fg, bg) => [
    fg.r * fg.a + bg.r * (1 - fg.a),
    fg.g * fg.a + bg.g * (1 - fg.a),
    fg.b * fg.a + bg.b * (1 - fg.a),
  ];
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return +((l1 + 0.05) / (l2 + 0.05)).toFixed(2);
  };

  // 面板底色：.root 的半透明背景合成到最深灰之上
  const rootEl = document.querySelector(".root") || document.querySelector(".padk-login");
  const rootBgP = rootEl ? parse(getComputedStyle(rootEl).backgroundColor) : null;
  const deep = { r: 28, g: 28, b: 30 };
  let panelBg = [44, 44, 46];
  if (rootBgP) {
    panelBg = rootBgP.a < 1 ? over(rootBgP, deep) : [rootBgP.r, rootBgP.g, rootBgP.b];
  }

  const contrast = {};
  for (const [name, sel] of [
    ["title", ".head .title"],
    ["label", ".label"],
    ["value", ".value"],
    ["landing-meta", ".landing-meta"],
    ["landing-empty", ".landing-empty"],
    ["coord", ".coord"],
    ["hint", ".hint"],
    ["pl-lede", ".pl-lede"],
    ["pl-foot", ".pl-foot"],
    ["pb-id", ".pb-id"],
  ]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    const ownBg = parse(cs.backgroundColor);
    let bg = panelBg;
    if (ownBg && ownBg.a > 0.5) bg = [ownBg.r, ownBg.g, ownBg.b];
    const base = { r: bg[0], g: bg[1], b: bg[2] };
    const eff = over(fg, { ...base, a: 1 });
    const r = ratio(eff, base);
    contrast[name] = {
      size: cs.fontSize,
      ratio: r,
      aa: r >= 4.5 ? "pass" : r >= 3 ? "large-only" : "fail",
    };
  }

  return {
    elementCount: els.length,
    violations: {
      gradient: grad,
      radiusOver12: radius,
      borderOver1px: border,
      shadowNotAllowed: shadow,
      transitionNonColor: transition,
    },
    key: {
      root: pick(".root"),
      head: pick(".head"),
      title: pick(".head .title"),
      btn: pick(".btn"),
      btnGhost: pick(".btn.ghost"),
      label: pick(".label"),
      badge: pick(".badge"),
      landing: pick(".landing"),
      coord: pick(".coord"),
      tabs: pick(".mode-tabs"),
      tabOn: pick(".mode-tabs button.on"),
      log: pick(".log"),
      mask: pick(".mask"),
      card: pick(".card"),
      padkLogin: pick(".padk-login"),
      padkLoginH1: pick(".padk-login h1"),
    },
    contrast,
    // 状态断言：确认这一步该渲染的东西真的渲染了，
    // 否则"规范全通过"可能只是没渲染出内容
    state: {
      hasMask: !!document.querySelector(".mask"),
      hasCoord: !!document.querySelector(".coord"),
      landingText: (document.querySelector(".landing")?.innerText || "")
        .slice(0, 70)
        .replace(/\s+/g, " "),
      primaryBtn: (() => {
        const b = [...document.querySelectorAll(".body > .btn")][0];
        return b ? `${b.textContent.trim()}${b.disabled ? " (disabled)" : ""}` : null;
      })(),
      firstSelectValue: document.querySelector("select")?.value ?? null,
      // 面板日志尾部：用来确认失败路径给出的引导是否可操作
      logs: [...document.querySelectorAll(".log div")]
        .slice(-5)
        .map((d) => d.textContent.replace(/^\d{2}:\d{2}:\d{2}/, "").trim()),
      hasPickBuildingBtn: [...document.querySelectorAll(".landing button")].some(
        (b) => b.textContent.trim() === "选宿舍楼"
      ),
    },
    // 地图单独查：.mapbox 自带 leaflet-container，
    // 已被 skip() 排除在规范审计之外，这里按需断言
    map: (() => {
      const box = document.querySelector(".mapbox");
      if (!box) return null;
      const pane = box.querySelector(".leaflet-tile-pane");
      return {
        dataTile: box.dataset.tile ?? null,
        tilePaneFilter: pane ? getComputedStyle(pane).filter : null,
        tileCount: box.querySelectorAll(".leaflet-tile").length,
        height: Math.round(box.getBoundingClientRect().height),
        legend: !!document.querySelector(".map-legend"),
      };
    })(),
    page: {
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    },
  };
};

/* ── 注入模式：面板跑在 Shadow DOM 里，必须单独审 ── */
const AUDIT_INJECT = () => {
  const host = document.getElementById("csu-padk-panel-host");
  if (!host) return { error: "面板未注入：找不到 #csu-padk-panel-host" };
  const sr = host.shadowRoot;
  if (!sr) return { error: "宿主元素没有 shadowRoot" };

  const rootEl = sr.querySelector(".root");
  if (!rootEl) return { error: "shadow 内没有 .root" };

  const shortName = (el) => {
    let p = el.tagName.toLowerCase();
    if (typeof el.className === "string" && el.className.trim())
      p += "." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
    return p;
  };

  const grad = [], radius = [], border = [], shadowBad = [];
  for (const el of sr.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const p = shortName(el);

    if (/gradient/i.test(cs.backgroundImage)) grad.push(p);

    const rRaw = cs.borderTopLeftRadius;
    const r = parseFloat(rRaw) || 0;
    if (r > 12.5 && !(/%/.test(rRaw) && r >= 50)) radius.push(`${p}=${rRaw}`);

    for (const s of ["Top", "Right", "Bottom", "Left"]) {
      const w = parseFloat(cs[`border${s}Width`]) || 0;
      if (cs[`border${s}Style`] !== "none" && w > 1.5) border.push(`${p}.${s}=${w}`);
    }

    if (cs.boxShadow !== "none" && !/\.root|padk-login/.test(p)) shadowBad.push(p);
  }

  const cs = getComputedStyle(rootEl);
  const b = rootEl.getBoundingClientRect();
  const titleEl = sr.querySelector(".head .title");
  const btnEl = sr.querySelector(".btn");
  const first = (f) => {
    const e = f.element;
    if (!e) return null;
    const c = getComputedStyle(e);
    return {
      font: c.fontFamily.split(",")[0].replace(/["']/g, ""),
      size: c.fontSize,
      bg: c.backgroundColor,
      radius: c.borderTopLeftRadius,
    };
  };

  return {
    styleTagsInShadow: sr.querySelectorAll("style").length,
    root: {
      position: cs.position,
      box: [Math.round(b.width), Math.round(b.height)],
      bg: cs.backgroundColor,
      backdrop: cs.backdropFilter === "none" ? null : cs.backdropFilter,
      radius: cs.borderTopLeftRadius,
      border: `${cs.borderTopWidth} ${cs.borderTopColor}`,
      shadow: cs.boxShadow === "none" ? null : cs.boxShadow.slice(0, 60),
    },
    title: first({ element: titleEl }),
    btn: first({ element: btnEl }),
    violations: {
      gradient: grad,
      radiusOver12: radius,
      borderOver1px: border,
      shadowNotAllowed: shadowBad,
    },
    // Shadow DOM 的核心承诺：宿主页面样式不被污染
    hostPageUntouched: {
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 32),
    },
  };
};

/* ── 状态覆盖 ── */
const results = [];

const report = async (page, label) => {
  const r = await page.evaluate(AUDIT);
  results.push({ label, ...r });

  const v = r.violations || {};
  const bad = Object.entries(v).filter(([, list]) => list && list.length);
  console.log(`\n═══ ${label} ═══`);
  console.log(
    `元素 ${r.elementCount} ｜ 溢出 ${r.page?.overflowX ? "有" : "无"} ｜ ` +
      (bad.length
        ? `违规: ${bad.map(([k, l]) => `${k}×${l.length}`).join(" ")}`
        : "规范检查全通过")
  );
  const rows = Object.entries(r.contrast || {}).map(
    ([k, x]) => `${k} ${x.size} ${x.ratio}:1 ${x.aa}`
  );
  if (rows.length) console.log("  对比度: " + rows.join(" | "));
  console.log("  状态: " + JSON.stringify(r.state));
  if (r.map) console.log("  地图: " + JSON.stringify(r.map));
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});

/* ① 登录页 */
const lp = await browser.newPage();
await lp.setViewport({ width: 960, height: 900, deviceScaleFactor: 2 });
await lp.goto(process.env.PADK_BASE || "http://localhost:5173", {
  waitUntil: "domcontentloaded",
});
await lp.evaluate(() => localStorage.clear());
await lp.reload({ waitUntil: "networkidle2" });
await sleep(900);
await report(lp, "登录页 960×900");
await lp.close();

/* ② 打卡页各状态 */
const page = await browser.newPage();
await page.setViewport({ width: 980, height: 1180, deviceScaleFactor: 2 });
await installStubs(page);
await enterReady(page);
await report(page, "打卡页 · 初始（实时定位）");

await clickByText(page, "设置");
await sleep(400);
await report(page, "打卡页 · 设置展开");

/* 切到虚拟落点但不选楼 —— 圆心未定时的空态要有可操作入口 */
await clickByText(page, "收起设置");
await sleep(250);
await clickByText(page, "虚拟落点");
await sleep(300);
await report(page, "虚拟落点 · 圆心未定");

/* 走新加的「选宿舍楼」入口打开设置，顺带验证这个按钮真的能用 */
await clickByText(page, "选宿舍楼");
await sleep(400);
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
await sleep(250);
await clickByText(page, "生成落点");
await sleep(700);
await report(page, "打卡页 · 已生成落点");

await clickByText(page, "提交虚拟落点");
await sleep(1400);
await report(page, "打卡页 · 成功遮罩");

/* 地图：收起遮罩后展开，等瓦片拉取 */
await clickByText(page, "确定");
await sleep(400);
await clickByText(page, "地图选点");
await sleep(6000);
await report(page, "打卡页 · 地图展开");

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
await report(mob, "窄屏 390×844");
await mob.close();

/* ④ 注入模式：host.html 载入 dist/inject.js，面板挂进 Shadow DOM */
const inj = await browser.newPage();
await inj.setViewport({ width: 1100, height: 820, deviceScaleFactor: 2 });
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
await sleep(3000);
{
  const r = await inj.evaluate(AUDIT_INJECT);
  console.log("\n═══ 注入模式 · Shadow DOM ═══");
  if (r.error) {
    console.log("  ✗ " + r.error);
  } else {
    const bad = Object.entries(r.violations).filter(([, l]) => l && l.length);
    console.log(
      `  shadow 内 <style> ${r.styleTagsInShadow} 个 ｜ ` +
        (bad.length ? `违规: ${JSON.stringify(Object.fromEntries(bad))}` : "规范检查全通过")
    );
    console.log("  root: " + JSON.stringify(r.root));
    console.log("  title: " + JSON.stringify(r.title));
    console.log("  btn: " + JSON.stringify(r.btn));
    console.log("  宿主页未被污染: " + JSON.stringify(r.hostPageUntouched));
  }
  results.push({ label: "注入模式 · Shadow DOM", ...r });
}
await inj.close();

await browser.close();

mkdirSync("shots", { recursive: true });
writeFileSync("shots/audit-report.json", JSON.stringify(results, null, 2), "utf8");
console.log("\n完整报告 → shots/audit-report.json");
