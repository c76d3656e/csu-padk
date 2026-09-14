import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const s = fs.readFileSync(dir + "\\index.js", "utf8");
for (const probe of ['[e]+".js"', '}[e]+"."', '+".js"', '"static/js/"']) {
  let i = -1;
  while ((i = s.indexOf(probe, i + 1)) !== -1) {
    console.log(`\n>>> probe=${probe} @${i}`);
    console.log(s.slice(Math.max(0, i - 120), i + 120));
    break;
  }
}
console.log("\n--- all \".js\" occurrences near r.p (first 5) ---");
let c = 0, p = -1;
while ((p = s.indexOf('.js"', p + 1)) !== -1 && c < 5) { c++; console.log(`@${p}: ` + s.slice(Math.max(0,p-150), p+30)); }
