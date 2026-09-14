import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const s = fs.readFileSync(dir + "\\pages-service-index.35f81294.js", "utf8");
const i = s.indexOf('"006f":function');
console.log("=== api module head @", i, "===");
console.log(s.slice(i, i + 400));
// 找 http 模块引用
const m = s.slice(i, i + 600).match(/var\s+([a-z])\s*=\s*[a-z]\(n\("([0-9a-f]{4})"\)\)/g);
console.log("\n=== 模块引用 ===");
console.log(m ? m.join("\n") : "(none)");
// 在整个文件里找该模块 id 的定义
const ids = [...s.slice(i, i + 900).matchAll(/n\("([0-9a-f]{4})"\)/g)].map(x => x[1]);
console.log("\nreferenced ids:", [...new Set(ids)].join(", "));
for (const id of new Set(ids)) {
  const re = new RegExp('"' + id + '":function');
  const j = s.search(re);
  console.log(`  ${id} -> def@${j}`);
}
