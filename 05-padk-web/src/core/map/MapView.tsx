import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { Building } from "../api";
import type { Landing } from "../geo";
import { distanceM } from "../geo";
import { getTile, DEFAULT_TILE } from "./tiles";
import { injectLeafletCss, loadLeaflet, makeHandleIcon, makePinIcon, type Leaflet } from "./leaflet";
import css from "leaflet/dist/leaflet.css?inline";

export interface MapViewProps {
  buildings: Building[];
  center: { jd: number; wd: number } | null;
  /** 服务端围栏半径（只读展示） */
  fenceRadius: number;
  /** 落点范围半径（可拖拽调整） */
  rangeRadius: number;
  landing: Landing | null;
  history: Landing[];
  tileId?: string;
  height?: number;
  /** 点击空白处时作用于哪个点 */
  clickTarget?: "center" | "landing";
  /** 落点图钉是否可拖拽 */
  landingDraggable?: boolean;
  onCenterChange: (c: { jd: number; wd: number }) => void;
  onRangeChange: (r: number) => void;
  onLandingChange?: (p: { jd: number; wd: number }) => void;
  onBuildingPick?: (b: Building) => void;
}

const PIN_CENTER = "#2278fd";
const PIN_LANDING = "#e0a33e";
const FENCE_COLOR = "#2278fd";
const RANGE_COLOR = "#e0a33e";

