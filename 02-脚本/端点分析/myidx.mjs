import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const s = fs.readFileSync(dir + "\\pages-login-myindex.2c86c85c.js", "utf8");
let buf = "len=" + s.length + "\n";
for (const k of ["lzc","uid","token","casLogin","caslogin","loginByCas","getToken","setStorageSync(\"token\""]) {
  let i = -1, n = 0;
  while ((i = s.indexOf(k, i + 1)) !== -1 && n < 6) {
    n++; buf += `\n--[${k}] @${i}--\n` + s.slice(Math.max(0,i-600), i+600).replace(/\s+/g," ") + "\n";
  }
}
fs.writeFileSync(process.argv[2] + "\\cas_myindex.txt", buf, "utf8");
console.log("bytes=" + buf.length);
