import fs from "node:fs";
const dir = process.argv[2];
const files = fs.readdirSync(dir + "\\js").filter(f=>f.endsWith(".js"));
const kws = ["请使用手机","仅支持在手机","微信中打开","MicroMessenger","miniProgram","isWeixin","wechat","weixin"];
for (const f of files) {
  const s = fs.readFileSync(dir + "\\js\\" + f, "utf8");
  for (const k of kws) {
    let i = -1, n = 0;
    while ((i = s.indexOf(k, i + 1)) !== -1 && n < 6) {
      n++;
      console.log(`### ${f} :: ${k} @${i}`);
      console.log(s.slice(Math.max(0, i - 260), i + 320).replace(/\n/g, " "));
      console.log("");
    }
  }
}