function MapViewInner({
  buildings,
  center,
  fenceRadius,
  rangeRadius,
  landing,
  history,
  tileId = DEFAULT_TILE,
  height = 260,
  clickTarget = "center",
  landingDraggable = false,
  onCenterChange,
  onRangeChange,
  onLandingChange,
  onBuildingPick,
}: MapViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const LRef = useRef<Leaflet | null>(null);
  const layerRef = useRef<any>(null);
  const tileRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const handleRef = useRef<any>(null);
  const centerMarkerRef = useRef<any>(null);
  const landingMarkerRef = useRef<any>(null);

  // 拖拽过程中的高频值不放进 state，避免整棵树重渲染
  const dragRef = useRef<{ kind: "center" | "radius" | null }>({ kind: null });

  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 回调放进 ref，地图事件里始终读最新值，避免重建监听器
  const cbRef = useRef({ onCenterChange, onRangeChange, onLandingChange, onBuildingPick });
  cbRef.current = { onCenterChange, onRangeChange, onLandingChange, onBuildingPick };

  // 点击作用目标同样走 ref，切换时无需重绑事件
  const clickTargetRef = useRef(clickTarget);
  clickTargetRef.current = clickTarget;

  // 半径在拖拽过程中高频变化：state 驱动重绘，ref 供事件处理器读取最新值
  const [localRange, setLocalRange] = useState(rangeRadius);
  const localRangeRef = useRef(rangeRadius);
  localRangeRef.current = localRange;

  /* ── 初始化地图 ── */
  useEffect(() => {
    let destroyed = false;

    (async () => {
      if (!boxRef.current) return;
      try {
        const L = await loadLeaflet();
        if (destroyed || !boxRef.current) return;
        LRef.current = L;

        // 面板跑在 Shadow DOM 里，Leaflet 的样式必须手动送进去
        const rootNode = boxRef.current.getRootNode();
        injectLeafletCss(rootNode as any, css);

        const map = L.map(boxRef.current, {
          zoomControl: true,
          attributionControl: false,
          // 移动端友好
          tap: true,
        }).setView([center?.wd ?? 28.14, center?.jd ?? 112.99], 16);

        const tile = getTile(tileId);
        tileRef.current = L.tileLayer(tile.url, {
          subdomains: tile.subdomains,
          maxZoom: tile.maxZoom,
        }).addTo(map);

        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;

        // 点击地图 → 按当前作用目标设置圆心或落点
        map.on("click", (e: any) => {
          const p = { jd: +e.latlng.lng.toFixed(7), wd: +e.latlng.lat.toFixed(7) };
          if (clickTargetRef.current === "landing" && cbRef.current.onLandingChange) {
            cbRef.current.onLandingChange(p);
          } else {
            cbRef.current.onCenterChange(p);
          }
        });

        setReady(true);
      } catch (e: any) {
        setErr(e?.message ?? "地图加载失败");
      }
    })();

    return () => {
      destroyed = true;
      mapRef.current?.remove?.();
      mapRef.current = null;
    };
    // 只在挂载时初始化；后续变化走增量更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── 切换底图 ── */
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const tile = getTile(tileId);
    tileRef.current?.remove?.();
    tileRef.current = L.tileLayer(tile.url, {
      subdomains: tile.subdomains,
      maxZoom: tile.maxZoom,
    });
    tileRef.current.addTo(map);
    tileRef.current.bringToBack?.();
  }, [tileId, ready]);

  /* ── 同步外部半径 ── */
  useEffect(() => {
    setLocalRange(rangeRadius);
  }, [rangeRadius]);

  /* ── 增量绘制：圆心 / 围栏 / 把手 / 落点 / 楼栋 / 历史 ── */
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer || !ready) return;

    layer.clearLayers();

    /* 邻居楼栋（按当前圆心算距离，派生状态直接在渲染阶段算） */
    if (center) {
      const rows: Array<{ b: Building; d: number }> = [];
      for (const b of buildings) {
        const d = distanceM(center, { jd: +b.jd, wd: +b.wd });
        if (d <= Math.max(fenceRadius, localRange) + 100) rows.push({ b, d });
      }
      for (const { b, d } of rows) {
        const inFence = d <= fenceRadius;
        const inRange = d <= localRange;
        const dot = L.circleMarker([+b.wd, +b.jd], {
          radius: inRange ? 5 : inFence ? 4 : 3.5,
          color: inRange ? "#b8801f" : inFence ? "#0b8f4f" : "#9aa7b5",
          weight: 1.4,
          fillColor: inRange ? "#e0a33e" : inFence ? "#19be6b" : "#c3ccd6",
          fillOpacity: inRange ? 0.9 : inFence ? 0.8 : 0.45,
        });
        dot.bindTooltip(`${b.ldmc} · ${d.toFixed(0)}m`, { direction: "top" });
        dot.on("click", () => {
          cbRef.current.onBuildingPick?.(b);
          cbRef.current.onCenterChange({ jd: +b.jd, wd: +b.wd });
        });
        dot.addTo(layer);
      }
    }

    if (center) {
      /* ① 服务端围栏（只读） */
      L.circle([center.wd, center.jd], {
        radius: fenceRadius,
        color: FENCE_COLOR,
        weight: 1.6,
        dashArray: "8 7",
        fillColor: FENCE_COLOR,
        fillOpacity: 0.06,
        interactive: false,
      }).addTo(layer);

      /* ② 落点范围（可拖拽改半径） */
      circleRef.current = L.circle([center.wd, center.jd], {
        radius: localRange,
        color: RANGE_COLOR,
        weight: 2,
        fillColor: RANGE_COLOR,
        fillOpacity: 0.09,
        interactive: false,
      }).addTo(layer);

      /* 圆边把手：拖它改落点范围 */
      const edge = offsetByBearing(center, localRange, 0);
      handleRef.current = L.marker([edge.wd, edge.jd], {
        draggable: true,
        icon: makeHandleIcon(L, RANGE_COLOR),
        zIndexOffset: 800,
      }).addTo(layer);

      handleRef.current.on("drag", (e: any) => {
        const p = e.target.getLatLng();
        const r = Math.max(10, Math.min(fenceRadius, distanceM(center, { jd: p.lng, wd: p.lat })));
        setLocalRange(Math.round(r));
      });
      handleRef.current.on("dragend", () => {
        cbRef.current.onRangeChange(localRangeRef.current);
      });

      /* 圆心标记：可拖拽 */
      centerMarkerRef.current = L.marker([center.wd, center.jd], {
        draggable: true,
        icon: makePinIcon(L, PIN_CENTER, 30),
        zIndexOffset: 900,
      }).addTo(layer);

      centerMarkerRef.current.bindTooltip("围栏圆心（可拖动）", { direction: "top", offset: [0, -26] });
      centerMarkerRef.current.on("drag", (e: any) => {
        const p = e.target.getLatLng();
        const nc = { jd: +p.lng.toFixed(7), wd: +p.lat.toFixed(7) };
        // 拖动中只移动圆与把手，回写交由 dragend
        circleRef.current?.setLatLng([nc.wd, nc.jd]);
        const edge2 = offsetByBearing(nc, localRangeRef.current, 0);
        handleRef.current?.setLatLng([edge2.wd, edge2.jd]);
      });
      centerMarkerRef.current.on("dragend", (e: any) => {
        const p = e.target.getLatLng();
        cbRef.current.onCenterChange({ jd: +p.lng.toFixed(7), wd: +p.lat.toFixed(7) });
      });
    }

    /* 历史落点 */
    for (const h of history.slice(0, 25)) {
      L.circleMarker([h.wd, h.jd], {
        radius: 3,
        color: "#c9d2dc",
        weight: 1,
        fillColor: "#c9d2dc",
        fillOpacity: 0.6,
        interactive: false,
      }).addTo(layer);
    }

    /* 当前落点 */
    if (landing) {
      landingMarkerRef.current = L.marker([landing.wd, landing.jd], {
        icon: makePinIcon(L, PIN_LANDING, 28),
        draggable: landingDraggable,
        zIndexOffset: 1000,
      }).addTo(layer);
      landingMarkerRef.current.bindTooltip(
        `落点 · ${landing.buildingName} · ${landing.offset}m`,
        { direction: "top", offset: [0, -24] }
      );
      if (landingDraggable) {
        landingMarkerRef.current.on("dragend", (e: any) => {
          const p = e.target.getLatLng();
          cbRef.current.onLandingChange?.({ jd: +p.lng.toFixed(7), wd: +p.lat.toFixed(7) });
        });
      }
    }

    /* 视野跟随圆心（首次或圆心远离视野时） */
    if (center) {
      const c = map.getCenter();
      const far = distanceM({ jd: c.lng, wd: c.lat }, center) > fenceRadius * 4;
      if (far || !map.__padkInit) {
        map.setView([center.wd, center.jd], 16);
        map.__padkInit = true;
      }
    }
  }, [ready, buildings, center, localRange, landing, history, fenceRadius, landingDraggable]);

  /* ── 容器尺寸变化 ── */
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => mapRef.current?.invalidateSize?.(), 60);
    return () => clearTimeout(t);
  }, [ready, height]);

  const retry = useCallback(() => {
    setErr(null);
    setReady(false);
    loadLeaflet()
      .then(() => window.location.reload())
      .catch(() => setErr("仍然失败"));
  }, []);

  if (err) {
    return (
      <div className="mapbox mapbox--err" style={{ height }}>
        <span>地图加载失败</span>
        <small>{err}</small>
        <button className="btn gray" onClick={retry}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="mapwrap" style={{ height }}>
      <div ref={boxRef} className="mapbox" style={{ height }} />
      {!ready && (
        <div className="map-skeleton" style={{ height }}>
          <span className="ms-grid" />
          <span className="ms-text">地图加载中…</span>
        </div>
      )}
      <div className="map-legend">
        <span>
          <i style={{ background: PIN_CENTER }} />
          圆心
        </span>
        <span>
          <i style={{ background: RANGE_COLOR }} />
          落点范围
        </span>
        <span>
          <i style={{ background: FENCE_COLOR }} />
          围栏 {fenceRadius}m
        </span>
      </div>
    </div>
  );
}

/** 沿给定方位角偏移指定距离 */
function offsetByBearing(
  from: { jd: number; wd: number },
  meters: number,
  bearingRad: number
) {
  const dLat = (meters * Math.cos(bearingRad)) / 111320;
  const dLng = (meters * Math.sin(bearingRad)) / (111320 * Math.cos((from.wd * Math.PI) / 180));
  return { jd: +(from.jd + dLng).toFixed(7), wd: +(from.wd + dLat).toFixed(7) };
}

export default memo(MapViewInner);
