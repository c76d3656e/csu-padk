/**
 * 本地登录编排中间件（仅开发服务器生效，生产构建不包含）
 *
 * 把 CAS 协议登录的全部步骤收敛成一个接口：
 *   POST /__auth/login  { username, password }
 *     → { token, casual, user }
 *
 * 前端因此不需要关心 UA 门禁、验证码、ticket 回调、uid/lzc 兑换等等。
 * 中间件只在内存中转发，不落盘、不记录凭据。
 */
import crypto from "node:crypto";
import type { Plugin, Connect } from "vite";

const CAS = "https://ca.csu.edu.cn";
const ZHXG = "https://zhxg.csu.edu.cn";
const SERVICE = ZHXG + "/fdcwonsun/caslogin_h5.jsp";
const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40";

/* ── 金智密码加密（AES-128-CBC）── */
const AES_CHARS = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
const rand = (n: number) => {
  let s = "";
  for (let i = 0; i < n; i++) s += AES_CHARS.charAt(Math.floor(Math.random() * AES_CHARS.length));
  return s;
};

function encryptPassword(plain: string, salt: string): string {
  if (!salt) return plain;
  const key = Buffer.from(salt.trim(), "utf8");
  const iv = Buffer.from(rand(16), "utf8");
  const data = Buffer.from(rand(64) + plain, "utf8");
  const c = crypto.createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([c.update(data), c.final()]).toString("base64");
}

function generateCasual(n = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/* ── 极简 cookie jar ── */
class Jar {
  private m = new Map<string, string>();
  set(res: Response) {
    const raw = (res.headers as any).getSetCookie?.() ?? [];
    for (const line of raw) {
      const pair = String(line).split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) this.m.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() {
    return [...this.m].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

interface LoginResult {
  token: string;
  casual: string;
  user: { xh: string; xm: string; bmid: string; bmmc?: string };
}

async function protocolLogin(username: string, password: string): Promise<LoginResult> {
  const jar = new Jar();
  const loginUrl = `${CAS}/authserver/login?service=${encodeURIComponent(SERVICE)}`;

  // 1. 取登录页 → salt / execution
  let res = await fetch(loginUrl, {
    redirect: "manual",
    headers: { "User-Agent": UA_DESKTOP },
  });
  jar.set(res);
  const html = await res.text();
  const salt = (html.match(/id="pwdEncryptSalt"\s+value="([^"]*)"/) || [])[1] || "";
  const exec = (html.match(/id="execution"\s+name="execution"\s+value="([^"]*)"/) || [])[1] || "e1s1";

  // 企业微信分支兜底
  if (!salt && res.headers.get("location")?.includes("weixinQYLogin")) {
    throw new Error("CAS 走了企业微信授权分支，请稍后重试");
  }
  if (!salt) throw new Error("未能从登录页解析加密盐，页面结构可能已变更");

  // 2. 是否需要验证码
  res = await fetch(
    `${CAS}/authserver/checkNeedCaptcha.htl?username=${encodeURIComponent(username)}&_=${Date.now()}`,
    { headers: { "User-Agent": UA_DESKTOP, Cookie: jar.header() } }
  );
  jar.set(res);
  const needCaptcha = (await res.json().catch(() => ({}))).isNeed === true;

  // 3. 提交登录
  res = await fetch(loginUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA_DESKTOP,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jar.header(),
    },
    body: new URLSearchParams({
      username,
      password: encryptPassword(password, salt),
      lt: "",
      execution: exec,
      _eventId: "submit",
      cllt: "userNameLogin",
      dllt: "generalLogin",
      captcha: "",
      rmShown: "1",
    }).toString(),
  });
  jar.set(res);

  if (res.status !== 302) {
    const body = await res.text();
    const tip = (body.match(/id="showErrorTip"[^>]*>([^<]*)</) || [])[1];
    if (needCaptcha) throw new Error("该账号需要验证码，请改用官方页面登录");
    throw new Error(tip?.trim() || "账号或密码不正确");
  }

  let ticketUrl = res.headers.get("location") || "";
  if (ticketUrl.startsWith("/")) ticketUrl = ZHXG + ticketUrl;

  // 4. 跟随回调拿 uid / lzc
  const wxJar = new Jar();
  let cur = ticketUrl;
  let body = "";
  for (let hop = 0; hop < 5 && cur; hop++) {
    const r = await fetch(cur, { redirect: "manual", headers: { "User-Agent": UA_MOBILE, Cookie: wxJar.header() } });
    wxJar.set(r);
    const t = await r.text();
    if (t.includes("uid")) body = t;
    const next = r.headers.get("location");
    if (!next) break;
    cur = next.startsWith("/") ? ZHXG + next : next;
  }

  const uid = (body.match(/uid\s*=\s*['"]([^'"]+)['"]/) || [])[1] || "";
  const lzc = (body.match(/lzc\s*=\s*['"]([^'"]*)['"]/) || [])[1] || "";
  if (!uid) throw new Error("未取得登录凭据（uid）");

  // 5. 换 token
  const casual = generateCasual(16);
  const r5 = await fetch(`${ZHXG}/znzhxgpt/basesys/rbac-yh/login-other`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      deviceType: "4",
      AppCode: "znzhxgpt",
      "User-Agent": UA_MOBILE,
      Origin: ZHXG,
      Referer: ZHXG + "/znzhxgpt_h5/",
      Cookie: wxJar.header(),
    },
    body: JSON.stringify({
      tyrzpt: "1",
      channeld: "1",
      yhzh: encodeURIComponent(encodeURIComponent(uid)),
      lzc: encodeURIComponent(encodeURIComponent(lzc || "")),
      caasual: casual,
    }),
  });

  const j = await r5.json().catch(() => null);
  if (!j?.data?.token) throw new Error(j?.message || "换取 token 失败");

  let bmmc: string | undefined;
  try {
    const payload = JSON.parse(Buffer.from(j.data.token.split(".")[1], "base64").toString("utf8"));
    const info = JSON.parse(payload.user_info || "{}");
    bmmc = info.bmmc;
  } catch { /* ignore */ }

  return {
    token: j.data.token,
    casual,
    user: { xh: j.data.yhzh, xm: j.data.yhxm, bmid: j.data.bmid, bmmc },
  };
}

/* ── Vite 插件 ── */
export function casAuthPlugin(): Plugin {
  return {
    name: "padk-cas-auth",
    apply: "serve",
    configureServer(server) {
      const handler: Connect.NextHandleFunction = (req, res, next) => {
        if (!req.url?.startsWith("/__auth/login")) return next();

        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            const { username, password } = JSON.parse(raw || "{}");
            if (!username || !password) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ ok: false, error: "缺少账号或密码" }));
            }
            const t0 = Date.now();
            const out = await protocolLogin(String(username).trim(), String(password));
            server.config.logger.info(
              `[cas-auth] ${out.user.xh} 登录成功 (${Date.now() - t0}ms)`
            );
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, ...out }));
          } catch (e: any) {
            server.config.logger.warn(`[cas-auth] 失败: ${e?.message}`);
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: false, error: e?.message || "登录失败" }));
          }
        });
      };
      server.middlewares.use(handler);
    },
  };
}
