import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
const kws = ["请使用手机","仅支持在手机","使用手机扫码","微信中打开","请在微信","手机端访问","移动端访问","扫码或在微信","wechat","MicroMessenger"];
let buf = "";
for (const f of files) {
  const s = fs.readFileSync(dir + "\\" + f, "utf8");
  for (const k of kws) {
    const n = s.split(k).length - 1;
    if (!n) continue;
    buf += `\n### ${f} :: ${k} :: x${n}\n`;
    let p = -1, c = 0;
    while ((p = s.indexOf(k, p + 1)) !== -1 && c < 2) { c++; buf += "   ..." + s.slice(Math.max(0,p-350), p+350).replace(/\s+/g," ") + "...\n"; }
  }
}
fs.writeFileSync(process.argv[2] + "\\h5_gate.txt", buf, "utf8");
console.log("bytes=" + buf.length);
