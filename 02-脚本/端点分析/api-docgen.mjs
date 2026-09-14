/* 由 api-inventory.json 生成完整 REST API 文档 */
import fs from "node:fs";

const inv = JSON.parse(fs.readFileSync("api-inventory.json", "utf8"));

/* ───────── 模块说明 ───────── */
const MODULES = {
  "/basesys": {
    name: "基础系统 / 统一权限",
    desc: "登录鉴权、用户、角色、组织架构、菜单权限、字典、参数配置。整个平台的地基，其余模块全部依赖它下发的 token 与权限点位。",
    resources: [
      ["rbac-yh", "用户账号（登录、绑定、切换身份）"],
      ["rbac-yhgl", "用户管理（列表、绑定关系）"],
      ["rbac-zzjg", "组织架构（学院/部门树）"],
      ["rbac-zdyqz", "自定义权组（菜单权限模板）"],
      ["rbac-js", "角色"],
      ["app-xcxcd", "小程序菜单点"],
      ["sys-sjzd", "数据字典"],
      ["sys-cs", "系统参数"],
      ["sys-rz", "操作日志"],
    ],
  },
  "/qxj": {
    name: "请假及离校",
    desc: "学生请假、离校登记、返校报备、平安打卡、催报与看板。是学生端使用频率最高的模块，本项目的打卡功能即出自这里。",
    resources: [
      ["xsqjxx", "学生请假申请（含请假时间校验）"],
      ["xszwzfsq", "学生在外租房申请"],
      ["xsxjsq", "学生销假申请"],
      ["xszwzfydgd", "在外租房月度归档"],
      ["lxglxx", "离校管理（班级/学院统计、学生台账）"],
      ["lxxslxxx", "离校学生离校信息（含去向、随行）"],
      ["lxxsfxxx", "离校学生返校信息"],
      ["lxjjrxx", "离校紧急联系人"],
      ["lxwcbbglxx", "离校外出报备管理"],
      ["lfxrsbbxx", "离返校人数报备"],
      ["padkglxx", "平安打卡管理（班次、围栏、打卡记录）"],
      ["dkcb", "打卡催报（提醒、结果查询、历史）"],
      ["dkzg", "打卡资格（免打卡名单）"],
      ["dktxpz", "打卡提醒配置"],
      ["dqr", "代确认（班委/辅导员代学生确认）"],
      ["bpa", "平安看板（学院/班级统计、催办、报表）"],
      ["zwzfglxx", "在外租房管理"],
      ["kqfwxx", "考勤范围（围栏圆心与半径）"],
      ["dksjsdxx", "打卡时间设定"],
      ["jqlxxx", "假期离校信息"],
      ["qjlxxx", "请假类信息（字典/配置）"],
    ],
  },
  "/ssgl": {
    name: "宿舍管理",
    desc: "楼栋、房间、床位、入住与调宿。平安打卡的「楼栋坐标」数据源即来自这里。",
    resources: [
      ["ss-ldxx", "宿舍楼栋信息（含经纬度坐标、层数、楼层数）"],
      ["ss-fjxx", "房间信息"],
      ["ss-cwxx", "床位信息"],
      ["ss-hscl", "宿舍处理（入住/退宿）"],
      ["ss-tj", "宿舍统计"],
    ],
  },
  "/zhcp": {
    name: "学生综合测评",
    desc: "综合测评批次配置、加分项申报与审核、绩点计算、排名公示。",
    resources: [
      ["zhcp-pcxx", "测评批次"],
      ["zhcp-jfxsqjlxx", "加分项申请记录"],
      ["zhcp-xspcglxx", "学生测评管理"],
      ["zhcp-zhcpcx", "综合测评查询"],
      ["zhcp-gsb", "公示表"],
    ],
  },
  "/dekt": {
    name: "第二课堂",
    desc: "社会实践、志愿服务、社团活动的第二课堂学分体系。含项目申报、成员管理、打卡地点变更、审核流转。",
    resources: [
      ["dekt-shsj", "社会实践项目（申报、审核、打卡地点、成员）"],
      ["dekt-sjsb", "实践申报"],
      ["dekt-dkjl", "打卡记录"],
      ["dekt-dkddxgsq", "打卡地点修改申请"],
    ],
  },
  "/zz": {
    name: "学生资助",
    desc: "勤工助学岗位、助学金、困难生认定、奖学金申报、资助育人活动。",
    resources: [
      ["zz-qzgwxx", "勤工助学岗位"],
      ["zz-qzlstd", "勤工助学老师端"],
      ["zz-qzxsgwsqxx", "勤工助学学生岗位申请"],
      ["zz-zqsx", "助学金申请"],
      ["zz-pksrd", "贫困生认定（批次、申请、评议、公示）"],
    ],
  },
  "/xljkrz": {
    name: "心理健康",
    desc: "心理测评、咨询预约、咨询师工作台、危机干预、谈心谈话记录、通知触达。",
    resources: [
      ["xljkrz-rz", "心理健康日志/记录"],
      ["xljkrz-xyy", "心理预约（学生端：预约、反馈、私信）"],
      ["xljkrz-lstd", "咨询师端（审批、反馈、统计、通知）"],
    ],
  },
  "/xlpxzx": {
    name: "心理培训中心",
    desc: "心理培训班级管理、开班计划、报名与签到签退。",
    resources: [
      ["xlpxzx-bm", "培训报名（报名/取消/签到/签退/提醒）"],
      ["xlpxzx-cg", "培训成果"],
      ["xlpxzx-pxjh", "培训计划"],
      ["xlpxzx-sb", "培训申报"],
    ],
  },
  "/xlfk": {
    name: "心理反馈",
    desc: "心理相关反馈工单的提交与处理。",
    resources: [["xlfk-fkxx", "反馈信息"]],
  },
  "/bbs": {
    name: "校园论坛",
    desc: "帖子、评论、社团圈、私信、举报与治理、敏感词。",
    resources: [
      ["bbs-tz", "帖子"],
      ["bbs-pl", "评论"],
      ["bbs-cg", "圈子/社团"],
      ["bbs-admin", "论坛管理（审核、举报、敏感词）"],
    ],
  },
  "/tzgg": {
    name: "通知公告",
    desc: "通知发布、定向触达、填报任务与阅读回执。",
    resources: [
      ["tzgg-tzjbxx", "通知基本信息"],
      ["tzgg-tbrwxx", "填报任务"],
      ["tzgg-yjxx", "阅件信息"],
    ],
  },
  "/gfjy": {
    name: "国防教育",
    desc: "军训、征兵、国防教育活动与学生队管理。",
    resources: [
      ["gfjy-xsd", "国防教育学生队"],
      ["gfjy-hd", "国防教育活动"],
    ],
  },
  "/zgxsk": {
    name: "资助学生库",
    desc: "资助相关的学生基础库与通知信息。",
    resources: [["zgxsk-tzxx", "通知信息"]],
  },
  "/ywzs": {
    name: "业务中枢",
    desc: "跨部门业务的统一入口：各类申报表单、迎新/离校/宿舍/证明等条线业务。端点最多，多为标准 CRUD + 流程发起。",
    resources: [
      ["ywzs-cdgl", "场地管理"],
      ["ywzs-wjdc", "问卷调查（创建、填写、分析）"],
      ["ywzs-tzgg", "通知公告"],
      ["ywzs-yzgl", "印章管理"],
      ["ywzs-qdzs", "签到助手"],
      ["ywzs-*-index", "各条线业务页面"],
    ],
  },
  "/yw": {
    name: "业务办理",
    desc: "学生事务办理：证明开具、证照申请、各类申请单与审批。",
    resources: [
      ["xj-jzgxx", "学籍相关"],
      ["wj-wjxx", "问卷/文件"],
      ["yzgl-yzsq", "印章申请"],
      ["qd-qdxx", "签到信息"],
      ["cd-yysq", "场地预约申请"],
      ["hd-*", "活动参与"],
    ],
  },
  "/ai": {
    name: "AI 助手",
    desc: "学工 AI 问答（含流式 SSE 输出、会话管理、知识库召回）。",
    resources: [
      ["aiagent", "AI 代理（流式对话、会话）"],
      ["dify", "Dify 平台对接"],
    ],
  },
  "/fdydwgl": {
    name: "辅导员队伍管理",
    desc: "辅导员信息、带班情况、考核。",
    resources: [["fdydwgl", "辅导员队伍"]],
  },
};

