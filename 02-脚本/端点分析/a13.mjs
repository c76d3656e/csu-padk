import fs from "node:fs";
const out = process.argv[2] + "\\chunks";
let buf = "";
for (const f of ["index-Cmk8tEE5.js","index-DleRb4dy.js","index-CHEx_kJH.js","request-BihiTeB0.js","axios-DUsTPAXz.js","index-B2ylzV83.js"]) {
  const p = out + "\\" + f;
  if (!fs.existsSync(p)) { buf += `MISSING ${f}\n`; continue; }
  const s = fs.readFileSync(p, "utf8");
  buf += `\n\n@@@@@ ${f} len=${s.length} @@@@@\n`;
  buf += s.length > 22000 ? s.slice(0,22000) + "\n...[TRUNC]..." : s;
}
fs.writeFileSync(process.argv[2] + "\\dump_req.txt", buf, "utf8");
console.log("bytes=" + buf.length);
