/**
 * 凭据存取 —— 全仓库唯一的 token / casual 入口
 *
 * 为什么必须集中：
 *   postDes 的 body 是 DES-ECB(JSON, key=casual) 的 Hex，服务端用
 *   「当前会话绑定的 casual」解密。casual 是登录时前端生成、随
 *   login-other 一起提交并与该次会话绑定的 —— 它和 token 是同一时刻的
 *   一对，拆开取就可能配上别的会话的 casual，服务端解不开 → 400。
 *
 * 旧实现 getToken() / getCasual() 各自独立扫 sessionStorage 再扫
 * localStorage，两次 `||` 短路互不知情：token 可能来自 localStorage 而
 * casual 来自 sessionStorage，配上不同会话是必然，不是偶发。
 *
 * 现在的规则：
 *   1. 登录成功时把 token + casual + agentId 打包成一个对象，写进同一个 key；
 *   2. 读取只从这一个对象整对取，缺一个就整体失败；
 *   3. 该 key 缺失时才回退去宿主页面里「同源捡取」，且两个值必须来自
 *      同一个 storage 的同一个对象，绝不跨 store 拼装。
 */

/** 自有凭据的存储键。与宿主页面的 token / casual 键完全隔离，互不覆盖 */
const CRED_KEY = "csu-padk:cred";

/**
 * 是否允许回退去宿主页面里捡取凭据。
 *
 * 书签注入形态下这是唯一来源 —— 页面就在 zhxg 域内，token / casual 是
 * 官方前端写下的，整页形态下也确实是当前这个学号的。
 *
 * 但整页与桌面形态不一样：localStorage 里可能残留**另一个学号**的官方
 * 会话（同一台电脑上别人登录过）。这时捡取会静默张冠李戴，比读不到更危险。
 * 所以由 PadkPage 在进入登录页时关掉，只有本工具自己登录写入的凭据才算数。
 */
let usePickHost = true;

/** 由宿主应用设置来源策略。整页 / 桌面形态在登录前必须关掉捡取 */
export function setCredSource(pickHost: boolean): void {
  usePickHost = pickHost;
}

/** token 是 RS256 JWT，长度远超此值；casual 固定 16 位 */
const TOKEN_MIN = 32;
const CASUAL_RE = /^[A-Za-z0-9]{16}$/;
const TOKEN_RE = /^[A-Za-z0-9_\-./+=]+$/;

export interface Credential {
  token: string;
  casual: string;
  agentId?: string;
  /** 写入时刻 */
  at?: number;
  /** self = 本工具登录写入；host = 从官方页面同源捡取 */
  src?: "self" | "host";
}

export type CredFail = "no-cred" | "token-invalid" | "casual-invalid";

export interface CredResult {
  ok: boolean;
  cred: Credential | null;
  reason?: CredFail;
  /** 给用户看的一句话，说明为什么不可用 */
  detail: string;
}

/* ───────────────── 基础设施 ───────────────── */

/** Node（e2e 脚本）里没有 window，回退到 globalThis 上的 mock */
function safeStorage(which: "local" | "session"): Storage | null {
  try {
    const g: any = typeof window !== "undefined" ? window : globalThis;
    return which === "local" ? g.localStorage : g.sessionStorage;
  } catch {
    return null;
  }
}

/** uni-app 的 H5 storage 会把值包成 {"type":"string","data":"…"} */
function unwrap(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/^"|"$/g, "");
  if (!t) return null;
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t) as any;
      if (o && typeof o === "object" && typeof o.data === "string") return o.data.trim();
    } catch {
      /* 不是 JSON 包装，按原值用 */
    }
  }
  return t;
}

export function isToken(v: string | null | undefined): v is string {
  return !!v && v.length >= TOKEN_MIN && !/\s/.test(v) && TOKEN_RE.test(v);
}

export function isCasual(v: string | null | undefined): v is string {
  return !!v && CASUAL_RE.test(v);
}

function validate(c: Credential, src: "self" | "host"): CredResult {
  // 长度先在收窄之前取好：isToken / isCasual 是类型谓词，
  // 否定分支里 c.token 会被收窄成 never，再读属性就编译不过
  const tLen = (c.token ?? "").length;
  const cLen = (c.casual ?? "").length;
  if (!isToken(c.token)) {
    return {
      ok: false,
      cred: null,
      reason: "token-invalid",
      detail: `token 不是合法 JWT（当前 ${tLen} 字符）`,
    };
  }
  if (!isCasual(c.casual)) {
    return {
      ok: false,
      cred: null,
      reason: "casual-invalid",
      detail: `casual 必须是 16 位字母数字（当前 ${cLen} 位）`,
    };
  }
  return {
    ok: true,
    cred: { ...c, src },
    detail: src === "self" ? "本工具登录的凭据" : "官方页面的凭据",
  };
}