/* ───────── 分组 ───────── */
const groups = new Map();
for (const r of inv) {
  if (!groups.has(r.prefix)) groups.set(r.prefix, []);
  groups.get(r.prefix).push(r);
}
const order = Object.keys(MODULES);

/* ───────── 生成 ───────── */
let md = "";
md += `# 智慧学工平台 · REST API 文档\n\n`;
md += `> 逆向自 \`zhxg.csu.edu.cn\` 前端构建产物（PC 端 2224 个 chunk + 移动端 558 个 chunk）\n`;
md += `> 共 \`${inv.length}\` 个唯一端点，覆盖 \`${groups.size}\` 个服务模块\n\n`;
md += `---\n\n`;

/* 1. 架构 */
md += `## 一、系统架构\n\n`;
md += "```\n";
md += `浏览器 / 微信小程序\n`;
md += `        │\n`;
md += `        ▼\n`;
md += `nginx  (zhxg.csu.edu.cn)\n`;
md += `   ├─ /znzhxgpt_web/         PC 管理端（Vue3 + Vite）\n`;
md += `   ├─ /znzhxgpt_h5/          移动端（uni-app，同源可编译小程序）\n`;
md += `   ├─ /znzhxgptpublic/       公共资源\n`;
md += `   └─ /znzhxgpt/**     ───►  网关（内部前缀 /gw）\n`;
md += `                                 │\n`;
md += `        ┌────────────────────────┼────────────────────────┐\n`;
md += `     /basesys  /qxj  /ssgl   /zhcp  /dekt  /zz  ...    微服务\n`;
md += "```\n\n";
md += `nginx 会剥离 \`/znzhxgpt\` 前缀并按模块路由。**对外一律使用 \`/znzhxgpt/<模块>/<资源>/<动作>\`**。\n\n`;

