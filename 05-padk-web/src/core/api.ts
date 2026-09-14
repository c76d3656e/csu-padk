/**
 * 接口层 —— 全部请求在宿主域内同源发出，token 只留在用户浏览器本地
 *
 * 路径规则（实测）：
 *   外部入口  https://zhxg.csu.edu.cn/znzhxgpt/<模块>/<接口>
 *   nginx 剥离 /znzhxgpt 后按模块路由到对应微服务
 */
import { encryptPayload } from "./crypto";
import { invoke } from "@tauri-apps/api/core";

/**
 * 是否跑在 Tauri 桌面壳里。
 *
 * 两种形态的差别只在「谁来发请求」：
 *   桌面 —— Rust 侧发，没有同源策略这回事
 *   浏览器 —— 由本地服务同源代理转发
 * 业务逻辑与响应解析完全共用。
 */
export const IS_TAURI =
  typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

/**
 * 请求基址（运行时求值，不能做成模块级常量）
 *
 * ES 模块的 import 会先于模块体执行，若写成 `const ORIGIN = ...`，
 * 宿主还没机会设置 __PADK_ORIGIN__ 就已经算完了。
 *
 *   正式场景（书签注入）：页面本身就在 zhxg.csu.edu.cn，同源直连
 *   本地调试（打卡页 / host.html）：置空 → 走 Vite 反向代理，浏览器侧仍是同源
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

/* ───────────────── 本地凭据读取（不落任何服务器） ───────────────── */

function deepFind(obj: any, keys: string[], depth = 0): string | null {
  if (!obj || depth > 4) return null;
  if (typeof obj === "string") {
    const t = obj.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return deepFind(JSON.parse(t), keys, depth + 1);
      } catch {
        return null;
      }
    }
    return null;
  }
  if (typeof obj !== "object") return null;
  for (const k of keys) {
    if (typeof obj[k] === "string" && obj[k]) return obj[k];
  }
  for (const v of Object.values(obj)) {
    const r = deepFind(v, keys, depth + 1);
    if (r) return r;
  }
  return null;
}

/**
 * @param minLen 最小有效长度。token(JWT) 很长；casual 只有 16 字符，不能一刀切
 */
function scanStorage(store: Storage, keys: string[], minLen: number): string | null {
  try {
    for (const k of keys) {
      const raw = store.getItem(k);
      if (!raw) continue;
      const t = raw.trim().replace(/^"|"$/g, "");
      if (t.length >= minLen) return t;
    }
    for (let i = 0; i < store.length; i++) {
      const name = store.key(i);
      if (!name) continue;
      const raw = store.getItem(name) ?? "";
      if (!raw) continue;
      const hit = deepFind(raw, keys);
      if (hit && hit.length >= minLen) return hit;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** token：PC 端存 sessionStorage，H5 端存 localStorage（RS256 JWT，约 1KB） */
export function getToken(): string | null {
  return (
    scanStorage(sessionStorage, ["token"], 32) ||
    scanStorage(localStorage, ["token"], 32)
  );
}

/** casual：postDes 的 DES 密钥，登录时由前端生成并提交给服务端（16 字符） */
export function getCasual(): string | null {
  return (
    scanStorage(sessionStorage, ["casual", "caasual"], 8) ||
    scanStorage(localStorage, ["casual", "caasual"], 8)
  );
}

export function getAgentId(): string {
  return scanStorage(sessionStorage, ["agentId"], 1) ?? "";
}

/* ───────────────── 请求封装 ───────────────── */

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

  let text: string;

  if (IS_TAURI) {
    // 桌面形态：请求由 Rust 侧发出。
    // 进程内的 HTTP 客户端不受同源策略约束 —— 跨域、预检、代理都不存在了。
    try {
      text = await invoke<string>("api_post", {
        args: { path, token: ctx.token, body, agentId: ctx.agentId ?? "" },
      });
    } catch (e) {
      throw new ApiError(String(e));
    }
  } else {
    const res = await fetch(getOrigin() + path, {
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

    if (res.status === 400)
      throw new ApiError("请求被拒绝（加密密钥 casual 不匹配，请重新登录）", "400");
    if (!res.ok && res.status !== 200)
      throw new ApiError(`HTTP ${res.status}`, String(res.status));

    text = await res.text();
  }

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
