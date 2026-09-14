/* 验证 token 有效性：调用需要鉴权的 basesys 接口 */
import fs from "node:fs";
const S = JSON.parse(fs.readFileSync("zhxg-session.json", "utf8"));
const ZHXG = "https://zhxg.csu.edu.cn";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.40";

async function probe(label, path, body, opts = {}) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    deviceType: "4",
    "User-Agent": UA,
    Origin: ZHXG,
    Referer: ZHXG + "/znzhxgpt_h5/",
    ...(opts.token === false ? {} : { Authorization: S.token, token: S.token }),
    AppCode: opts.appCode || "znzhxgpt",
    ...(opts.extra || {}),
  };
  const res = await fetch(ZHXG + path, { method: "POST", headers, body: JSON.stringify(body) });
  const t = await res.text();
  console.log(`\n[${label}] ${res.status}`);
  console.log("   " + t.replace(/\s+/g, " ").slice(0, 300));
  return { status: res.status, t };
}

console.log("══════ token 有效性验证（basesys 需鉴权接口）══════");
await probe("listMyBindYh (需鉴权)", "/znzhxgpt/basesys/rbac-yhgl/listMyBindYh", {});
await probe("listMyBindYh 无token", "/znzhxgpt/basesys/rbac-yhgl/listMyBindYh", {}, { token: false });
await probe("findYhXcxcdJsxx", "/znzhxgpt/basesys/app-xcxcd/findYhXcxcdJsxx", {});

console.log("\n══════ qxj 接口加各种 header 组合 ══════");
const P = "/znzhxgpt/qxj/qxj-padkglxx/jcqqwzsjsfndk";
const B = { paramsData: { jd: 112.9388, wd: 28.1657, dklb: "0" } };
await probe("baseline", P, B);
await probe("+MenuId=1", P, B, { extra: { MenuId: "1" } });
await probe("+agentId", P, B, { extra: { agentId: "1000002" } });
await probe("+deviceType=1", P, B, { extra: { deviceType: "1" } });
await probe("+AppCode=empty", P, B, { appCode: "" });
await probe("+Referer=web", P, B, { extra: { Referer: ZHXG + "/znzhxgpt_web/" } });
