import fs from "node:fs";
const out = process.argv[2] + "\\chunks";
const files = fs.readdirSync(out);
let buf = "";
const seen = new Set();
for (const f of files) {
  const s = fs.readFileSync(out + "\\" + f, "utf8");
  // 任何形如 xxx/yyy 且含 padk|pksrd|dk|wd|checkin 的路径
  for (const m of s.matchAll(/["'`]([^"'`\s]{0,60}(?:padk|pksrd|dkdd|dkcb|dkjl|checkin|Checkin)[^"'`\s]{0,60})["'`]/g)) {
    const k = m[1]; if (k.includes("import")||k.includes(".js")) continue;
    if (seen.has(k)) continue; seen.add(k);
    buf += `${f}\t${k}\n`;
  }
}
fs.writeFileSync(process.argv[2] + "\\dump_paths.txt", buf, "utf8");
console.log("paths=" + seen.size);
