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
 * 第 3 步是唯一有交互的一步：账号、密码、验证码由学校侧判定。失败时 CAS 有三种
 * 回应形态，必须分开识别，否则会把「登录没被接受」误报成「拿不到 uid」：
 *   302 → 登录页              登录没被受理，被退回（见第 3 步后的判断）
 *   200 → 登录页正文          CAS 不接受这次登录（验证码未通过、密码错误等），不重定向
 *   302 → service?ticket=…    真正成功
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
    /*
     * CAS 拒绝登录时不一定带错误提示元素，实测会直接回登录页正文（含这段脚本变量）。
     * 先认它，再判验证码 —— 顺序反过来会把「登录页被退回来」说成「需要验证码」。
     */
    if (/var\s+inputUserNameTip/.test(body)) {
      throw new Error(
        "统一认证没有接受这次登录（账号或密码不正确，或该账号被要求验证码）。" +
          "出现验证码时需要用官方页面登录一次。"
      );
    }
    if (needCaptcha) throw new Error("该账号需要验证码，请改用官方页面登录");
    throw new Error(tip?.trim() || "账号或密码不正确");
  }

  let ticketUrl = res.headers.get("location") || "";
  if (ticketUrl.startsWith("/")) ticketUrl = ZHXG + ticketUrl;

  /*
   * 302 不等于登录成功。
   *
   * CAS 拒绝一次登录时，会以 302 把请求**退回登录页**，而不是带 ticket 回到
   * service。只看状态码的实现会把这个「伪成功」一路带到第 4 步，最后只报一句
   * 「未取得登录凭据（uid）」，把真正的原因（登录根本没被受理）藏起来。
   *
   * 归因到此为止：实测本机出口与 Cloudflare 出口对 CAS 的行为一致，具体诱因
   * （会话、参数、账号状态）没有定论，所以这里只识别、不解释。遇到时改用官方
   * 页面登录一次即可绕过。
   */
  if (/\/authserver\/login\b/.test(ticketUrl)) {
    throw new Error("统一认证没有接受这次登录：被退回登录页。请改用官方页面登录一次。");
  }

  const ticket = (() => {
    try {
      return new URL(ticketUrl, ZHXG).searchParams.get("ticket") || "";
    } catch {
      return "";
    }
  })();

  // 4. 跟随回调拿 uid / lzc
  /*
   * 回调页依赖 CAS 会话。协议客户端没有那个会话，所以这一环在多数环境下拿不到
   * uid —— 实测用三种 UA 直接请求回调页都是 403 空体。它只在浏览器里带着会话
   * 访问时才走得通，因此保留为「能拿到就先拿」的通道，真正的兜底是下面的
   * serviceValidate。这里做两处提前退出，避免把整条链白白跑完：
   *   403 空体            服务端明确拒绝无会话请求，后面几跳只会更远。
   *   下一跳回到 CAS 登录页 链路已经离开 service，继续跟会走进企业微信授权。
   */
  const wxJar = new Jar();
  let cur = ticketUrl;
  const hops: string[] = [];
  const trace: string[] = [];
  for (let hop = 0; hop < 5 && cur; hop++) {
    const h: Record<string, string> = { "User-Agent": UA_DESKTOP };
    // 首跳不塞空 Cookie 头：空头值在 Node 与边缘运行时处置不同，而首跳本来就无 cookie 可带
    const ck = wxJar.header();
    if (ck) h.Cookie = ck;
    const r = await fetch(cur, { redirect: "manual", headers: h });
    wxJar.set(r);
    const t = await r.text();
    hops.push(t);
    const next = r.headers.get("location") || "";
    trace.push(
      `#${hop} ${r.status} len=${t.length}${t.includes("uid") ? " uid" : ""} → ${(next || "-").slice(0, 80)}`
    );
    if (r.status === 403 && !t) break;
    if (!next) break;
    if (/\/authserver\/login\b/.test(next)) break;
    cur = next.startsWith("/") ? ZHXG + next : next;
  }

  /*
   * 回调页有两种形态，取决于服务端能不能就地换票据：
   *   带 uid 的页面        直接取 uid / lzc。
   *   167 字节的跳转脚本   window.location.href='…/authserver/login?service=…'
   *                       服务端没就地换票据，而是让客户端带着自己的会话回 CAS
   *                       再走一次；协议客户端没有那个会话，所以退回 serviceValidate。
   * 取「任一跳里带 uid 的那一页」而不是只看最后一跳：回调链长短由服务端决定。
   */
  const body = hops.find((t) => t.includes("uid")) || "";

  let uid = (body.match(/uid\s*=\s*['"]([^'"]+)['"]/) || [])[1] || "";
  const lzc = (body.match(/lzc\s*=\s*['"]([^'"]*)['"]/) || [])[1] || "";

  /*
   * 没有 uid 时用 CAS 标准协议 serviceValidate：拿 ticket 直接换回 XML 形式的
   * 账号，不依赖 HTML 结构、不跟随重定向、不需要任何会话 cookie —— 实测无 cookie
   * 直连也能正常工作（无效 ticket 回 INVALID_TICKET，说明接口本身是通的）。
   * 这是没有浏览器会话时的唯一可靠通道。lzc 只有回调页里有，拿不到就留空
   * （第 5 步允许空值）。
   */
  if (!uid && ticket) {
    // 2.0 与 3.0 两个端点都试：3.0 多返回属性，个别部署只开了其中一个。
    // trace 里带上 CAS 的失败码（INVALID_TICKET / INVALID_SERVICE 等），
    // 这样线上报错时能直接看出是哪一环不通，而不是只有一个空 uid。
    for (const ep of ["/authserver/serviceValidate", "/authserver/p3/serviceValidate"]) {
      try {
        const v = await fetch(
          `${CAS}${ep}?service=${encodeURIComponent(SERVICE)}&ticket=${encodeURIComponent(ticket)}`,
          { headers: { "User-Agent": UA_DESKTOP } }
        );
        const xml = await v.text();
        uid = (xml.match(/<cas:user>([^<]+)<\/cas:user>/) || [])[1] || "";
        const code = (xml.match(/code="([^"]+)"/) || [])[1] || "";
        trace.push(
          `serviceValidate${ep.includes("p3") ? "(p3)" : ""} ${v.status} len=${xml.length}${code ? " " + code : ""}${uid ? " uid" : ""}`
        );
        if (uid) break;
      } catch (e) {
        trace.push(`serviceValidate${ep.includes("p3") ? "(p3)" : ""} ERR ${(e as Error).message}`);
      }
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
  if (!j?.data?.token) {
    // 实测这个接口对无效身份回 200 + code 600「登陆失败」，所以不能只看状态码。
    // 走到这里说明 uid 已经拿到，问题出在会话绑定，文案要点明，否则会被当成登录整体失败。
    const why = [j?.code, j?.message].filter(Boolean).join(" ");
    throw new Error("换取登录令牌失败" + (why ? "：" + why : "") + "（账号已识别，卡在会话绑定这一步）");
  }

  return {
    token: j.data.token,
    casual,
    user: { xh: j.data.yhzh, xm: j.data.yhxm, bmid: j.data.bmid, bmmc: readBmmc(j.data.token) },
  };
}