/* ───────────────── 自有凭据 ───────────────── */

function readOwn(): Credential | null {
  for (const which of ["local", "session"] as const) {
    const s = safeStorage(which);
    if (!s) continue;
    const raw = s.getItem(CRED_KEY);
    if (!raw) continue;
    try {
      const o = JSON.parse(raw) as any;
      if (o && typeof o.token === "string" && typeof o.casual === "string") {
        return {
          token: o.token,
          casual: o.casual,
          agentId: typeof o.agentId === "string" ? o.agentId : "",
          at: typeof o.at === "number" ? o.at : undefined,
          src: "self",
        };
      }
    } catch {
      /* 坏数据，继续找下一个 store */
    }
  }
  return null;
}

/**
 * 从一段 JSON 文本里找**同一个对象**内的 token + casual 对。
 * 这是关键：不允许「token 取自 A 对象、casual 取自 B 对象」。
 */
function pickPair(raw: string, depth = 0): Credential | null {
  if (depth > 4) return null;
  const t = raw.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;

  let o: any;
  try {
    o = JSON.parse(t);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;

  if (!Array.isArray(o)) {
    const tok = unwrap(o.token);
    const cas = unwrap(o.casual) ?? unwrap(o.caasual);
    if (tok && cas) {
      return { token: tok, casual: cas, agentId: unwrap(o.agentId) ?? "", src: "host" };
    }
  }

  for (const v of Object.values(o)) {
    if (typeof v === "string") {
      const hit = pickPair(v, depth + 1);
      if (hit) return hit;
    } else if (v && typeof v === "object") {
      const hit = pickPair(JSON.stringify(v), depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** 从宿主页面的 storage 里同源捡取（自有凭据不存在时才走这条路） */
function pickHostCred(): Credential | null {
  for (const which of ["local", "session"] as const) {
    const s = safeStorage(which);
    if (!s) continue;

    // ① 平铺键：官方 H5 就是这么存的。两个键必须在同一个 storage 里。
    const flatT = unwrap(s.getItem("token"));
    const flatC = unwrap(s.getItem("casual")) ?? unwrap(s.getItem("caasual"));
    if (flatT && flatC) {
      return { token: flatT, casual: flatC, agentId: unwrap(s.getItem("agentId")) ?? "", src: "host" };
    }

    // ② 嵌套 JSON：同一个 key 的同一个对象里必须同时含 token 与 casual
    let n = 0;
    try {
      n = s.length;
    } catch {
      n = 0;
    }
    for (let i = 0; i < n; i++) {
      let k: string | null = null;
      try {
        k = s.key(i);
      } catch {
        break;
      }
      if (!k || k === CRED_KEY) continue;
      const raw = s.getItem(k);
      if (!raw || !/"?\b(token|casual|caasual)\b"?\s*:/.test(raw)) continue;
      const hit = pickPair(raw);
      if (hit) return hit;
    }
  }
  return null;
}

/* ───────────────── 对外 ───────────────── */

/** 读取凭据。这是唯一入口 —— 不要在别处直接摸 storage 里的 token / casual */
export function readCred(): CredResult {
  const own = readOwn();
  if (own) return validate(own, "self");

  const host = usePickHost ? pickHostCred() : null;
  if (host) return validate(host, "host");

  return { ok: false, cred: null, reason: "no-cred", detail: "未找到会话凭据" };
}

/** 登录成功后写入。格式不合法就整体拒绝，绝不写半截 */
export function writeCred(c: { token: string; casual: string; agentId?: string }): CredResult {
  const cred: Credential = {
    token: c.token,
    casual: c.casual,
    agentId: c.agentId ?? "",
    at: Date.now(),
    src: "self",
  };
  const r = validate(cred, "self");
  if (!r.ok) return r;

  const raw = JSON.stringify(cred);
  for (const which of ["local", "session"] as const) {
    const s = safeStorage(which);
    if (!s) continue;
    try {
      s.setItem(CRED_KEY, raw);
    } catch {
      /* 隐私模式 / 配额，忽略 */
    }
  }
  return { ok: true, cred, detail: "凭据已写入" };
}

/** 清除自有凭据。宿主页面的 token / casual 不动 —— 那是官方会话的 */
export function clearCred(): void {
  for (const which of ["local", "session"] as const) {
    const s = safeStorage(which);
    if (!s) continue;
    try {
      s.removeItem(CRED_KEY);
    } catch {
      /* ignore */
    }
  }
}

/* ── 兼容旧名字（e2e 脚本与部分调用点仍在用） ── */

export function getToken(): string | null {
  return readCred().cred?.token ?? null;
}

export function getCasual(): string | null {
  return readCred().cred?.casual ?? null;
}

export function getAgentId(): string {
  return readCred().cred?.agentId ?? "";
}
