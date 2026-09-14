import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
let buf = "";
const counts = {};
for (const f of files) {
  const s = fs.readFileSync(dir + "\\" + f, "utf8");
  const n = s.split("postDes").length - 1;
  if (!n) continue;
  counts[f] = n;
  // 只在出现次数较少（可能含定义）或主包里 dump 上下文
  if (f === "chunk-vendors.js" || f === "index.js" || /service|http|request|axios|api/i.test(f)) {
    let p = -1, c = 0;
    while ((p = s.indexOf("postDes", p + 1)) !== -1 && c < 4) {
      c++;
      buf += `\n### ${f} @${p}\n` + s.slice(Math.max(0,p-800), p+900).replace(/\s+/g," ") + "\n";
    }
  }
}
buf = "FILES_WITH_postDes:\n" + Object.entries(counts).sort((a,b)=>a[1]-b[1]).map(([k,v])=>`  ${k}: ${v}`).join("\n") + "\n" + buf;
fs.writeFileSync(process.argv[2] + "\\postdes2.txt", buf, "utf8");
console.log("files=" + Object.keys(counts).length);
console.log(Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>k+":"+v).join(" | "));
