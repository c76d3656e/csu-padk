/**
 * Leaflet 懒加载封装
 *
 * 目标：
 *   1. 地图是重资产（~150KB），只在用户真正点开地图时才加载 —— bundle-conditional
 *   2. CSS 需要单独注入，因为面板跑在 Shadow DOM 里，全局样式进不来
 *   3. 加载失败要有降级路径，面板不能因为地图挂了就不可用
 */

export type Leaflet = typeof import("leaflet");

let leafletPromise: Promise<Leaflet> | null = null;
let cssInjected = new WeakSet<ShadowRoot | Document>();

/** 动态加载 Leaflet（只加载一次，失败后可重试） */
export function loadLeaflet(): Promise<Leaflet> {
  if (!leafletPromise) {
    leafletPromise = import("leaflet")
      .then((m) => (m as any).default ?? m)
      .catch((e) => {
        leafletPromise = null; // 允许重试
        throw e;
      });
  }
  return leafletPromise;
}

/**
 * 把 Leaflet 样式注入到目标 root（ShadowRoot 或 document）
 * 面板内必须走 ShadowRoot，否则会污染宿主页面
 */
export function injectLeafletCss(root: ShadowRoot | Document, cssText: string) {
  if (cssInjected.has(root)) return;
  const style = document.createElement("style");
  style.setAttribute("data-leaflet-css", "1");
  style.textContent = cssText;
  if (root instanceof ShadowRoot) {
    root.appendChild(style);
  } else {
    document.head.appendChild(style);
  }
  cssInjected.add(root);
}

/**
 * Leaflet 默认图标依赖图片资源，打包后路径会丢。
 * 用内联 SVG 的 DivIcon 替代，既省请求又能在 Shadow DOM 里正常显示。
 */
export function makePinIcon(L: Leaflet, color: string, size = 26) {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
  <path d="M12 2.5c-3.9 0-7 3.1-7 7 0 5.2 7 12 7 12s7-6.8 7-12c0-3.9-3.1-7-7-7z"
        fill="${color}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>
  <circle cx="12" cy="9.4" r="2.5" fill="#fff"/>
</svg>`.trim();

  return L.divIcon({
    className: "padk-pin",
    html: `<div style="width:${size}px;height:${size}px;line-height:0;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))">${svg}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size + 4],
  });
}

/** 圆边拖拽把手（改半径用） */
export function makeHandleIcon(L: Leaflet, color: string) {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
  <circle cx="9" cy="9" r="7" fill="#fff" stroke="${color}" stroke-width="2.6"/>
</svg>`.trim();
  return L.divIcon({
    className: "padk-handle",
    html: `<div style="width:18px;height:18px;line-height:0;cursor:grab">${svg}</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}