md += `### 路径重写实测\n\n`;
md += "| 请求 | 网关收到 | 结果 |\n";
md += "|---|---|---|\n";
md += "| `POST /znzhxgpt/qxj/qxj-padkglxx/xspadk` | `/qxj/qxj-padkglxx/xspadk` | ✅ 正常 |\n";
md += "| `POST /znzhxgpt/qxj-padkglxx/xspadk` | `/gw/qxj-padkglxx/xspadk` | ❌ 404 缺模块段 |\n";
md += "| `POST /gw/qxj/...` | — | ❌ 405 nginx 内部 location |\n\n";

/* 2. 通用协议 */
md += `## 二、通用协议\n\n`;
md += `### 2.1 认证\n\n`;
md += "请求头同时携带两个字段，值相同：\n\n";
md += "```http\n";
md += `Content-Type: application/json; charset=utf-8\n`;
md += `deviceType: 4              # 4 = 移动端；PC 端另有取值\n`;
md += `AppCode: znzhxgpt\n`;
md += `Authorization: <token>\n`;
md += `token: <token>            # 与 Authorization 同值\n`;
md += `MenuId: <当前菜单ID>       # 部分模块用于权限点位校验\n`;
md += `agentId: <企业微信 AgentId>\n`;
md += "```\n\n";
md += `\`token\` 为 **RS256 JWT**，约 1036 字符，载荷内含 \`jti\` / \`exp\` / \`user_info\`（学号、部门、学院名等）。\n\n`;
md += `未携带或已过期时返回 HTTP 200 且 \`code = "203"\`（注意：**不是 401**）。\n\n`;

md += `### 2.2 请求体加密（关键）\n\n`;
md += `所有 \`postDes\` 接口的 body **不是明文 JSON**，而是 DES 密文的 Hex 串。\n\n`;
md += "```js\n";
md += `// 原站实现\n`;
md += `postDes(url, data) {\n`;
md += `  const key  = casual;                                   // 16 字符\n`;
md += `  const body = CryptoJS.DES\n`;
md += `    .encrypt(JSON.stringify(data), CryptoJS.enc.Utf8.parse(key),\n`;
md += `             { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 })\n`;
md += `    .ciphertext.toString(CryptoJS.enc.Hex);\n`;
md += `  return post(url, body);\n`;
md += `}\n`;
md += "```\n\n";
md += `- **算法**：DES-ECB / PKCS7，输出 Hex\n`;
md += `- **密钥**：\`casual\`，登录时由前端生成 16 位随机串并随 \`login-other\` 提交，服务端与之绑定\n`;
md += `- **实测**：明文直发一律 \`400 Bad Request\`，且与 body 内容无关（空对象同样 400）\n\n`;
md += `若使用 \`Content-Type: text/plain\` 会得到 \`415 Unsupported Media Type\`，说明服务端强制 JSON。\n\n`;

