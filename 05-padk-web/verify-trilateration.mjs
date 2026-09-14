/* 三边定位解算验证：给定真实圆心，用合成的 pcMi 反解，看误差多大 */

const L = 250; // 采样跨度（米）
const M_PER_DEG_LAT = 111320;

function solve(seed, center, spanM = L, quantize = 0) {
  const jdPerM = 1 / (M_PER_DEG_LAT * Math.cos((seed.wd * Math.PI) / 180));
  const wdPerM = 1 / M_PER_DEG_LAT;

  // 真实距离（米）
  const dxTrue = (center.jd - seed.jd) / jdPerM;
  const dyTrue = (center.wd - seed.wd) / wdPerM;

  const q = (v) => (quantize ? Math.round(v / quantize) * quantize : v);
  const d1 = q(Math.hypot(dxTrue, dyTrue));
  const d2 = q(Math.hypot(dxTrue - spanM, dyTrue));
  const d3 = q(Math.hypot(dxTrue, dyTrue - spanM));

  const x = (d1 * d1 - d2 * d2 + spanM * spanM) / (2 * spanM);
  const y = (d1 * d1 - d3 * d3 + spanM * spanM) / (2 * spanM);

  const errM = Math.hypot(x - dxTrue, y - dyTrue);
  return { d1, d2, d3, dxTrue, dyTrue, x, y, errM };
}

const seed = { jd: 112.9388, wd: 28.1665 };
const jdPerM = 1 / (M_PER_DEG_LAT * Math.cos((seed.wd * Math.PI) / 180));
const wdPerM = 1 / M_PER_DEG_LAT;
const at = (dx, dy) => ({ jd: seed.jd + dx * jdPerM, wd: seed.wd + dy * wdPerM });

console.log("跨度 L =", L, "米");
console.log("═".repeat(84));
console.log(
  "圆心相对种子位移".padEnd(22) + "三点偏差(米)".padEnd(26) + "解算位移(米)".padEnd(24) + "误差"
);
console.log("─".repeat(84));

const cases = [
  [0, 0], [50, 0], [0, 80], [120, -90], [-200, 150],
  [0, 280], [300, 300], [-450, -380], [800, 600], [1500, -1200],
];

for (const [dx, dy] of cases) {
  const r = solve(seed, at(dx, dy));
  console.log(
    `${dx},${dy}`.padEnd(22) +
      `${r.d1.toFixed(0)}/${r.d2.toFixed(0)}/${r.d3.toFixed(0)}`.padEnd(26) +
      `${r.x.toFixed(1)},${r.y.toFixed(1)}`.padEnd(24) +
      `${r.errM.toFixed(2)} m`
  );
}

console.log("\n考虑「pcMi 取整到米」带来的量化误差");
console.log("─".repeat(84));
let worst = 0;
for (let i = 0; i < 200; i++) {
  const dx = (Math.random() - 0.5) * 1600;
  const dy = (Math.random() - 0.5) * 1600;
  const r = solve(seed, at(dx, dy), L, 1);
  worst = Math.max(worst, r.errM);
}
console.log(`  200 次随机取点，最大解算误差 = ${worst.toFixed(2)} m`);

console.log("\n加大跨度到 400 米（提高抗量化能力）");
let worst2 = 0;
for (let i = 0; i < 200; i++) {
  const dx = (Math.random() - 0.5) * 1600;
  const dy = (Math.random() - 0.5) * 1600;
  const r = solve(seed, at(dx, dy), 400, 1);
  worst2 = Math.max(worst2, r.errM);
}
console.log(`  最大解算误差 = ${worst2.toFixed(2)} m`);
