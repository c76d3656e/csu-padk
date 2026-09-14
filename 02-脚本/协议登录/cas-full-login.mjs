/* ============================================================
 * 中南大学 智慧学工  完整协议登录 -> 获取 token
 * ------------------------------------------------------------
 * 链路：
 *   CAS 登录 (ca.csu.edu.cn)  -> ticket
 *     -> caslogin_h5.jsp 下发 uid + lzc
 *       -> POST /znzhxgpt/basesys/rbac-yh/login-other -> token
 *
 * 用法: node cas-full-login.mjs [学号] [密码]
 * ============================================================ */

import crypto from "node:crypto";
import fs from "node:fs";

const CAS = "https://ca.csu.edu.cn";
const CTX = "/authserver";
const ZHXG = "https://zhxg.csu.edu.cn";
const SERVICE = ZHXG + "/fdcwonsun/caslogin_h5.jsp";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40";

// ---------- 金智密码加密 ----------
const AES_CHARS = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
const randomString = (n) => {
  let s = "";
  for (let i = 0; i < n; i++) s += AES_CHARS.charAt(Math.floor(Math.random() * AES_CHARS.length));
  return s;
};
function encryptPassword(plain, salt) {
  if (!salt) return plain;
  const key = Buffer.from(String(salt).trim(), "utf8");
  const iv = Buffer.from(randomString(16), "utf8");
  const data = Buffer.from(randomString(64) + plain, "utf8");
  const c = crypto.createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([c.update(data), c.final()]).toString("base64");
}
// caasual 随机串（模块 5824 generatekey）
function generatekey(n) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

class Jar {
  constructor() { this.m = new Map(); }
  set(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of raw) {
      const pair = line.split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) this.m.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() { return [...this.m].map(([k, v]) => `${k}=${v}`).join("; "); }
  toJSON() { return Object.fromEntries(this.m); }
}

const casJar = new Jar();
const wxJar = new Jar();
const mask = (s, keep = 16) => !s ? "(空)" : s.length <= keep * 2 ? s : s.slice(0, keep) + "…" + s.slice(-8);

// ============================================================
const USER = process.argv[2] || "";
const PASS = process.argv[3] || "";
if (!USER || !PASS) {
  console.error("用法: node cas-full-login.mjs <学号> <密码>");
  process.exit(1);
}
const out = { studentId: USER, at: new Date().toISOString() };

console.log("═".repeat(72));
console.log(" 中南大学 智慧学工 · 协议登录");
console.log("═".repeat(72));

// ── 阶段 1：CAS ─────────────────────────────────────────────
console.log("\n【阶段 1】CAS 统一身份认证\n");

const loginUrl = `${CAS}${CTX}/login?service=${encodeURIComponent(SERVICE)}`;
let r = await fetch(loginUrl, {
  redirect: "manual",
  headers: { "User-Agent": DESKTOP_UA },
});
casJar.set(r);
const html = await r.text();
const SALT = (html.match(/id="pwdEncryptSalt"\s+value="([^"]*)"/) || [])[1] || "";
const EXEC = (html.match(/id="execution"\s+name="execution"\s+value="([^"]*)"/) || [])[1] || "e1s1";
console.log(`  [1.1] GET 登录页               ${r.status}`);
console.log(`        pwdEncryptSalt  = ${SALT}`);
console.log(`        execution       = ${EXEC}`);
console.log(`        JSESSIONID      = ${(casJar.m.get("JSESSIONID") || "").slice(0, 20)}…`);
if (!SALT) { console.error("\n  !! 未取到 salt"); process.exit(1); }

r = await fetch(`${CAS}${CTX}/checkNeedCaptcha.htl?username=${USER}&_=${Date.now()}`, {
  headers: { "User-Agent": DESKTOP_UA, Cookie: casJar.header() },
});
casJar.set(r);
const cap = await r.json();
console.log(`  [1.2] 验证码策略               isNeed = ${cap.isNeed}`);
if (cap.isNeed) console.log("        !! 该账号需要验证码，协议登录需接入打码");

const encPwd = encryptPassword(PASS, SALT);
console.log(`  [1.3] 密码加密                 ${encPwd.slice(0, 32)}… (${encPwd.length} chars, AES-128-CBC)`);

r = await fetch(loginUrl, {
  method: "POST",
  redirect: "manual",
  headers: {
    "User-Agent": DESKTOP_UA,
    "Content-Type": "application/x-www-form-urlencoded",
    Cookie: casJar.header(),
  },
  body: new URLSearchParams({
    username: USER, password: encPwd, lt: "", execution: EXEC,
    _eventId: "submit", cllt: "userNameLogin", dllt: "generalLogin", captcha: "", rmShown: "1",
  }).toString(),
});
casJar.set(r);
console.log(`  [1.4] POST 登录                ${r.status}`);