md += `### 2.3 统一响应结构\n\n`;
md += "```json\n";
md += `{\n`;
md += `  "pageNo": -1,\n`;
md += `  "pageSize": -1,\n`;
md += `  "allSize": -1,\n`;
md += `  "sortMap": null,\n`;
md += `  "paramsList": null,\n`;
md += `  "paramsDataList": null,\n`;
md += `  "params": {},\n`;
md += `  "paramsData": null,\n`;
md += `  "flzj": null,\n`;
md += `  "ywlx": null,\n`;
md += `  "code": "200",\n`;
md += `  "message": "成功",\n`;
md += `  "data": { }\n`;
md += `}\n`;
md += "```\n\n";
md += `外层为橙单框架的固定包装，业务数据一律在 \`data\` 内。\n\n`;

md += `### 2.4 业务状态码\n\n`;
md += "| code | 含义 | 说明 |\n";
md += "|---|---|---|\n";
md += "| `200` | 成功 | 业务正常 |\n";
md += "| `203` | 未登录 | 携带 HTTP 200 返回，token 缺失或过期 |\n";
md += "| `331` | 参数不能为空 | 必填参数缺失 |\n";
md += "| `500` | 服务器异常 | 内部错误 |\n\n";
md += `框架层另有 Spring 默认错误响应（含 \`timestamp/status/error/path/requestId\`），出现在 400/404/405 场景。\n\n`;

md += `### 2.5 分页与查询\n\n`;
md += `**分页参数**（\`paramsData\` 或直接顶层）：\n\n`;
md += "```json\n";
md += `{ "pageNo": 1, "pageSize": 15, "total": 0 }\n`;
md += "```\n\n";
md += `**动态查询条件** —— 两种写法并存：\n\n`;
md += "```json\n";
md += `// ① paramsData：键值对，最常用\n`;
md += `{ "paramsData": { "xn": "2025", "dkbc": "校内住宿打卡" } }\n\n`;
md += `// ② paramsList：条件表达式数组，PC 端复杂筛选使用\n`;
md += `{ "paramsList": [\n`;
md += `    { "type": "input",  "rule": "in", "field": "xmmc", "val": "暑期" },\n`;
md += `    { "type": "select", "rule": "eq", "field": "sjlx", "val": "团队" },\n`;
md += `    { "type": "date",   "rule": "ge", "field": "cjsjStart", "val": "2026-01-01" }\n`;
md += `] }\n`;
md += "```\n\n";
md += `\`rule\` 取值：\`eq\` 等于 / \`in\` 包含 / \`ge\` \`le\` 区间边界。\n\n`;
md += `**分页返回**：\`data\` 内为 \`{ records: [], total: N }\`（部分接口用 \`list\` / \`rows\`）。\n\n`;

