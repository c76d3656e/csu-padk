import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
let buf = "";
for (const f of files) {
  const s = fs.readFileSync(dir + "\\" + f, "utf8");
  for (const pat of ["postencrypt", "postDes", "doUrl"]) {
    // 找定义：形如 xxx.postDes = function / postDes(e,t,n){ / postDes:function
    const re = new RegExp("(?:^|[,.{;])\\s*" + pat + "\\s*(?::|=)\\s*(?:function|\\()", "g");
    let m;
    while ((m = re.exec(s)) !== null) {
      buf += `\n### ${f} :: DEF ${pat} @${m.index}\n` + s.slice(Math.max(0, m.index - 200), m.index + 1500).replace(/\s+/g, " ") + "\n";
    }
  }
}
fs.writeFileSync(process.argv[2] + "\\defs.txt", buf, "utf8");
console.log("bytes=" + buf.length);
