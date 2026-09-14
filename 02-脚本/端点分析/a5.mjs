import fs from "node:fs";
const out = process.argv[2] + "\\chunks";
const files = fs.readdirSync(out);
const pat = ["padk","/znzhxgpt","dkdd","dkcb"];
const map = new Map();
for (const f of files) {
  const s = fs.readFileSync(out + "\\" + f, "utf8");
  for (const p of pat) {
    const c = s.split(p).length - 1;
    if (c) { if(!map.has(p)) map.set(p,[]); map.get(p).push(`${f}:${c}`); }
  }
}
for (const [k,v] of map) { console.log(`\n### ${k} -> ${v.length} files`); console.log(v.slice(0,40).join(" | ")); }
