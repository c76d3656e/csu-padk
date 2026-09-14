import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
let buf = "";
const seen = new Set();
for (const f of files) {
  const s = fs.readFileSync(dir + "\\" + f, "utf8");
  // 找定义形态
  for (const pat of ["postDes=function", "postDes:function", "postDes=(", ".postDes=", "postencrypt=function", "postencrypt:function"]) {
    let i = s.indexOf(pat);
    if (i === -1) continue;
    const key = f + pat;
    if (seen.has(key)) continue; seen.add(key);
    buf += `\n### ${f} :: ${pat} @${i}\n` + s.slice(Math.max(0, i - 700), i + 1400).replace(/\s+/g, " ") + "\n";
  }
}
fs.writeFileSync(process.argv[2] + "\\postdes.txt", buf, "utf8");
console.log("bytes=" + buf.length + " hits=" + seen.size);
