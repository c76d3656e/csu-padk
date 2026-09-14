import fs from "node:fs";
const out = process.argv[2] + "\\chunks";
const files = fs.readdirSync(out);
let buf = "";
const seen = new Set();
for (const f of files) {
  const s = fs.readFileSync(out + "\\" + f, "utf8");
  for (const m of s.matchAll(/["'`](\/(?:qxj|pksrd|znzhxgpt)[\w\/{}.-]{0,70})["'`]/g)) {
    const k = m[1];
    const key = k.replace(/\$\{[^}]+\}/g, "{}");
    if (seen.has(key)) continue; seen.add(key);
    buf += `${key}\t${f}\n`;
  }
}
fs.writeFileSync(process.argv[2] + "\\dump_api.txt", buf, "utf8");
console.log("unique_endpoints=" + seen.size);
