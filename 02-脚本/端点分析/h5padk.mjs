import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
let buf = "";
for (const f of files) {
  const s = fs.readFileSync(dir + "\\" + f, "utf8");
  for (const k of ["平安打卡","平安宿舍","宿舍打卡","打卡地点","打卡范围"]) {
    const n = s.split(k).length - 1;
    if (!n) continue;
    buf += `\n### ${f} :: ${k} :: x${n}\n`;
    let p = -1, c = 0;
    while ((p = s.indexOf(k, p + 1)) !== -1 && c < 2) { c++; buf += "   ..." + s.slice(Math.max(0,p-320), p+320).replace(/\s+/g," ") + "...\n"; }
  }
}
fs.writeFileSync(process.argv[2] + "\\h5_padk.txt", buf, "utf8");
console.log("bytes=" + buf.length);
