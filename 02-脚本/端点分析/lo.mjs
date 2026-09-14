import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
let buf = "";
for (const f of files) {
  const s = fs.readFileSync(dir + "\\" + f, "utf8");
  let i = s.indexOf("loginOther");
  if (i === -1) continue;
  let p = -1, n = 0;
  while ((p = s.indexOf("loginOther", p + 1)) !== -1 && n < 4) {
    n++;
    buf += `\n### ${f} :: loginOther @${p}\n` + s.slice(Math.max(0,p-350), p+350).replace(/\s+/g," ") + "\n";
  }
}
// generatekey 定义
for (const f of files) {
  const s = fs.readFileSync(dir + "\\" + f, "utf8");
  let i = s.indexOf("generatekey");
  if (i === -1) continue;
  buf += `\n### ${f} :: generatekey @${i}\n` + s.slice(Math.max(0,i-400), i+400).replace(/\s+/g," ") + "\n";
  break;
}
fs.writeFileSync(process.argv[2] + "\\cas_loginother.txt", buf, "utf8");
console.log("bytes=" + buf.length);
