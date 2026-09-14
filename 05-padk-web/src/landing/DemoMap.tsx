import { useCallback, useMemo, useState } from "react";
import MapView from "../core/map/MapView";
import { TILE_SOURCES, DEFAULT_TILE } from "../core/map/tiles";
import { generateLanding, distanceM, type Landing } from "../core/geo";
import type { Building } from "../core/api";

/**
 * 演示用合成校区 —— 不使用任何真实校内数据。
 * 只是把交互效果展示出来：围栏标注、邻栋轮换、落点去重。
 */
const DEMO_CENTER = { jd: 112.9388, wd: 28.1665 };

const NAMES = [
  "一号斋", "二号斋", "三号斋", "四号斋", "五号斋", "六号斋",
  "东苑", "西苑", "南苑", "北苑", "研一楼", "研二楼", "留学生公寓", "教工之家",
];

function buildDemo(): Building[] {
  const out: Building[] = [];
  const n = NAMES.length;
  for (let i = 0; i < n; i++) {
    // 螺旋分布，模拟真实宿舍区的紧凑排布
    const angle = (i / n) * Math.PI * 2 * 1.6;
    const r = 40 + (i / n) * 215;
    const dLat = (r * Math.cos(angle)) / 111320;
    const dLng = (r * Math.sin(angle)) / (111320 * Math.cos((DEMO_CENTER.wd * Math.PI) / 180));
    out.push({
      id: `demo-${i}`,
      xqmc: "示例校区",
      xqdm: "demo",
      ldmc: NAMES[i],
      lddm: `d${i}`,
      jd: (DEMO_CENTER.jd + dLng).toFixed(7),
      wd: (DEMO_CENTER.wd + dLat).toFixed(7),
    });
  }
  return out;
}

const DEMO_BUILDINGS = buildDemo();
const FENCE = 300;

export default function DemoMap() {
  const [center, setCenter] = useState(DEMO_CENTER);
  const [range, setRange] = useState(140);
  const [tileId, setTileId] = useState(DEFAULT_TILE);
  const [landing, setLanding] = useState<Landing | null>(null);
  const [history, setHistory] = useState<Landing[]>([]);
  const [serial, setSerial] = useState(0);

  const inFence = useMemo(
    () => DEMO_BUILDINGS.filter((b) => distanceM(center, { jd: +b.jd, wd: +b.wd }) <= FENCE).length,
    [center]
  );

  const roll = useCallback(() => {
    const l = generateLanding(DEMO_BUILDINGS, center, history, [], {
      fenceRadius: FENCE,
      minOffset: 20,
      maxOffset: Math.max(range, 40),
      minSeparation: 55,
      neighborRadius: Math.max(range, 60),
    });
    setLanding(l);
    setHistory((prev) => [l, ...prev].slice(0, 24));
    setSerial((s) => s + 1);
  }, [center, history, range]);

  const reset = useCallback(() => {
    setHistory([]);
    setLanding(null);
    setSerial(0);
  }, []);

  return (
    <div className="demo">
      <div className="demo-head">
        <span className="demo-tag">交互演示 · 合成数据</span>
        <span className="demo-serial">#{String(serial).padStart(3, "0")}</span>
      </div>

      <MapView
        buildings={DEMO_BUILDINGS}
        center={center}
        fenceRadius={FENCE}
        rangeRadius={range}
        landing={landing}
        history={history}
        tileId={tileId}
        height={330}
        onCenterChange={setCenter}
        onRangeChange={setRange}
      />

      <div className="demo-bar">
        <label className="demo-ctl">
          <span>落点范围</span>
          <input
            type="range"
            min={20}
            max={280}
            step={5}
            value={range}
            onChange={(e) => setRange(+e.target.value)}
          />
          <b>{range}m</b>
        </label>

        <select
          className="demo-select"
          value={tileId}
          onChange={(e) => setTileId(e.target.value)}
        >
          {TILE_SOURCES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="demo-foot">
        <div className="demo-stats">
          <div>
            <span>围栏内楼栋</span>
            <b>{inFence}</b>
          </div>
          <div>
            <span>本次落点</span>
            <b>{landing ? `${landing.offset}m` : "—"}</b>
          </div>
          <div>
            <span>距圆心</span>
            <b>{landing ? `${landing.distFromCenter}m` : "—"}</b>
          </div>
          <div>
            <span>历史点数</span>
            <b>{history.length}</b>
          </div>
        </div>

        <div className="demo-actions">
          <button className="mb mb--primary" onClick={roll}>
            生成落点
          </button>
          <button className="mb" onClick={reset}>
            清空
          </button>
        </div>
      </div>

      {landing && (
        <div className="demo-landing">
          <span className="dl-pin">◉</span>
          <span className="dl-name">{landing.buildingName}</span>
          <span className="dl-coord">
            {landing.jd.toFixed(5)}, {landing.wd.toFixed(5)}
          </span>
        </div>
      )}
    </div>
  );
}
