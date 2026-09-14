import fs from "node:fs";
const dirs = [process.argv[2] + "\\h5\\static\\js", process.argv[2] + "\\chunks"];
let buf = "";
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".js"))) {
    const s = fs.readFileSync(dir + "\\" + f, "utf8");
    for (const id of ["f717", "4c0a", "ae58"]) {
      const re = new RegExp('"' + id + '":function\\s*\\(([^)]*)\\)\\s*\\{');
      const m = s.match(re);
      if (!m) continue;
      buf += `\n\n########## ${f} :: module ${id} @${m.index} ##########\n`;
      buf += s.slice(m.index, m.index + 5000);
    }
  }
}
fs.writeFileSync(process.argv[2] + "\\httpmod.txt", buf, "utf8");
console.log("bytes=" + buf.length);
