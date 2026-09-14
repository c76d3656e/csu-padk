import fs from "node:fs";
const out = process.argv[2] + "\\chunks";
const target = ["pksrd-DJxB7cJ4.js","index-Cmk8tEE5.js","bjpy-BrCuFtRl.js","index-XeMvKYdj.js","index-ZDMVDnXp.js","DkfwEditDialog-FZp7oCEC.js","lxdksjgl-DUXYqpiI.js","zwzfgl-DhqZTh7c.js","dkcb_popup-Cg1W-xVM.js","CheckinRecordsDialog-DvMBkr5G.js","xjsh-BcCB7_CR.js","index-BGcKD7Nm.js"];
let buf = "";
for (const f of target) {
  const p = out + "\\" + f;
  if (!fs.existsSync(p)) { buf += `\n\n@@@@@ MISSING ${f}\n`; continue; }
  const s = fs.readFileSync(p, "utf8");
  buf += `\n\n@@@@@@@@@@ ${f} (len=${s.length}) @@@@@@@@@@\n`;
  buf += s.length > 30000 ? s.slice(0, 30000) : s;
}
fs.writeFileSync(process.argv[2] + "\\dump_padk.txt", buf, "utf8");
console.log("written " + buf.length);
