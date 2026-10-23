#!/usr/bin/env node
/**
 * 登录链路诊断 —— 只走协议，不打卡、不落凭据。
 *
 * 为什么需要它：云端形态撞上「二次认证」时，主程序只能给一句结论。但那句话背后
 * 有好几种页面（短信验证码、OTP、设备确认），字段名与提交端点都不一样，光看结论
 * 写不出实现。这个脚本把 CAS 每一步的真实回应抓下来：状态码、location、cookie 名、
 * MFA 页面的表单结构与可见文案。
 *
 * 安全边界：
 *   - 密码只在本进程内存里用一次，不打印、不落盘；默认交互式掩盖输入。
 *   - 抓到的 HTML 脱敏后才落盘（手机号打码、ticket 截断）。
 *
 * 用法：
 *   node scripts/diag-login.mjs 8100xxxx
 *   node scripts/diag-login.mjs 8100xxxx --password '***'   # 仅在自动化里用
 */
import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";

const CAS = "https://ca.csu.edu.cn";
const ZHXG = "https://zhxg.csu.edu.cn";
const SERVICE = ZHXG + "/fdcwonsun/caslogin_h5.jsp";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* ── 域感知 cookie jar，语义与 src/core/casLogin.ts 一致 ── */
const jar = [];
function absorb(res, url) {
  const host = new URL(url).hostname.toLowerCase();
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const parts = String(line).split(";");
    const i = parts[0].indexOf("=");
    if (i <= 0) continue;
    const name = parts[0].slice(0, i).trim();
    const value = parts[0].slice(i + 1).trim();
    let domain = host;
    let path = "/";
    for (const attr of parts.slice(1)) {
      const j = attr.indexOf("=");
      const k = (j < 0 ? attr : attr.slice(0, j)).trim().toLowerCase();
      const v = j < 0 ? "" : attr.slice(j + 1).trim();
      if (k === "domain" && v) domain = v.replace(/^\./, "").toLowerCase();
      else if (k === "path" && v) path = v;
    }
    const at = jar.findIndex((c) => c.name === name && c.domain === domain && c.path === path);
    const next = { name, value, domain, path };
    if (at >= 0) jar[at] = next;
    else jar.push(next);
  }
}
function cookieHeader(url) {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const path = u.pathname || "/";
  return jar
    .filter((c) => {
      const domainOk = host === c.domain || host.endsWith("." + c.domain);
      const pathOk = c.path === "/" || path === c.path || path.startsWith(c.path + "/");
      return domainOk && pathOk;
    })
    .map((c) => c.name + "=" + c.value)
    .join("; ");
}

/** 与登录页一致：AES-128-CBC，key 取盐前 16 字节，IV 固定，明文前补 64 个 x */
function encryptPassword(plain, salt) {
  const key = Buffer.from(salt.trim().slice(0, 16), "utf8");
  const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.from("0123456789abcdef", "utf8"));
  return Buffer.concat([cipher.update(Buffer.from("x".repeat(64) + plain, "utf8")), cipher.final()]).toString("base64");
}