md += `### 2.6 框架动作约定\n\n`;
md += `橙单低代码框架对 CRUD 有固定命名，理解这套约定即可读懂绝大多数端点：\n\n`;
md += "| 动作 | 语义 | 参数 | 返回 |\n";
md += "|---|---|---|---|\n";
md += "| `add` | 新增 | 实体对象 | 新主键 |\n";
md += "| `update` | 按主键更新 | 实体对象（含 id） | 影响行数 |\n";
md += "| `saveOrUpdate` | 有 id 则更新，否则插入 | 实体对象 | 主键 |\n";
md += "| `delete` | 按主键删除 | `{ id }` | — |\n";
md += "| `deleteBatch` | 批量删除 | `{ ids: [] }` | — |\n";
md += "| `logicDelete` | 逻辑删除 | `{ id }` | — |\n";
md += "| `list` | 全量列表 | 查询条件 | `records[]` |\n";
md += "| `findPage` / `findXxxPage` | 分页查询 | 分页 + 条件 | `{records,total}` |\n";
md += "| `getById` / `view` | 按主键查详情 | `{ id }` | 实体对象 |\n";
md += "| `export` | 导出 Excel | 同查询 | 文件流 |\n";
md += "| `import` | 导入 Excel | 文件 | 结果统计 |\n\n";
md += `**工作流类**（\`wszhxgpt-flow\` 引擎）：\n\n`;
md += "| 动作 | 语义 |\n";
md += "|---|---|\n";
md += "| `startOnly` | 仅发起流程 |\n";
md += "| `startAndSaveDraft` | 发起并存草稿 |\n";
md += "| `startAndTakeUserTask` | 发起并进入首个用户任务 |\n";
md += "| `startWithBusinessKey` | 带业务主键发起 |\n";
md += "| `submitUserTask` | 提交当前任务节点 |\n";
md += "| `listWorkOrder` | 我的工单列表 |\n";
md += "| `viewTaskBusinessData` | 查看当前节点业务数据 |\n";
md += "| `viewHistoricTaskBusinessData` | 查看历史节点业务数据 |\n\n";
md += `路径末尾的 \`/{processDefinitionKey}\` 是流程定义键，例如 \`shsjdkddxgsq\`（社会实践打卡地点修改申请）、\`xslxwcbbsq\`（学生离校外出报备申请）。\n\n`;

md += `---\n\n`;

/* 3. 模块总览 */
md += `## 三、模块总览\n\n`;
md += "| 模块 | 名称 | 端点数 |\n";
md += "|---|---|---|\n";
for (const p of order) {
  const list = groups.get(p);
  if (!list) continue;
  md += `| \`${p}\` | ${MODULES[p].name} | ${list.length} |\n`;
}
for (const [p, list] of groups) {
  if (MODULES[p]) continue;
  md += `| \`${p}\` | — | ${list.length} |\n`;
}
md += "\n---\n\n";

/* 4. 各模块详情 */
md += `## 四、接口清单\n\n`;
for (const p of order) {
  const list = groups.get(p);
  if (!list) continue;
  const M = MODULES[p];
  md += `### \`${p}\` · ${M.name}\n\n`;
  md += `${M.desc}\n\n`;
  if (M.resources?.length) {
    md += `**主要资源**\n\n`;
    for (const [r, d] of M.resources) md += `- \`${r}\` — ${d}\n`;
    md += "\n";
  }
  md += `**端点（${list.length}）**\n\n`;
  md += "| 方法 | 路径 | 参数 | 返回字段 |\n";
  md += "|---|---|---|---|\n";
  for (const r of list) {
    const m = r.verb === "get" ? "GET" : "POST";
    const params = r.paramKeys.length
      ? r.paramKeys.slice(0, 10).map((x) => "`" + x.k + "`").join(" ")
      : "—";
    const ret = r.resultFields?.length
      ? r.resultFields.slice(0, 8).map((x) => "`" + x.k + "`").join(" ")
      : "—";
    md += `| ${m} | \`${r.full}\` | ${params} | ${ret} |\n`;
  }
  md += "\n";
}

/* 5. 剩余模块 */
const rest = [...groups.keys()].filter((p) => !MODULES[p]);
if (rest.length) {
  md += `### 其他模块\n\n`;
  for (const p of rest) {
    md += `#### \`${p}\`（${groups.get(p).length}）\n\n`;
    md += "| 方法 | 路径 | 参数 |\n|---|---|---|\n";
    for (const r of groups.get(p)) {
      const params = r.paramKeys.length ? r.paramKeys.slice(0, 8).map((x) => "`" + x.k + "`").join(" ") : "—";
      md += `| ${r.verb === "get" ? "GET" : "POST"} | \`${r.full}\` | ${params} |\n`;
    }
    md += "\n";
  }
}

fs.writeFileSync("智慧学工-API文档.md", md, "utf8");
console.log("生成完成: 智慧学工-API文档.md");
console.log("字节数:", md.length, "| 行数:", md.split("\n").length);
