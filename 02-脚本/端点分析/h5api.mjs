import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
const seen = new Map();
for (const f of files) {
  const s = fs.readFileSync(dir + "\\" + f, "utf8");
  for (const m of s.matchAll(/["'`](\/[a-z][a-z0-9-]{1,30}\/[a-zA-Z][\w\/{}.-]{1,60})["'`]/g)) {
    const k = m[1];
    if (/\.(js|css|png|jpg|svg|json|woff2?|ttf|map|gif|webp|svg)$/i.test(k)) continue;
    if (/^\/(static|assets|img|images|fonts|pages|views|ywViews)\//.test(k)) continue;
    if (/\.vue/.test(k)) continue;
    const key = k.replace(/\$\{[^}]+\}/g, "{}");
    if (!seen.has(key)) seen.set(key, f);
  }
}
const rows = [...seen.entries()].sort();
let buf = "H5_ENDPOINTS=" + rows.length + "\n";
for (const [k,f] of rows) buf += `${k}\t${f}\n`;
fs.writeFileSync(process.argv[2] + "\\h5_api.txt", buf, "utf8");
console.log("total=" + rows.length);
