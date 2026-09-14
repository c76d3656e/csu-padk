import fs from "node:fs";
const out = process.argv[2] + "\\chunks";
const files = fs.readdirSync(out);
const hits = {};
const paths = new Set();
for (const f of files) {
  const s = fs.readFileSync(out + "\\" + f, "utf8");
  if (/pksrd|平安|打卡/.test(s)) hits[f] = (s.match(/pksrd[\w/-]*/g) || []).slice(0,10);
  for (const m of s.matchAll(/["'`](\/[\w\/-]{4,}[\w\/-]*?)["'`]/g)) { if (m[1].startsWith("/api")||m[1].startsWith("/fdcwonsun")||m[1].startsWith("/znzhxg")) paths.add(m[1]); }
}
console.log("=== FILES WITH pksrd/平安/打卡 ===");
console.log(Object.keys(hits).join("\n"));
console.log("\n=== API PATH SAMPLES ===");
console.log([...paths].slice(0,60).join("\n"));
console.log("COUNT=" + paths.size);
