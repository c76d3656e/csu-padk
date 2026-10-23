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
 *   302 → reAuthCheck/…       密码已通过，学校侧要求二次认证（多因子），协议到此为止
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
  /**
   * CAS 的长期会话凭据（rememberMe=true 时签发的 TGT，默认数天有效）。
   * 有它就能免密换票，所以密码登录成功时一并带回，交给前端保存 ——
   * 下一次登录不必再输密码，也不会撞二次认证。
   */
  castgc?: string;
  user: LoginUser;
}

/** 一条 cookie。域与路径都要记，否则会把 ca 域的会话发到 zhxg 域去 */
interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

/**
 * 域感知 cookie jar。Node 的 getSetCookie 与边缘运行时的同名方法行为一致。
 *
 * 必须按域分发：统一认证的会话 cookie（CASTGC）属于 ca.csu.edu.cn，而第 4 步
 * 的回调页在 zhxg.csu.edu.cn。把两个域的 cookie 混着发，回调页拿不到自己的会话，
 * 就会 302 退回登录页。参考实现（Python requests.Session）是按域自动管理的，
 * 这里手工补上同一件事。
 */
class Jar {
  private m: Cookie[] = [];
  /** 记下响应里的 Set-Cookie；url 用于推断没写 Domain 属性时的默认域 */
  set(res: Response, url: string): void {
    const raw = (res.headers as any).getSetCookie?.() ?? [];
    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      host = "";
    }
    for (const line of raw) {
      const parts = String(line).split(";");
      const pair = parts[0];
      const i = pair.indexOf("=");
      if (i <= 0) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      let domain = host;
      let path = "/";
      for (const attr of parts.slice(1)) {
        const j = attr.indexOf("=");
        const k = (j < 0 ? attr : attr.slice(0, j)).trim().toLowerCase();
        const v = j < 0 ? "" : attr.slice(j + 1).trim();
        if (k === "domain" && v) domain = v.replace(/^\./, "").toLowerCase();
        else if (k === "path" && v) path = v;
      }
      if (!domain) continue;
      const at = this.m.findIndex(
        (c) => c.name === name && c.domain === domain && c.path === path
      );
      const next: Cookie = { name, value, domain, path };
      if (at >= 0) this.m[at] = next;
      else this.m.push(next);
    }
  }
  /** 该 URL 该带的 cookie：域后缀匹配 + 路径前缀匹配，长路径优先 */
  header(url: string): string {
    let host = "";
    let path = "/";
    try {
      const u = new URL(url);
      host = u.hostname.toLowerCase();
      path = u.pathname || "/";
    } catch {
      return "";
    }
    const hit = this.m.filter((c) => {
      const d = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
      const domainOk = host === d || host.endsWith("." + d);
      const pathOk =
        c.path === "/" || path === c.path || path.startsWith(c.path.endsWith("/") ? c.path : c.path + "/");
      return domainOk && pathOk;
    });
    hit.sort((a, b) => b.path.length - a.path.length);
    return hit.map((c) => `${c.name}=${c.value}`).join("; ");
  }
  /**
   * 把外部导入的 cookie 串挂到指定域上。
   * 用户从浏览器复制的是什么就传什么（"CASTGC=…; JSESSIONID=…"），
   * 多的项无害，缺的项由后续请求自己 Set-Cookie 补回来。
   */
  seed(raw: string, host: string): void {
    for (const part of raw.split(";")) {
      const i = part.indexOf("=");
      if (i <= 0) continue;
      const name = part.slice(0, i).trim();
      const value = part.slice(i + 1).trim();
      if (!name || !value) continue;
      const at = this.m.findIndex((c) => c.name === name && c.domain === host && c.path === "/");
      const next: Cookie = { name, value, domain: host, path: "/" };
      if (at >= 0) this.m[at] = next;
      else this.m.push(next);
    }
  }
  /** 取某个 cookie 的值；只在确实需要回传给前端时用，不进任何日志 */
  value(name: string): string {
    return this.m.find((c) => c.name === name)?.value || "";
  }
  /** 只报名字，值永远不外泄 —— 诊断文案要能贴进工单 */
  names(): string {
    return [...new Set(this.m.map((c) => c.name))].join(",") || "无";
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

/*
 * 两类失败是瞬时的，整体重试一次就能过，实测如此：
 *   - 出口 IP 被学校网关拦下，第 1 步拿不到登录页（或拿到「仅限校园网访问」提示页，状态码仍是 200）
 *   - 第 3 步提交后 CAS 以 302 把请求退回登录页，即 flow execution 与本次会话不匹配
 * 用独立类型标记，避免把「密码真的错了」也拿去重试 —— 那种情况 CAS 回 200 + 登录页正文。
 */
class RetryableLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableLoginError";
  }
}

