import fs from "node:fs";
const out = process.argv[2] + "\\chunks";
const files = fs.readdirSync(out);
const found = new Map();
for (const f of files) {
  const s = fs.readFileSync(out + "\\" + f, "utf8");
  for (const m of s.matchAll(/["'`]([a-zA-Z][\w.]*\/[\w\/{}.-]{3,})["'`]/g)) {
    const v = m[1];
    if (/^(https?:)?\/\//.test(v)) continue;
    if (/\.(js|css|png|svg|jpg|json|woff2?)$/.test(v)) continue;
    if (/^(node_modules|\.\/|\.\.\/)/.test(v)) continue;
    if (v.startsWith("image/")||v.startsWith("text/")||v.startsWith("application/")) continue;
    const key = v;
    if (!found.has(key)) found.set(key, f);
  }
}
const list = [...found.keys()];
const api = list.filter(v => /^(znzhxgpt|fdcwonsun|api|padk|wt|wf|dk)/i.test(v));
console.log("=== CANDIDATE ENDPOINTS (" + api.length + ") ===");
console.log(api.slice(0,150).join("\n"));
