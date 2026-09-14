/* 探测：用学生 token 能否拿到「本人宿舍」 */
import fs from "node:fs";
import crypto from "node:crypto";

const S = JSON.parse(fs.readFileSync("zhxg-session.json", "utf8"));
const ZHXG = "https://zhxg.csu.edu.cn";
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.40";

const enc = (o) => {
  const c = crypto.createCipheriv("des-ecb", Buffer.from(S.caasual, "utf8").subarray(0, 8), null);
  c.setAutoPadding(true);
  return Buffer.concat([c.update(Buffer.from(JSON.stringify(o), "utf8")), c.final()]).toString("hex");
};

const H = {
  "Content-Type": "application/json; charset=utf-8",
  deviceType: "4",
  AppCode: "znzhxgpt",
  Authorization: S.token,
  token: S.token,
  "User-Agent": UA,
  Origin: ZHXG,
  Referer: ZHXG + "/znzhxgpt_h5/",
};

async function post(path, body) {
  const r = await fetch(ZHXG + path, { method: "POST", headers: H, body: enc(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 200) }; }
}
async function get(path, qs = "") {
  const r = await fetch(ZHXG + path + qs, { method: "GET", headers: H });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 200) }; }
}

const brief = (j, depth = 320) =>
  j.code ? `code=${j.code} ${j.message || ""} ${JSON.stringify(j.data).slice(0, depth)}` : JSON.stringify(j).slice(0, depth);

console.log("学号:", S.studentId);
console.log("═".repeat(72));

console.log("\n【1】ss-grhsxx/findGrhsxxByPage（不限条件）");
console.log(" ", brief(await post("/znzhxgpt/ssgl/ss-grhsxx/findGrhsxxByPage", {})));

console.log("\n【2】ss-grhsxx/findGrhsxxByPage（按学号）");
console.log(" ", brief(await post("/znzhxgpt/ssgl/ss-grhsxx/findGrhsxxByPage", { paramsData: { xh: S.studentId } })));

console.log("\n【3】ss-grhsxx/findGrhsxxByPage（分页 + 学号）");
console.log(
  " ",
  brief(await post("/znzhxgpt/ssgl/ss-grhsxx/findGrhsxxByPage", { pageNo: 1, pageSize: 10, paramsData: { xh: S.studentId } }))
);

console.log("\n【4】ss-ldxx/findCwfpLdTjByList");
console.log(" ", brief(await post("/znzhxgpt/ssgl/ss-ldxx/findCwfpLdTjByList", {})));

console.log("\n【5】ss-ldxx/findLdzbCjList（楼栋字典，已知可用）");
const ld = await post("/znzhxgpt/ssgl/ss-ldxx/findLdzbCjList", {});
console.log(" ", ld.code, ld.data?.list?.length, "栋");

console.log("\n【6】basesys 用户信息（看是否含宿舍字段）");
const me = await post("/znzhxgpt/basesys/rbac-yhgl/listMyBindYh", {});
console.log(" ", brief(me, 500));
