/* 提取调用方读取的返回字段（result.data.xxx / res.data.records ...）*/
import fs from "node:fs";

const ROOT = process.argv[2];
const DIRS = [ROOT + "\\chunks", ROOT + "\\js", ROOT + "\\h5\\static\\js"];
const inventory = JSON.parse(fs.readFileSync("api-inventory.json", "utf8"));
const FN = new Set();
for (const r of inventory) for (const f of r.fn) FN.add(f);

const out = new Map(); // fn -> Map(field -> count)

const FIELD_RE = /\.data\s*\.\s*([A-Za-z_$][\w$]{0,30})/g;

for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const s = fs.readFileSync(dir + "\\" + f, "utf8");
    for (const fn of FN) {
      const i = s.indexOf(fn);
      if (i === -1) continue;
      // 取该函数名附近窗口（调用点前后）
      let p = -1;
      let n = 0;
      while ((p = s.indexOf(fn, p + 1)) !== -1 && n < 12) {
        n++;
        const win = s.slice(p, Math.min(s.length, p + 700));
        FIELD_RE.lastIndex = 0;
        let m;
        let c = 0;
        while ((m = FIELD_RE.exec(win)) !== null && c < 14) {
          c++;
          const k = m[1];
          if (/^(length|push|map|filter|forEach|slice|toFixed|indexOf)$/.test(k)) continue;
          let mm = out.get(fn);
          if (!mm) { mm = new Map(); out.set(fn, mm); }
          mm.set(k, (mm.get(k) || 0) + 1);
        }
      }
    }
  }
}

for (const r of inventory) {
  const acc = new Map();
  for (const f of r.fn) {
    const m = out.get(f);
    if (!m) continue;
    for (const [k, v] of m) acc.set(k, (acc.get(k) || 0) + v);
  }
  r.resultFields = [...acc.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, v]) => v >= 1)
    .slice(0, 16)
    .map(([k, n]) => ({ k, n }));
}

fs.writeFileSync("api-inventory.json", JSON.stringify(inventory, null, 2), "utf8");

const hit = inventory.filter((r) => r.resultFields.length).length;
console.log(`返回字段提取命中 ${hit}/${inventory.length}`);
console.log("\n示例:");
for (const r of inventory.filter((x) => x.resultFields.length).slice(0, 6)) {
  console.log(`  ${r.full}`);
  console.log(`     返回: ${r.resultFields.map((p) => p.k).join(", ")}`);
}