/*
 * 学校侧要求二次认证（多因子）。密码这一步已经通过，卡在短信 / OTP / 人脸 ——
 * 协议客户端没有那条流程的会话，跟过去会被踢回登录页，重试也只会被再要求一次，
 * 还多刷一次风控计数。所以单独归类、明确不重试。
 */
export class MfaRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MfaRequiredError";
  }
}

/** 学校网关的「仅限校园网访问」提示页。状态码是 200，只能认正文 */
function isGatewayBlock(html: string): boolean {
  return /仅限校园网访问|系统访问提示|仅限校内网络访问/.test(html);
}

async function protocolLoginOnce(username: string, password: string): Promise<LoginResult> {
  const jar = new Jar();
  const loginUrl = `${CAS}/authserver/login?service=${encodeURIComponent(SERVICE)}`;

  // 1. 取登录页 → salt / execution
  let res = await fetch(loginUrl, {
    redirect: "manual",
    headers: { "User-Agent": UA_DESKTOP },
  });
  jar.set(res, loginUrl);
  const html = await res.text();
  const salt = (html.match(/id="pwdEncryptSalt"\s+value="([^"]*)"/) || [])[1] || "";
  const exec = (html.match(/id="execution"\s+name="execution"\s+value="([^"]*)"/) || [])[1] || "e1s1";

  if (!salt && isGatewayBlock(html)) {
    throw new RetryableLoginError(
      "统一认证这一次没返回登录页，而是学校网关的「仅限校园网访问」提示页 —— 这个出口 IP 不在校园网允许范围内。"
    );
  }
  if (!salt && (res.headers.get("location") || "").includes("weixinQYLogin")) {
    throw new Error("统一认证走了企业微信授权分支，请稍后重试");
  }
  /*
   * 没拿到登录页就到此为止，不再往下走。
   * 实测的正常登录页一定同时带 salt 与会话 cookie（JSESSIONID）；两者都缺，
   * 说明这次根本没拿到页面 —— 网关拦截页已在上一步识别，剩下的就是学校侧
   * 的瞬时状态（限流、维护、会话分配失败）。这种情形提交密码只会被 CAS 退回，
   * 白白多一次失败计数，所以标记为可重试，在这里就重来一遍。
   */
  if (!salt) {
    throw new RetryableLoginError(
      "统一认证这一次没有返回登录页（既没有加密盐，也没有会话 cookie）—— 出口 IP 被学校侧拒绝时就是这个样子。"
    );
  }

  // 2. 是否需要验证码
  const captchaUrl = `${CAS}/authserver/checkNeedCaptcha.htl?username=${encodeURIComponent(username)}&_=${Date.now()}`;
  res = await fetch(captchaUrl, {
    headers: { "User-Agent": UA_DESKTOP, Cookie: jar.header(captchaUrl) },
  });
  jar.set(res, captchaUrl);
  const needCaptcha = (await res.json().catch(() => ({}))).isNeed === true;

  // 3. 提交登录
  res = await fetch(loginUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA_DESKTOP,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jar.header(loginUrl),
    },
    /*
     * 字段与参考实现（csu_dk-main 的 cas_login）逐一对齐。
     * rememberMe 是其中关键的一项：它让 CAS 在这次登录成功时签发长期 CASTGC，
     * 回调页那一跳要靠这个会话换票据 —— 少了它，回调页只会把请求退回登录页。
     */
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
      rememberMe: "true",
    }).toString(),
  });
  jar.set(res, loginUrl);

  if (res.status !== 302) {
    const body = await res.text();
    const tip = (body.match(/id="showErrorTip"[^>]*>([^<]*)</) || [])[1];
    /*
     * 诊断串：线上（云端形态）出问题时看不到内部状态，这串是唯一的线索。
     * 只报结构不报值 —— cookie 只列名字，salt 只说有无，密码永远不出现。
     */
    const diag =
      `诊断 status=${res.status} len=${body.length} ` +
      `salt=${/pwdEncryptSalt/.test(body) ? "有" : "无"} ` +
      `cookie=[${jar.names()}] 验证码=${needCaptcha ? "是" : "否"}`;
    /*
     * CAS 拒绝登录时不一定带错误提示元素，实测会直接回登录页正文（含这段脚本变量）。
     * 先认它，再判验证码 —— 顺序反过来会把「登录页被退回来」说成「需要验证码」。
     */
    /*
     * 新版登录页（2026-08 的 gorgeousCsu 主题）不再有 showErrorTip 元素，
     * 被拒时只把 i18n key "accountLogin_account_pwd_error" 原样吐在页面上，
     * 状态码同时从 200 变成 401。认出这两个就足以断言「密码不对」，
     * 不必再让用户去猜是验证码还是 MFA。
     */
    if (/accountLogin_account_pwd_error/.test(body) || res.status === 401) {
      throw new Error("统一认证判定用户名或密码不正确（status=" + res.status + "）。" + diag);
    }
    if (/var\s+inputUserNameTip/.test(body)) {
      /*
       * 服务端把登录页原样退了回来，说明这次提交没被受理。这是「凭据层」的失败
       * （账号密码、验证码），不是会话层 —— 重试只会多一次无效提交，还可能把
       * 失败次数推高触发验证码，所以这里不重试。
       */
      throw new Error(
        "统一认证没有接受这次登录（账号或密码不正确，或该账号被要求验证码）。" + diag
      );
    }
    if (needCaptcha) throw new Error("该账号需要验证码，请改用官方页面登录。" + diag);
    throw new Error((tip?.trim() || "账号或密码不正确") + "。" + diag);
  }

  return finishWithTicket(res.headers.get("location") || "", jar);
}

