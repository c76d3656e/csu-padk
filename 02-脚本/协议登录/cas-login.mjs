/* ============================================================
 * 中南大学 统一身份认证 (ca.csu.edu.cn) 协议登录
 * ------------------------------------------------------------
 * 还原自 /authserver/gorgeousCsu20260806/static/common/encrypt.js
 *
 * 用法:  node cas-login.mjs [学号] [密码]
 * ============================================================ */

import crypto from "node:crypto";
import fs from "node:fs";

const HOST = "https://ca.csu.edu.cn";
const CTX = "/authserver";
const SERVICE = "https://zhxg.csu.edu.cn/fdcwonsun/caslogin_h5.jsp";
// 注意：CAS 登录页对 MicroMessenger UA 会 302 到企业微信授权分支，
// 协议登录必须用桌面 UA 才能拿到账号密码表单。
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ---------- 1. 金智随机串 ----------
const AES_CHARS = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
function randomString(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += AES_CHARS.charAt(Math.floor(Math.random() * AES_CHARS.length));
  return s;
}

// ---------- 2. 密码加密 ----------
function encryptPassword(plain, salt) {
  if (!salt) return plain;
  const key = Buffer.from(String(salt).replace(/^\s+|\s+$/g, ""), "utf8");
  const iv = Buffer.from(randomString(16), "utf8");
  const data = Buffer.from(randomString(64) + plain, "utf8");
  const c = crypto.createCipheriv("aes-128-cbc", key, iv);
  c.setAutoPadding(true); // PKCS7
  return Buffer.concat([c.update(data), c.final()]).toString("base64");
}

// ---------- 3. 极简 cookie jar ----------
class Jar {
  constructor() { this.m = new Map(); }
  set(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of raw) {
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      if (idx < 0) continue;
      this.m.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
  header() { return [...this.m].map(([k, v]) => `${k}=${v}`).join("; "); }
  dump() { return [...this.m].map(([k, v]) => `${k} = ${v}`).join("\n"); }
}

const jar = new Jar();
const H = () => ({ "User-Agent": UA, Cookie: jar.header(), "Accept-Language": "zh-CN,zh;q=0.9" });

async function step(label, url, opts = {}) {
  const res = await fetch(url, { redirect: "manual", ...opts, headers: { ...H(), ...(opts.headers || {}) } });
  jar.set(res);
  console.log(`\n[${label}] ${res.status} ${res.statusText}  <- ${url}`);
  const loc = res.headers.get("location");
  if (loc) console.log(`   Location: ${loc}`);
  const sc = res.headers.get("set-cookie");
  if (sc) console.log(`   Set-Cookie: ${sc.slice(0, 120)}`);
  return res;
}

// ============================================================
const USER = process.argv[2] || "";
const PASS = process.argv[3] || "";
if (!USER || !PASS) {
  console.error("用法: node cas-login.mjs <学号> <密码>");
  process.exit(1);
}

console.log("=".repeat(70));
console.log("中南大学 CAS 协议登录");
console.log("学号:", USER);
console.log("=".repeat(70));

// --- Step 1: 拿登录页（JSESSIONID + salt + execution）---
const loginUrl = `${HOST}${CTX}/login?service=${encodeURIComponent(SERVICE)}`;
const page = await step("1. GET 登录页", loginUrl);
const html = await page.text();

const saltMatch = html.match(/id="pwdEncryptSalt"\s+value="([^"]*)"/);
const execMatch = html.match(/id="execution"\s+name="execution"\s+value="([^"]*)"/);
const SALT = saltMatch ? saltMatch[1] : "";
const EXEC = execMatch ? execMatch[1] : "e1s1";

console.log("\n   >> pwdEncryptSalt =", SALT);
console.log("   >> execution      =", EXEC);
console.log("   >> cookie 已获得 :\n      " + jar.dump().split("\n").join("\n      "));

