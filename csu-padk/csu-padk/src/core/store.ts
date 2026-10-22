/**
 * 本地状态 —— 全部存于用户浏览器 localStorage，绝不上传
 */
import type { Landing } from "./geo";

const PREFIX = "csu-padk:";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* 存储满/隐私模式，忽略 */
  }
}

export interface Settings {
  /** 用户指定的宿舍楼 id（= 围栏圆心） */
  buildingId: string;
  /** 手动指定的圆心坐标（覆盖楼栋坐标） */
  centerOverride: { jd: number; wd: number } | null;
  /** 落点距楼栋的偏移范围（米） */
  minOffset: number;
  maxOffset: number;
  /** 与历史落点的最小间隔（米） */
  minSeparation: number;
  /** 邻居楼栋搜索半径（米） */
  neighborRadius: number;
  /** 是否走"外出打卡"分支 */
  useOutdoor: boolean;
  /** 自动打卡时刻（可选，仅本地提醒用） */
  autoTime: string;
  /** 界面浮层收起状态 */
  collapsed: boolean;
  /** 浮层位置 */
  pos: { x: number; y: number } | null;
}

export const DEFAULT_SETTINGS: Settings = {
  buildingId: "",
  centerOverride: null,
  minOffset: 15,
  maxOffset: 90,
  minSeparation: 45,
  neighborRadius: 250,
  useOutdoor: false,
  autoTime: "",
  collapsed: false,
  pos: null,
};

export const store = {
  getSettings(): Settings {
    return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>("settings", {}) };
  },
  setSettings(patch: Partial<Settings>) {
    const next = { ...this.getSettings(), ...patch };
    write("settings", next);
    return next;
  },

  getHistory(): Landing[] {
    return read<Landing[]>("history", []);
  },
  pushHistory(l: Landing, keep = 40) {
    const h = [l, ...this.getHistory()].slice(0, keep);
    write("history", h);
    return h;
  },
  clearHistory() {
    write("history", []);
  },

  /** 最近使用过的楼栋 id（用于轮换，避免连续同一栋） */
  getRecentBuildings(): string[] {
    return read<string[]>("recentBld", []);
  },
  pushRecentBuilding(id: string, keep = 4) {
    const r = [id, ...this.getRecentBuildings().filter((x) => x !== id)].slice(0, keep);
    write("recentBld", r);
  },

  /** 最近一次打卡结果（用于回显） */
  getLastPunch(): { at: number; jd: number; wd: number; dz: string; ok: boolean } | null {
    return read("lastPunch", null as any);
  },
  setLastPunch(v: { at: number; jd: number; wd: number; dz: string; ok: boolean }) {
    write("lastPunch", v);
  },

  /** 缓存的楼栋列表，避免每次拉取 */
  getBuildingsCache(): { at: number; list: any[] } | null {
    return read("bldCache", null as any);
  },
  setBuildingsCache(list: any[]) {
    write("bldCache", { at: Date.now(), list });
  },
};
