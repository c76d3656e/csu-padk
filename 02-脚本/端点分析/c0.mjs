import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
let buf = "";
for (const f of files) {
  const s = fs.readFileSync(dir + "\\" + f, "utf8");
  // 模块定义形态: "cee0":function(...)  或 cee0:function
  const m = s.match(/["']?cee0["']?\s*:\s*function\s*\([^)]*\)\s*\{/);
  if (!m) continue;
  const i = m.index;
  buf += `\n\n########## ${f} :: cee0 module @${i} ##########\n`;
  buf += s.slice(i, i + 6000);
}
fs.writeFileSync(process.argv[2] + "\\cee0.txt", buf, "utf8");
console.log("bytes=" + buf.length);
