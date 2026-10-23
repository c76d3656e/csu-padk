/**
 * 接口层 —— 全部请求在宿主域内同源发出，token 只留在用户浏览器本地
 *
 * 路径规则（实测）：
 *   外部入口  https://zhxg.csu.edu.cn/znzhxgpt/<模块>/<接口>
 *   nginx 剥离 /znzhxgpt 后按模块路由到对应微服务
 */
import { encryptPayload } from "./crypto";

// 凭据只从 core/cred.ts 取 —— 那里保证 token 与 casual 成对来自同一次会话。
// 历史调用点（Panel / e2e 脚本）继续用这些名字，实现已换成整对读取。
export {
  readCred,
  writeCred,
  clearCred,
  setCredSource,
  setManualCred,
  isToken,
  isCasual,
  getToken,
  getCasual,
  getAgentId,
} from "./cred";
export type { Credential, CredResult, CredFail } from "./cred";

/**
 * 请求基址（运行时求值，不能做成模块级常量）
 *
 * ES 模块的 import 会先于模块体执行，若写成 `const ORIGIN = ...`，
 * 宿主还没机会设置 __PADK_ORIGIN__ 就已经算完了。
 *
 *   站点形态（index.html 里置空）：由同源服务转发，浏览器侧仍是同源
 *   没有这个变量时（直接跑源码调试）：直连 zhxg.csu.edu.cn
 */
export function getOrigin(): string {
  const w = typeof window !== "undefined" ? (window as any) : null;
  return w && w.__PADK_ORIGIN__ !== undefined ? w.__PADK_ORIGIN__ : "https://zhxg.csu.edu.cn";
}

/** 各模块 base（对应 H5 端 API_BASE_xxx） */
export const API = {
  qxj: "/znzhxgpt/qxj",
  ssgl: "/znzhxgpt/ssgl",
  basesys: "/znzhxgpt/basesys",
} as const;

export const EP = {
  /** 打卡班次 / 时间窗 / 围栏 */
  dkbc: `${API.qxj}/qxj-padkglxx/queryKqDkbc`,
  /** 围栏校验（服务端判距离） */
  checkLoc: `${API.qxj}/qxj-padkglxx/jcqqwzsjsfndk`,
  /** 提交打卡 */
  punch: `${API.qxj}/qxj-padkglxx/xspadk`,
  /** 我的考勤记录 */
  myRecords: `${API.qxj}/qxj-padkglxx/queryPadkKqAyListByXh`,
  /** 宿舍楼栋（含经纬度） */
  buildings: `${API.ssgl}/ss-ldxx/findLdzbCjList`,
} as const;

/* ───────────────── 请求封装 ───────────────── */

/**
 * 400 的真实含义。
 *
 * 实测（2026-10，对 /qxj/qxj-padkglxx/queryKqDkbc 发假凭据）：服务端回的是
 * Spring 默认错误体 ——
 *   {"timestamp":"…","status":400,"error":"Bad Request","path":"/qxj/…"}
 * 里面**没有** casual / 密钥 / 密文 任何字样。所以别指望从 body 反推出原因，
 * 只能如实呈现原文，并给出最可能的两类解释；同时把 path 挑出来 —— 它证明
 * 请求确实打到了后端（路由存在、不是 405/404 那一类）。
 */
function describe400(body: string): string {
  const raw = (body || "").trim().slice(0, 200);
  let path = "";
  let msg = "";
  try {
    const j = JSON.parse(raw);
    if (typeof j?.path === "string") path = j.path;
    if (typeof j?.message === "string") msg = j.message;
  } catch {
    /* 不是 JSON：当纯文本处理 */
  }

  const hint = `${msg} ${raw}`;
  if (/casual|密钥|密文|解密|decrypt/i.test(hint)) {
    return `加密密钥 casual 与当前会话不匹配，请重新登录（服务端：${msg || raw}）`;
  }
  const where = path ? `（${path}）` : "";
  return (
    `请求被拒绝：HTTP 400${where}。最可能是这次请求的密文与当前登录会话不同源` +
    `（token 与 casual 来自两次登录），其次是请求体不是合法密文。` +
    `服务端原文：${raw || "（空）"}`
  );
}

export interface ApiResult<T = any> {
  code: string;
  message: string;
  data: T;
}

export class ApiError extends Error {
  code?: string;
  constructor(msg: string, code?: string) {
    super(msg);
    this.code = code;
  }
}

