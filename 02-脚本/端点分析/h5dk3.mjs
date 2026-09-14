import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const s = fs.readFileSync(dir + "\\ywViews-qxjlfx-dk-index.822cf527.js", "utf8");
let buf = `len=${s.length}\n`;
const probes = ["getLocation","latitude","longitude","jd:","wd:","dkjl","submit","dksj","dkbc","jwd","开卡","打卡成功","定位"];
for (const p of probes) {
  let i = -1, n = 0;
  while ((i = s.indexOf(p, i + 1)) !== -1 && n < 3) { n++; buf += `\n--[${p}] @${i}--\n` + s.slice(Math.max(0,i-500), i+500).replace(/\s+/g," ") + "\n"; }
}
fs.writeFileSync(process.argv[2] + "\\h5_dkindex.txt", buf, "utf8");
console.log("bytes=" + buf.length);
