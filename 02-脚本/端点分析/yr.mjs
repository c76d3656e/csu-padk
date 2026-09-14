import fs from "node:fs";
const dir = process.argv[2] + "\\js";
const s = fs.readFileSync(dir + "\\index-CtIQ-390.js", "utf8");
let buf = "";
// 找 yr / ur 的定义
for (const name of ["yr", "ur"]) {
  const pats = [
    new RegExp("(?:function|const|let|var)\\s+" + name + "\\s*[=(]", "g"),
    new RegExp("[,;{]" + name + "\\s*=\\s*function", "g"),
  ];
  for (const re of pats) {
    let m;
    while ((m = re.exec(s)) !== null) {
      buf += `\n### DEF ${name} @${m.index} :: ${m[0].slice(0,40)}\n` + s.slice(Math.max(0, m.index - 200), m.index + 1300).replace(/\s+/g, " ") + "\n";
    }
  }
}
fs.writeFileSync(process.argv[2] + "\\yrdur.txt", buf, "utf8");
console.log("bytes=" + buf.length);
