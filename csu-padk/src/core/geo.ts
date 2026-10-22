/**
 * 落点算法
 *
 * 约束（来自服务端实测数据）：
 *   - 围栏圆心 = 学生本人所住宿舍楼坐标（kqfwxx[0].kqdz = "学生所住宿舍楼栋坐标（自动取）"）
 *   - 围栏半径 = 300 米（全校统一）
 *   - 打卡窗口 20:00 - 23:30
 *
 * 目标：
 *   1) 每次落点在围栏内，服务端 jcqqwzsjsfndk 必过
 *   2) 落点落在真实楼栋附近（视觉合理，不会飘到水里）
 *   3) 每次不重合、不总是同一处
 */
import type { Building } from "./api";

const R_EARTH = 6371008.8;

export function toRad(d: number) {
  return (d * Math.PI) / 180;
}
export function toDeg(r: number) {
  return (r * 180) / Math.PI;
}

/** 两点球面距离（米） */
export function distanceM(
  a: { jd: number; wd: number },
  b: { jd: number; wd: number }
): number {
  const dLat = toRad(b.wd - a.wd);
  const dLng = toRad(b.jd - a.jd);
  const la1 = toRad(a.wd);
  const la2 = toRad(b.wd);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 以 origin 为圆心，在 [minR, maxR] 米、随机方位角处取点
 */
export function offsetPoint(
  origin: { jd: number; wd: number },
  minR: number,
  maxR: number,
  angleRad?: number
): { jd: number; wd: number; dist: number; angle: number } {
  const angle = angleRad ?? Math.random() * Math.PI * 2;
  // 面积均匀采样（sqrt 避免中心过密）
  const t = Math.random();
  const dist = Math.sqrt(minR * minR + t * (maxR * maxR - minR * minR));

  const dLat = (dist * Math.cos(angle)) / 111320;
  const dLng = (dist * Math.sin(angle)) / (111320 * Math.cos(toRad(origin.wd)));

  return {
    jd: +(origin.jd + dLng).toFixed(7),
    wd: +(origin.wd + dLat).toFixed(7),
    dist,
    angle,
  };
}

export interface LandingOptions {
  /** 围栏半径（米），默认 300 */
  fenceRadius?: number;
  /** 落点距楼栋的最小 / 最大偏移（米） */
  minOffset?: number;
  maxOffset?: number;
  /** 与历史落点的最小间隔（米），保证"不重合" */
  minSeparation?: number;
  /** 邻居楼栋搜索半径（米） */
  neighborRadius?: number;
  /** 连续避免使用的最近楼栋数 */
  avoidRecentBuildings?: number;
}

export interface Landing {
  jd: number;
  wd: number;
  /** 落点所依托的楼栋 */
  building: Building;
  buildingName: string;
  /** 落点相对楼栋的偏移距离（米） */
  offset: number;
  /** 落点相对围栏圆心的距离（米） */
  distFromCenter: number;
  angle: number;
  createdAt: number;
}

/** 用楼栋坐标构造，过滤掉无坐标的 */
export function normalizeBuildings(list: Building[]): Building[] {
  return (list ?? []).filter(
    (b) => b && b.jd && b.wd && isFinite(+b.jd) && isFinite(+b.wd)
  );
}

/**
 * 找"可打卡地点"候选池：
 *   以用户楼栋坐标为中心，取 neighborRadius 内的所有楼栋（含自身）
 */
export function candidatePool(
  all: Building[],
  center: { jd: number; wd: number },
  neighborRadius = 250
): Building[] {
  const pool = all.filter((b) => {
    const d = distanceM(center, { jd: +b.jd, wd: +b.wd });
    return d <= neighborRadius;
  });
  // 至少保证自身在内
  return pool.length ? pool : all.slice(0, 1);
}

/**
 * 生成一个落点
 *
 * @param all        全部楼栋
 * @param center     围栏圆心（= 用户宿舍楼坐标）
 * @param history    历史落点（用于去重）
 * @param recentBld  最近用过的楼栋 id（用于轮换）
 */
export function generateLanding(
  all: Building[],
  center: { jd: number; wd: number },
  history: Landing[] = [],
  recentBld: string[] = [],
  opts: LandingOptions = {}
): Landing {
  const {
    fenceRadius = 300,
    minOffset = 15,
    maxOffset = 90,
    minSeparation = 45,
    neighborRadius = 250,
    avoidRecentBuildings = 2,
  } = opts;

  const pool = candidatePool(all, center, neighborRadius);

  // 排除最近刚用过的楼栋，优先轮换
  const fresh = pool.filter((b) => !recentBld.slice(0, avoidRecentBuildings).includes(b.id));
  const usable = fresh.length ? fresh : pool;

  const fits = (jd: number, wd: number) => {
    // 围栏内留 20m 余量
    if (distanceM(center, { jd, wd }) > fenceRadius - 20) return false;
    // 与历史落点保持间隔
    return history.every((h) => distanceM({ jd, wd }, h) >= minSeparation);
  };

  let best: Landing | null = null;
  let bestScore = -1;

  const TRIES = 60;
  for (let i = 0; i < TRIES; i++) {
    const b = usable[Math.floor(Math.random() * usable.length)];
    const bc = { jd: +b.jd, wd: +b.wd };
    const p = offsetPoint(bc, minOffset, maxOffset);
    const dCenter = distanceM(center, p);

    const ok = fits(p.jd, p.wd);
    // 打分：合规优先；其次离围栏中心稍远一点（更"有位移感"），但不超过安全线
    const score = (ok ? 1000 : 0) + Math.min(dCenter, fenceRadius - 30);
    if (score > bestScore) {
      bestScore = score;
      best = {
        jd: p.jd,
        wd: p.wd,
        building: b,
        buildingName: `${b.xqmc}·${b.ldmc}`,
        offset: +p.dist.toFixed(1),
        distFromCenter: +dCenter.toFixed(1),
        angle: +toDeg(p.angle).toFixed(1),
        createdAt: Date.now(),
      };
    }
    if (score >= 1000 && ok) break; // 命中即用
  }

  // 兜底：极端情况下直接用圆心
  return (
    best ?? {
      jd: center.jd,
      wd: center.wd,
      building: usable[0],
      buildingName: usable[0] ? `${usable[0].xqmc}·${usable[0].ldmc}` : "未知楼栋",
      offset: 0,
      distFromCenter: 0,
      angle: 0,
      createdAt: Date.now(),
    }
  );
}

/** 在候选楼栋里找离给定坐标最近的一栋 */
export function nearestBuilding(
  all: Building[],
  pos: { jd: number; wd: number }
): { building: Building; distance: number } | null {
  let best: { building: Building; distance: number } | null = null;
  for (const b of all) {
    const d = distanceM(pos, { jd: +b.jd, wd: +b.wd });
    if (!best || d < best.distance) best = { building: b, distance: d };
  }
  return best;
}

/** 复刻 H5 端 wgs84 -> gcj02（浏览器定位拿到的坐标要转成火星坐标） */
export function wgs84ToGcj02(lng: number, lat: number): { jd: number; wd: number } {
  const outOfChina = lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
  if (outOfChina) return { jd: lng, wd: lat };
  const a = 6378245.0;
  const ee = 0.00669342162296594323;

  const transformLat = (x: number, y: number) => {
    let ret =
      -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
    ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
    return ret;
  };
  const transformLng = (x: number, y: number) => {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
    ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
    return ret;
  };

  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { jd: +(lng + dLng).toFixed(7), wd: +(lat + dLat).toFixed(7) };
}
