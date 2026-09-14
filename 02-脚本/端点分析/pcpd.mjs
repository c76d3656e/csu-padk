import fs from "node:fs";
const dirs = [process.argv[2] + "\\js", process.argv[2] + "\\chunks"];
let buf = "";
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".js"))) {
    const s = fs.readFileSync(dir + "\\" + f, "utf8");
    let i = -1;
    while ((i = s.indexOf("postDes", i + 1)) !== -1) {
      const prev = s.slice(Math.max(0, i - 15), i);
      const next = s.slice(i + 7, i + 25);
      // 只看不像 ".postDes(" 调用 的
      if (prev.endsWith(".") && next.trimStart().startsWith("(")) continue;
      buf += `\n### ${f} @${i}\n   prev="${prev}" next="${next}"\n`;
      buf += s.slice(Math.max(0, i - 600), i + 1200).replace(/\s+/g, " ") + "\n";
    }
  }
}
fs.writeFileSync(process.argv[2] + "\\pcpostdes.txt", buf, "utf8");
console.log("bytes=" + buf.length);
