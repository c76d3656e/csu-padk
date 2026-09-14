import fs from "node:fs";
const out = process.argv[2] + "\\chunks";
function dump(f, kws, w=400, lim=4) {
  const s = fs.readFileSync(out + "\\" + f, "utf8");
  console.log(`\n########## ${f} (len=${s.length}) ##########`);
  for (const k of kws) {
    let p = -1, n = 0;
    while ((p = s.indexOf(k, p + 1)) !== -1 && n < lim) { n++; console.log(`--[${k}]--`); console.log(s.slice(Math.max(0,p-w), p+w).replace(/\s+/g," ")); }
    if (n === 0) console.log(`--[${k}] NOT FOUND`);
  }
}
dump("common-C0kxIZcY.js", ["baseURL","axios.create","interceptors.request","token","/znzhxgpt"], 350, 3);
dump("padkDict-BMyy0bD4.js", ["/", "padk", "打卡"], 300, 6);
