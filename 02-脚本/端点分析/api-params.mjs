/* 提取：① 每个 API 函数的调用参数键  ② 调用方读取的返回字段 */
import fs from "node:fs";

const ROOT = process.argv[2];
const DIRS = [
  ROOT + "\\chunks",
  ROOT + "\\js",
  ROOT + "\\h5\\static\\js",
];

const inventory = JSON.parse(fs.readFileSync("api-inventory.json", "utf8"));
const FN_NAMES = new Set();
for (const r of inventory) for (const f of r.fn) FN_NAMES.add(f);

/** 从 `{` 位置开始，做括号配对，返回对象文本 */
function readObject(src, braceStart) {
  let depth = 0;
  let i = braceStart;
  let inStr = null;
  for (; i < src.length && i < braceStart + 4000; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  return null;
}

/** 提取对象顶层键名（跳过嵌套） */
function topKeys(objText) {
  const keys = new Set();
  let depth = 0;
  let inStr = null;
  let buf = "";
  let i = 1;
  for (; i < objText.length; i++) {
    const c = objText[i];
    if (inStr) {
      if (c === "\\") { buf += c + objText[++i]; continue; }
      if (c === inStr) inStr = null;
      buf += c;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; buf += c; continue; }
    if (c === "{" || c === "[") { depth++; continue; }
    if (c === "}" || c === "]") { depth--; continue; }
    if (depth === 0 && c === ":" ) {
      const k = buf.trim().replace(/^["'`]|["'`]$/g, "");
      if (/^[A-Za-z_$][\w$]*$/.test(k)) keys.add(k);
      buf = "";
      // 跳到下一个逗号
      let d2 = 0, j = i + 1, s2 = null;
      for (; j < objText.length; j++) {
        const ch = objText[j];
        if (s2) { if (ch === "\\") j++; else if (ch === s2) s2 = null; continue; }
        if (ch === '"' || ch === "'" || ch === "`") { s2 = ch; continue; }
        if (ch === "{" || ch === "[" || ch === "(") d2++;
        else if (ch === "}" || ch === "]" || ch === ")") { if (d2 === 0) break; d2--; }
        else if (ch === "," && d2 === 0) break;
      }
      i = j;
      continue;
    }
    if (depth === 0 && (c === "," )) { buf = ""; continue; }
    buf += c;
  }
  // 简写属性 { foo, bar }
  for (const m of objText.matchAll(/[,{]\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/g)) {
    if (!objText.slice(0, m.index).includes(m[1] + ":")) keys.add(m[1]);
  }
  return [...keys].filter((k) => k.length > 1 && k.length < 40);
}

const paramKeys = new Map();   // fn -> Map(key -> count)
const callSamples = new Map(); // fn -> Set(short text)

for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const s = fs.readFileSync(dir + "\\" + f, "utf8");
    const re = /([A-Za-z_$][\w$]{1,40})\s*\(\s*\{/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const fn = m[1];
      // 只保留长度 ≥3 的具名函数，避免噪声
      if (fn.length < 3 || /^(if|for|while|switch|catch|function|return|typeof)$/.test(fn)) continue;
      const brace = s.indexOf("{", m.index + fn.length);
      const objText = readObject(s, brace);
      if (!objText) continue;
      const keys = topKeys(objText);
      if (!keys.length) continue;
      let map = paramKeys.get(fn);
      if (!map) { map = new Map(); paramKeys.set(fn, map); }
      for (const k of keys) map.set(k, (map.get(k) || 0) + 1);
      if (!callSamples.has(fn)) callSamples.set(fn, new Set());
      const set = callSamples.get(fn);
      if (set.size < 2) set.add(objText.slice(0, 260).replace(/\s+/g, " "));
    }
  }
}

// 合并到清单
for (const r of inventory) {
  const acc = new Map();
  for (const f of r.fn) {
    const m = paramKeys.get(f);
    if (!m) continue;
    for (const [k, v] of m) acc.set(k, (acc.get(k) || 0) + v);
  }
  r.paramKeys = [...acc.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k, n }));
  const s = callSamples.get(r.fn[0]);
  r.sample = s ? [...s][0] : null;
}

// 修正模块前缀
const FIX = { API_BASE_XLJKRZ: "/xljkrz", API_BASE_XLJK_RZ: "/xljkrz" };
for (const r of inventory) {
  if (r.prefix === "?") r.prefix = FIX[r.mod] ?? "?";
  r.full = `/znzhxgpt${r.prefix}${r.path}`;
}

fs.writeFileSync("api-inventory.json", JSON.stringify(inventory, null, 2), "utf8");

const withParams = inventory.filter((r) => r.paramKeys.length).length;
console.log(`端点 ${inventory.length}，其中 ${withParams} 个推断出参数键`);
console.log("\n模块分布:");
const byMod = new Map();
for (const r of inventory) byMod.set(r.prefix, (byMod.get(r.prefix) || 0) + 1);
for (const [p, n] of [...byMod].sort((a, b) => b[1] - a[1])) console.log(`  ${p.padEnd(14)} ${n}`);

console.log("\n样例（qxj 模块）:");
console.log(JSON.stringify(inventory.filter((r) => r.prefix === "/qxj").slice(0, 3), null, 2));
