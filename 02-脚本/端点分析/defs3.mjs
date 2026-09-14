import fs from "node:fs";
const dirs = [process.argv[2] + "\\chunks", process.argv[2] + "\\h5\\static\\js"];
let buf = "";
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".js"))) {
    const s = fs.readFileSync(dir + "\\" + f, "utf8");
    let i = -1;
    const hits = [];
    while ((i = s.indexOf("postDes", i + 1)) !== -1) {
      const prev = s.slice(Math.max(0, i - 12), i);
      hits.push([i, prev]);
    }
    // 统计前置字符，找非 "." 前缀的（即定义）
    const defs = hits.filter(([, prev]) => !prev.endsWith("."));
    if (defs.length) {
      buf += `\n### ${f}  total=${hits.length} nonDot=${defs.length}\n`;
      for (const [p, prev] of defs.slice(0, 3)) {
        buf += `   @${p} prev="${prev}"\n` + s.slice(Math.max(0,p-300), p+900).replace(/\s+/g," ") + "\n";
      }
    }
  }
}
fs.writeFileSync(process.argv[2] + "\\defs3.txt", buf, "utf8");
console.log("bytes=" + buf.length);