export interface RequestCtx {
  token: string;
  casual: string;
  agentId?: string;
}

export async function postDes<T = any>(
  path: string,
  payload: unknown,
  ctx: RequestCtx
): Promise<ApiResult<T>> {
  const body = encryptPayload(payload, ctx.casual);

  /*
   * 网络层失败要翻译成人话。
   *
   * fetch 只在「响应无法被接受」时 reject，抛的是 TypeError: Failed to fetch
   * —— 这个字符串对使用者毫无信息量，历史上让人误以为是接口挂了。它实际
   * 覆盖的是：服务没起来、连接被中断、响应头与实体自相矛盾（如声称 gzip 却
   * 回明文）等等。这里补上目标地址与常见成因，让它自己说明白。
   */
  const url = getOrigin() + path;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        deviceType: "4",
        AppCode: "znzhxgpt",
        Authorization: ctx.token,
        token: ctx.token,
        agentId: ctx.agentId ?? "",
      },
      body,
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new ApiError(
      `请求没能到达服务：${why}\n` +
        `目标 ${url}。若本机服务已关掉就重新打开一次；` +
        `若服务在跑，多半是响应被中间层改坏了（压缩头与实际实体不符）。`,
      "network"
    );
  }

  if (res.status === 400)
    throw new ApiError(describe400(await res.text().catch(() => "")), "400");
  if (!res.ok && res.status !== 200)
    throw new ApiError(`HTTP ${res.status}`, String(res.status));

  const text = await res.text();

  let json: ApiResult<T>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError("响应不是合法 JSON：" + text.slice(0, 120));
  }

  if (json.code === "203") throw new ApiError("登录状态已失效，请重新登录", "203");
  // 单点登录互踢：同一账号在别处登录会导致此处 token 作废
  if (json.code === "2031")
    throw new ApiError("账号已在其他设备登录，需重新登录", "2031");
  if (json.code !== "200" && json.code !== "331") {
    throw new ApiError(json.message || "接口返回异常", json.code);
  }
  return json;
}

/** 是否为需要重新登录的错误 */
export function isAuthError(e: unknown): boolean {
  return e instanceof ApiError && (e.code === "203" || e.code === "2031");
}

/**
 * 是否为「密文被服务端拒绝」的 400。
 *
 * 注意这里判不了精确原因：服务端对 casual 错配只回一个通用 400，body 里
 * 没有任何可辨认的线索（见 describe400 的实测记录）。所以这是**按最可能的
 * 原因归类**，调用方必须再做一次「凭据是否真的变了」的确认才允许重放 ——
 * 见 Panel.refreshCredIfChanged：casual 没变就说明不是凭据问题，原样抛错。
 *
 * 这样归类的好处：宿主页面重登、被顶下线、切账号之后，casual 换了新值，
 * 面板手里的旧密钥就会让每个请求都 400。重新整对读一次即可自愈，
 * 不必把用户丢回登录页。
 */
export function isCasualMismatch(e: unknown): boolean {
  return e instanceof ApiError && e.code === "400";
}

/* ───────────────── 业务接口 ───────────────── */

export interface ShiftInfo {
  dksjfw: string;   // 打卡时间窗 20:00-23:30
  dksj: string | null;
  gz: string;       // 规则说明
  kdk: boolean;     // 当前可否打卡
  dkbc: string;     // 打卡班次名
  bkyy: string;     // 不可打卡原因
  kqfwxx: Array<{ mc: string; dkfw: number; jd: number | null; wd: number | null; kqdz?: string }>;
  sfydk: number;
  lx: number;
}

export interface Building {
  id: string;
  xqmc: string;   // 校区
  xqdm: string;
  ldmc: string;   // 楼栋名
  lddm: string;
  lcs?: string;   // 层数
  jd: string;     // 经度
  wd: string;     // 纬度
  qyzt?: number;
  zt?: number;
}

export interface CheckLocResult {
  canDk: boolean;
  msg: string;
  reason?: string;
  needExplain?: boolean;
  pcMi?: number;  // 偏差米数
  fwMi?: number;  // 范围米数
  yxMc?: string;
}

