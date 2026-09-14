/* 全量提取 API 定义：方法名 / HTTP 动词 / 模块常量 / 路径 */
import fs from "node:fs";

const DIRS = [
  { tag: "PC", dir: process.argv[2] + "\\chunks" },
  { tag: "PC", dir: process.argv[2] + "\\js" },
  { tag: "H5", dir: process.argv[2] + "\\h5\\static\\js" },
];

// 形如: e.foo=function(t){return a.default.postDes(r.API_BASE_QXJ+"/path",t,!0)}
const RE =
  /([A-Za-z_$][\w$]*)\s*=\s*function\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*return\s+[A-Za-z_$][\w$]*\.default\.(postDes|postencrypt|post|get|put|delete|download|downloadDes|sse)\s*\(\s*([A-Za-z_$][\w$]*)\.(API_BASE_\w+)\s*\+\s*"([^"]+)"/g;

const rows = new Map(); // key: `${module}|${path}` -> record

for (const { tag, dir } of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const s = fs.readFileSync(dir + "\\" + f, "utf8");
    RE.lastIndex = 0;
    let m;
    while ((m = RE.exec(s)) !== null) {
      const [, fn, , verb, , mod, path] = m;
      const key = `${mod}|${path}`;
      const cur = rows.get(key);
      if (cur) {
        cur.fn.add(fn);
        cur.src.add(tag);
      } else {
        rows.set(key, { mod, path, verb, fn: new Set([fn]), src: new Set([tag]), file: f });
      }
    }
  }
}

const arr = [...rows.values()].map((r) => ({
  mod: r.mod,
  path: r.path,
  verb: r.verb,
  fn: [...r.fn].sort(),
  src: [...r.src].join("+"),
}));

// 模块常量 -> URL 前缀（来自 index.js config 模块 2d62）
const MODULE_PREFIX = {
  API_BASE_SYS: "/basesys",
  API_BASE_YW: "/yw",
  API_BASE_FILE: "/file",
  API_BASE_FLOW: "/wszhxgpt-flow",
  API_BASE_AI: "/ai",
  API_BASE_AI_V3: "/aiagent",
  API_BASE_ZZ: "/zz",
  API_BASE_QXJ: "/qxj",
  API_BASE_ZHCP: "/zhcp",
  API_BASE_GFJY: "/gfjy",
  API_BASE_SSGL: "/ssgl",
  API_BASE_YWZS: "/ywzs",
  API_BASE_TZGG: "/tzgg",
  API_BASE_BBS: "/bbs",
  API_BASE_XLJK_RZ: "/xljkrz",
  API_BASE_XLFK: "/xlfk",
  API_BASE_DEKT: "/dekt",
  API_BASE_XFJS: "/xfjs",
  API_BASE_FDYDWGL: "/fdydwgl",
  API_BASE_XGXX: "/xgxx",
  API_BASE_ZGXSK: "/zgxsk",
  API_BASE_API: "/basesys",
};
for (const r of arr) {
  r.prefix = MODULE_PREFIX[r.mod] ?? "?";
  r.full = `/znzhxgpt${r.prefix}${r.path}`;
}

arr.sort((a, b) => (a.prefix + a.path).localeCompare(b.prefix + b.path));

// 统计
const byModule = new Map();
for (const r of arr) {
  if (!byModule.has(r.prefix)) byModule.set(r.prefix, []);
  byModule.get(r.prefix).push(r);
}

console.log("TOTAL_UNIQUE_ENDPOINTS =", arr.length);
console.log("\n按模块统计:");
for (const [p, list] of [...byModule].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${p.padEnd(18)} ${String(list.length).padStart(5)}`);
}

fs.writeFileSync("api-inventory.json", JSON.stringify(arr, null, 2), "utf8");
console.log("\n-> api-inventory.json");
