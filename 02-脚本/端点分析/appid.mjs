import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const s = fs.readFileSync(dir + "\\index.js", "utf8");
let buf = "";
// getAppId 实现
for (const k of ["n.getAppId=u", "getAppId=function", "function u(){var", "appId"]) {
  let i = s.indexOf(k), n = 0;
  while (i !== -1 && n < 3) { n++; buf += `\n--[${k}] @${i}--\n` + s.slice(Math.max(0,i-700), i+400).replace(/\s+/g," ") + "\n"; i = s.indexOf(k, i+1); }
}
fs.writeFileSync(process.argv[2] + "\\appid.txt", buf, "utf8");
console.log("bytes=" + buf.length);
