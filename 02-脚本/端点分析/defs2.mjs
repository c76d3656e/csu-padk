import fs from "node:fs";
const dirs = [process.argv[2] + "\\chunks", process.argv[2] + "\\h5\\static\\js"];
let buf = "";
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".js"))) {
    const s = fs.readFileSync(dir + "\\" + f, "utf8");
    if (!s.includes("postDes")) continue;
    // 定义形态：postDes 后跟 = 或 : 再跟 function/(，且不是 .postDes( 调用
    const idxs = [];
    let i = -1;
    while ((i = s.indexOf("postDes", i + 1)) !== -1) idxs.push(i);
    // 取最后一次出现（定义通常在 api 模块中后部）—— 改取所有非 ".postDes(" 的
    for (const p of idxs) {
      const after = s.slice(p + 7, p + 40);
      if (/^\s*\(/.test(after)) continue;      // 调用 .postDes(...)
      if (/^\s*[=:]/.test(after)) {
        buf += `\n### ${f} @${p} after="${after.slice(0,30)}"\n` + s.slice(Math.max(0,p-400), p+1200).replace(/\s+/g," ") + "\n";
        break;
      }
    }
  }
}
fs.writeFileSync(process.argv[2] + "\\defs2.txt", buf, "utf8");
console.log("bytes=" + buf.length);
