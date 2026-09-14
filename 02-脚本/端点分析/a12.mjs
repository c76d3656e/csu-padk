import fs from "node:fs";
const out = process.argv[2] + "\\chunks";
const files = fs.readdirSync(out);
const kws = ["请使用手机","仅支持在手机","使用手机扫码","手机端","移动端","请在微信","扫码或在微信","wechatOnly","onlyMobile","needPhone"];
let buf = "";
for (const f of files) {
  const s = fs.readFileSync(out + "\\" + f, "utf8");
  for (const k of kws) {
    let p = s.indexOf(k);
    if (p === -1) continue;
    buf += `\n### ${f} :: ${k} :: count=${s.split(k).length-1}\n`;
    buf += s.slice(Math.max(0,p-400), p+400).replace(/\s+/g," ") + "\n";
  }
}
fs.writeFileSync(process.argv[2] + "\\dump_gate.txt", buf, "utf8");
console.log("gate_bytes=" + buf.length);