if (r.status !== 302) {
  const body = await r.text();
  const tip = (body.match(/id="showErrorTip"[^>]*>([^<]*)</) || [])[1];
  console.error("        !! 登录未成功", tip ? "提示: " + tip : "");
  process.exit(1);
}
let ticketUrl = r.headers.get("location");
if (ticketUrl.startsWith("/")) ticketUrl = ZHXG + ticketUrl;
const ticket = (ticketUrl.match(/ticket=([^&]+)/) || [])[1] || "";
const CASTGC = casJar.m.get("CASTGC") || "";
console.log(`        ticket         = ${ticket}`);
console.log(`        CASTGC         = ${mask(CASTGC, 12)}`);
out.ticket = ticket;
out.castgc = CASTGC;
out.casCookies = casJar.toJSON();

// ── 阶段 2：caslogin_h5.jsp 换 uid / lzc ────────────────────
console.log("\n【阶段 2】业务侧回调换取 uid / lzc\n");

let cur = ticketUrl;
let callbackBody = "";
for (let hop = 0; hop < 5 && cur; hop++) {
  const res = await fetch(cur, { redirect: "manual", headers: { "User-Agent": MOBILE_UA, Cookie: wxJar.header() } });
  wxJar.set(res);
  console.log(`  [2.${hop + 1}] ${res.status}  ${cur.slice(0, 90)}${cur.length > 90 ? "…" : ""}`);
  const next = res.headers.get("location");
  const body = await res.text();
  if (body && body.includes("uid")) callbackBody = body;
  if (!next) break;
  cur = next.startsWith("/") ? ZHXG + next : next;
}

const uidM = callbackBody.match(/uid\s*=\s*['"]([^'"]+)['"]/);
const lzcM = callbackBody.match(/lzc\s*=\s*['"]([^'"]*)['"]/);
const UID = uidM ? uidM[1] : "";
const LZC = lzcM ? lzcM[1] : "";
console.log(`\n        uid 长度 = ${UID.length}   ${mask(UID, 40)}`);
console.log(`        lzc        = "${LZC}"`);
out.uid = UID;
out.lzc = LZC;
if (!UID) { console.error("\n  !! 未取到 uid"); process.exit(1); }

// ── 阶段 3：login-other 换 token ─────────────────────────────
console.log("\n【阶段 3】rbac-yh/login-other 换取 token\n");

const caasual = generatekey(16);
const payload = {
  tyrzpt: "1",
  channeld: "1",
  yhzh: encodeURIComponent(encodeURIComponent(UID)),
  lzc: encodeURIComponent(encodeURIComponent(LZC || "")),
  caasual,
};
console.log(`  请求: POST ${ZHXG}/znzhxgpt/basesys/rbac-yh/login-other`);
console.log(`  body: tyrzpt=${payload.tyrzpt} channeld=${payload.channeld} caasual=${caasual}`);
console.log(`        yhzh(前60) = ${payload.yhzh.slice(0, 60)}…`);

const loRes = await fetch(`${ZHXG}/znzhxgpt/basesys/rbac-yh/login-other`, {
  method: "POST",
  headers: {
    "User-Agent": MOBILE_UA,
    "Content-Type": "application/json;charset=UTF-8",
    deviceType: "4",
    AppCode: "znzhxgpt",
    Origin: ZHXG,
    Referer: ZHXG + "/znzhxgpt_h5/",
    Cookie: wxJar.header(),
  },
  body: JSON.stringify(payload),
});
const loText = await loRes.text();
console.log(`\n  响应 [${loRes.status}]: ${loText.slice(0, 500)}`);

let TOKEN = "";
try {
  const j = JSON.parse(loText);
  TOKEN = (j.data && j.data.token) || "";
} catch { /* ignore */ }

if (TOKEN) {
  console.log(`\n  ✅ token = ${mask(TOKEN, 24)}`);
  console.log(`     token 长度 = ${TOKEN.length}`);
  out.token = TOKEN;
  out.caasual = caasual;
} else {
  console.log("\n  ⚠️  未取到 token，请看上面的原始响应");
}

out.wxCookies = wxJar.toJSON();
fs.writeFileSync("zhxg-session.json", JSON.stringify(out, null, 2), "utf8");
console.log("\n完整会话（含 token）已写入 zhxg-session.json");
console.log("═".repeat(72));
