/* 端到端验证：直接使用 src/core 的实现代码（非复刻） */
import fs from "node:fs";

// ── 1. 把 core 打包成 Node 可加载的 ESM ──
// 由外壳脚本先执行 esbuild 完成

// ── 2. 从会话文件注入 mock storage ──
const S = JSON.parse(fs.readFileSync("zhxg-session.json", "utf8"));

function mockStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

globalThis.localStorage = mockStorage({
  token: S.token,
  casual: S.caasual,
});
globalThis.sessionStorage = mockStorage();

// ── 3. 加载真实实现 ──
const { api, getToken, getCasual } = await import("./.tmp-core/api.js");
const { generateLanding, normalizeBuildings, distanceM } = await import("./.tmp-core/geo.js");

console.log("═".repeat(70));
console.log("端到端验证（使用项目实际源码）");
console.log("═".repeat(70));

const token = getToken();
const casual = getCasual();
console.log("\n[凭据] token =", token ? token.slice(0, 20) + "…" : "(空)");
console.log("[凭据] casual =", casual);

const ctx = { token, casual, agentId: "" };

// ── 班次 ──
const shift = await api.shift(ctx);
console.log("\n[班次]", shift.data.dkbc, "| 时间窗", shift.data.dksjfw, "| 可打卡", shift.data.kdk, "|", shift.data.bkyy);
console.log("[围栏]", JSON.stringify(shift.data.kqfwxx));

// ── 楼栋 ──
const bl = await api.buildings(ctx);
const list = normalizeBuildings(bl.data.list);
console.log("\n[楼栋] 共", list.length, "栋，校区:", (bl.data.xqList || []).join(" / "));

// ── 以「学生3舍」附近为圆心（取天心校区第一栋）──
const target = list.find((b) => b.ldmc.includes("3舍")) || list[0];
const center = { jd: +target.jd, wd: +target.wd };
console.log("\n[圆心]", `${target.xqmc}·${target.ldmc}`, center);

// ── 生成 6 个落点，检查去重与围栏 ──
console.log("\n[落点生成] 连续生成 6 个，验证不重合 + 均在 300m 围栏内");
const history = [];
const recent = [];
const fence = shift.data.kqfwxx?.[0]?.dkfw ?? 300;
let minPair = Infinity;

for (let i = 0; i < 6; i++) {
  const l = generateLanding(list, center, history, recent, {
    fenceRadius: fence,
    minOffset: 15,
    maxOffset: 90,
    minSeparation: 45,
    neighborRadius: 250,
  });
  history.unshift(l);
  recent.unshift(l.building?.id ?? "");
  const inFence = l.distFromCenter <= fence;
  console.log(
    `  #${i + 1} ${l.buildingName.padEnd(18)} 偏移${String(l.offset).padStart(6)}m  ` +
    `距圆心${String(l.distFromCenter).padStart(6)}m  方位${String(l.angle).padStart(6)}°  ` +
    `${inFence ? "围栏内✓" : "超围栏✗"}  ${l.jd},${l.wd}`
  );
}
for (let i = 0; i < history.length; i++)
  for (let j = i + 1; j < history.length; j++)
    minPair = Math.min(minPair, distanceM(history[i], history[j]));
console.log(`  → 任意两点最近距离 ${minPair.toFixed(1)}m（要求 ≥45m）${minPair >= 45 ? " ✓ 无重合" : " ✗ 有重合"}`);
const allIn = history.every((h) => h.distFromCenter <= fence);
console.log(`  → 全部在 ${fence}m 围栏内：${allIn ? "✓" : "✗"}`);

// ── 围栏预检（只读，不提交打卡）──
console.log("\n[服务端围栏预检]（只读，不打卡）");
const probe = history[0];
const chk = await api.checkLocation(ctx, { jd: probe.jd, wd: probe.wd, dklb: "0" });
console.log("  请求点:", probe.jd, probe.wd);
console.log("  响应  :", JSON.stringify(chk.data));

console.log("\n" + "═".repeat(70));
console.log("验证完成 —— 未提交任何打卡");
console.log("═".repeat(70));
