import fs from "node:fs";
const s = fs.readFileSync(process.argv[2] + "\\js\\index-CtIQ-390.js", "utf8");
console.log(s.slice(136200, 137400));
