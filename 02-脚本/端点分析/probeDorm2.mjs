/* 继续探测：学生 token 能访问的宿舍相关接口 */
import fs from "node:fs";
import crypto from "node:crypto";

const S = JSON.parse(fs.readFileSync("zhxg-session.json", "utf8"));
const ZHXG = "https://zhxg.csu.edu.cn";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.40";

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

async function hit(method, path, body) {
  const url = ZHXG + path;
  const r = await fetch(url, method === "GET"
    ? { method, headers: H }
    : { method, headers: H, body: enc(body) });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 150) }; }
  const s = j.code
    ? `${j.code} ${j.message || ""} ${JSON.stringify(j.data)?.slice(0, 200) ?? ""}`
    : JSON.stringify(j).slice(0, 200);
  console.log(`${(method + " " + path.replace("/znzhxgpt", "")).padEnd(62)} ${s}`);
  return j;
}

console.log("探测「本人宿舍」可能的学生端入口");
console.log("═".repeat(110));

await hit("POST", "/znzhxgpt/ssgl/grhscl", {});
await hit("POST", "/znzhxgpt/ssgl/grhscl/hscl", {});
await hit("POST", "/znzhxgpt/ssgl/grpscl/pscl", {});
await hit("POST", "/znzhxgpt/ssgl/ss-sjgl/overview", {});
await hit("POST", "/znzhxgpt/ssgl/ss-xqxx/findXqxxByList", {});
await hit("POST", "/znzhxgpt/ssgl/ss-ldxx/findLdxxByList", {});
await hit("POST", "/znzhxgpt/ssgl/ss-fjxx/findSsFjxxByPage", { pageNo: 1, pageSize: 5 });
await hit("POST", "/znzhxgpt/ssgl/ss-grhsxx/getGrhsxxById", { id: S.studentId });
await hit("GET", "/znzhxgpt/ssgl/ss-ldxx/findLdzbCjList", {});

console.log("\n考勤/打卡记录（可能含楼栋与坐标）");
console.log("─".repeat(110));
await hit("POST", "/znzhxgpt/qxj/qxj-padkglxx/queryPadkKqAyListByXh", { paramsData: { xh: S.studentId } });
await hit("POST", "/znzhxgpt/qxj/qxj-padkglxx/queryPadkKqAyListByXh", { xh: S.studentId });
await hit("POST", "/znzhxgpt/qxj/qxj-padkglxx/queryPadkKqAyListByXh", { paramsData: { xh: S.studentId, xn: "2025" } });
await hit("POST", "/znzhxgpt/qxj/qxj-dqr/queryBjDkRkTj", {});
await hit("POST", "/znzhxgpt/qxj/qxj-dktz/queryMyTzPage", { pageNo: 1, pageSize: 5 });