/** 抽出能定位实现的元素，同时脱敏 */
function digest(html) {
  const inputs = [...html.matchAll(/<(input|select|button|form)\b[^>]*>/gi)].map((m) =>
    m[0].replace(/\s+/g, " ").replace(/value="[^"]{24,}"/gi, 'value="<长值>"').slice(0, 260)
  );
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
  return {
    title: (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "",
    hasLoginForm: /pwdEncryptSalt/.test(html),
    hasCaptcha: /getCaptcha|checkNeedCaptcha|captcha\.image/i.test(html),
    mentionsMfa: /reAuth|multifactor/i.test(html),
    inputs,
    text,
  };
}

function redact(html) {
  return html
    .replace(/1[3-9]\d{9}/g, "1**********")
    .replace(/ticket=[^&"'\s]+/gi, "ticket=<截断>")
    .replace(/(password=)[^&"'\s]+/gi, "$1<截断>");
}

/** 发一步请求并记录。withHtml 只在需要看页面结构时开，避免 JSON 里塞满登录页 */
async function step(name, url, init = {}, withHtml = false) {
  const headers = { "User-Agent": UA, ...(init.headers || {}) };
  const ck = cookieHeader(url);
  if (ck) headers.Cookie = ck;
  const t0 = Date.now();
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  absorb(res, url);
  const body = await res.text();
  const rec = {
    step: name,
    status: res.status,
    ms: Date.now() - t0,
    location: res.headers.get("location") || "",
    cookies: jar.map((c) => c.name),
    len: body.length,
    probe: digest(body),
  };
  if (withHtml) rec.html = redact(body);
  return { res, body, rec };
}

/** 密码输入：TTY 下逐字符读、掩盖回显 */
function ask(q) {
  return new Promise((resolve) => {
    process.stdout.write(q);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      const rl = readline.createInterface({ input: stdin, output: process.stdout });
      rl.question("", (a) => {
        rl.close();
        resolve(a);
      });
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const onData = (ch) => {
      if (ch === "\u0003") {
        stdin.setRawMode(false);
        process.stdout.write("\n");
        process.exit(130);
      } else if (ch === "\r" || ch === "\n") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(buf);
      } else if (ch === "\u007f" || ch === "\b") {
        if (buf.length) {
          buf = buf.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        buf += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

const argv = process.argv.slice(2);
const xh = argv.find((a) => !a.startsWith("--"));
const pwdAt = argv.indexOf("--password");
if (!xh) {
  console.log("用法：node scripts/diag-login.mjs <学号> [--password <密码>] [--castgc]");
  console.log("  --castgc  登录成功时把这枚会话凭据打印出来，供云端页面「导入会话」使用");
  process.exit(2);
}
const password = pwdAt >= 0 ? argv[pwdAt + 1] : await ask("密码（不回显、不保存）：");
if (!password) {
  console.log("没有密码，退出。");
  process.exit(2);
}

const out = { at: new Date().toISOString(), xh, verdict: "", steps: [] };
const loginUrl = `${CAS}/authserver/login?service=${encodeURIComponent(SERVICE)}`;

const s1 = await step("1-get-login-page", loginUrl, {}, true);
out.steps.push(s1.rec);
const salt = (s1.body.match(/id="pwdEncryptSalt"\s+value="([^"]*)"/) || [])[1] || "";
const exec = (s1.body.match(/id="execution"\s+name="execution"\s+value="([^"]*)"/) || [])[1] || "e1s1";

const capUrl = `${CAS}/authserver/checkNeedCaptcha.htl?username=${encodeURIComponent(xh)}&_=${Date.now()}`;
const s2 = await step("2-check-captcha", capUrl);
out.steps.push(s2.rec);
out.needCaptcha = (() => {
  try {
    return JSON.parse(s2.body).isNeed === true;
  } catch {
    return null;
  }
})();

const s3 = await step(
  "3-post-login",
  loginUrl,
  {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: xh,
      password: encryptPassword(password, salt),
      lt: "",
      execution: exec,
      _eventId: "submit",
      cllt: "userNameLogin",
      dllt: "generalLogin",
      captcha: "",
      rmShown: "1",
      rememberMe: "true",
    }).toString(),
  },
  true
);
out.steps.push(s3.rec);

const loc = s3.rec.location;
if (/reAuth|reAuthCheck|reAuthLoginView/i.test(loc)) {
  // 二次认证页需要这条会话，必须接着带 jar 去抓
  const s4 = await step("4-reauth-page", loc, {}, true);
  out.steps.push(s4.rec);
  out.verdict = "MFA_REQUIRED";
} else if (/ticket=/.test(loc)) {
  out.verdict = "OK_TICKET";
  const ticket = new URL(loc, ZHXG).searchParams.get("ticket") || "";
  const v = await fetch(
    `${CAS}/authserver/serviceValidate?service=${encodeURIComponent(SERVICE)}&ticket=${encodeURIComponent(ticket)}`,
    { headers: { "User-Agent": UA } }
  );
  const xml = await v.text();
  out.serviceValidate = {
    status: v.status,
    len: xml.length,
    user: (xml.match(/<cas:user>([^<]+)<\/cas:user>/) || [])[1] || "",
    code: (xml.match(/code="([^"]+)"/) || [])[1] || "",
  };
} else if (s3.res.status === 302) {
  out.verdict = "NO_TICKET";
} else {
  out.verdict = "REJECTED_BY_CAS";
  // 新版登录页把失败原因写成 i18n key 吐在页面上，状态码同时变成 401
  const rejHtml = s3.rec.html || "";
  out.reason = /accountLogin_account_pwd_error/.test(rejHtml)
    ? "pwd_error"
    : s3.res.status === 401
      ? "http_401"
      : "unknown";
}

/*
 * 5. CASTGC 能否免密换票。
 * 登录成功时 CAS 会下发 CASTGC（TGT）。若它能直接换出新 ticket，云端就只需
 * 保存这一枚 cookie 而不必存密码；若它同样被要求二次认证，这条路在云端走不通。
 * 只记录状态与去向，不落 CASTGC 的值。
 */
if (out.verdict === "OK_TICKET") {
  /*
   * --castgc：把这次登录拿到的 CASTGC 打印出来，用于在云端页面「导入会话」。
   * 它等同于账号的登录态，所以只在显式要求时才输出，并在旁边放一句提醒。
   */
  if (argv.includes("--castgc")) {
    const tgt = jar.find((c) => c.name === "CASTGC");
    if (tgt) {
      console.log("\n把下面整行贴到云端页面的 CASTGC 输入框：\n");
      console.log("CASTGC=" + tgt.value + "\n");
      console.log("  （这串等同于账号登录态，几天内可免密换票，不要发给别人。）");
    } else {
      console.log("\n这次登录没有拿到 CASTGC，无法导出。");
    }
  }

  const s5 = await step("5-castgc-replay", loginUrl, {}, true);
  out.steps.push(s5.rec);
  const l5 = s5.rec.location || "";
  out.castgcReplay = {
    status: s5.rec.status,
    hasTicket: /ticket=/.test(l5),
    mfa: /reAuth|reAuthCheck/i.test(l5),
    location: l5.slice(0, 120),
  };
}

const file = `diag-${xh.slice(-4)}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(file, JSON.stringify(out, null, 2), "utf8");

console.log("\n结论：" + out.verdict);
if (out.castgcReplay) {
  const c = out.castgcReplay;
  console.log(
    "  CASTGC 复用：" +
      (c.hasTicket
        ? "可直接换票（云端只需保存 CASTGC，不必存密码）"
        : c.mfa
          ? "同样被要求二次认证（这条路走不通）"
          : "未换到 ticket，status=" + c.status)
  );
}
if (out.reason) {
  console.log(
    "  原因：" +
      ({ pwd_error: "CAS 判定用户名或密码错误", http_401: "CAS 返回 401", unknown: "未能识别，见 steps[2].html" }[out.reason] || out.reason)
  );
}
for (const s of out.steps) {
  console.log(
    `  ${s.step.padEnd(18)} ${s.status} ${String(s.len).padStart(6)}B ${String(s.ms).padStart(5)}ms ` +
      (s.location ? "→ " + s.location.slice(0, 110) : "")
  );
}
const mfa = out.steps.find((s) => s.step === "4-reauth-page");
if (mfa) {
  console.log("\n二次认证页面的表单元素：");
  console.log("  " + (mfa.probe.inputs.join("\n  ") || "（没有表单元素）"));
  console.log("  可见文案：" + (mfa.probe.text || "").slice(0, 500));
}
console.log("\n完整记录已写入 " + file + "（已脱敏，可直接贴出来）");
