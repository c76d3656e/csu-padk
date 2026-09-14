import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
let buf = "";
for (const f of ["ywViews-qxjlfx-dk-index.822cf527.js","ywViews-qxjlfx-dk-rule.bb824f5b.js"]) {
  const s = fs.readFileSync(dir + "\\" + f, "utf8");
  buf += `\n\n@@@@@@@@@@ ${f} len=${s.length} @@@@@@@@@@\n`;
  buf += s;
}
fs.writeFileSync(process.argv[2] + "\\h5_dk.txt", buf, "utf8");
console.log("bytes=" + buf.length);
