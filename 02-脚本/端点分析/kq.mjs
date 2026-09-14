import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
let buf = "";
for (const f of files) {
  const s = fs.readFileSync(dir + "\\" + f, "utf8");
  for (const k of ["queryKqDkbc"]) {
    let i = s.indexOf(k), n = 0;
    while (i !== -1 && n < 4) { n++; buf += `\n### ${f} @${i}\n` + s.slice(Math.max(0,i-300), i+300).replace(/\s+/g," ") + "\n"; i = s.indexOf(k, i+1); }
  }
}
fs.writeFileSync(process.argv[2] + "\\kqdkbc.txt", buf, "utf8");
console.log("bytes=" + buf.length);
