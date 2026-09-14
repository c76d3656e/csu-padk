import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  getCasual,
  getToken,
  getAgentId,
  isAuthError,
  probeFenceCenter,
  type Building,
  type RequestCtx,
  type ShiftInfo,
  ApiError,
} from "../core/api";
import { generateLanding, nearestBuilding, normalizeBuildings, distanceM, wgs84ToGcj02, type Landing } from "../core/geo";
import { store, type Settings } from "../core/store";
import { TILE_SOURCES, DEFAULT_TILE } from "../core/map/tiles";

// 地图是重资产（~150KB），仅在用户点开时才拉取 —— bundle-dynamic-imports
const MapView = lazy(() => import("../core/map/MapView"));

type LogKind = "i" | "s" | "e" | "w";
interface LogItem { t: string; kind: LogKind; msg: string }

const hhmmss = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });

export interface PanelProps {
  /** true = 整页形态（独立打卡页）；false = 浮动面板（书签注入） */
  pageMode?: boolean;
  /** 凭据失效（203 / 2031）时回调，由宿主决定是否回到登录页 */
  onAuthError?: (message: string) => void;
}

export default function Panel({ pageMode = false, onAuthError }: PanelProps) {
  const [settings, setSettings] = useState<Settings>(() => store.getSettings());
  const [ctx, setCtx] = useState<RequestCtx | null>(null);
  const [shift, setShift] = useState<ShiftInfo | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [landing, setLanding] = useState<Landing | null>(null);
  /** 落点是否为手动指定（区别于自动生成） */
  const [landingManual, setLandingManual] = useState(false);
  /** 地图点击的作用目标 */
  const [mapClickTarget, setMapClickTarget] = useState<"center" | "landing">("landing");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [done, setDone] = useState<{ at: number; jd: number; wd: number; dz: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [collapsed, setCollapsed] = useState(settings.collapsed);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(settings.pos);
  const [showMap, setShowMap] = useState(false);
  const [tileId, setTileId] = useState(DEFAULT_TILE);

  /**
   * 两种打卡模式
   *   live    实时定位 —— 人在宿舍时用这个，前端无需知道围栏圆心
   *   virtual 虚拟落点 —— 不在校时用，需先确定圆心（选宿舍楼）
   */
  const [mode, setMode] = useState<"live" | "virtual">("live");
  const [livePos, setLivePos] = useState<{
    jd: number;
    wd: number;
    acc?: number;
    /** 定位点最近的宿舍楼，用于明确告知用户"你在哪" */
    nearest?: { id: string; name: string; distance: number };
  } | null>(null);
  const [locating, setLocating] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const log = useCallback((kind: LogKind, msg: string) => {
    setLogs((prev) => [...prev.slice(-60), { t: hhmmss(), kind, msg }]);
  }, []);

  // 回调收进 ref，bootstrap 不因父组件重渲染而重建
  const authErrRef = useRef(onAuthError);
  authErrRef.current = onAuthError;

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  /* ── 应用自定义位置 ── */
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !pos) return;
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.left = pos.x + "px";
    el.style.top = pos.y + "px";
  }, [pos]);

  /* ── 拖拽 ── */
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const onHeadDown = (e: React.MouseEvent) => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };

    const move = (ev: MouseEvent) => {
      const nx = Math.max(4, Math.min(window.innerWidth - 120, ev.clientX - dragRef.current!.dx));
      const ny = Math.max(4, Math.min(window.innerHeight - 60, ev.clientY - dragRef.current!.dy));
      el.style.right = "auto";
      el.style.bottom = "auto";
      el.style.left = nx + "px";
      el.style.top = ny + "px";
    };
    const up = () => {
      const r2 = el.getBoundingClientRect();
      const p = { x: r2.left, y: r2.top };
      setPos(p);
      store.setSettings({ pos: p });
      dragRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  /* ── 初始化 ── */
  const bootstrap = useCallback(async () => {
    const token = getToken();
    const casual = getCasual();
    if (!token) {
      log("e", "未读到 token —— 请先在本站登录（页面需处于已登录状态）");
      return;
    }
    if (!casual) {
      log("e", "未读到 casual —— postDes 加密密钥缺失，请重新登录一次");
      return;
    }
    const c: RequestCtx = { token, casual, agentId: getAgentId() };
    setCtx(c);
    log("s", `凭据就绪 token=${token.slice(0, 16)}… casual=${casual}`);

    try {
      const [s, b] = await Promise.allSettled([api.shift(c), api.buildings(c)]);

      // 凭据失效优先处理：交给宿主决定是否回登录页
      const bad = [s, b].find(
        (r) => r.status === "rejected" && isAuthError((r as PromiseRejectedResult).reason)
      );
      if (bad) {
        const reason = (bad as PromiseRejectedResult).reason as ApiError;
        log("e", reason.message);
        authErrRef.current?.(reason.message);
        return;
      }

      if (s.status === "fulfilled") {
        setShift(s.value.data);
        log("i", `班次「${s.value.data.dkbc}」 时间窗 ${s.value.data.dksjfw} 可打卡=${s.value.data.kdk}${s.value.data.bkyy ? " (" + s.value.data.bkyy + ")" : ""}`);
      } else {
        log("e", "班次查询失败：" + (s.reason?.message ?? s.reason));
      }
      if (b.status === "fulfilled") {
        const list = normalizeBuildings(b.value.data?.list ?? []);
        setBuildings(list);
        store.setBuildingsCache(b.value.data?.list ?? []);
        log("s", `楼栋数据 ${list.length} 栋`);
      } else {
        const cached = store.getBuildingsCache();
        if (cached?.list?.length) {
          setBuildings(normalizeBuildings(cached.list));
          log("w", `楼栋接口失败，用本地缓存 ${cached.list.length} 栋`);
        } else {
          log("e", "楼栋查询失败：" + (b.reason?.message ?? b.reason));
        }
      }
    } catch (e: any) {
      log("e", "初始化异常：" + (e?.message ?? e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  /* ── 圆心坐标 ── */
  const center = useMemo(() => {
    if (settings.centerOverride) return settings.centerOverride;
    const b = buildings.find((x) => x.id === settings.buildingId);
    if (b) return { jd: +b.jd, wd: +b.wd };
    return null;
  }, [settings.centerOverride, settings.buildingId, buildings]);

  /* ── 邻居楼栋数 ── */
  const neighborCount = useMemo(() => {
    if (!center) return 0;
    return buildings.filter((b) => distanceM(center, { jd: +b.jd, wd: +b.wd }) <= settings.neighborRadius).length;
  }, [buildings, center, settings.neighborRadius]);

  /* ── 生成落点 ── */
  const roll = useCallback(() => {
    if (!center) {
      log("w", "尚未选择宿舍楼（围栏圆心），先在设置里指定");
      return;
    }
    const l = generateLanding(
      buildings,
      center,
      store.getHistory(),
      store.getRecentBuildings(),
      {
        fenceRadius: shift?.kqfwxx?.[0]?.dkfw ?? 300,
        minOffset: settings.minOffset,
        maxOffset: settings.maxOffset,
        minSeparation: settings.minSeparation,
        neighborRadius: settings.neighborRadius,
      }
    );
    setLanding(l);
    setLandingManual(false);
    log("i", `自动落点 → ${l.buildingName} 偏移 ${l.offset}m 距圆心 ${l.distFromCenter}m 方位 ${l.angle}°`);
  }, [center, buildings, shift, settings, log]);

  /** 手动指定落点（地图点击或拖拽图钉） */
  const setLandingAt = useCallback(
    (p: { jd: number; wd: number }) => {
      const fenceR = shift?.kqfwxx?.[0]?.dkfw ?? 300;
      const dist = center ? distanceM(center, p) : 0;
      const inFence = !center || dist <= fenceR;
      setLanding({
        jd: p.jd,
        wd: p.wd,
        building: null as any,
        buildingName: "手动指定",
        offset: 0,
        distFromCenter: +dist.toFixed(1),
        angle: 0,
        createdAt: Date.now(),
      });
      setLandingManual(true);
      log(
        inFence ? "s" : "w",
        `手动落点 ${p.jd.toFixed(6)}, ${p.wd.toFixed(6)}` +
          (center ? ` · 距圆心 ${dist.toFixed(0)}m${inFence ? "" : " ⚠ 已超出围栏"}` : "")
      );
    },
    [center, shift, log]
  );

  /* ── 浏览器定位 ── */
  const locate = useCallback(
    (silent = false) => {
      if (!navigator.geolocation) {
        if (!silent) log("e", "浏览器不支持定位");
        return;
      }
      setLocating(true);
      if (!silent) log("i", "正在获取定位…");
      navigator.geolocation.getCurrentPosition(
        (p) => {
          setLocating(false);
          const g = wgs84ToGcj02(p.coords.longitude, p.coords.latitude);
          const acc = Number(p.coords.accuracy) || 0;

          // 找出最近的宿舍楼
          const near = nearestBuilding(buildings, g);
          const nearest = near
            ? {
                id: near.building.id,
                name: `${near.building.xqmc}·${near.building.ldmc}`,
                distance: Math.round(near.distance),
              }
            : undefined;

          setLivePos({ ...g, acc, nearest });

          if (nearest) {
            const dTxt = nearest.distance < 1000
              ? `${nearest.distance}m`
              : `${(nearest.distance / 1000).toFixed(2)}km`;
            log("s", `定位成功 ±${acc.toFixed(0)}m · 最近楼栋 ${nearest.name}（${dTxt}）`);
          } else {
            log("s", `定位成功 ±${acc.toFixed(0)}m ${g.jd.toFixed(6)}, ${g.wd.toFixed(6)}`);
          }

          // 虚拟落点模式需要圆心：离校区近才自动采用，避免误判
          if (
            near &&
            near.distance <= 3000 &&
            !settings.buildingId &&
            !settings.centerOverride
          ) {
            const next = store.setSettings({ buildingId: near.building.id, centerOverride: null });
            setSettings(next);
            log("i", `已把 ${near.building.ldmc} 设为围栏圆心`);
          }
        },
        (err) => {
          setLocating(false);
          if (!silent) log("w", "定位失败（" + err.message + "），可改用「虚拟落点」模式");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    },
    [buildings, log, settings.buildingId, settings.centerOverride]
  );

  /** 首次进入自动取一次定位 */
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current) return;
    if (!buildings.length) return;
    autoTried.current = true;
    locate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings.length]);

  /**
   * 反推围栏圆心
   *
   * 服务端知道学生宿舍坐标（围栏圆心），但不开放给学生端查询。
   * 不过 jcqqwzsjsfndk 会返回 pcMi（提交点到圆心的米数），
   * 因此在打卡窗口内做三次测量即可用三边定位解出圆心。
   */
  const [probing, setProbing] = useState(false);
  const probeCenter = useCallback(async () => {
    if (!ctx) return;
    // 注意：这里必须用 store.getHistory()，直接写 history 会拿到 window.history
    const hist = store.getHistory();
    const seed = livePos ?? (hist.length ? { jd: hist[0].jd, wd: hist[0].wd } : null);
    if (!seed) {
      log("w", "需要先取得一次定位作为探测种子");
      return;
    }
    setProbing(true);
    log("i", `探测围栏圆心中（种子 ${seed.jd.toFixed(6)}, ${seed.wd.toFixed(6)}）…`);
    try {
      const r = await probeFenceCenter(ctx, "0", seed, 400);
      if (!r) {
        log("w", "接口未返回偏差米数 —— 通常是因为当前不在打卡时间窗内，窗口内再试");
        return;
      }
      const next = store.setSettings({
        centerOverride: { jd: r.jd, wd: r.wd },
        buildingId: "",
      });
      setSettings(next);
      log("s", `圆心解出 ${r.jd.toFixed(6)}, ${r.wd.toFixed(6)}`);
      log("i", `距种子 ${r.distance}m · 围栏 ${r.radius ?? "?"}m · 三点偏差 ${r.samples.join(" / ")}m`);
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : (e?.message ?? String(e));
      log("e", "探测失败：" + msg);
      if (isAuthError(e)) authErrRef.current?.(msg);
    } finally {
      setProbing(false);
    }
  }, [ctx, livePos, log]);

  /* ── 打卡 ── */
  const doPunch = useCallback(async () => {
    if (!ctx) return;

    const target = mode === "live" ? livePos : landing;
    if (!target) {
      setBlocked(mode === "live" ? "尚未取得定位，请点「重新定位」" : "请先生成落点");
      return;
    }
    const dz = mode === "live" ? "当前位置打卡" : landing!.buildingName;

    setBusy(true);
    setBlocked(null);
    try {
      /* ① 围栏预检 —— 服务端不放行就不提交，与官方前端一致 */
      const chk = await api.checkLocation(ctx, { jd: target.jd, wd: target.wd, dklb: "0" });
      const d: any = chk.data;
      const can = d && typeof d === "object" ? d.canDk : Boolean(d);
      const reason =
        (d && typeof d === "object" && (d.msg || d.reason)) || "";

      if (can !== true) {
        const why =
          reason === "NOT_ALLOWED" || !reason
            ? "当前不在可打卡状态"
            : reason;
        log("w", `未放行：${why}${d?.pcMi != null ? `（偏差 ${d.pcMi}m / 围栏 ${d.fwMi}m）` : ""}`);
        setBlocked(why);
        return; // ← 不再继续提交
      }

      log(
        "s",
        `预检通过 canDk=true${d?.pcMi != null ? ` 偏差${d.pcMi}m/围栏${d.fwMi}m` : ""}`
      );

      /* ② 提交 */
      const res = await api.punch(ctx, {
        jd: target.jd,
        wd: target.wd,
        dkbc: shift?.dkbc ?? "校内住宿打卡",
        dkdz: dz,
        sfwcdk: settings.useOutdoor ? 1 : undefined,
      });

      // 服务端「未到打卡时间」这类业务拒绝也是 HTTP 200，必须看 message 才知道真伪
      const msg = res.message || "";
      const reallyOk = /成功/.test(msg) && !/未|失败|不能|不可|已打卡|不在/.test(msg);

      if (!reallyOk) {
        log("w", `打卡未完成：${msg || "服务端未确认"}`);
        setBlocked(msg || "打卡未完成");
        return;
      }

      log("s", `打卡成功：${msg}`);

      if (mode === "virtual" && landing) {
        store.pushHistory(landing);
        store.pushRecentBuilding(landing.building?.id ?? "");
      }
      store.setLastPunch({ at: Date.now(), jd: target.jd, wd: target.wd, dz, ok: true });
      setDone({ at: Date.now(), jd: target.jd, wd: target.wd, dz });
      api.shift(ctx).then((r) => setShift(r.data)).catch(() => {});
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : (e?.message ?? String(e));
      log("e", "打卡失败：" + msg);
      setBlocked(msg);
      if (isAuthError(e)) authErrRef.current?.(msg);
      const t = mode === "live" ? livePos : landing;
      if (t) {
        store.setLastPunch({ at: Date.now(), jd: t.jd, wd: t.wd, dz, ok: false });
      }
    } finally {
      setBusy(false);
    }
  }, [ctx, mode, livePos, landing, shift, settings.useOutdoor, log]);

  const upd = (patch: Partial<Settings>) => setSettings(store.setSettings(patch));

  /* ── 地图交互 ── */
  const handleCenterChange = useCallback(
    (c: { jd: number; wd: number }) => {
      const near = nearestBuilding(buildings, c);
      const snap = near && near.distance < 40 ? near.building.id : "";
      const next = store.setSettings({ centerOverride: c, buildingId: snap });
      setSettings(next);

      if (!landingManual) {
        // 自动落点是按旧圆心算出来的，圆心一变就作废
        setLanding(null);
      } else if (landing) {
        // 手动落点是用户明确指定的，保留，只重算与圆心的距离
        const fenceR = shift?.kqfwxx?.[0]?.dkfw ?? 300;
        const dist = distanceM(c, { jd: landing.jd, wd: landing.wd });
        setLanding({ ...landing, distFromCenter: +dist.toFixed(1) });
        if (dist > fenceR) log("w", `手动落点距新圆心 ${dist.toFixed(0)}m，已超出围栏 ${fenceR}m`);
      }

      log(
        "i",
        `圆心 → ${c.jd.toFixed(6)}, ${c.wd.toFixed(6)}` +
          (near ? ` · 最近 ${near.building.ldmc} ${near.distance.toFixed(0)}m` : "")
      );
    },
    [buildings, log, landingManual, landing, shift]
  );

  const handleRangeChange = useCallback(
    (r: number) => {
      const next = store.setSettings({ maxOffset: r });
      setSettings(next);
      log("i", `落点范围 → ${r}m`);
    },
    [log]
  );

  const target = mode === "live" ? livePos : landing;
  const canPunch = !!ctx && !!target && !busy;
  const fence = shift?.kqfwxx?.[0]?.dkfw ?? 300;

  /* ── 折叠态（仅浮层模式）── */
  if (collapsed && !pageMode) {
    return (
      <div className={"root collapsed" + (pos ? " pinned" : "")} ref={rootRef}>
        <div className="head" onMouseDown={onHeadDown}>
          <span className="dot" />
          <span className="title">平安打卡</span>
          <span
            className="ico"
            title="展开"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              setCollapsed(false);
              store.setSettings({ collapsed: false });
            }}
          >
            ▢
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={"root" + (pageMode ? " page-mode" : "")} ref={rootRef}>
      <div className="head" onMouseDown={pageMode ? undefined : onHeadDown}>
        <span className="dot" />
        <span className="title">平安打卡</span>
        {!pageMode && (
          <span
            className="ico"
            title="收起"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              setCollapsed(true);
              store.setSettings({ collapsed: true });
            }}
          >
            ─
          </span>
        )}
      </div>

      <div className="body">
        {done && (
          <div className="mask">
            <div className="success">
              <div className="tick">✓</div>
              <div className="t1">打卡成功</div>
              <div className="t2">
                已于 {new Date(done.at).toLocaleTimeString("zh-CN", { hour12: false })} 完成打卡
                <br />
                {done.dz}
                <div className="coord">
                  {done.jd.toFixed(5)}, {done.wd.toFixed(5)}
                </div>
              </div>
              <button className="btn" onClick={() => setDone(null)}>
                确定
              </button>
            </div>
          </div>
        )}

        {/* 班次状态 */}
        <div className="row">
          <span className="label">班次</span>
          <span className="value">{shift?.dkbc ?? "—"}</span>
        </div>
        <div className="row">
          <span className="label">时间窗</span>
          <span className="value">{shift?.dksjfw ?? "—"}</span>
        </div>
        <div className="row">
          <span className="label">状态</span>
          <span className="value">
            {shift ? (
              shift.kdk ? (
                <span className="badge ok">可打卡</span>
              ) : (
                <span className="badge warn">{shift.bkyy || "不可打卡"}</span>
              )
            ) : (
              <span className="badge info">加载中</span>
            )}
          </span>
        </div>

        {/* 模式切换 */}
        <div className="mode-tabs">
          <button
            className={mode === "live" ? "on" : ""}
            onClick={() => {
              setMode("live");
              setBlocked(null);
            }}
            title="人在宿舍时用这个，直接提交手机定位"
          >
            实时定位
          </button>
          <button
            className={mode === "virtual" ? "on" : ""}
            onClick={() => {
              setMode("virtual");
              setBlocked(null);
            }}
            title="不在校时用这个，在围栏内生成一个合规坐标"
          >
            虚拟落点
          </button>
        </div>

        {/* 提交目标 */}
        {mode === "live" ? (
          livePos ? (
            <div className="landing">
              <div className="landing-name">
                <span className="pin">◉</span>
                当前位置
                {livePos.acc ? (
                  <span className="nb-acc">±{livePos.acc.toFixed(0)}m</span>
                ) : null}
              </div>
              <div className="coord">
                {livePos.jd.toFixed(6)}, {livePos.wd.toFixed(6)}
              </div>

              {livePos.nearest && (
                <div className="nearest">
                  <span className="nb-label">最近宿舍楼</span>
                  <span className="nb-name">{livePos.nearest.name}</span>
                  <span
                    className={
                      "nb-dist" + (livePos.nearest.distance <= 150 ? " close" : "")
                    }
                  >
                    {livePos.nearest.distance < 1000
                      ? `${livePos.nearest.distance}m`
                      : `${(livePos.nearest.distance / 1000).toFixed(2)}km`}
                  </span>
                  {livePos.nearest.distance <= 150 && (
                    <span className="nb-tag ok">就在附近</span>
                  )}
                  {livePos.nearest.distance > 3000 && (
                    <span className="nb-tag warn">不在校区周边</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="landing landing-empty">
              {locating ? "正在定位…" : "尚未取得定位，点下方「重新定位」"}
            </div>
          )
        ) : landing ? (
          <div className="landing">
            <div className="landing-name">
              <span className="pin">◉</span>
              {landing.buildingName}
              {landingManual && <span className="nb-tag manual">手动指定</span>}
            </div>
            <div className="landing-meta">
              {!landingManual && <span>偏移 <b>{landing.offset}m</b></span>}
              <span>距圆心 <b>{landing.distFromCenter}m</b></span>
              {!landingManual && <span>方位 <b>{landing.angle}°</b></span>}
              <span>围栏 <b>{fence}m</b></span>
            </div>
            <div className="coord">
              {landing.jd.toFixed(6)}, {landing.wd.toFixed(6)}
            </div>
            {landing.distFromCenter > fence && (
              <div className="hint warn">
                ⚠ 该点已超出服务端围栏（{fence}m），提交可能被拒绝
              </div>
            )}
          </div>
        ) : (
          <div className="landing landing-empty">
            {center ? (
              "点击下方「生成落点」"
            ) : (
              <>
                圆心未确定。可自动探测，或在设置里选宿舍楼
                <button
                  className="btn ghost"
                  style={{ marginTop: 10 }}
                  disabled={probing || !ctx}
                  onClick={probeCenter}
                >
                  {probing ? "探测中…" : "自动探测圆心"}
                </button>
                <div className="hint" style={{ marginTop: 8, textAlign: "left" }}>
                  原理：围栏校验接口会返回「你提交的点距圆心多少米」，用三次测量即可反解出圆心
                  —— 也就是服务端替你保存的那栋宿舍楼坐标。仅在打卡时间窗内可用。
                </div>
              </>
            )}
          </div>
        )}

        {/* 地图选点（虚拟落点模式） */}
        {mode === "virtual" && center && (
          <>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn ghost" onClick={() => setShowMap((v) => !v)}>
                {showMap ? "收起地图" : "地图选点"}
              </button>
              {showMap && (
                <select
                  value={tileId}
                  onChange={(e) => setTileId(e.target.value)}
                  style={{ flex: 1 }}
                  title="切换底图"
                >
                  {TILE_SOURCES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {showMap && (
              <div className="click-target">
                <span className="ct-label">点击地图设为</span>
                <button
                  className={mapClickTarget === "landing" ? "on" : ""}
                  onClick={() => setMapClickTarget("landing")}
                >
                  落点
                </button>
                <button
                  className={mapClickTarget === "center" ? "on" : ""}
                  onClick={() => setMapClickTarget("center")}
                >
                  圆心
                </button>
              </div>
            )}

            {showMap && (
              <Suspense
                fallback={
                  <div className="map-skeleton" style={{ height: 300, borderRadius: 10, marginTop: 10 }}>
                    <span className="ms-text">地图加载中…</span>
                  </div>
                }
              >
                <MapView
                  buildings={buildings}
                  center={center}
                  fenceRadius={fence}
                  rangeRadius={settings.maxOffset}
                  landing={landing}
                  history={store.getHistory()}
                  tileId={tileId}
                  height={300}
                  clickTarget={mapClickTarget}
                  landingDraggable
                  onCenterChange={handleCenterChange}
                  onRangeChange={handleRangeChange}
                  onLandingChange={setLandingAt}
                />
              </Suspense>
            )}
          </>
        )}

        {blocked && (
          <div className="blocked">
            <span className="bk-ico">!</span>
            <span>{blocked}</span>
          </div>
        )}

        <button className="btn" disabled={!canPunch} onClick={doPunch}>
          {busy ? (
            <>
              <span className="spin" />
              打卡中…
            </>
          ) : mode === "live" ? (
            "用当前位置打卡"
          ) : (
            "提交虚拟落点"
          )}
        </button>

        <div className="btn-row">
          {mode === "live" ? (
            <button className="btn ghost" disabled={locating} onClick={() => locate(false)}>
              {locating ? "定位中…" : "重新定位"}
            </button>
          ) : (
            <button className="btn ghost" disabled={!center} onClick={roll}>
              生成落点
            </button>
          )}
          <button className="btn ghost" onClick={() => setShowSettings((v) => !v)}>
            {showSettings ? "收起设置" : "设置"}
          </button>
        </div>

        {/* 设置 */}
        {showSettings && (
          <div className="card">
            <div className="card-title">
              <span>围栏圆心（宿舍楼）</span>
              <span className="link" onClick={() => locate(false)}>
                自动定位
              </span>
            </div>
            <select
              value={settings.buildingId}
              onChange={(e) => upd({ buildingId: e.target.value, centerOverride: null })}
            >
              <option value="">— 请选择 —</option>
              {Object.entries(
                buildings.reduce<Record<string, Building[]>>((acc, b) => {
                  (acc[b.xqmc] ||= []).push(b);
                  return acc;
                }, {})
              ).map(([campus, list]) => (
                <optgroup key={campus} label={campus}>
                  {list.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.ldmc}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {center && (
              <div className="coord">
                圆心 {center.jd.toFixed(6)}, {center.wd.toFixed(6)}
                <br />
                周边 {neighborCount} 栋楼在 {settings.neighborRadius}m 内
              </div>
            )}

            <div className="field">
              <label className="field-label">落点偏移下限（米）</label>
              <div className="slider-row">
                <input
                  type="range"
                  min={5}
                  max={200}
                  step={5}
                  value={settings.minOffset}
                  onChange={(e) => upd({ minOffset: +e.target.value })}
                />
                <span className="num">{settings.minOffset}</span>
              </div>
            </div>

            <div className="field">
              <label className="field-label">落点偏移上限（米）</label>
              <div className="slider-row">
                <input
                  type="range"
                  min={10}
                  max={280}
                  step={5}
                  value={settings.maxOffset}
                  onChange={(e) => upd({ maxOffset: +e.target.value })}
                />
                <span className="num">{settings.maxOffset}</span>
              </div>
            </div>

            <div className="field">
              <label className="field-label">与历史落点最小间隔（米，防重合）</label>
              <div className="slider-row">
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={settings.minSeparation}
                  onChange={(e) => upd({ minSeparation: +e.target.value })}
                />
                <span className="num">{settings.minSeparation}</span>
              </div>
            </div>

            <div className="field">
              <label className="field-label">候选楼栋搜索半径（米）</label>
              <div className="slider-row">
                <input
                  type="range"
                  min={50}
                  max={280}
                  step={10}
                  value={settings.neighborRadius}
                  onChange={(e) => upd({ neighborRadius: +e.target.value })}
                />
                <span className="num">{settings.neighborRadius}</span>
              </div>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <span className="label">走「外出打卡」分支</span>
              <input
                type="checkbox"
                checked={settings.useOutdoor}
                onChange={(e) => upd({ useOutdoor: e.target.checked })}
                style={{ width: "auto" }}
              />
            </div>

            <div className="btn-row">
              <button className="btn gray" onClick={() => { store.clearHistory(); log("i", "历史落点已清空"); }}>
                清空历史落点
              </button>
              <button className="btn gray" onClick={bootstrap}>
                重新连接
              </button>
            </div>
          </div>
        )}

        {/* 日志 */}
        {logs.length > 0 && (
          <div className="log" ref={logRef}>
            {logs.map((l, i) => (
              <div key={i}>
                <span className="t">{l.t}</span>
                <span className={l.kind}>{l.msg}</span>
              </div>
            ))}
          </div>
        )}

        {shift?.gz && <div className="hint">{shift.gz}</div>}
      </div>
    </div>
  );
}