if (!SALT) { console.error("\n!! 未取到 salt，页面结构可能已变"); process.exit(1); }

// --- Step 2: 验证码策略 ---
const capRes = await step("2. GET 验证码策略", `${HOST}${CTX}/checkNeedCaptcha.htl?username=${USER}&_=${Date.now()}`);
const capText = await capRes.text();
console.log("   >> 响应:", capText);
let needCaptcha = false;
try { needCaptcha = !!JSON.parse(capText).isNeed; } catch {}

// --- Step 3: 提交登录 ---
const encrypted = encryptPassword(PASS, SALT);
console.log("\n   >> 加密后密码(前48位):", encrypted.slice(0, 48) + "...");
console.log("   >> 密文长度:", encrypted.length);

const form = new URLSearchParams({
  username: USER,
  password: encrypted,
  lt: "",
  execution: EXEC,
  _eventId: "submit",
  cllt: "userNameLogin",
  dllt: "generalLogin",
  captcha: "",
  rmShown: "1",
});

const loginRes = await step("3. POST 登录", loginUrl, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: form.toString(),
});
const loginBody = await loginRes.text();

if (loginRes.status === 302 || loginRes.status === 301) {
  console.log("\n   >>> 登录成功，已下发 ticket");
} else {
  const err = loginBody.match(/id="showErrorTip"[^>]*>([^<]*)</) || loginBody.match(/class="item-error-tip"[^>]*>([^<]*)</);
  console.log("\n   >>> 未跳转。状态:", loginRes.status);
  if (err) console.log("   >>> 页面错误提示:", err[1].trim());
  const authErr = loginBody.match(/errorMsg\s*[:=]\s*['"]([^'"]+)/);
  if (authErr) console.log("   >>> errorMsg:", authErr[1]);
  console.log("   >>> 响应片段:", loginBody.replace(/\s+/g, " ").slice(0, 400));
}

// --- Step 4: 跟随 service 回调拿 token ---
if (loginRes.status === 302 || loginRes.status === 301) {
  let loc = loginRes.headers.get("location");
  if (loc && loc.startsWith("/")) loc = HOST + loc;
  console.log("\n   >> ticket 回调 URL:", loc);

  let cur = loc;
  for (let hop = 0; hop < 5 && cur; hop++) {
    const r = await fetch(cur, { redirect: "manual", headers: H() });
    jar.set(r);
    console.log(`\n[4.${hop + 1}] ${r.status} <- ${cur}`);
    const next = r.headers.get("location");
    const body = await r.text();

    // 从 URL / body / cookie 里捞 token
    const found = {};
    for (const m of cur.matchAll(/[?&#](uid|lzc|token|casual|number)=([^&#]+)/g)) found[m[1]] = decodeURIComponent(m[2]);
    for (const m of body.matchAll(/[?&#"'](uid|lzc|token|casual|number)=([^&#"'<\s]+)/g)) found[m[1]] = decodeURIComponent(m[2]);

    if (Object.keys(found).length) {
      console.log("   >> URL/HTML 中提取到的凭据参数:");
      for (const [k, v] of Object.entries(found)) {
        console.log(`      ${k} = ${String(v).slice(0, 60)}${String(v).length > 60 ? "..." : ""}`);
      }
    }
    if (body && body.length < 2000) console.log("   >> body:", body.replace(/\s+/g, " ").slice(0, 300));
    if (next) console.log("   Location:", next);
    if (!next) break;
    cur = next.startsWith("/") ? HOST + next : next;
  }

  console.log("\n   >> 最终 cookie 状态:\n      " + jar.dump().split("\n").join("\n      "));
}

fs.writeFileSync("cas-session.json", JSON.stringify({
  studentId: USER,
  cookies: Object.fromEntries(jar.m),
  cookieHeader: jar.header(),
  at: new Date().toISOString(),
}, null, 2), "utf8");
console.log("\n会话已保存到 cas-session.json");
