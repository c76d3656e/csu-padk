import fs from "node:fs";
const arr = JSON.parse(fs.readFileSync("api-inventory.json", "utf8"));

console.log("=== 未映射模块常量 ===");
const unknown = [...new Set(arr.filter((r) => r.prefix === "?").map((r) => r.mod))];
console.log(unknown.join(", "));

console.log("\n=== 未映射端点的路径样例 ===");
console.log(
  arr.filter((r) => r.prefix === "?").slice(0, 40).map((r) => `${r.mod}${r.path}`).join("\n")
);

console.log("\n=== 动作名分布（末段） ===");
const verbs = new Map();
for (const r of arr) {
  const seg = r.path.split("/").filter(Boolean).pop() || "";
  verbs.set(seg, (verbs.get(seg) || 0) + 1);
}
const top = [...verbs].sort((a, b) => b[1] - a[1]);
console.log(top.slice(0, 45).map(([k, v]) => `${k}(${v})`).join("  "));
console.log(`\n唯一末段数 = ${top.length}`);

console.log("\n=== HTTP 动词分布 ===");
const v = new Map();
for (const r of arr) v.set(r.verb, (v.get(r.verb) || 0) + 1);
console.log([...v].map(([k, n]) => `${k}:${n}`).join("  "));

console.log("\n=== 二级路径段（资源名）分布 ===");
const res = new Map();
for (const r of arr) {
  const seg = r.path.split("/").filter(Boolean)[0] || "";
  res.set(seg, (res.get(seg) || 0) + 1);
}
console.log(
  [...res]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([k, n]) => `${k}(${n})`)
    .join("  ")
);
