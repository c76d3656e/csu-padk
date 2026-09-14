import fs from "node:fs";
const dir = process.argv[2] + "\\h5\\static\\js";
const files = fs.readdirSync(dir).filter(f=>/qxjlfx|dk|padk|daka/i.test(f));
console.log("RELATED_CHUNKS:\n" + files.join("\n"));
