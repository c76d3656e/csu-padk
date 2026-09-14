import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
let buf = "";
const kws = ["studentDk","checkDkLocation","getDqrRkTj","sfwcdk","dkbc","dklb"];
for (const f of files) {
  const s = fs.readFileSync(dir + "\\" + f, "utf8");
  for (const k of kws) {
    let i = s.indexOf(k);
    if (i === -1) continue;
    if (k === "studentDk" || k === "checkDkLocation" || k === "getDqrRkTj") {
      let p = -1, n = 0;
      while ((p = s.indexOf(k, p + 1)) !== -1 && n < 6) {
        n++;
        buf += `\n### ${f} :: ${k} @${p}\n` + s.slice(Math.max(0,p-260), p+260).replace(/\s+/g," ") + "\n";
      }
    }
  }
}
fs.writeFileSync(process.argv[2] + "\\h5_dkapi.txt", buf, "utf8");
console.log("bytes=" + buf.length);
