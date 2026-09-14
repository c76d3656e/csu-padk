import fs from "node:fs";
const s = fs.readFileSync(process.argv[2] + "\\js\\index-CtIQ-390.js", "utf8");
// dump postDes 所在模块前后
fs.writeFileSync(process.argv[2] + "\\pcpost.txt", s.slice(136000, 152000), "utf8");
console.log("dumped 16000");
// 搜加密特征
let buf = "";
for (const k of ["Utf8.parse","AES.encrypt","AES.decrypt","CryptoJS","encryptData","decryptData","function yr","function ur","yr=","ur="]) {
  let i = s.indexOf(k), n = 0, hits = [];
  while (i !== -1 && n < 3) { n++; hits.push(i); i = s.indexOf(k, i+1); }
  if (hits.length) buf += `${k}: ${hits.join(", ")}\n`;
}
fs.writeFileSync(process.argv[2] + "\\cryptohits.txt", buf, "utf8");
console.log(buf);
