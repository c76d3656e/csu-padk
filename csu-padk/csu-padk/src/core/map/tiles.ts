/**
 * 瓦片源
 *
 * 坐标系：服务端返回的楼栋坐标是 GCJ-02（火星坐标）
 *   —— H5 端定位链路 wgs84 → gcj02 后才提交，逆地理走百度 Geocoder 内部再转 BD09
 * 因此底图必须选 GCJ-02 系，否则会有约 500m 的偏移。
 */
export interface TileSource {
  id: string;
  name: string;
  url: string;
  subdomains: string[];
  attribution: string;
  maxZoom: number;
  /** 该源的坐标系，用于提示是否发生偏移 */
  crs: "GCJ02" | "WGS84";
}

export const TILE_SOURCES: TileSource[] = [
  {
    id: "amap-vector",
    name: "高德 · 路网",
    url: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
    subdomains: ["1", "2", "3", "4"],
    attribution: "© 高德地图",
    maxZoom: 19,
    crs: "GCJ02",
  },
  {
    id: "amap-satellite",
    name: "高德 · 卫星",
    url: "https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
    subdomains: ["1", "2", "3", "4"],
    attribution: "© 高德地图",
    maxZoom: 19,
    crs: "GCJ02",
  },
  {
    id: "osm",
    name: "OSM（有偏移）",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: ["a"],
    attribution: "© OpenStreetMap",
    maxZoom: 19,
    crs: "WGS84",
  },
];

export const DEFAULT_TILE = TILE_SOURCES[0].id;

export function getTile(id: string): TileSource {
  return TILE_SOURCES.find((t) => t.id === id) ?? TILE_SOURCES[0];
}
