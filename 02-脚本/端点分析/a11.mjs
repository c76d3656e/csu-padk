import fs from "node:fs";
const out = process.argv[2] + "\\chunks";
const files = fs.readdirSync(out);
const seen = new Map();
for (const f of files) {
  const s = fs.readFileSync(out + "\\" + f, "utf8");
  for (const m of s.matchAll(/["'`](\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/[a-zA-Z][\w\/]{1,60})["'`]/g)) {
    const k = m[1];
    if (/\.(js|css|png|jpg|svg|json|woff2?|ttf|map|gif|webp)$/i.test(k)) continue;
    if (/^\/(src|assets|node_modules|static|img|images|fonts|download)\//.test(k)) continue;
    if (/\.vue/.test(k)) continue;
    if (!seen.has(k)) seen.set(k, f);
  }
}
const arr = [...seen.entries()].sort();
let buf = "ENDPOINTS=" + arr.length + "\n";
for (const [k, f] of arr) buf += `${k}\t${f}\n`;
fs.writeFileSync(process.argv[2] + "\\dump_api_all.txt", buf, "utf8");
console.log("total=" + arr.length);
