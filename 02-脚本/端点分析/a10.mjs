import fs from "node:fs";
const out = process.argv[2] + "\\chunks";
let buf = "";
for (const f of ["pksrd-DJxB7cJ4.js","xnzsdk-MhX_aW5I.js","xwzfdk-B3HwevCp.js","index-Dlk8IZzm.js"]) {
  const p = out + "\\" + f;
  if (!fs.existsSync(p)) { buf += `MISSING ${f}\n`; continue; }
  const s = fs.readFileSync(p, "utf8");
  buf += `\n\n@@@@@ ${f} len=${s.length} @@@@@\n`;
  buf += s;
}
fs.writeFileSync(process.argv[2] + "\\dump_core.txt", buf, "utf8");
console.log("bytes=" + buf.length);
