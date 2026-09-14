import fs from "node:fs";
const out = process.argv[2] + "\\chunks";
const files = fs.readdirSync(out);
const kws = ["请使用手机","仅支持在手机","微信中打开","MicroMessenger","\\u8bf7\\u4f7f\\u7528\\u624b\\u673a","OnlyMobile","isMobile","mobileOnly"];
for (const f of files) {
  const s = fs.readFileSync(out + "\\" + f, "utf8");
  for (const k of kws) {
    let i = s.indexOf(k);
    if (i === -1) continue;
    console.log(`\n=== ${f} :: ${k} :: hits=${s.split(k).length-1}`);
    let n = 0, p = -1;
    while ((p = s.indexOf(k, p + 1)) !== -1 && n < 3) { n++; console.log("   ..." + s.slice(Math.max(0,p-300), p+300).replace(/\s+/g," ") + "..."); }
  }
}
