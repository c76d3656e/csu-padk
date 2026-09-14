import fs from "node:fs";
const out = process.argv[2] + "\\chunks";
const files = fs.readdirSync(out);
let n = 0;
for (const f of files) {
  const s = fs.readFileSync(out + "\\" + f, "utf8");
  let p = s.indexOf("/znzhxgpt");
  while (p !== -1 && n < 25) {
    console.log(`\n=== ${f} @${p}`);
    console.log(s.slice(Math.max(0,p-350), p+350).replace(/\s+/g," "));
    n++;
    p = s.indexOf("/znzhxgpt", p + 1);
  }
}
