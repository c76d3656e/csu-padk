import fs from "node:fs";
const s = fs.readFileSync(process.argv[2] + "\\cas\\encrypt.js", "utf8");
fs.writeFileSync(process.argv[2] + "\\cas_encrypt_tail.txt", s.slice(9000), "utf8");
console.log("tail bytes=" + (s.length - 9000));
