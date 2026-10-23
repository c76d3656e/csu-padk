/**
 * 统一身份认证登录编排 —— 唯一实现
 *
 * 三个运行时共用：
 *   server.mjs         本机形态（Node http 服务）
 *   vite.casAuth.ts    开发服务器中间件
 *   src/edge/worker.js 边缘函数（Cloudflare / Vercel）
 *
 * 流程：
 *   1. GET  /authserver/login?service=…       取登录页的 pwdEncryptSalt / execution
 *   2. GET  /authserver/checkNeedCaptcha.htl  判断是否需要验证码
 *   3. POST /authserver/login                 成功即 302 + ticket（非 302 视为失败）
 *   4. 跟随 ticket 回调（≤5 跳）               从页面里取 uid / lzc
 *   5. POST /znzhxgpt/basesys/rbac-yh/login-other  换 token，casual 在此与会话绑定
 *
 * 本模块不落盘、不打印任何凭据；抛出的错误文案可直接展示给用户。
 */
import { encryptPassword, generateCasual } from "./kcipher.ts";

export const CAS = "https://ca.csu.edu.cn";
export const ZHXG = "https://zhxg.csu.edu.cn";
export const SERVICE = ZHXG + "/fdcwonsun/caslogin_h5.jsp";
export const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
export const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40";

export interface LoginUser {
  xh: string;
  xm: string;
  bmid: string;
  bmmc?: string;
}

export interface LoginResult {
  token: string;
  casual: string;
  user: LoginUser;
}

/** 极简 cookie jar。Node 的 getSetCookie 与边缘运行时的同名方法行为一致 */
class Jar {
  private m = new Map<string, string>();
  set(res: Response): void {
    const raw = (res.headers as any).getSetCookie?.() ?? [];
    for (const line of raw) {
      const pair = String(line).split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) this.m.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header(): string {
    return [...this.m].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

/** base64url → UTF-8 字符串。Buffer 在边缘运行时不可用，用 atob 手工补 padding */
function b64urlDecode(seg: string): string {
  const s = seg.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 从 token 的 payload 里取院系名；拿不到不影响登录 */
function readBmmc(token: string): string | undefined {
  try {
    const payload = JSON.parse(b64urlDecode(token.split(".")[1]));
    return JSON.parse(payload.user_info || "{}").bmmc;
  } catch {
    return undefined;
  }
}

export async function protocolLogin(username: string, password: string): Promise<LoginResult> {
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

  if (!salt && (res.headers.get("location") || "").includes("weixinQYLogin")) {
    throw new Error("统一认证走了企业微信授权分支，请稍后重试");
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
      password: await encryptPassword(password, salt),
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

  /*
   * 302 不等于登录成功。
   *
   * 实测：出口 IP 触发学校侧风控时，CAS 会以 302 把浏览器**退回登录页**，
   * 而不是带 ticket 回到 service。只看状态码的实现会把这个「伪成功」一路
   * 带到第 4 步，最后只报一句「未取得登录凭据（uid）」，把真正的原因（登录
   * 根本没被接受）藏起来 —— Cloudflare 边缘出口上就是这样。
   */
  if (/\/authserver\/login\b/.test(ticketUrl)) {
    throw new Error(
      "统一认证没有接受这次登录：被退回登录页。出口 IP 触发学校侧风控时会出现这种情形，" +
        "本机 exe 形态不受影响。"
    );
  }

  const ticket = (() => {
    try {
      return new URL(ticketUrl, ZHXG).searchParams.get("ticket") || "";
    } catch {
      return "";
    }
  })();

  // 4. 跟随回调拿 uid / lzc
  const wxJar = new Jar();
  let cur = ticketUrl;
  let body = "";
  const trace: string[] = [];
  for (let hop = 0; hop < 5 && cur; hop++) {
    const h: Record<string, string> = { "User-Agent": UA_MOBILE };
    // 首跳不塞空 Cookie 头：空头值在 Node 与边缘运行时处置不同，而首跳本来就无 cookie 可带
    const ck = wxJar.header();
    if (ck) h.Cookie = ck;
    const r = await fetch(cur, { redirect: "manual", headers: h });
    wxJar.set(r);
    const t = await r.text();
    const hasUid = t.includes("uid");
    if (hasUid) body = t;
    trace.push(
      `#${hop} ${r.status} len=${t.length}${hasUid ? " uid" : ""} → ${(r.headers.get("location") || "-").slice(0, 80)}`
    );
    const next = r.headers.get("location");
    if (!next) break;
    cur = next.startsWith("/") ? ZHXG + next : next;
  }

  let uid = (body.match(/uid\s*=\s*['"]([^'"]+)['"]/) || [])[1] || "";
  const lzc = (body.match(/lzc\s*=\s*['"]([^'"]*)['"]/) || [])[1] || "";

  /*
   * 回调页在部分出口环境下拿不到 uid（页面形态与校内直连不同）。这时退回 CAS
   * 标准协议 serviceValidate —— 按 ticket 直接换回 XML 形式的账号，不依赖
   * HTML 结构与重定向链，是 CAS 里最稳的一条路。lzc 只有回调页里有，拿不到就
   * 留空（第 5 步允许空值）。
   */
  if (!uid && ticket) {
    try {
      const v = await fetch(
        `${CAS}/authserver/serviceValidate?service=${encodeURIComponent(SERVICE)}&ticket=${encodeURIComponent(ticket)}`,
        { headers: { "User-Agent": UA_DESKTOP } }
      );
      const xml = await v.text();
      uid = (xml.match(/<cas:user>([^<]+)<\/cas:user>/) || [])[1] || "";
      trace.push(`serviceValidate ${v.status} len=${xml.length}${uid ? " uid" : ""}`);
    } catch (e) {
      trace.push(`serviceValidate ERR ${(e as Error).message}`);
    }
  }

  if (!uid) {
    const detail = trace.join(" | ");
    // 边缘环境（Cloudflare）的 console 输出会进平台日志，便于线上排查
    console.log("[padk] 未取得 uid，回调链：" + detail);
    throw new Error("未取得登录凭据（uid）。回调链：" + detail);
  }

  // 5. 换 token（casual 在此与这次会话绑定）
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

  const j: any = await r5.json().catch(() => null);
  if (!j?.data?.token) throw new Error(j?.message || "换取登录令牌失败");

  return {
    token: j.data.token,
    casual,
    user: { xh: j.data.yhzh, xm: j.data.yhxm, bmid: j.data.bmid, bmmc: readBmmc(j.data.token) },
  };
}
