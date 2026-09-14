import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
let buf = "";
// 1) 主包里 error 路由的触发逻辑
const idx = fs.readFileSync(dir + "\\index.js", "utf8");
const probes = ["pages/public/error","public/error"];
for (const p of probes) {
  let i = -1, n = 0;
  while ((i = idx.indexOf(p, i + 1)) !== -1 && n < 4) {
    n++;
    buf += `\n### index.js :: ${p} @${i}\n` + idx.slice(Math.max(0,i-900), i+500).replace(/\s+/g," ") + "\n";
  }
}
// 2) 环境判断
for (const p of ["isPC","isPc","checkEnv","isDesktop","platform"]) {
  let i = -1, n = 0;
  while ((i = idx.indexOf(p, i + 1)) !== -1 && n < 2) {
    n++;
    buf += `\n### index.js :: ${p} @${i}\n` + idx.slice(Math.max(0,i-600), i+600).replace(/\s+/g," ") + "\n";
  }
}
fs.writeFileSync(process.argv[2] + "\\h5_env.txt", buf, "utf8");
console.log("bytes=" + buf.length);
