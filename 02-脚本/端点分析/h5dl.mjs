import fs from "node:fs";
import path from "node:path";
const root = process.argv[2];
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const files = fs.readFileSync(root + "\\h5_files.txt", "utf8").split("\n").filter(Boolean);
const out = root + "\\h5\\static\\js";
const base = "https://zhxg.csu.edu.cn/znzhxgpt_h5/static/js/";
let ok = 0, fail = 0;
const q = files.slice();
async function w() {
  while (q.length) {
    const f = q.shift();
    const p = path.join(out, f);
    if (fs.existsSync(p) && fs.statSync(p).size > 0) { ok++; continue; }
    try {
      const r = await fetch(base + f, { headers: { "User-Agent": "Mozilla/5.0 (iPhone) MicroMessenger/8.0.40" } });
      if (!r.ok) { fail++; continue; }
      fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
      ok++;
    } catch { fail++; }
  }
}
await Promise.all(Array.from({ length: 12 }, w));
console.log(`ok=${ok} fail=${fail}`);