/**
 * 从第 3 步的 302 落点继续走完：识别落点 → 取 ticket → 回调拿 uid/lzc → 换 token。
 *
 * 单独成函数是为了让「CASTGC 免密换票」复用同一份实现 —— 两条入口在这一步之后
 * 完全一致，不该有第二份换票逻辑。
 */
async function finishWithTicket(location: string, jar: Jar): Promise<LoginResult> {
  let ticketUrl = location;
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
  /*
   * 还有一种落点，容易被误读成「会话失配」：
   *   302 → /authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true&service=…
   * 这是统一认证的二次认证（多因子）页面 —— 密码已经验过，卡的是短信 / OTP /
   * 人脸这一关，跟图形验证码是两回事。协议客户端没有那条流程的会话，跟过去只会
   * 被踢回登录页；重试也照样被要求一次，只多刷一次风控计数。单独归一类，不重试。
   */
  if (/reAuthLoginView|reAuthCheck|\/reAuth/i.test(ticketUrl)) {
    throw new MfaRequiredError(
      "统一认证要求二次认证（多因子）：密码这一步已经通过，卡在短信 / 二次验证这一关，" +
        "跟图形验证码无关。协议登录无法自动完成，请在官方页面登录一次（完成二次验证），" +
        "再用「手动导入」把 token 与 casual 搬进来。"
    );
  }

  if (/\/authserver\/login\b/.test(ticketUrl)) {
    // flow execution 失效时 CAS 会带上 exception.message，把它透出来，省得靠猜
    const why = (() => {
      try {
        return new URL(ticketUrl, ZHXG).searchParams.get("exception.message") || "";
      } catch {
        return "";
      }
    })();
    throw new RetryableLoginError(
      "统一认证把这次登录退回了登录页（会话与表单令牌对不上）。" + (why ? ` CAS 原话：${why}` : "")
    );
  }

  const ticket = (() => {
    try {
      return new URL(ticketUrl, ZHXG).searchParams.get("ticket") || "";
    } catch {
      return "";
    }
  })();

  /*
   * 302 还必须真的带回 ticket。实测 CAS 用 302 回应时，location 有三种落点：
   *   service?ticket=…        成功
   *   /authserver/login?…     被退回登录页（上面已拦）
   *   service（无 ticket）     登录没被受理，但 CAS 仍用 302 回应
   * 第三种是真实线上观察到的形态，而它恰好也是 flow execution 失配的症状 ——
   * 实测同一会话连续提交两次，第二次必得这种回应。归到可重试一类，重走一遍
   * 完整流程（换新会话与新令牌）通常就过了。
   */
  if (!ticket) {
    throw new RetryableLoginError(
      "统一认证回了 302，但没有带回票据 —— 这次登录没有被受理（location=" +
        ticketUrl.slice(0, 120) +
        "）。"
    );
  }

  // 4. 跟随回调拿 uid / lzc
  /*
   * 回调页依赖 CAS 会话。协议客户端没有那个会话，所以这一环在多数环境下拿不到
   * uid —— 实测用三种 UA 直接请求回调页都是 403 空体。它只在浏览器里带着会话
   * 访问时才走得通，因此保留为「能拿到就先拿」的通道，真正的兜底是下面的
   * serviceValidate。这里做两处提前退出，避免把整条链白白跑完：
   *   403 空体            服务端明确拒绝无会话请求，后面几跳只会更远。
   *   下一跳回到 CAS 登录页 链路已经离开 service，继续跟会走进企业微信授权。
   */
  let cur = ticketUrl;
  const hops: string[] = [];
  const trace: string[] = [];
  // 票据本身是凭据，不进日志；只记长度。这一条能一眼区分两种失败：
  // 没有 ticket（第 3 步其实没成功）与有 ticket 但换不回身份。
  trace.push(`ticket len=${ticket.length}`);
  for (let hop = 0; hop < 5 && cur; hop++) {
    const h: Record<string, string> = { "User-Agent": UA_DESKTOP };
    /*
     * 必须复用第 1~3 步的 jar：登录成功后 CAS 把 CASTGC 挂在 ca 域上，
     * 回调页要靠它确认「这个人刚登录过」。用空 jar 请求回调页，服务端只会
     * 回那段 167 字节的跳转脚本（把你送回登录页），于是整条链白跑。
     * jar 是域感知的，发给 zhxg 的请求不会带上 ca 域的会话。
     */
    const ck = jar.header(cur);
    if (ck) h.Cookie = ck;
    const r = await fetch(cur, { redirect: "manual", headers: h });
    jar.set(r, cur);
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

  // 第 4 步结束后的诊断：uid 拿到了但回调页没给 lzc 时，留个痕便于比对
  if (uid && !lzc) trace.push("lzc 缺失（第 5 步允许）");

  // 5. 换 token（casual 在此与这次会话绑定）
  const casual = generateCasual(16);
  const loginOther = `${ZHXG}/znzhxgpt/basesys/rbac-yh/login-other`;
  const r5 = await fetch(loginOther, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      deviceType: "4",
      AppCode: "znzhxgpt",
      "User-Agent": UA_MOBILE,
      Origin: ZHXG,
      Referer: ZHXG + "/znzhxgpt_h5/",
      // 这一跳同样要带上会话：login-other 会用服务端会话核对 uid 是否刚通过认证
      Cookie: jar.header(loginOther),
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

  const tgt = jar.value("CASTGC");
  return {
    token: j.data.token,
    casual,
    ...(tgt ? { castgc: tgt } : {}),
    user: { xh: j.data.yhzh, xm: j.data.yhxm, bmid: j.data.bmid, bmmc: readBmmc(j.data.token) },
  };
}

/**
 * 用 CASTGC 免密换票 —— 云端形态真正可用的自动登录入口。
 *
 * 密码登录成功时 CAS 会签发 CASTGC（rememberMe=true 的 TGT）。带着它直接 GET
 * 登录页，CAS 认「这个客户端已经认证过」，立刻 302 回 service?ticket=：不经过
 * 密码、不会进二次认证，第 4、5 步与密码登录完全一致。
 *
 * 所以云端只需要保存这一枚 cookie：
 *   - 比存密码安全 —— 没有密码，随时可以在浏览器里「退出登录」把它作废；
 *   - 比存 token 耐用 —— token 约 24 小时，CASTGC 有数天，且每次都能换出新 token;
 *   - 出口无关 —— 换票是一次 GET，不发凭据，不触发密码风控。
 *
 * cookie 按原样接收（形如 "CASTGC=…; JSESSIONID=…"）：只有 CASTGC 必需，
 * 其余项带上无碍，缺失的由回调过程自己补。
 */
export async function castgcLogin(cookie: string): Promise<LoginResult> {
  const raw = String(cookie || "").trim();
  if (!raw) throw new Error("没有拿到 CASTGC —— 请从浏览器复制一次再导入");

  const jar = new Jar();
  jar.seed(raw, "ca.csu.edu.cn");
  const loginUrl = `${CAS}/authserver/login?service=${encodeURIComponent(SERVICE)}`;
  const res = await fetch(loginUrl, {
    redirect: "manual",
    headers: { "User-Agent": UA_DESKTOP, Cookie: jar.header(loginUrl) },
  });
  jar.set(res, loginUrl);

  if (res.status === 200) {
    const html = await res.text();
    if (isGatewayBlock(html)) {
      throw new RetryableLoginError(
        "统一认证这一次没返回跳转，而是学校网关的「仅限校园网访问」提示页 —— 这个出口 IP 不在校园网允许范围内。"
      );
    }
    throw new Error(
      "CASTGC 已经不被认可：统一认证没有换票，而是把登录页又发了一次（" +
        html.length +
        " 字节）。它通常只有几天有效期，过期或在浏览器里退出过登录就会这样 —— 重新导入一次即可。"
    );
  }

  const loc = res.headers.get("location") || "";
  if (!loc) {
    throw new Error("CASTGC 换票没有落到任何地址（status=" + res.status + "），请重新导入一次");
  }

  try {
    return await finishWithTicket(loc, jar);
  } catch (e) {
    /*
     * 这一层要改写可重试类的文案：对密码登录来说「被退回登录页」是会话令牌的
     * 瞬时错乱，重走一遍就好；对 CASTGC 来说它只意味着一件事 —— 这枚凭据不再被认。
     */
    if (e instanceof RetryableLoginError) {
      throw new Error(
        "CASTGC 没有换来票据：" + e.message + "导入的会话大概率已经过期或被注销，重新导入一次即可。"
      );
    }
    throw e;
  }
}

/**
 * 对外入口：把瞬时失败吃掉，最多重试一次。
 *
 * 只重试 RetryableLoginError，即会话层的瞬时失败：
 *   出口 IP 被学校网关拦下（拿不到登录页，或拿到「仅限校园网访问」提示页）/
 *   提交后 CAS 以 302 退回登录页（表单令牌与本次会话对不上）。
 * 出口 IP 被拦是持续性的，重试救不了 —— 所以第二次仍失败时会明确告诉用户改用官方页面。
 * 账号密码与验证码走的是另一条路径（CAS 回 200 + 登录页正文），不重试 ——
 * 免得把用户一次输错变成两次无效提交，也免得推高失败次数触发验证码。
 */
export async function protocolLogin(username: string, password: string): Promise<LoginResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await protocolLoginOnce(username, password);
    } catch (e) {
      if (!(e instanceof RetryableLoginError) || attempt >= 1) {
        if (e instanceof RetryableLoginError) {
          // 重试也没过，说明不是会话令牌的问题，而是这次登录本身不被接受
          throw new Error(e.message + " 已经重试过一次仍未通过，请改用官方页面登录一次。");
        }
        throw e;
      }
      // 网关拦截与 flow execution 失效都是瞬时的，退一步再走一遍完整流程
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}
