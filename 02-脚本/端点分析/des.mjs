import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
let buf = "";
const targets = ["chunk-vendors.js","views-workflow-handleFlowTask-index.498fe14a.js","index.js","pages-service-index.35f81294.js"];
const kws = ["DES","TripleDES","desEncrypt","encryptData","postDes","postencrypt","decrypt"];
for (const f of targets) {
  const p = dir + "\\" + f;
  if (!fs.existsSync(p)) continue;
  const s = fs.readFileSync(p, "utf8");
  for (const k of kws) {
    const n = s.split(k).length - 1;
    if (!n) continue;
    buf += `\n### ${f} :: ${k} x${n}\n`;
    let i = -1, c = 0;
    while ((i = s.indexOf(k, i + 1)) !== -1 && c < 3) {
      c++;
      buf += "  @" + i + " ..." + s.slice(Math.max(0,i-320), i+380).replace(/\s+/g," ") + "...\n";
    }
  }
}
fs.writeFileSync(process.argv[2] + "\\des.txt", buf, "utf8");
console.log("bytes=" + buf.length);
