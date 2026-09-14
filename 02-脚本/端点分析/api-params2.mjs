/* 参数提取 v2：兼容 webpack 的 (0, mod.fn)({...}) 调用形式 */
import fs from "node:fs";

const ROOT = process.argv[2];
const DIRS = [ROOT + "\\chunks", ROOT + "\\js", ROOT + "\\h5\\static\\js"];

const inventory = JSON.parse(fs.readFileSync("api-inventory.json", "utf8"));
const FN_NAMES = new Set();
for (const r of inventory) for (const f of r.fn) FN_NAMES.add(f);

function readObject(src, braceStart) {
  let depth = 0, i = braceStart, inStr = null;
  for (; i < src.length && i < braceStart + 3000; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(braceStart, i + 1); }
  }
  return null;
}

const paramKeys = new Map();
const samples = new Map();

for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const s = fs.readFileSync(dir + "\\" + f, "utf8");
    // 先粗筛：含有清单里的函数名
    const cand = [];
    for (const fn of FN_NAMES) if (s.includes(fn)) cand.push(fn);
    if (!cand.length) continue;

    for (const fn of cand) {
      // 允许 fn(   /  fn)(   /  fn)({   /  fn({ paramsData: ...
      const re = new RegExp("\\b" + fn.replace(/\$/g, "\\$") + "\\s*\\)?\\s*\\(\\s*\\{", "g");
      let m;
      let n = 0;
      while ((m = re.exec(s)) !== null && n < 30) {
        n++;
        const brace = s.indexOf("{", m.index + fn.length);
        if (brace === -1) continue;
        const obj = readObject(s, brace);
        if (!obj || obj.length < 4) continue;
        let map = paramKeys.get(fn);
        if (!map) { map = new Map(); paramKeys.set(fn, map); }
        // 只取顶层键
        const keys = [];
        let depth = 0, inStr = null, buf = "";
        for (let i = 1; i < obj.length; i++) {
          const c = obj[i];
          if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = null; buf += c; continue; }
          if (c === '"' || c === "'" || c === "`") { inStr = c; buf += c; continue; }
          if (c === "{" || c === "[" || c === "(") { depth++; continue; }
          if (c === "}" || c === "]" || c === ")") { depth--; continue; }
          if (depth === 0 && c === ":") {
            const k = buf.trim().replace(/^["'`]|["'`]$/g, "");
            if (/^[A-Za-z_$][\w$]{0,39}$/.test(k)) keys.push(k);
            buf = "";
            continue;
          }
          if (depth === 0 && c === ",") { buf = ""; continue; }
          buf += c;
        }
        for (const k of keys) map.set(k, (map.get(k) || 0) + 1);
        if (!samples.has(fn)) samples.set(fn, new Set());
        const set = samples.get(fn);
        if (set.size < 3) set.add(obj.length > 300 ? obj.slice(0, 300) + "…" : obj);
      }
    }
  }
}

for (const r of inventory) {
  r.paramKeys = r.fn
    .map((f) => [...(paramKeys.get(f) || new Map()).entries()])
    .flat()
    .reduce((acc, [k, v]) => { acc.set(k, (acc.get(k) || 0) + v); return acc; }, new Map());
  r.paramKeys = [...r.paramKeys.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k, n }));
  const set = samples.get(r.fn[0]);
  r.sample = set ? [...set][0] : null;
}

fs.writeFileSync("api-inventory.json", JSON.stringify(inventory, null, 2), "utf8");
const hit = inventory.filter((r) => r.paramKeys.length).length;
console.log(`端点 ${inventory.length}，提取到参数键 ${hit} 个 (${((hit / inventory.length) * 100).toFixed(1)}%)`);
console.log("\n示例:");
for (const r of inventory.filter((x) => x.paramKeys.length).slice(0, 8)) {
  console.log(`  ${r.full}`);
  console.log(`     keys: ${r.paramKeys.slice(0, 14).map((p) => p.k).join(", ")}`);
}
