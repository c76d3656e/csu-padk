/* ============================================================
 * 中南大学 智慧学工 · 平安打卡  无人值守自动打卡
 * ------------------------------------------------------------
 * 环境：Node.js >= 18（原生 fetch）
 *
 * 用法：
 *   1. 复制 config.example.json 为 config.json，填 token / 坐标 / 班次
 *   2. node padk-auto.mjs            立即打一次卡
 *      node padk-auto.mjs --daemon   常驻，每天到点自动打卡
 *      node padk-auto.mjs --verify   只做围栏预检，不提交
 *      node padk-auto.mjs --probe    探测可用接口路径
 * ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CFG_PATH = path.join(HERE, "config.json");

const ORIGIN = "https://zhxg.csu.edu.cn";
const BASE = ORIGIN + "/znzhxgpt/qxj";

const API = {
  check: "/qxj-padkglxx/jcqqwzsjsfndk",
  punch: "/qxj-padkglxx/xspadk",
  shifts: "/qxj-padkglxx/queryKqDkbc",
  myList: "/qxj-padkglxx/queryPadkKqAyListByXh",
  tz: "/qxj-dktz/queryMyTzPage",
};

// ---------------- 配置 ----------------
const DEFAULTS = {
  token: "",
  agentId: "",
  menuId: "",
  appCode: "znzhxgpt",
  // 打卡坐标（绕过地域限制：填围栏圆心，而非你的真实位置）
  jd: 113.0,
  wd: 28.0,
  dz: "中南大学学生宿舍",
  dkbc: "",
  dklb: "0",         // 0 校内住宿打卡 / 4 校外租房打卡
  sfwcdk: 0,         // 1 = 走"外出打卡"分支
  schedule: ["06:30", "22:30"], // 每天打卡时刻
  retry: 3,
  debug: false,
};

function loadCfg() {
  let file = {};
  if (fs.existsSync(CFG_PATH)) {
    try { file = JSON.parse(fs.readFileSync(CFG_PATH, "utf8")); }
    catch (e) { console.error("[配置] config.json 解析失败:", e.message); }
  }
  const cfg = { ...DEFAULTS, ...file };
  if (process.env.PADK_TOKEN) cfg.token = process.env.PADK_TOKEN;
  if (process.env.PADK_JD) cfg.jd = Number(process.env.PADK_JD);
  if (process.env.PADK_WD) cfg.wd = Number(process.env.PADK_WD);
  return cfg;
}

// ---------------- HTTP ----------------
function headers(cfg) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    deviceType: "4",
    Authorization: cfg.token,
    token: cfg.token,
    MenuId: cfg.menuId || "",
    AppCode: cfg.appCode || "znzhxgpt",
    agentId: cfg.agentId || "",
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40",
    Origin: ORIGIN,
    Referer: ORIGIN + "/znzhxgpt_h5/",
  };
}

async function call(cfg, endpoint, paramsData, extra) {
  const url = BASE + endpoint;
  const body = { paramsData: { ...paramsData, ...(extra || {}) } };
  if (cfg.debug) console.log("  ->", "POST", url, JSON.stringify(body));
  const res = await fetch(url, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text };
}

// ---------------- 业务 ----------------
function ts() { return new Date().toLocaleString("zh-CN", { hour12: false }); }
function log(...a) { console.log(`[${ts()}]`, ...a); }

async function verify(cfg) {
  const r = await call(cfg, API.check, { jd: cfg.jd, wd: cfg.wd, dklb: cfg.dklb });
  const d = r.json && r.json.data;
  const can = d && typeof d === "object" ? d.canDk : d;
  log("围栏预检:", r.status, "canDk =", can,
    d && typeof d === "object" && d.pcMi != null ? `| 偏差 ${d.pcMi}m / 范围 ${d.fwMi}m` : "",
    d && typeof d === "object" && d.msg ? `| ${d.msg}` : "");
  return { raw: r, can };
}

async function punch(cfg) {
  const extra = cfg.sfwcdk ? { sfwcdk: cfg.sfwcdk } : null;
  const r = await call(cfg, API.punch,
    { jd: cfg.jd, wd: cfg.wd, dkbc: cfg.dkbc, dkdz: cfg.dz }, extra);
  const ok = r.json && String(r.json.code) === "200";
  log("提交打卡:", r.status, ok ? "成功" : "返回异常", r.json ? JSON.stringify(r.json) : r.text.slice(0, 300));
  return ok;
}

async function once(cfg, { onlyVerify = false } = {}) {
  if (!cfg.token) {
    log("!! token 为空。请在 config.json 填 token，或设 PADK_TOKEN 环境变量");
    log("   获取方式：PC 浏览器打开 /znzhxgpt_h5/ 登录后，Console 执行 localStorage.getItem('token')");
    return false;
  }
  for (let i = 1; i <= cfg.retry; i++) {
    try {
      const v = await verify(cfg);
      if (onlyVerify) return true;
      if (v.can === false) {
        log("!! 服务端判定不在围栏内，继续提交以验证服务端是否二次校验");
      }
      const ok = await punch(cfg);
      if (ok) return true;
      log(`第 ${i}/${cfg.retry} 次尝试未成功`);
    } catch (e) {
      log(`第 ${i}/${cfg.retry} 次异常:`, e.message);
    }
    if (i < cfg.retry) await new Promise((r) => setTimeout(r, 3000 * i));
  }
  return false;
}

/** 探测各候选路径，确认接口前缀 */
async function probe(cfg) {
  const cands = [
    BASE + API.check,
    ORIGIN + "/gw/qxj" + API.check,
    ORIGIN + "/znzhxgpt" + API.check,
  ];
  for (const url of cands) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: headers(cfg),
        body: JSON.stringify({ paramsData: { jd: cfg.jd, wd: cfg.wd, dklb: cfg.dklb } }),
      });
      const t = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
      console.log(`[${res.status}] ${url}\n     ${t}\n`);
    } catch (e) {
      console.log(`[ERR] ${url} -> ${e.message}\n`);
    }
  }
}

/** 常驻调度：每天在 schedule 指定时刻打卡 */
async function daemon(cfg) {
  log("守护模式启动，打卡时刻:", cfg.schedule.join(" / "));
  const fired = new Set();
  setInterval(async () => {
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    const dayKey = now.toDateString() + " " + hhmm;
    if (cfg.schedule.includes(hhmm) && !fired.has(dayKey)) {
      fired.add(dayKey);
      if (fired.size > 50) fired.clear();
      log("== 到达打卡时刻", hhmm, "==");
      await once(cfg);
    }
  }, 20000);
  // 启动时先试一次
  await once(cfg);
}

// ---------------- 入口 ----------------
const arg = process.argv[2] || "";
const cfg = loadCfg();

if (arg === "--probe") {
  await probe(cfg);
} else if (arg === "--verify") {
  await once(cfg, { onlyVerify: true });
} else if (arg === "--daemon") {
  await daemon(cfg);
} else {
  const ok = await once(cfg);
  process.exit(ok ? 0 : 1);
}