export const api = {
  /** 打卡班次与围栏配置 */
  async shift(ctx: RequestCtx) {
    return postDes<ShiftInfo>(EP.dkbc, {}, ctx);
  },

  /** 全部宿舍楼栋（含坐标） */
  async buildings(ctx: RequestCtx) {
    return postDes<{ list: Building[]; zs: number; xqList: string[] }>(EP.buildings, {}, ctx);
  },

  /** 围栏校验 */
  async checkLocation(ctx: RequestCtx, p: { jd: number; wd: number; dklb: string }) {
    return postDes<CheckLocResult>(EP.checkLoc, { paramsData: p }, ctx);
  },

  /**
   * 提交打卡
   *
   * 原站调用：studentDk({ jd, wd, dkbc, dkdz })
   *   studentDk = t => postDes(API_BASE_QXJ + "/qxj-padkglxx/xspadk", t, !0)
   * 注意：postDes 的第二个参数即请求体本身，这里**不做 paramsData 包装**
   * （与 jcqqwzsjsfndk 不同，那个调用方自己传了 {paramsData:{...}}）
   */
  async punch(
    ctx: RequestCtx,
    p: { jd: number; wd: number; dkbc: string; dkdz?: string; sfwcdk?: number }
  ) {
    const { sfwcdk, ...rest } = p;
    const payload: any = { ...rest };
    if (sfwcdk) payload.sfwcdk = sfwcdk;
    return postDes<{ msg?: string }>(EP.punch, payload, ctx);
  },

  /** 我的考勤记录 */
  async myRecords(ctx: RequestCtx, p: { pageNo?: number; pageSize?: number } = {}) {
    return postDes(EP.myRecords, { paramsData: { pageNo: 1, pageSize: 30, ...p } }, ctx);
  },
};

/* ───────────────── 围栏圆心探测 ───────────────── */

export interface ProbedCenter {
  jd: number;
  wd: number;
  /** 服务端返回的围栏半径 */
  radius?: number;
  /** 解算出的圆心与种子点的距离（米） */
  distance: number;
  /** 三个采样点的实测偏差 */
  samples: number[];
}

/**
 * 用围栏校验接口反推圆心（三边定位）
 *
 * jcqqwzsjsfndk 在打卡窗口内会返回 pcMi —— 提交点到围栏圆心的距离（米）。
 * 以此为半径做三次测量即可解出圆心：
 *
 *   以种子点 P 为原点，东为 x、北为 y
 *     P      → d1  ⇒  x² + y²         = d1²
 *     P+东 L → d2  ⇒  (x-L)² + y²     = d2²
 *     P+北 L → d3  ⇒  x² + (y-L)²     = d3²
 *
 *   相减得：x = (d1² - d2² + L²) / 2L
 *           y = (d1² - d3² + L²) / 2L
 *
 * 窗口外接口不返回 pcMi（只给「未到打卡时间」），此时返回 null。
 */
export async function probeFenceCenter(
  ctx: RequestCtx,
  dklb: string,
  seed: { jd: number; wd: number },
  spanM = 400
): Promise<ProbedCenter | null> {
  const toMeters = (p: { jd: number; wd: number }) => ({
    jdPerM: 1 / (111320 * Math.cos((p.wd * Math.PI) / 180)),
    wdPerM: 1 / 111320,
  });

  const measure = async (p: { jd: number; wd: number }) => {
    const r = await api.checkLocation(ctx, { jd: p.jd, wd: p.wd, dklb });
    const d: any = r.data;
    if (!d || typeof d !== "object") return null;
    return { pcMi: typeof d.pcMi === "number" ? d.pcMi : null, fwMi: d.fwMi, msg: d.msg };
  };

  const m = toMeters(seed);
  const east = { jd: seed.jd + spanM * m.jdPerM, wd: seed.wd };
  const north = { jd: seed.jd, wd: seed.wd + spanM * m.wdPerM };

  const a = await measure(seed);
  if (!a || a.pcMi == null) return null;
  const b = await measure(east);
  if (!b || b.pcMi == null) return null;
  const c = await measure(north);
  if (!c || c.pcMi == null) return null;

  const d1 = a.pcMi, d2 = b.pcMi, d3 = c.pcMi;
  const L = spanM;
  const x = (d1 * d1 - d2 * d2 + L * L) / (2 * L);
  const y = (d1 * d1 - d3 * d3 + L * L) / (2 * L);

  return {
    jd: +(seed.jd + x * m.jdPerM).toFixed(7),
    wd: +(seed.wd + y * m.wdPerM).toFixed(7),
    radius: typeof a.fwMi === "number" ? a.fwMi : undefined,
    distance: +Math.hypot(x, y).toFixed(1),
    samples: [d1, d2, d3],
  };
}
