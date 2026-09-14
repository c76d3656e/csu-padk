# 智慧学工平台 · REST API 文档

> 逆向自 `zhxg.csu.edu.cn` 前端构建产物（PC 端 2224 个 chunk + 移动端 558 个 chunk）
> 共 `600` 个唯一端点，覆盖 `15` 个服务模块

---

## 一、系统架构

```
浏览器 / 微信小程序
        │
        ▼
nginx  (zhxg.csu.edu.cn)
   ├─ /znzhxgpt_web/         PC 管理端（Vue3 + Vite）
   ├─ /znzhxgpt_h5/          移动端（uni-app，同源可编译小程序）
   ├─ /znzhxgptpublic/       公共资源
   └─ /znzhxgpt/**     ───►  网关（内部前缀 /gw）
                                 │
        ┌────────────────────────┼────────────────────────┐
     /basesys  /qxj  /ssgl   /zhcp  /dekt  /zz  ...    微服务
```

nginx 会剥离 `/znzhxgpt` 前缀并按模块路由。**对外一律使用 `/znzhxgpt/<模块>/<资源>/<动作>`**。

### 路径重写实测

| 请求 | 网关收到 | 结果 |
|---|---|---|
| `POST /znzhxgpt/qxj/qxj-padkglxx/xspadk` | `/qxj/qxj-padkglxx/xspadk` | ✅ 正常 |
| `POST /znzhxgpt/qxj-padkglxx/xspadk` | `/gw/qxj-padkglxx/xspadk` | ❌ 404 缺模块段 |
| `POST /gw/qxj/...` | — | ❌ 405 nginx 内部 location |

## 二、通用协议

### 2.1 认证

请求头同时携带两个字段，值相同：

```http
Content-Type: application/json; charset=utf-8
deviceType: 4              # 4 = 移动端；PC 端另有取值
AppCode: znzhxgpt
Authorization: <token>
token: <token>            # 与 Authorization 同值
MenuId: <当前菜单ID>       # 部分模块用于权限点位校验
agentId: <企业微信 AgentId>
```

`token` 为 **RS256 JWT**，约 1036 字符，载荷内含 `jti` / `exp` / `user_info`（学号、部门、学院名等）。

未携带或已过期时返回 HTTP 200 且 `code = "203"`（注意：**不是 401**）。

### 2.2 请求体加密（关键）

所有 `postDes` 接口的 body **不是明文 JSON**，而是 DES 密文的 Hex 串。

```js
// 原站实现
postDes(url, data) {
  const key  = casual;                                   // 16 字符
  const body = CryptoJS.DES
    .encrypt(JSON.stringify(data), CryptoJS.enc.Utf8.parse(key),
             { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 })
    .ciphertext.toString(CryptoJS.enc.Hex);
  return post(url, body);
}
```

- **算法**：DES-ECB / PKCS7，输出 Hex
- **密钥**：`casual`，登录时由前端生成 16 位随机串并随 `login-other` 提交，服务端与之绑定
- **实测**：明文直发一律 `400 Bad Request`，且与 body 内容无关（空对象同样 400）

若使用 `Content-Type: text/plain` 会得到 `415 Unsupported Media Type`，说明服务端强制 JSON。

### 2.3 统一响应结构

```json
{
  "pageNo": -1,
  "pageSize": -1,
  "allSize": -1,
  "sortMap": null,
  "paramsList": null,
  "paramsDataList": null,
  "params": {},
  "paramsData": null,
  "flzj": null,
  "ywlx": null,
  "code": "200",
  "message": "成功",
  "data": { }
}
```

外层为橙单框架的固定包装，业务数据一律在 `data` 内。

### 2.4 业务状态码

| code | 含义 | 说明 |
|---|---|---|
| `200` | 成功 | 业务正常 |
| `203` | 未登录 | 携带 HTTP 200 返回，token 缺失或过期 |
| `331` | 参数不能为空 | 必填参数缺失 |
| `500` | 服务器异常 | 内部错误 |

框架层另有 Spring 默认错误响应（含 `timestamp/status/error/path/requestId`），出现在 400/404/405 场景。

### 2.5 分页与查询

**分页参数**（`paramsData` 或直接顶层）：

```json
{ "pageNo": 1, "pageSize": 15, "total": 0 }
```

**动态查询条件** —— 两种写法并存：

```json
// ① paramsData：键值对，最常用
{ "paramsData": { "xn": "2025", "dkbc": "校内住宿打卡" } }

// ② paramsList：条件表达式数组，PC 端复杂筛选使用
{ "paramsList": [
    { "type": "input",  "rule": "in", "field": "xmmc", "val": "暑期" },
    { "type": "select", "rule": "eq", "field": "sjlx", "val": "团队" },
    { "type": "date",   "rule": "ge", "field": "cjsjStart", "val": "2026-01-01" }
] }
```

`rule` 取值：`eq` 等于 / `in` 包含 / `ge` `le` 区间边界。

**分页返回**：`data` 内为 `{ records: [], total: N }`（部分接口用 `list` / `rows`）。

### 2.6 框架动作约定

橙单低代码框架对 CRUD 有固定命名，理解这套约定即可读懂绝大多数端点：

| 动作 | 语义 | 参数 | 返回 |
|---|---|---|---|
| `add` | 新增 | 实体对象 | 新主键 |
| `update` | 按主键更新 | 实体对象（含 id） | 影响行数 |
| `saveOrUpdate` | 有 id 则更新，否则插入 | 实体对象 | 主键 |
| `delete` | 按主键删除 | `{ id }` | — |
| `deleteBatch` | 批量删除 | `{ ids: [] }` | — |
| `logicDelete` | 逻辑删除 | `{ id }` | — |
| `list` | 全量列表 | 查询条件 | `records[]` |
| `findPage` / `findXxxPage` | 分页查询 | 分页 + 条件 | `{records,total}` |
| `getById` / `view` | 按主键查详情 | `{ id }` | 实体对象 |
| `export` | 导出 Excel | 同查询 | 文件流 |
| `import` | 导入 Excel | 文件 | 结果统计 |

**工作流类**（`wszhxgpt-flow` 引擎）：

| 动作 | 语义 |
|---|---|
| `startOnly` | 仅发起流程 |
| `startAndSaveDraft` | 发起并存草稿 |
| `startAndTakeUserTask` | 发起并进入首个用户任务 |
| `startWithBusinessKey` | 带业务主键发起 |
| `submitUserTask` | 提交当前任务节点 |
| `listWorkOrder` | 我的工单列表 |
| `viewTaskBusinessData` | 查看当前节点业务数据 |
| `viewHistoricTaskBusinessData` | 查看历史节点业务数据 |

路径末尾的 `/{processDefinitionKey}` 是流程定义键，例如 `shsjdkddxgsq`（社会实践打卡地点修改申请）、`xslxwcbbsq`（学生离校外出报备申请）。

---

## 三、模块总览

| 模块 | 名称 | 端点数 |
|---|---|---|
| `/basesys` | 基础系统 / 统一权限 | 29 |
| `/qxj` | 请假及离校 | 62 |
| `/ssgl` | 宿舍管理 | 2 |
| `/zhcp` | 学生综合测评 | 28 |
| `/dekt` | 第二课堂 | 74 |
| `/zz` | 学生资助 | 37 |
| `/xljkrz` | 心理健康 | 53 |
| `/xlfk` | 心理反馈 | 10 |
| `/bbs` | 校园论坛 | 22 |
| `/gfjy` | 国防教育 | 19 |
| `/zgxsk` | 资助学生库 | 18 |
| `/ywzs` | 业务中枢 | 125 |
| `/yw` | 业务办理 | 109 |
| `/ai` | AI 助手 | 11 |
| `/fdydwgl` | 辅导员队伍管理 | 1 |

---

## 四、接口清单

### `/basesys` · 基础系统 / 统一权限

登录鉴权、用户、角色、组织架构、菜单权限、字典、参数配置。整个平台的地基，其余模块全部依赖它下发的 token 与权限点位。

**主要资源**

- `rbac-yh` — 用户账号（登录、绑定、切换身份）
- `rbac-yhgl` — 用户管理（列表、绑定关系）
- `rbac-zzjg` — 组织架构（学院/部门树）
- `rbac-zdyqz` — 自定义权组（菜单权限模板）
- `rbac-js` — 角色
- `app-xcxcd` — 小程序菜单点
- `sys-sjzd` — 数据字典
- `sys-cs` — 系统参数
- `sys-rz` — 操作日志

**端点（29）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| GET | `/znzhxgpt/basesys/app-xcxcd/findXcxcdByJsid` | `jsid` `cdwz` | — |
| GET | `/znzhxgpt/basesys/busi-wjxx/deleteWjxxByGlzj` | `glzj` | `code` |
| POST | `/znzhxgpt/basesys/busi-wjxx/saveWjxxForm` | `glzj` `wjxxs` | `code` |
| GET | `/znzhxgpt/basesys/busi-wjxx/selectWjxxByGlzj` | `glzj` | — |
| GET | `/znzhxgpt/basesys/rbac-cd/findMenuList` | `qxid` `jsid` | — |
| GET | `/znzhxgpt/basesys/rbac-yh/count-users` | — | — |
| POST | `/znzhxgpt/basesys/rbac-yh/login` | — | `token` |
| POST | `/znzhxgpt/basesys/rbac-yh/login-other` | — | `token` |
| POST | `/znzhxgpt/basesys/rbac-yh/loginH5` | — | — |
| POST | `/znzhxgpt/basesys/rbac-yh/queryYhByJsIdAndXybm` | `jsid` `xybm` | — |
| POST | `/znzhxgpt/basesys/rbac-yh/updateCdxs` | `cdxs` | — |
| POST | `/znzhxgpt/basesys/rbac-yhgl/switchBindYh` | `yhid` `caasual` | — |
| GET | `/znzhxgpt/basesys/rbac-yhjsgl/getZyzJs` | — | — |
| GET | `/znzhxgpt/basesys/rbac-zdyqz/find_QzList` | — | — |
| GET | `/znzhxgpt/basesys/rbac-zdyqz/find_QzMembers` | `qzid` | — |
| GET | `/znzhxgpt/basesys/rbac-zdyqz/remove_Qz` | `id` | — |
| POST | `/znzhxgpt/basesys/rbac-zdyqz/saveOrUpdate_Qz` | `qzmc` `fw` `cyList` | — |
| POST | `/znzhxgpt/basesys/rbac-zzjg/findBmmcByIds` | `ids` | — |
| POST | `/znzhxgpt/basesys/rbac-zzjg/findDirectChildrenByPids` | `pids` `zt` | — |
| GET | `/znzhxgpt/basesys/rbac-zzjg/findZzjgList` | — | — |
| GET | `/znzhxgpt/basesys/rbac-zzjg/findZzjgListByIdLen12` | — | — |
| POST | `/znzhxgpt/basesys/rbac-zzjg/queryZzjgByPage` | `current` `paramsData` `paramsList` `size` `total` | — |
| GET | `/znzhxgpt/basesys/sys-sjzd/findZdList` | `zdbm` | `cyrList` `qsgxList` `jkzkList` |
| POST | `/znzhxgpt/basesys/wf-inst/findInstPage` | `pageNo` `pageSize` `ywbh` | — |
| GET | `/znzhxgpt/basesys/wf-inst/getInstDetail` | `id` | `nodeInsts` `logs` `pathNodeInsts` `tasks` |
| POST | `/znzhxgpt/basesys/wf-inst/terminateInst` | — | — |
| POST | `/znzhxgpt/basesys/wf-task/handleTask` | `taskId` `cz` `spyj` | — |
| GET | `/znzhxgpt/basesys/ydxyw/find_YhxxBycode` | — | — |
| GET | `/znzhxgpt/basesys/ydxyw/getYdxywAccessToken` | — | — |

### `/qxj` · 请假及离校

学生请假、离校登记、返校报备、平安打卡、催报与看板。是学生端使用频率最高的模块，本项目的打卡功能即出自这里。

**主要资源**

- `xsqjxx` — 学生请假申请（含请假时间校验）
- `xszwzfsq` — 学生在外租房申请
- `xsxjsq` — 学生销假申请
- `xszwzfydgd` — 在外租房月度归档
- `lxglxx` — 离校管理（班级/学院统计、学生台账）
- `lxxslxxx` — 离校学生离校信息（含去向、随行）
- `lxxsfxxx` — 离校学生返校信息
- `lxjjrxx` — 离校紧急联系人
- `lxwcbbglxx` — 离校外出报备管理
- `lfxrsbbxx` — 离返校人数报备
- `padkglxx` — 平安打卡管理（班次、围栏、打卡记录）
- `dkcb` — 打卡催报（提醒、结果查询、历史）
- `dkzg` — 打卡资格（免打卡名单）
- `dktxpz` — 打卡提醒配置
- `dqr` — 代确认（班委/辅导员代学生确认）
- `bpa` — 平安看板（学院/班级统计、催办、报表）
- `zwzfglxx` — 在外租房管理
- `kqfwxx` — 考勤范围（围栏圆心与半径）
- `dksjsdxx` — 打卡时间设定
- `jqlxxx` — 假期离校信息
- `qjlxxx` — 请假类信息（字典/配置）

**端点（62）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| POST | `/znzhxgpt/qxj/qxj-bpa/queryBoard` | `paramsData` | `rq` `wtjs` `cbmb` `ysb` `kxjz` `list` `wzrXy` |
| POST | `/znzhxgpt/qxj/qxj-bpa/queryXyHistory` | `paramsData` | `xymc` `xybm` `tjTs` `asTs` `yqTs` `ycTs` `list` |
| POST | `/znzhxgpt/qxj/qxj-bpa/queryXyHz` | `paramsData` | `rq` `xybm` `ycList` `ycZs` `ycPageSize` `tjzt` |
| POST | `/znzhxgpt/qxj/qxj-bpa/queryXyYcPage` | `paramsData` | `total` `list` `pageNo` |
| POST | `/znzhxgpt/qxj/qxj-bpa/submitBpa` | `paramsData` | — |
| POST | `/znzhxgpt/qxj/qxj-bpa/summaryReport` | `paramsData` | — |
| POST | `/znzhxgpt/qxj/qxj-bpa/urge` | `paramsData` | `wzrXy` |
| POST | `/znzhxgpt/qxj/qxj-dkcb/queryCbJg` | `paramsData` | `mx` |
| POST | `/znzhxgpt/qxj/qxj-dkcb/queryCbLs` | `paramsData` | `bjbh` `bjmc` `cbTs` `txRc` `txhdk` `wdk` `list` |
| POST | `/znzhxgpt/qxj/qxj-dkcb/queryTxXx` | `paramsData` | `bjbh` `bjList` `rq` `dkbc` `bjmc` `wdkList` `zgList` `xsMb` |
| POST | `/znzhxgpt/qxj/qxj-dkcb/queryZgXz` | `paramsData` | `rq` `bjmc` `list` `yht` |
| POST | `/znzhxgpt/qxj/qxj-dkcb/saveHt` | `paramsData` | — |
| POST | `/znzhxgpt/qxj/qxj-dkcb/sendCb` | `paramsData` | `cbid` |
| POST | `/znzhxgpt/qxj/qxj-dktz/markRead` | `paramsData` | — |
| POST | `/znzhxgpt/qxj/qxj-dktz/queryMyTzPage` | `pageNo` `pageSize` `paramsData` | `records` `wds` `bjbh` `bjList` |
| POST | `/znzhxgpt/qxj/qxj-dqr/queryBjDkLs` | `paramsData` | `bjmc` `ykqTs` `qydbTs` `ywdkTs` `dqrRc` `list` |
| POST | `/znzhxgpt/qxj/qxj-dqr/queryBjDkMd` | `paramsData` | `bjmc` `rq` `jzsj` `ydkrs` `ydk` `dqr` `wdkrs` `list` |
| POST | `/znzhxgpt/qxj/qxj-dqr/queryBjDkRkTj` | — | `sfbz` `wdkrs` `dkbc` |
| POST | `/znzhxgpt/qxj/qxj-dqr/queryXsDkXq` | `paramsData` | `rq` |
| POST | `/znzhxgpt/qxj/qxj-dqr/saveDqr` | `paramsData` | — |
| POST | `/znzhxgpt/qxj/qxj-lfxrsbbxx/batchSave` | `jjrlx` `lfxlx` `bbrq` `xsList` | — |
| POST | `/znzhxgpt/qxj/qxj-lfxrsbbxx/findBjXsLxzt` | `pageNo` `pageSize` `paramsData` | `records` `allSize` |
| POST | `/znzhxgpt/qxj/qxj-lfxrsbbxx/findBjXsLxztRsTj` | `lfxlx` `jjrlx` | — |
| POST | `/znzhxgpt/qxj/qxj-lfxrsbbxx/findDailyLfxTj` | `lfxlx` `jjrlx` | `dailyList` |
| POST | `/znzhxgpt/qxj/qxj-lxglxx/checkLxSj` | `ssjjr` `kssj` `jssj` | `totalHours` `days` |
| POST | `/znzhxgpt/qxj/qxj-lxglxx/findLxGlPage` | — | — |
| POST | `/znzhxgpt/qxj/qxj-lxglxx/findMyBbList` | — | — |
| POST | `/znzhxgpt/qxj/qxj-lxjjrxx/findCurrentHolidays` | `paramsData` | — |
| POST | `/znzhxgpt/qxj/qxj-lxjjrxx/findJjrxxByList` | — | — |
| POST | `/znzhxgpt/qxj/qxj-lxwcbbglxx/checkLxWcBbSj` | `kssj` `jssj` `lxId` | `totalHours` `originalDays` |
| GET | `/znzhxgpt/qxj/qxj-lxxsfxxx/getByLxid` | — | — |
| POST | `/znzhxgpt/qxj/qxj-lxxsfxxx/save` | — | — |
| POST | `/znzhxgpt/qxj/qxj-lxxslxxx/findLxglBjTjList` | — | `barList` `classList` |
| POST | `/znzhxgpt/qxj/qxj-lxxslxxx/findLxglFilterOptions` | — | `xyList` `zyList` `bjList` `xbList` `pyccList` |
| POST | `/znzhxgpt/qxj/qxj-lxxslxxx/findLxglOverview` | — | — |
| POST | `/znzhxgpt/qxj/qxj-lxxslxxx/findLxglRoleScope` | — | `barList` `classList` `collegeList` |
| POST | `/znzhxgpt/qxj/qxj-lxxslxxx/findLxglXsList` | — | `records` `total` |
| POST | `/znzhxgpt/qxj/qxj-lxxslxxx/findLxglXyTjList` | — | `barList` `collegeList` |
| POST | `/znzhxgpt/qxj/qxj-lxxslxxx/findXslxjlByPage` | `pageNo` `pageSize` | `children` `records` |
| GET | `/znzhxgpt/qxj/qxj-lxxslxxx/getById` | `id` | `children` |
| POST | `/znzhxgpt/qxj/qxj-lxxslxxx/getLxglXsDetail` | — | `avatar` `txurl` |
| POST | `/znzhxgpt/qxj/qxj-lxxslxxx/saveOrUpdate` | — | — |
| POST | `/znzhxgpt/qxj/qxj-lxxslxxx/updateByYqfx` | `id` | — |
| POST | `/znzhxgpt/qxj/qxj-padkglxx/jcqqwzsjsfndk` | `paramsData` | `pcMi` `fwMi` `canDk` `msg` `yxMc` `sfbz` `wdkrs` |
| POST | `/znzhxgpt/qxj/qxj-padkglxx/queryKqDkbc` | `paramsData` | `message` |
| POST | `/znzhxgpt/qxj/qxj-padkglxx/queryPadkKqAyListByXh` | `paramsData` | — |
| POST | `/znzhxgpt/qxj/qxj-padkglxx/xspadk` | — | `dkbc` |
| POST | `/znzhxgpt/qxj/qxj-qjlxxx/findQjlxxxByLx` | `pageSize` `pageNo` `paramsData` | `records` `code` |
| POST | `/znzhxgpt/qxj/qxj-xsqjxx/checkQjsj` | `kssj` `jssj` | `days` `totalHours` `records` |
| POST | `/znzhxgpt/qxj/qxj-xsqjxx/findList` | `lx` | — |
| POST | `/znzhxgpt/qxj/qxj-xsqjxx/findQjxxByXh` | — | — |
| GET | `/znzhxgpt/qxj/qxj-xsqjxx/getByYwbh` | `ywbh` | `jssj` |
| POST | `/znzhxgpt/qxj/qxj-xsxjxx/checkXjdkfw` | `jd` `wd` `lx` `lxid` | `code` |
| POST | `/znzhxgpt/qxj/qxj-zwzfglxx/compareData` | — | — |
| POST | `/znzhxgpt/qxj/qxj-zwzfglxx/findZwzffxBjTjList` | — | `barList` `classList` |
| POST | `/znzhxgpt/qxj/qxj-zwzfglxx/findZwzffxFilterOptions` | — | `xyList` `zyList` `bjList` `xbList` `pyccList` |
| POST | `/znzhxgpt/qxj/qxj-zwzfglxx/findZwzffxOverview` | — | — |
| POST | `/znzhxgpt/qxj/qxj-zwzfglxx/findZwzffxRoleScope` | — | — |
| POST | `/znzhxgpt/qxj/qxj-zwzfglxx/findZwzffxXsList` | — | `records` `total` |
| POST | `/znzhxgpt/qxj/qxj-zwzfglxx/findZwzffxXyTjList` | — | `barList` `collegeList` |
| POST | `/znzhxgpt/qxj/qxj-zwzfglxx/getlastYearData` | — | — |
| POST | `/znzhxgpt/qxj/qxj-zwzfglxx/getZwzffxXsDetail` | — | `dh` `lxdh` `sjhm` `zfdz` `zzdz` `avatar` `txurl` |

### `/ssgl` · 宿舍管理

楼栋、房间、床位、入住与调宿。平安打卡的「楼栋坐标」数据源即来自这里。

**主要资源**

- `ss-ldxx` — 宿舍楼栋信息（含经纬度坐标、层数、楼层数）
- `ss-fjxx` — 房间信息
- `ss-cwxx` — 床位信息
- `ss-hscl` — 宿舍处理（入住/退宿）
- `ss-tj` — 宿舍统计

**端点（2）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| POST | `/znzhxgpt/ssgl/ss-ldxx/findLdzbCjList` | `params` | `list` `zs` `ycj` `dcj` `xqList` |
| POST | `/znzhxgpt/ssgl/ss-ldxx/saveLdzbCj` | `params` | — |

### `/zhcp` · 学生综合测评

综合测评批次配置、加分项申报与审核、绩点计算、排名公示。

**主要资源**

- `zhcp-pcxx` — 测评批次
- `zhcp-jfxsqjlxx` — 加分项申请记录
- `zhcp-xspcglxx` — 学生测评管理
- `zhcp-zhcpcx` — 综合测评查询
- `zhcp-gsb` — 公示表

**端点（28）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| POST | `/znzhxgpt/zhcp/zhcp-bjpcglxx/bjcpxzPcxz` | `pageNo` `pageSize` | `records` `total` |
| POST | `/znzhxgpt/zhcp/zhcp-gsb/findMyGsbList` | `params` | — |
| GET | `/znzhxgpt/zhcp/zhcp-gsb/getById` | `id` | `records` |
| POST | `/znzhxgpt/zhcp/zhcp-jfxsqjlxx/addOrUpdateJfxsqjlxx` | — | — |
| GET | `/znzhxgpt/zhcp/zhcp-jfxsqjlxx/findCpxzZhszjfxx` | `id` | — |
| POST | `/znzhxgpt/zhcp/zhcp-jfxsqjlxx/findCpxzZhszjfxxPage` | `pageNo` `pageSize` `paramsData` | `records` `allSize` |
| POST | `/znzhxgpt/zhcp/zhcp-jfxsqjlxx/findXsJfxsqjlxxList` | `pageNo` `pageSize` `paramsData` | `total` |
| POST | `/znzhxgpt/zhcp/zhcp-jfxsqjlxx/updateCpxzZhszjfx` | `paramsData` | — |
| POST | `/znzhxgpt/zhcp/zhcp-jfxsqjlxx/xscxsqjfx` | `paramsData` | — |
| POST | `/znzhxgpt/zhcp/zhcp-jfxxx/queryJfxList` | `paramsData` | `jfxList` |
| POST | `/znzhxgpt/zhcp/zhcp-pcxx/findCpxzPcxxPage` | `pageNo` `pageSize` | `records` `allSize` |
| POST | `/znzhxgpt/zhcp/zhcp-pcxx/findCpxzPcxxZx` | — | `records` `allSize` |
| POST | `/znzhxgpt/zhcp/zhcp-pcxx/findMyCpxzRole` | — | — |
| POST | `/znzhxgpt/zhcp/zhcp-xspcglxx/findBjcpxzPcxqByPage` | `pageNo` `pageSize` `params` | `records` `total` |
| POST | `/znzhxgpt/zhcp/zhcp-xspcglxx/findCpcjPage` | `pageNo` `pageSize` `paramsData` | `records` |
| POST | `/znzhxgpt/zhcp/zhcp-xspcglxx/findCpgsByMyBj` | — | — |
| POST | `/znzhxgpt/zhcp/zhcp-xspcglxx/findCpgsTjByPcid` | — | — |
| POST | `/znzhxgpt/zhcp/zhcp-xspcglxx/findXscjpcPage` | `pageNo` `pageSize` | `records` `allSize` |
| POST | `/znzhxgpt/zhcp/zhcp-xspcglxx/findZhcpxsDetail` | `params` | `xsxmglxxList` |
| POST | `/znzhxgpt/zhcp/zhcp-xsxmglxx/addOrUpdateXsxmglxx` | `params` | — |
| POST | `/znzhxgpt/zhcp/zhcp-zhcpcx/findBjTjList` | — | `barList` `classList` |
| POST | `/znzhxgpt/zhcp/zhcp-zhcpcx/findFilterOptions` | — | `xyList` `zyList` `bjList` `njList` `xbList` `pyccList` |
| POST | `/znzhxgpt/zhcp/zhcp-zhcpcx/findOverview` | — | — |
| POST | `/znzhxgpt/zhcp/zhcp-zhcpcx/findRoleScope` | — | — |
| POST | `/znzhxgpt/zhcp/zhcp-zhcpcx/findXsList` | — | `records` `total` |
| POST | `/znzhxgpt/zhcp/zhcp-zhcpcx/findXyTjList` | — | `barList` `collegeList` |
| POST | `/znzhxgpt/zhcp/zhcp-zhcpcx/findYears` | — | — |
| POST | `/znzhxgpt/zhcp/zhcp-zhcpcx/getXsDetail` | — | `avatar` `txurl` |

### `/dekt` · 第二课堂

社会实践、志愿服务、社团活动的第二课堂学分体系。含项目申报、成员管理、打卡地点变更、审核流转。

**主要资源**

- `dekt-shsj` — 社会实践项目（申报、审核、打卡地点、成员）
- `dekt-sjsb` — 实践申报
- `dekt-dkjl` — 打卡记录
- `dekt-dkddxgsq` — 打卡地点修改申请

**端点（74）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| GET | `/znzhxgpt/dekt/sthd-cyba/formPrefill` | — | — |
| GET | `/znzhxgpt/dekt/sthd-cyba/list` | `stid` `pcid` `xn` | — |
| POST | `/znzhxgpt/dekt/sthd-cyba/submit` | `stid` `pcid` `xn` `name` `college` `majorClass` `grade` `political` `phone` `email` | — |
| POST | `/znzhxgpt/dekt/sthd-hdbm/exit?hdid=` | — | — |
| GET | `/znzhxgpt/dekt/sthd-hdbm/exportList` | — | — |
| GET | `/znzhxgpt/dekt/sthd-hdbm/manageList` | — | — |
| GET | `/znzhxgpt/dekt/sthd-hdbm/memberList` | — | — |
| GET | `/znzhxgpt/dekt/sthd-hdbm/myStatus` | — | — |
| GET | `/znzhxgpt/dekt/sthd-hdpj/detail` | — | — |
| GET | `/znzhxgpt/dekt/sthd-hdpj/myCount` | — | — |
| GET | `/znzhxgpt/dekt/sthd-hdpj/myList` | `pageNo` `pageSize` | — |
| GET | `/znzhxgpt/dekt/sthd-hdpj/rated` | `hdid` `hdids` | — |
| POST | `/znzhxgpt/dekt/sthd-hdpj/submit` | `hdid` `dtda` `zhf` `zp` | — |
| GET | `/znzhxgpt/dekt/sthd-hdsq/detail` | — | — |
| GET | `/znzhxgpt/dekt/sthd-hdsq/manageList` | `scope` `stid` | — |
| GET | `/znzhxgpt/dekt/sthd-hdsq/myJoined` | `pageNo` `pageSize` | — |
| GET | `/znzhxgpt/dekt/sthd-hdsq/myList` | — | — |
| GET | `/znzhxgpt/dekt/sthd-hdsq/publicList` | `keyword` `hdfw` `stid` | — |
| GET | `/znzhxgpt/dekt/sthd-jrsq/myStatus` | — | — |
| POST | `/znzhxgpt/dekt/sthd-jrsq/submit` | `stid` `jrly` `jrsm` | — |
| GET | `/znzhxgpt/dekt/sthd-nspc/queryActivityPerm` | `stid` | — |
| GET | `/znzhxgpt/dekt/sthd-nspc/queryCurrent` | — | — |
| GET | `/znzhxgpt/dekt/sthd-nspc/queryListForClub` | `stid` | — |
| GET | `/znzhxgpt/dekt/sthd-nssq/myList` | — | — |
| POST | `/znzhxgpt/dekt/sthd-stcy/batchAdd` | `stid` `members` | — |
| GET | `/znzhxgpt/dekt/sthd-stcy/joinedCount` | — | `records` `list` |
| GET | `/znzhxgpt/dekt/sthd-stcy/list` | `stid` `filter` | — |
| POST | `/znzhxgpt/dekt/sthd-stcy/remove` | `id` | — |
| POST | `/znzhxgpt/dekt/sthd-stcy/updateRole` | `id` `zw` `zwmc` | — |
| GET | `/znzhxgpt/dekt/sthd-stsq/myList` | — | — |
| GET | `/znzhxgpt/dekt/sthd-stxx/detail` | — | — |
| GET | `/znzhxgpt/dekt/sthd-stxx/myJoined` | — | — |
| GET | `/znzhxgpt/dekt/sthd-stxx/myList` | — | — |
| GET | `/znzhxgpt/dekt/sthd-stxx/publicList` | — | — |
| GET | `/znzhxgpt/dekt/sthd-stxx/queryZdjsByStid` | — | — |
| GET | `/znzhxgpt/dekt/sthd-stxx/recruitOverview` | — | — |
| POST | `/znzhxgpt/dekt/sthd-stxx/saveProfile` | `id` `stjj` `wxh` `wbh` `qqun` `qtpt` | — |
| POST | `/znzhxgpt/dekt/sthd-stxx/setRecruit` | `stid` `enabled` | — |
| GET | `/znzhxgpt/dekt/sthd-xbsq/myList` | — | — |
| GET | `/znzhxgpt/dekt/sthd-zxsq/myList` | — | — |
| GET | `/znzhxgpt/dekt/wspy-gs/publicList` | — | — |
| GET | `/znzhxgpt/dekt/wspy-jx/enabledList` | `fqjs` `jb` | — |
| GET | `/znzhxgpt/dekt/wspy-jxsq/myList` | — | — |
| GET | `/znzhxgpt/dekt/wspy-jxsq/resolveMyCollege` | — | — |
| GET | `/znzhxgpt/dekt/wspy-pc/openList` | — | — |
| POST | `/znzhxgpt/dekt/wspy-pc/pageList` | `pageNo` `pageSize` `paramsData` | — |
| POST | `/znzhxgpt/dekt/zyfw-dkjlxx/daka` | — | — |
| GET | `/znzhxgpt/dekt/zyfw-dkjlxx/memberClockRecords` | `hdid` `xh` `pageNo` `pageSize` | — |
| POST | `/znzhxgpt/dekt/zyfw-dw/findPage` | — | — |
| GET | `/znzhxgpt/dekt/zyfw-dw/getDetail` | — | — |
| POST | `/znzhxgpt/dekt/zyfw-dw/listMembersPage` | `pageNo` `pageSize` `paramsData` | — |
| POST | `/znzhxgpt/dekt/zyfw-dw/myTeams` | `sf` `keyword` | — |
| POST | `/znzhxgpt/dekt/zyfw-dw/saveTeam` | — | — |
| POST | `/znzhxgpt/dekt/zyfw-hdcyxx/addMembers` | `hdid` `cyjs` `members` | `added` |
| POST | `/znzhxgpt/dekt/zyfw-hdcyxx/logicDelete` | — | — |
| POST | `/znzhxgpt/dekt/zyfw-hdcyxx/saveScrdHours` | — | — |
| GET | `/znzhxgpt/dekt/zyfw-hdcyxx/scrdMemberDetail` | `hdid` `pageNo` `pageSize` | — |
| GET | `/znzhxgpt/dekt/zyfw-hdcyxx/scrdMembers` | `activityId` `keyword` `pageNo` `pageSize` | — |
| POST | `/znzhxgpt/dekt/zyfw-hdcyxx/updateRole` | `hdid` `id` `cyjs` | — |
| GET | `/znzhxgpt/dekt/zyfw-scrdxx/approvedByHdid` | — | — |
| GET | `/znzhxgpt/dekt/zyfw-scrdxx/latestSubmittedByHdid` | — | — |
| POST | `/znzhxgpt/dekt/zyfw-tdcy/addMembers` | `dwid` `cyjs` `members` | `added` |
| POST | `/znzhxgpt/dekt/zyfw-tdcy/logicDelete` | — | — |
| POST | `/znzhxgpt/dekt/zyfw-tdcy/quitTeam` | `dwid` | — |
| POST | `/znzhxgpt/dekt/zyfw-tdcy/searchPersons` | `keyword` `pageNo` `pageSize` | — |
| POST | `/znzhxgpt/dekt/zyfw-tdcy/updateRole` | `dwid` `id` `cyjs` | — |
| GET | `/znzhxgpt/dekt/zyfw-zyhdxx/activityList` | `pageNo` `pageSize` `keyword` `startYM` `endYM` `category` `status` | — |
| GET | `/znzhxgpt/dekt/zyfw-zyhdxx/clockInInfo` | — | — |
| POST | `/znzhxgpt/dekt/zyfw-zyhdxx/enroll` | `hdId` | — |
| GET | `/znzhxgpt/dekt/zyfw-zyhdxx/homeActivities` | `limit` | `ongoing` `latest` |
| GET | `/znzhxgpt/dekt/zyfw-zyhdxx/manageDetail` | — | — |
| GET | `/znzhxgpt/dekt/zyfw-zyhdxx/myInitiated` | — | — |
| GET | `/znzhxgpt/dekt/zyfw-zyhdxx/myJoined` | — | — |
| POST | `/znzhxgpt/dekt/zyfw-zyzxx/register` | — | — |

### `/zz` · 学生资助

勤工助学岗位、助学金、困难生认定、奖学金申报、资助育人活动。

**主要资源**

- `zz-qzgwxx` — 勤工助学岗位
- `zz-qzlstd` — 勤工助学老师端
- `zz-qzxsgwsqxx` — 勤工助学学生岗位申请
- `zz-zqsx` — 助学金申请
- `zz-pksrd` — 贫困生认定（批次、申请、评议、公示）

**端点（37）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| GET | `/znzhxgpt/zz/zz-knrdpcxx/find_KnrdpcxxByDqsj` | — | — |
| GET | `/znzhxgpt/zz/zz-knrdsqxx/exists_KnrdsqxxBySqpczj` | `sqpczj` | — |
| GET | `/znzhxgpt/zz/zz-lhrddjpz/find_Config` | — | — |
| GET | `/znzhxgpt/zz/zz-qzdtjlxx/find_dtwcjszf` | — | `sfjg` `zdf` |
| GET | `/znzhxgpt/zz/zz-qzdtjlxx/find_mjgcxks` | — | — |
| POST | `/znzhxgpt/zz/zz-qzdtjlxx/jysfxyks` | — | `records` |
| POST | `/znzhxgpt/zz/zz-qzdtxqxx/update_ZzQzdtxqxxByTmid` | `tmid` `xxid` `id` | — |
| GET | `/znzhxgpt/zz/zz-qzgwxx/find_gwxqByid` | `id` | `jcxx` `kqpc` `sfjg` |
| POST | `/znzhxgpt/zz/zz-qzgwxx/find_ZzQzgwxxByPage` | `pageNo` `pageSize` `paramsData` | `records` `pages` |
| POST | `/znzhxgpt/zz/zz-qzgwxx/find_ZzQzgwxxByPageForStudent` | `pageNo` `pageSize` `paramsData` | `records` `pages` |
| POST | `/znzhxgpt/zz/zz-qzgwxx/find_ZzQzgwxxByPageToH5Gld` | `pageNo` `pageSize` `params` | `records` |
| POST | `/znzhxgpt/zz/zz-qzgwxx/find_ZzQzgwxxDetailToH5Gld` | `pageNo` `pageSize` `params` | — |
| POST | `/znzhxgpt/zz/zz-qzgwxx/findGwxxByFzrAndLx` | `pageNo` `pageSize` `params` | — |
| POST | `/znzhxgpt/zz/zz-qzgwxx/findXsxxDetail` | `xh` | — |
| POST | `/znzhxgpt/zz/zz-qzgwxx/gwReview` | `id` `shzt` | `data` |
| GET | `/znzhxgpt/zz/zz-qzgwxx/qgzx_xcxsy` | — | `gdgw` `lsgw` `jcxx` `records` |
| POST | `/znzhxgpt/zz/zz-qzgwzpxx/addOrUpdateGwzpxx` | — | `records` |
| POST | `/znzhxgpt/zz/zz-qzgwzpxx/findGwzpxxByPage` | `pageNo` `pageSize` `params` | — |
| POST | `/znzhxgpt/zz/zz-qzlstd/choose_Gw` | `sqid` `offerId` | — |
| GET | `/znzhxgpt/zz/zz-qzlstd/find_MyRdxx` | — | — |
| GET | `/znzhxgpt/zz/zz-qzlstd/find_MySq` | — | — |
| POST | `/znzhxgpt/zz/zz-qzlstd/reject_All` | `sqid` | — |
| POST | `/znzhxgpt/zz/zz-qzlstd/submit_Sq` | `sqly` `lxfs` | — |
| POST | `/znzhxgpt/zz/zz-qzqgzxxzxx/ackNotice` | — | — |
| GET | `/znzhxgpt/zz/zz-qzqgzxxzxx/find_ZzQzqgzxxzxxByOne` | — | — |
| GET | `/znzhxgpt/zz/zz-qzqgzxxzxx/hasAckedNotice` | — | — |
| POST | `/znzhxgpt/zz/zz-qztkxx/find_ZzQztkxxByPage` | — | — |
| GET | `/znzhxgpt/zz/zz-qztmxx/find_ZzQztmxxxxByAll` | — | — |
| POST | `/znzhxgpt/zz/zz-qzxsgwrzxx/update_ZzQzxsgwrzxx` | `id` `zzzt` | — |
| POST | `/znzhxgpt/zz/zz-qzxsgwrzxx/update_ZzQzxsgwsqxx` | `id` `shzt` | — |
| POST | `/znzhxgpt/zz/zz-qzxsgwsqxx/addOrUpdateQzxsgwsqxx` | `id` `shzt` | — |
| POST | `/znzhxgpt/zz/zz-qzxsgwsqxx/find_gwsq` | `yylz` `gwbm` | — |
| POST | `/znzhxgpt/zz/zz-qzxsgwsqxx/find_wdgwsq` | `pageNo` `pageSize` `paramsData` | `records` |
| POST | `/znzhxgpt/zz/zz-qzxsgwsqxx/findgwsqxxByPage` | `pageNo` `pageSize` `params` | — |
| POST | `/znzhxgpt/zz/zz-qzxxkcjlxx/recordStudy` | `kcid` `lx` | — |
| POST | `/znzhxgpt/zz/zz-qzxxkcxx/find_ZzQzxxkcxxByPage` | `pageNo` `pageSize` `paramsData` | `records` |
| POST | `/znzhxgpt/zz/zz-qzyrdwxx/findQzyrdwxxByPage` | `pageNo` `pageSize` `params` | — |

### `/xljkrz` · 心理健康

心理测评、咨询预约、咨询师工作台、危机干预、谈心谈话记录、通知触达。

**主要资源**

- `xljkrz-rz` — 心理健康日志/记录
- `xljkrz-xyy` — 心理预约（学生端：预约、反馈、私信）
- `xljkrz-lstd` — 咨询师端（审批、反馈、统计、通知）

**端点（53）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/accept` | `id` | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/approve` | `id` `sqbh` `jzsj` `jzjssj` `jytx` | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/batchApprove` | — | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/collegeStat` | — | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/dashboard` | `paramsData` | `cards` `monthlyTrend` `latest` `trend` `count` `visitTypeDist` `collegeTop` |
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/delete` | — | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/feedback` | `id` `jzqk` `zdjg` | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/findPage` | `pageNo` `pageSize` `paramsData` | `records` `total` |
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/getById` | `id` | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/markAllRead` | `admin` | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/markRead` | `id` | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/notifications` | `pageNo` `pageSize` `paramsData` | `records` `total` |
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/reject` | `id` `reason` | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/saveOrUpdate` | — | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-lstd/unreadCount` | `admin` | `count` |
| POST | `/znzhxgpt/xljkrz/xljkrz-rz/dashboard` | — | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-rz/delete` | `id` | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-rz/findPage` | `pageNo` `pageSize` `paramsData` | `total` |
| POST | `/znzhxgpt/xljkrz/xljkrz-rz/getById` | `id` | `dtsj` |
| POST | `/znzhxgpt/xljkrz/xljkrz-rz/saveOrUpdate` | — | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-xyy/addFeedback` | `jzid` `fknr` `viewRole` | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-xyy/collegeOptions` | `viewRole` | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-xyy/collegeStat` | `viewRole` | `collegeNames` `scopeLabel` `jsmc` `roleLabel` `xm` `gh` `bmmc` `cards` |
| POST | `/znzhxgpt/xljkrz/xljkrz-xyy/dashboard` | `viewRole` `mine` `rangeType` | `riskDist` `cards` `recent` `scopeLabel` `jsmc` `xm` `gh` `bmmc` |
| POST | `/znzhxgpt/xljkrz/xljkrz-xyy/delete` | — | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-xyy/feedbackOverview` | — | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-xyy/findPage` | `pageNo` `pageSize` `paramsData` | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-xyy/getById` | `id` `viewRole` | `viewRole` |
| POST | `/znzhxgpt/xljkrz/xljkrz-xyy/myProfile` | `viewRole` | `viewRole` `scopeLabel` `xm` `collegeNames` `jsmc` `gh` `bmmc` `cards` |
| POST | `/znzhxgpt/xljkrz/xljkrz-xyy/queryStudent` | `xh` | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-xyy/saveOrUpdate` | — | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-xyy/sendPrivateMsg` | `jzid` `nr` `viewRole` | — |
| POST | `/znzhxgpt/xljkrz/xljkrz-xyy/unreadChat` | — | `recent` `riskDist` `scopeLabel` `jsmc` `xm` `gh` `bmmc` `cards` |
| POST | `/znzhxgpt/xljkrz/xljkrz-xyy/warningPage` | `pageNo` `pageSize` `paramsData` | `records` `total` `viewRole` `scopeLabel` `jsmc` `roleLabel` `xm` `gh` |
| POST | `/znzhxgpt/xljkrz/xlpxzx-bm/cancel` | `pxid` | — |
| POST | `/znzhxgpt/xljkrz/xlpxzx-bm/detail` | `pxid` | `pxjh` `bm` `sb` `cg` |
| POST | `/znzhxgpt/xljkrz/xlpxzx-bm/enroll` | `pxid` | — |
| POST | `/znzhxgpt/xljkrz/xlpxzx-bm/remind` | — | — |
| POST | `/znzhxgpt/xljkrz/xlpxzx-bm/signIn` | `pxid` | — |
| POST | `/znzhxgpt/xljkrz/xlpxzx-bm/signOut` | `pxid` | — |
| POST | `/znzhxgpt/xljkrz/xlpxzx-cg/delete` | — | — |
| POST | `/znzhxgpt/xljkrz/xlpxzx-cg/list` | — | — |
| POST | `/znzhxgpt/xljkrz/xlpxzx-cg/save` | `pxid` `fjmc` `fjurl` `fjlx` `fjdx` `cglx` | — |
| POST | `/znzhxgpt/xljkrz/xlpxzx-pxjh/findPage` | `pageNo` `pageSize` `paramsData` | `records` `total` |
| POST | `/znzhxgpt/xljkrz/xlpxzx-pxjh/getById` | `id` | — |
| POST | `/znzhxgpt/xljkrz/xlpxzx-pxjh/tabCount` | — | — |
| POST | `/znzhxgpt/xljkrz/xlpxzx-sb/apply` | — | — |
| POST | `/znzhxgpt/xljkrz/xlpxzx-sb/canApplyPage` | `pageNo` `pageSize` `paramsData` | `records` |
| POST | `/znzhxgpt/xljkrz/xlpxzx-sb/findPage` | `pageNo` `pageSize` `paramsData` | `records` `total` |
| POST | `/znzhxgpt/xljkrz/xlpxzx-sb/getById` | `id` | `sb` `progress` |
| POST | `/znzhxgpt/xljkrz/xlpxzx-sb/statistics` | — | `records` |
| POST | `/znzhxgpt/xljkrz/xlpxzx-xf/detailPage` | `pageNo` `pageSize` `paramsData` | `records` `total` |
| POST | `/znzhxgpt/xljkrz/xlpxzx-xf/overview` | — | — |

### `/xlfk` · 心理反馈

心理相关反馈工单的提交与处理。

**主要资源**

- `xlfk-fkxx` — 反馈信息

**端点（10）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| POST | `/znzhxgpt/xlfk/xlfk-ai/summarize` | `zy` `mklj` `bwList` | — |
| POST | `/znzhxgpt/xlfk/xlfk-fkhf/addReply` | `fkzj` `fsfzlx` `nr` `ftlb` | — |
| GET | `/znzhxgpt/xlfk/xlfk-fkhf/findByFkid` | — | — |
| GET | `/znzhxgpt/xlfk/xlfk-fktp/getByFkid` | — | — |
| POST | `/znzhxgpt/xlfk/xlfk-fkxx/findPage` | `pageNo` `pageSize` `paramsData` | — |
| GET | `/znzhxgpt/xlfk/xlfk-fkxx/getById` | — | — |
| POST | `/znzhxgpt/xlfk/xlfk-fkxx/rate` | `id` `pf` `pfwz` | — |
| POST | `/znzhxgpt/xlfk/xlfk-fkxx/submit` | — | — |
| POST | `/znzhxgpt/xlfk/xlfk-ggwt/list` | `pageNo` `pageSize` | — |
| POST | `/znzhxgpt/xlfk/xlfk-ggwt/vote` | — | — |

### `/bbs` · 校园论坛

帖子、评论、社团圈、私信、举报与治理、敏感词。

**主要资源**

- `bbs-tz` — 帖子
- `bbs-pl` — 评论
- `bbs-cg` — 圈子/社团
- `bbs-admin` — 论坛管理（审核、举报、敏感词）

**端点（22）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| POST | `/znzhxgpt/bbs/bbs-cg/delete_Cg` | `id` | — |
| GET | `/znzhxgpt/bbs/bbs-cg/find_CgById` | — | — |
| POST | `/znzhxgpt/bbs/bbs-cg/save_Cg` | — | — |
| POST | `/znzhxgpt/bbs/bbs-cg/update_Cg` | — | — |
| GET | `/znzhxgpt/bbs/bbs-ht/find_ByZdbmid` | — | — |
| POST | `/znzhxgpt/bbs/bbs-pl/delete_Pl` | `id` | — |
| POST | `/znzhxgpt/bbs/bbs-pl/find_MyPage` | — | — |
| POST | `/znzhxgpt/bbs/bbs-pl/find_MyTzPage` | `pageNo` `pageSize` | — |
| GET | `/znzhxgpt/bbs/bbs-pl/find_TreeByTzid` | — | — |
| POST | `/znzhxgpt/bbs/bbs-pl/save_Pl` | — | — |
| GET | `/znzhxgpt/bbs/bbs-sx/find_Messages` | — | — |
| POST | `/znzhxgpt/bbs/bbs-sx/send_Sx` | `jsrid` `nr` | — |
| POST | `/znzhxgpt/bbs/bbs-tz/delete_Tz` | `id` | `msg` |
| POST | `/znzhxgpt/bbs/bbs-tz/find_MyJbPage` | `pageNo` `pageSize` `tab` | — |
| POST | `/znzhxgpt/bbs/bbs-tz/find_MyPage` | `pageNo` `pageSize` | — |
| POST | `/znzhxgpt/bbs/bbs-tz/find_Page` | `pageNo` `pageSize` `sort` `lx` | — |
| GET | `/znzhxgpt/bbs/bbs-tz/find_TzById` | — | — |
| POST | `/znzhxgpt/bbs/bbs-tz/save_Jb` | `tzid` `jblx` `jbyy` | — |
| POST | `/znzhxgpt/bbs/bbs-tz/save_Tz` | `bt` `nr` `lx` `tps` | — |
| POST | `/znzhxgpt/bbs/bbs-tz/update_Tz` | `id` `bt` `nr` `ht` `zdbmid` `tps` | — |
| POST | `/znzhxgpt/bbs/bbs-xx/find_Page` | `pageNo` `pageSize` `lx` | — |
| POST | `/znzhxgpt/bbs/bbs-yh/save_NcTx` | `nc` `tx` | — |

### `/gfjy` · 国防教育

军训、征兵、国防教育活动与学生队管理。

**主要资源**

- `gfjy-xsd` — 国防教育学生队
- `gfjy-hd` — 国防教育活动

**端点（19）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| GET | `/znzhxgpt/gfjy/gfjy-xsd/find_HdBmzt` | — | — |
| GET | `/znzhxgpt/gfjy/gfjy-xsd/find_HdglById` | — | — |
| POST | `/znzhxgpt/gfjy/gfjy-xsd/find_HdglByPage` | `pageNo` `pageSize` | `records` `pages` |
| GET | `/znzhxgpt/gfjy/gfjy-xsd/find_ZbxcglById` | — | — |
| POST | `/znzhxgpt/gfjy/gfjy-xsd/find_ZbxcglByLxPage` | `pageNo` `pageSize` `params` | `records` |
| POST | `/znzhxgpt/gfjy/gfjy-xsd/save_Hdbm` | `hdid` `xm` `sjh` `xyid` `xymc` `bjid` `bjmc` | — |
| POST | `/znzhxgpt/gfjy/jskjx-xsd/save_JxsqglBmh` | — | — |
| POST | `/znzhxgpt/gfjy/jskjx-xsd/save_JxsqglGat` | — | — |
| GET | `/znzhxgpt/gfjy/wdhd-xsd/cancel_Hdbm` | — | — |
| GET | `/znzhxgpt/gfjy/wdhd-xsd/find_MyHdByZt` | — | — |
| GET | `/znzhxgpt/gfjy/zbrw-xsd/find_ZbxcglById` | — | — |
| POST | `/znzhxgpt/gfjy/zbrw-xsd/find_ZbxcglByLxPage` | `pageNo` `pageSize` `params` | `records` `total` |
| POST | `/znzhxgpt/gfjy/zbrw-xsd/save_Cjyxdj` | — | — |
| GET | `/znzhxgpt/gfjy/zyt-xsd/find_RwfbById` | — | — |
| POST | `/znzhxgpt/gfjy/zyt-xsd/find_RwfbByPage` | `pageNo` `pageSize` | `records` `pages` |
| GET | `/znzhxgpt/gfjy/zyt-xsd/find_XlfbById` | — | — |
| POST | `/znzhxgpt/gfjy/zyt-xsd/find_XlfbByPage` | `pageNo` `pageSize` | `records` `pages` |
| GET | `/znzhxgpt/gfjy/zyt-xsd/find_ZytMemberByDwid` | — | `leaders` `members` |
| POST | `/znzhxgpt/gfjy/zyt-xsd/save_Cysq` | — | — |

### `/zgxsk` · 资助学生库

资助相关的学生基础库与通知信息。

**主要资源**

- `zgxsk-tzxx` — 通知信息

**端点（18）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| POST | `/znzhxgpt/zgxsk/zgxsk-thtz/find_ById` | `id` | — |
| POST | `/znzhxgpt/zgxsk/zgxsk-thtz/find_Page` | `pageNo` `pageSize` `xh` `exactXh` `month` `sfdb` | `records` `total` |
| POST | `/znzhxgpt/zgxsk/zgxsk-tj/find_FocusPage` | — | `records` |
| POST | `/znzhxgpt/zgxsk/zgxsk-tj/find_RoleOverview` | `roleKey` | — |
| POST | `/znzhxgpt/zgxsk/zgxsk-tzxx/find_ById` | `id` | `zcsqList` |
| POST | `/znzhxgpt/zgxsk/zgxsk-tzxx/find_CardStat` | — | `total` |
| POST | `/znzhxgpt/zgxsk/zgxsk-tzxx/find_DjCount` | — | — |
| POST | `/znzhxgpt/zgxsk/zgxsk-tzxx/find_Page` | — | `records` `total` |
| POST | `/znzhxgpt/zgxsk/zgxsk-tzxx/find_TabCount` | — | — |
| POST | `/znzhxgpt/zgxsk/zgxsk-tzxx/find_XsByXh` | `xh` `sfdb` | — |
| POST | `/znzhxgpt/zgxsk/zgxsk-xlk/find_ById` | — | — |
| POST | `/znzhxgpt/zgxsk/zgxsk-xlk/find_Page` | — | — |
| POST | `/znzhxgpt/zgxsk/zgxsk-xlk/find_Stat` | — | — |
| POST | `/znzhxgpt/zgxsk/zgxsk-xxtz/find_MyPage` | — | — |
| POST | `/znzhxgpt/zgxsk/zgxsk-xxtz/read_Msg` | `id` | — |
| POST | `/znzhxgpt/zgxsk/zgxsk-zcsq/find_ById` | `id` | `zcsqList` |
| POST | `/znzhxgpt/zgxsk/zgxsk-zhda/find_Stat` | — | — |
| POST | `/znzhxgpt/zgxsk/zgxsk-zhda/find_StudentPage` | — | — |

### `/ywzs` · 业务中枢

跨部门业务的统一入口：各类申报表单、迎新/离校/宿舍/证明等条线业务。端点最多，多为标准 CRUD + 流程发起。

**主要资源**

- `ywzs-cdgl` — 场地管理
- `ywzs-wjdc` — 问卷调查（创建、填写、分析）
- `ywzs-tzgg` — 通知公告
- `ywzs-yzgl` — 印章管理
- `ywzs-qdzs` — 签到助手
- `ywzs-*-index` — 各条线业务页面

**端点（125）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| GET | `/znzhxgpt/ywzs/cd-bdmb/find_BdmbById` | `id` | `zdList` `ZDLIST` |
| POST | `/znzhxgpt/ywzs/cd-cdjbxx/find_CdjbxxByPage` | `pageNo` `pageSize` `paramsData` | `records` `list` |
| POST | `/znzhxgpt/ywzs/cd-cdjbxx/find_CdjbxxByTab` | `scene` | — |
| GET | `/znzhxgpt/ywzs/cd-cdjbxx/find_CdjbxxDetail` | `id` `scene` | — |
| POST | `/znzhxgpt/ywzs/cd-yysq/approve_Yysq` | — | — |
| GET | `/znzhxgpt/ywzs/cd-yysq/check_YyQxpz` | `cdid` | — |
| POST | `/znzhxgpt/ywzs/cd-yysq/find_MyYysqByPage` | `pageNo` `pageSize` `paramsData` | — |
| GET | `/znzhxgpt/ywzs/cd-yysq/find_YysqById` | `id` | `lcsl` |
| POST | `/znzhxgpt/ywzs/cd-yysq/find_YysqByPage` | — | — |
| GET | `/znzhxgpt/ywzs/cd-yysq/list_OccupiedSd` | `cdid` `yyrq` | — |
| POST | `/znzhxgpt/ywzs/cd-yysq/reject_Yysq` | — | — |
| POST | `/znzhxgpt/ywzs/cd-yysq/revoke_Yysq` | `params` | — |
| POST | `/znzhxgpt/ywzs/cd-yysq/save_Yysq` | — | `message` `msg` `MSG` |
| POST | `/znzhxgpt/ywzs/cd-yysq/sync_ApprovalResult` | `sqid` `params` `spyj` | — |
| GET | `/znzhxgpt/ywzs/hd-canyu/cancel` | `hdid` | — |
| GET | `/znzhxgpt/ywzs/hd-canyu/enroll` | `hdid` | `records` `total` `canSelfEnroll` `favTotal` `rate` `centerLabel` `pieData` `stats` |
| POST | `/znzhxgpt/ywzs/hd-canyu/find_MyFavorites` | `paramsData` | — |
| GET | `/znzhxgpt/ywzs/hd-canyu/share` | `hdid` | — |
| GET | `/znzhxgpt/ywzs/hd-canyu/toggleFavorite` | `hdid` | — |
| GET | `/znzhxgpt/ywzs/hd-cyr/checkin` | `hdid` `yhid` | — |
| POST | `/znzhxgpt/ywzs/hd-cyr/find_MyActivities` | `paramsData` | — |
| GET | `/znzhxgpt/ywzs/hd-fj/find_FjtjDetail` | `hdid` | `files` |
| POST | `/znzhxgpt/ywzs/hd-fj/find_MyUploads` | `paramsData` | — |
| POST | `/znzhxgpt/ywzs/hd-fj/submitFiles` | `hdid` `files` | — |
| POST | `/znzhxgpt/ywzs/hd-fj/uploadFile` | `url` `filePath` `name` `header` `success` `fail` `formData` `complete` `timeout` | `downloadUri` `filename` `uploadPath` |
| POST | `/znzhxgpt/ywzs/hd-hdxx/find_CanyuHdByPage` | `pageNo` `pageSize` `paramsData` | — |
| GET | `/znzhxgpt/ywzs/hd-hdxx/find_CanyuHdDetail` | `id` | `canSelfEnroll` `files` |
| POST | `/znzhxgpt/ywzs/hd-hdxx/find_CanyuHdForCalendar` | `paramsData` | — |
| POST | `/znzhxgpt/ywzs/hd-hdxx/find_HdForCalendar` | — | — |
| GET | `/znzhxgpt/ywzs/hd-hdxx/find_HotHd` | `limit` | — |
| GET | `/znzhxgpt/ywzs/hd-hj/find_HjDetail` | `id` | — |
| POST | `/znzhxgpt/ywzs/hd-hj/find_HjList` | `pageNo` `pageSize` `paramsData` | `records` |
| GET | `/znzhxgpt/ywzs/hd-lottery/lotteryInfo` | `hdid` | — |
| GET | `/znzhxgpt/ywzs/hd-pj/find_FeaturedPj` | `hdid` | — |
| GET | `/znzhxgpt/ywzs/hd-pj/find_MyPjByHdid` | `hdid` | — |
| POST | `/znzhxgpt/ywzs/hd-pj/submit` | — | — |
| GET | `/znzhxgpt/ywzs/hd-zm/find_CertData` | `hdid` `action` | — |
| POST | `/znzhxgpt/ywzs/qd-qdjl/find_QdjlByPage` | — | — |
| POST | `/znzhxgpt/ywzs/qd-qdry/find_KfpRyListByPage` | `pageNo` `pageSize` `params` | `records` `total` |
| POST | `/znzhxgpt/ywzs/qd-qdry/find_QdryByPage` | `pageNo` `pageSize` `params` | `records` `total` |
| POST | `/znzhxgpt/ywzs/qd-qdry/save_FpRy` | `params` | — |
| POST | `/znzhxgpt/ywzs/qd-qdxx/assignPersonnel` | `params` | — |
| POST | `/znzhxgpt/ywzs/qd-qdxx/doSign` | `params` | — |
| POST | `/znzhxgpt/ywzs/qd-qdxx/doSignOut` | `params` | — |
| POST | `/znzhxgpt/ywzs/qd-qdxx/find_MyQdxxByPage` | `pageNo` `pageSize` `params` | — |
| GET | `/znzhxgpt/ywzs/qd-qdxx/find_QdxxById` | — | `qdryList` |
| GET | `/znzhxgpt/ywzs/qd-qdxx/find_QdxxByIdDlzh` | `id` | `qdryList` |
| POST | `/znzhxgpt/ywzs/qd-qdxx/find_QdxxByPage` | `pageNo` `pageSize` `params` | — |
| GET | `/znzhxgpt/ywzs/qd-qdxx/generateQrcode` | — | — |
| GET | `/znzhxgpt/ywzs/qd-qdxx/remove_QdxxById` | — | — |
| POST | `/znzhxgpt/ywzs/qd-qdxx/saveOrUpdate_Qdxx` | — | — |
| POST | `/znzhxgpt/ywzs/tzgg-cbjl/doCb` | — | `cbjsrs` |
| POST | `/znzhxgpt/ywzs/tzgg-cbjl/doCbAll` | `params` | `cbjsrs` |
| POST | `/znzhxgpt/ywzs/tzgg-cbjl/doCbBatch` | `params` | — |
| POST | `/znzhxgpt/ywzs/tzgg-tbrwxx/doSh` | — | — |
| POST | `/znzhxgpt/ywzs/tzgg-tbrwxx/doTb` | — | — |
| GET | `/znzhxgpt/ywzs/tzgg-tbrwxx/find_HzFjList` | `tbrwid` | — |
| POST | `/znzhxgpt/ywzs/tzgg-tbrwxx/find_MyTbByPage` | `pageNo` `pageSize` `params` | `total` |
| POST | `/znzhxgpt/ywzs/tzgg-tbrwxx/find_TbjsrByPage` | `pageNo` `pageSize` `params` | — |
| GET | `/znzhxgpt/ywzs/tzgg-tbrwxx/find_TbrwById` | `id` | — |
| POST | `/znzhxgpt/ywzs/tzgg-tbrwxx/find_TbrwByPage` | `pageNo` `pageSize` `params` | — |
| GET | `/znzhxgpt/ywzs/tzgg-tbrwxx/find_ZfjlDetail` | `taskId` | — |
| POST | `/znzhxgpt/ywzs/tzgg-tbrwxx/forward` | — | — |
| POST | `/znzhxgpt/ywzs/tzgg-tbrwxx/markZfjlViewed` | `params` | — |
| POST | `/znzhxgpt/ywzs/tzgg-tbrwxx/saveOrUpdate_Tbrw` | `params` | — |
| POST | `/znzhxgpt/ywzs/tzgg-tbrwxx/saveTbCg` | — | `messag` `message` |
| GET | `/znzhxgpt/ywzs/tzgg-tzjbxx/doBj` | `tzid` | — |
| GET | `/znzhxgpt/ywzs/tzgg-tzjbxx/doHz` | `tzid` | — |
| POST | `/znzhxgpt/ywzs/tzgg-tzjbxx/find_HcfjByPage` | `pageNo` `pageSize` `params` | — |
| POST | `/znzhxgpt/ywzs/tzgg-tzjbxx/find_JsrByPage` | — | — |
| POST | `/znzhxgpt/ywzs/tzgg-tzjbxx/find_MyMsgByPage` | `pageNo` `pageSize` `params` | — |
| POST | `/znzhxgpt/ywzs/tzgg-tzjbxx/find_SentByPage` | — | — |
| GET | `/znzhxgpt/ywzs/tzgg-tzjbxx/find_TzjbxxById` | `id` | — |
| GET | `/znzhxgpt/ywzs/tzgg-tzjbxx/markRead` | `tzid` | — |
| POST | `/znzhxgpt/ywzs/tzgg-tzjbxx/publish` | — | — |
| GET | `/znzhxgpt/ywzs/tzgg-tzjbxx/remove_TzjbxxById` | `id` | — |
| POST | `/znzhxgpt/ywzs/tzgg-tzjbxx/saveHcfj` | `params` | — |
| POST | `/znzhxgpt/ywzs/tzgg-tzjbxx/saveOrUpdate_Tzjbxx` | `params` | — |
| POST | `/znzhxgpt/ywzs/tzgg-tzjbxx/withdraw` | `params` | `message` |
| GET | `/znzhxgpt/ywzs/wj-mbfl/delete_Mbfl?flid=` | — | — |
| POST | `/znzhxgpt/ywzs/wj-mbfl/saveOrUpdate_Mbfl` | — | — |
| GET | `/znzhxgpt/ywzs/wj-mbxx/delete_Mbxx?mbid=` | — | — |
| GET | `/znzhxgpt/ywzs/wj-mbxx/find_MbxxById?mbid=` | — | `questionList` `tmList` |
| POST | `/znzhxgpt/ywzs/wj-mbxx/find_MbxxByPage` | `pageNo` `pageSize` `paramsData` | `records` `total` |
| POST | `/znzhxgpt/ywzs/wj-mbxx/saveOrUpdate_Mbxx` | — | — |
| POST | `/znzhxgpt/ywzs/wj-wjda/find_DoneList` | `pageNo` `pageSize` `paramsData` | `total` `records` |
| GET | `/znzhxgpt/ywzs/wj-wjda/find_MyDa?daid=` | — | — |
| POST | `/znzhxgpt/ywzs/wj-wjda/find_PendingList` | — | `total` `records` |
| GET | `/znzhxgpt/ywzs/wj-wjda/find_WjForFill?wjid=` | — | — |
| POST | `/znzhxgpt/ywzs/wj-wjda/submit_Wjda` | `wjid` `txsc` `tmList` | `daid` `DAID` |
| POST | `/znzhxgpt/ywzs/wj-wjxx/createFromMb` | — | — |
| GET | `/znzhxgpt/ywzs/wj-wjxx/delete_Wjxx?wjid=` | — | `code` |
| POST | `/znzhxgpt/ywzs/wj-wjxx/export_Wjxx` | — | — |
| GET | `/znzhxgpt/ywzs/wj-wjxx/find_DaDetail?daid=` | — | — |
| POST | `/znzhxgpt/ywzs/wj-wjxx/find_DaList` | `pageNo` `pageSize` `paramsData` | — |
| POST | `/znzhxgpt/ywzs/wj-wjxx/find_HdList` | — | — |
| POST | `/znzhxgpt/ywzs/wj-wjxx/find_TargetTree` | — | — |
| POST | `/znzhxgpt/ywzs/wj-wjxx/find_WjxxByPage` | `pageNo` `pageSize` `paramsData` | `records` `total` |
| POST | `/znzhxgpt/ywzs/wj-wjxx/find_Wtrs` | `pageNo` `pageSize` `paramsData` | `records` `total` |
| POST | `/znzhxgpt/ywzs/wj-wjxx/find_Ytrs` | `pageNo` `pageSize` `paramsData` | `records` `total` |
| GET | `/znzhxgpt/ywzs/wj-wjxx/getQrcode?wjid=` | — | `url` |
| POST | `/znzhxgpt/ywzs/wj-wjxx/publish_Wjxx` | `wjid` `fbfs` `kssj` `jzsj` `sfdsfb` `dsfbsj` `sfnm` `yxgx` `xsjtj` `mrlx` | — |
| POST | `/znzhxgpt/ywzs/wj-wjxx/remind_Wtrs` | `wjid` `all` | — |
| POST | `/znzhxgpt/ywzs/wj-wjxx/saveOrUpdate_Wjxx` | — | `wjid` |
| GET | `/znzhxgpt/ywzs/wj-wjxx/stat_Cross` | `wjid` `tmid` `dim` | — |
| GET | `/znzhxgpt/ywzs/wj-wjxx/stat_Duration?wjid=` | — | `records` `buckets` `wjmc` `tmList` |
| GET | `/znzhxgpt/ywzs/wj-wjxx/stat_Summary?wjid=` | — | `wjmc` `records` `buckets` `tmList` |
| GET | `/znzhxgpt/ywzs/wj-wjxx/stat_Trend` | — | — |
| GET | `/znzhxgpt/ywzs/wj-wjxx/stop_Wjxx?wjid=` | — | — |
| POST | `/znzhxgpt/ywzs/yzgl-yzsq/find_MyByPage` | `pageNo` `pageSize` `params` | `records` `total` |
| GET | `/znzhxgpt/ywzs/yzgl-yzsq/find_YzsqxxById` | — | `nodeInsts` `logs` |
| GET | `/znzhxgpt/ywzs/yzgl-yzsq/preview_Flow` | `yzid` | `nodes` `supported` |
| POST | `/znzhxgpt/ywzs/yzgl-yzsq/publish_DraftYzsqxx` | — | — |
| POST | `/znzhxgpt/ywzs/yzgl-yzsq/remove_DraftYzsqxx?id=` | — | — |
| POST | `/znzhxgpt/ywzs/yzgl-yzsq/save_DraftYzsqxx` | — | `sqid` |
| POST | `/znzhxgpt/ywzs/yzgl-yzsq/save_Yzsqxx` | — | — |
| POST | `/znzhxgpt/ywzs/yzgl-yzsq/sync_ApprovalResult` | `sqid` `params` `spyj` | — |
| POST | `/znzhxgpt/ywzs/yzgl-yzsq/update_Yzsqxx` | — | — |
| POST | `/znzhxgpt/ywzs/yzgl-yzsq/withdraw?id=` | — | — |
| POST | `/znzhxgpt/ywzs/yzgl-yzxx/find_ByPage` | `pageNo` `pageSize` `params` | `records` |
| POST | `/znzhxgpt/ywzs/zyk-resource/page_Resources` | `pageNo` `pageSize` `params` | `records` `total` |
| POST | `/znzhxgpt/ywzs/zyk-resource/remove_Resource` | `ids` | — |
| POST | `/znzhxgpt/ywzs/zyk-resource/save_Resource` | — | `id` |
| POST | `/znzhxgpt/ywzs/zyk-resource/update_Resource` | — | — |
| POST | `/znzhxgpt/ywzs/zyk-tag/list_Tags` | `params` | `records` `list` `resource` `tags` `tota` |

### `/yw` · 业务办理

学生事务办理：证明开具、证照申请、各类申请单与审批。

**主要资源**

- `xj-jzgxx` — 学籍相关
- `wj-wjxx` — 问卷/文件
- `yzgl-yzsq` — 印章申请
- `qd-qdxx` — 签到信息
- `cd-yysq` — 场地预约申请
- `hd-*` — 活动参与

**端点（109）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| POST | `/znzhxgpt/yw/dekt-hdglpz/appFindPage` | `pageNo` `pageSize` `paramsData` | — |
| GET | `/znzhxgpt/yw/dekt-hdglpz/getDetailFull` | `id` | — |
| GET | `/znzhxgpt/yw/dekt-hdglpz/listSjzxByHdId` | — | — |
| POST | `/znzhxgpt/yw/dekt-shsj/addResult` | — | — |
| POST | `/znzhxgpt/yw/dekt-shsj/applyExcellent` | `paramsData` | — |
| GET | `/znzhxgpt/yw/dekt-shsj/auditRecords` | `projectId` | — |
| POST | `/znzhxgpt/yw/dekt-shsj/cancelSignup` | `paramsData` | — |
| POST | `/znzhxgpt/yw/dekt-shsj/changeLocation/apply` | — | — |
| GET | `/znzhxgpt/yw/dekt-shsj/changeLocation/list` | `projectId` | — |
| POST | `/znzhxgpt/yw/dekt-shsj/closingMaterial` | `paramsData` | — |
| GET | `/znzhxgpt/yw/dekt-shsj/collegeActivity` | — | — |
| GET | `/znzhxgpt/yw/dekt-shsj/creditProjects` | — | — |
| GET | `/znzhxgpt/yw/dekt-shsj/creditRecords` | — | — |
| POST | `/znzhxgpt/yw/dekt-shsj/daka` | `paramsData` | — |
| POST | `/znzhxgpt/yw/dekt-shsj/deletePracticeJournal` | `paramsData` | — |
| POST | `/znzhxgpt/yw/dekt-shsj/deleteProject` | `paramsData` | — |
| GET | `/znzhxgpt/yw/dekt-shsj/getResultsByXmid` | `xmid` | — |
| GET | `/znzhxgpt/yw/dekt-shsj/listResults` | — | — |
| GET | `/znzhxgpt/yw/dekt-shsj/myCredit` | — | `xf` `creditCap` `communityCap` |
| GET | `/znzhxgpt/yw/dekt-shsj/myPointDetail` | — | — |
| GET | `/znzhxgpt/yw/dekt-shsj/myProjectList` | `page` `pageSize` | — |
| GET | `/znzhxgpt/yw/dekt-shsj/myScrdList` | `page` `pageSize` | — |
| GET | `/znzhxgpt/yw/dekt-shsj/notices` | — | — |
| POST | `/znzhxgpt/yw/dekt-shsj/practiceJournal` | `paramsData` | — |
| GET | `/znzhxgpt/yw/dekt-shsj/practiceRecord` | `projectId` | `days` |
| GET | `/znzhxgpt/yw/dekt-shsj/preConfirm/get` | `projectId` | — |
| POST | `/znzhxgpt/yw/dekt-shsj/preConfirm/submit` | `paramsData` | — |
| POST | `/znzhxgpt/yw/dekt-shsj/projectCard` | `paramsData` | `days` |
| GET | `/znzhxgpt/yw/dekt-shsj/projectDetail` | `projectId` | — |
| GET | `/znzhxgpt/yw/dekt-shsj/projectLib` | — | — |
| GET | `/znzhxgpt/yw/dekt-shsj/recommendProjects` | `limit` | — |
| POST | `/znzhxgpt/yw/dekt-shsj/reportEvent` | — | — |
| POST | `/znzhxgpt/yw/dekt-shsj/saveResults` | — | — |
| POST | `/znzhxgpt/yw/dekt-shsj/sjscRank` | `pageNo` `pageSize` `params` | — |
| POST | `/znzhxgpt/yw/dekt-shsj/supplementCard` | — | — |
| POST | `/znzhxgpt/yw/dekt-sjjdgl/findPage` | `pageNo` `pageSize` | — |
| POST | `/znzhxgpt/yw/dekt-sjsb/addTdcy` | `paramsData` | — |
| GET | `/znzhxgpt/yw/dekt-sjsb/listTdcy` | `sbid` | — |
| POST | `/znzhxgpt/yw/dekt-sjsb/removeTdcy` | `paramsData` | — |
| POST | `/znzhxgpt/yw/dekt-sjsb/update` | — | — |
| GET | `/znzhxgpt/yw/dekt-sjsbpz/listZxForSelect` | — | — |
| GET | `/znzhxgpt/yw/lstd-axwzffxx/countWzlqxx` | — | — |
| GET | `/znzhxgpt/yw/lstd-axwzffxx/countWzlqxxFl` | — | — |
| POST | `/znzhxgpt/yw/lstd-axwzffxx/findZyzLqxx` | `pageNo` `pageSize` `paramsData` | `records` |
| GET | `/znzhxgpt/yw/lstd-axwzffxx/getWzxxByxh` | `xh` | — |
| GET | `/znzhxgpt/yw/lstd-axwzffxx/lqAxwzxxByXh` | `xh` | — |
| POST | `/znzhxgpt/yw/lstd-axwzffxx/wzlqDj` | `xh` `wzlx` | — |
| POST | `/znzhxgpt/yw/lstd-dklxx/back` | `id` | `activities` `collection` `rclxList` `records` `value` |
| GET | `/znzhxgpt/yw/lstd-dklxx/checkSfysqDkxx` | `bs` | — |
| POST | `/znzhxgpt/yw/lstd-dklxx/findById` | — | — |
| POST | `/znzhxgpt/yw/lstd-dklxx/save_xcx` | — | — |
| POST | `/znzhxgpt/yw/lstd-dklxx/selectById` | `id` | `wjxxs` `hzjym` `wjxxList` |
| POST | `/znzhxgpt/yw/lstd-dklxx/submitDkhzjymByYwbh` | `hzjym` `id` | — |
| POST | `/znzhxgpt/yw/lstd-dklxx/zlyj` | — | — |
| GET | `/znzhxgpt/yw/lstd-fbyxx/delete` | `ywbh` | `wjxxList` `wjxxs` |
| GET | `/znzhxgpt/yw/lstd-fbyxx/rollbackFbyxxByYwbh` | `ywbh` | — |
| POST | `/znzhxgpt/yw/lstd-fbyxx/svaeFbyxx` | — | — |
| GET | `/znzhxgpt/yw/lstd-scsmxx/getMessageFby` | — | — |
| POST | `/znzhxgpt/yw/lstd-scsmxx/slectXzBylx` | `lx` | `nr` |
| POST | `/znzhxgpt/yw/lstd-sqxzxx/selectxz` | `lx` | `nr` `records` `pages` |
| GET | `/znzhxgpt/yw/lstd-tsqtxx/getTsqtxx` | — | — |
| GET | `/znzhxgpt/yw/lstd-xshjxx/confirmYxXshjxxByHjid` | — | — |
| GET | `/znzhxgpt/yw/lstd-xsjzxx/deleteXsjzxxById` | `id` | — |
| GET | `/znzhxgpt/yw/lstd-xsjzxx/getXsjzxxByCjrid` | — | `ma` |
| POST | `/znzhxgpt/yw/lstd-xsjzxx/saveYxXsjzxx` | — | `qsgxList` `jkzkList` |
| GET | `/znzhxgpt/yw/lstd-zzlxx/getZzlxxByYwbh` | `ywbh` | — |
| POST | `/znzhxgpt/yw/lstd-zzlxx/hasYxZzlx` | — | — |
| GET | `/znzhxgpt/yw/lstd-zzlxx/rollbackZzlxxByYwbh` | `ywbh` | — |
| POST | `/znzhxgpt/yw/lstd-zzlxx/saveYxLstdzz` | — | — |
| POST | `/znzhxgpt/yw/qxj-qjxsqjxx/add` | — | — |
| GET | `/znzhxgpt/yw/qxj-qjxsqjxx/getById?id=` | — | — |
| GET | `/znzhxgpt/yw/qxj-qjxsqjxx/getLeaveByLoginUser` | — | — |
| GET | `/znzhxgpt/yw/xj-bjxx/find_BjxxByXybm` | `xybm` | — |
| POST | `/znzhxgpt/yw/xj-bjxx/getBjxxByZybh` | `zybh` | — |
| POST | `/znzhxgpt/yw/xj-bjxx/getOrganizationTree` | — | — |
| GET | `/znzhxgpt/yw/xj-jcxx-xqxx/findXqxxByRq` | — | — |
| GET | `/znzhxgpt/yw/xj-jzgxx/countWzffqsByGh` | `ffrq` | — |
| GET | `/znzhxgpt/yw/xj-jzgxx/countWzxylqqkByGh` | — | — |
| GET | `/znzhxgpt/yw/xj-jzgxx/countWzzbfxByGh` | — | — |
| GET | `/znzhxgpt/yw/xj-jzgxx/countXsAxwzffxxByGh` | — | — |
| GET | `/znzhxgpt/yw/xj-jzgxx/find_JzgxqxxBygh` | — | — |
| POST | `/znzhxgpt/yw/xj-jzgxx/find_JzgxqxxByGhListAndXybm` | `params` `paramsDataList` | — |
| GET | `/znzhxgpt/yw/xj-jzgxx/findByGh` | `gh` | — |
| GET | `/znzhxgpt/yw/xj-jzgxx/findWzlqxxByXybm` | `xybm` `lqzt` | — |
| POST | `/znzhxgpt/yw/xj-jzgxx/findXjJzgxxByPages` | `pageNo` `pageSize` `paramsData` | — |
| POST | `/znzhxgpt/yw/xj-jzgxx/findXsAxwzffxxByPage` | `pageNo` `pageSize` `paramsData` | `records` |
| POST | `/znzhxgpt/yw/xj-jzgxx/queryData` | `paramsData` | — |
| GET | `/znzhxgpt/yw/xj-xsqsxx/listByXh` | — | — |
| POST | `/znzhxgpt/yw/xj-xsxx/findXsgrxx` | — | `xh` `xm` |
| POST | `/znzhxgpt/yw/xj-xsxx/queryXsxxByPage` | `pageNo` `pageSize` `paramsData` | `records` `list` |
| GET | `/znzhxgpt/yw/xj-xyxx/queryAllXyxx` | — | — |
| POST | `/znzhxgpt/yw/xj-zyxx/getZyxxByXybm` | `xybm` | — |
| POST | `/znzhxgpt/yw/xs-bjgkcxx/findPage` | — | — |
| POST | `/znzhxgpt/yw/xs-cxcyxx/findPage` | — | — |
| POST | `/znzhxgpt/yw/xs-gatxsqtxx/getByXh` | — | — |
| POST | `/znzhxgpt/yw/xs-gatxx/getGatjbxxByXh` | — | — |
| POST | `/znzhxgpt/yw/xs-gbrzxx/findPage` | — | — |
| POST | `/znzhxgpt/yw/xs-jsxx/findPage` | — | — |
| POST | `/znzhxgpt/yw/xs-ryjxxx/findPage` | — | — |
| POST | `/znzhxgpt/yw/xs-strz-stxx/findPage` | — | — |
| POST | `/znzhxgpt/yw/xs-xjxzjxshjsydxx/getByXh` | — | — |
| POST | `/znzhxgpt/yw/xs-xjxzjxsjtxx/getByXh` | — | — |
| POST | `/znzhxgpt/yw/xs-xjxzxsxx/getByXh` | — | — |
| POST | `/znzhxgpt/yw/xs-xqxfxx/findPage` | — | — |
| POST | `/znzhxgpt/yw/xs-yycjxx/findPage` | — | — |
| POST | `/znzhxgpt/yw/xs-zhsz-jyyx/findPage` | — | — |
| POST | `/znzhxgpt/yw/xs-zhsz-shsj/findPage` | — | — |
| POST | `/znzhxgpt/yw/xs-zypmxx/findPage` | — | — |
| POST | `/znzhxgpt/yw/xswj-wjgl/findPage` | — | — |

### `/ai` · AI 助手

学工 AI 问答（含流式 SSE 输出、会话管理、知识库召回）。

**主要资源**

- `aiagent` — AI 代理（流式对话、会话）
- `dify` — Dify 平台对接

**端点（11）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| GET | `/znzhxgpt/ai/ai-chat/messagesSuggested` | — | — |
| POST | `/znzhxgpt/ai/ai-chat/sendChatMessageStream` | — | — |
| POST | `/znzhxgpt/ai/aichat-yhzntgl/addUserOrAgent` | — | — |
| POST | `/znzhxgpt/ai/aichat-zntfl/findByPage` | — | — |
| GET | `/znzhxgpt/ai/aichat-zntxx/list` | — | — |
| GET | `/znzhxgpt/ai/dify/conversationVariables` | `messageId` | — |
| GET | `/znzhxgpt/ai/dify/getMessagesResponse` | — | — |
| GET | `/znzhxgpt/ai/dify/stopMessagesStream` | — | — |
| GET | `/znzhxgpt/ai/lthhxx/delete/` | — | — |
| GET | `/znzhxgpt/ai/ltxxjlxx/count-assistant` | — | — |
| GET | `/znzhxgpt/ai/ltxxjlxx/like` | — | — |

### `/fdydwgl` · 辅导员队伍管理

辅导员信息、带班情况、考核。

**主要资源**

- `fdydwgl` — 辅导员队伍

**端点（1）**

| 方法 | 路径 | 参数 | 返回字段 |
|---|---|---|---|
| POST | `/znzhxgpt/fdydwgl/fdy-dbbxx/listByGh` | `gh` `pageNum` `pageSize` | — |

---

## 五、核心链路详解

以下接口均已**实测验证**，请求与响应为真实抓取。

### 5.1 统一身份认证（CAS）

认证不经过智慧学工，而是走学校统一身份认证 `ca.csu.edu.cn`（Apereo CAS 定制版，金智教育）。

#### ① 获取登录页

```http
GET https://ca.csu.edu.cn/authserver/login?service=<URLEncode(回调地址)>
```

回调地址固定为：

```
https://zhxg.csu.edu.cn/fdcwonsun/caslogin_h5.jsp
```

响应 HTML 中提取两个关键值：

| 字段 | 说明 |
|---|---|
| `#pwdEncryptSalt` | 16 字符随机盐，每次请求变化 |
| `#execution` | 通常为 `e1s1` |

同时下发 `JSESSIONID` 与 `route`（负载均衡路由）两个 Cookie，**必须保持**。

> ⚠️ 若请求携带 `MicroMessenger` UA，会 302 跳转到 `weixinQYLogin.do` 企业微信授权分支。协议登录必须使用桌面端 UA。

#### ② 验证码策略

```http
GET /authserver/checkNeedCaptcha.htl?username=<学号>&_=<时间戳>
```

```json
{ "isNeed": false }
```

`isNeed = true` 时需额外提交 `captcha` 字段。

#### ③ 提交登录

```http
POST /authserver/login?service=<同上报文>
Content-Type: application/x-www-form-urlencoded

username=<学号>&password=<密文>&lt=&execution=e1s1
&_eventId=submit&cllt=userNameLogin&dllt=generalLogin
&captcha=&rmShown=1
```

**密码加密算法**：

```js
function randomString(n) {
  const chars = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678"; // 32 字符，去除易混字符
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function encryptPassword(plain, salt) {
  const key = CryptoJS.enc.Utf8.parse(salt);           // key = pwdEncryptSalt
  const iv  = CryptoJS.enc.Utf8.parse(randomString(16)); // iv 为随机生成
  return CryptoJS.AES
    .encrypt(randomString(64) + plain, key,            // 明文前置 64 位随机串
             { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 })
    .toString();                                        // Base64
}
```

- 算法：**AES-128-CBC / PKCS7**
- 明文：`randomString(64) + 密码`
- 密钥：`pwdEncryptSalt`；IV：`randomString(16)`
- 密文长度实测 108 字符

成功返回 `302`，`Location` 携带 ticket：

```
https://zhxg.csu.edu.cn/fdcwonsun/caslogin_h5.jsp?ticket=ST-5572-Fw3BW1Dsa060bLnWQB9oBXQWJCI...
```

同时下发 `CASTGC`（TGT，可用于后续免密换取 ticket）。

#### ④ 换取业务凭据

```http
GET /fdcwonsun/caslogin_h5.jsp?ticket=<ST-...>
```

响应 HTML 内嵌两个变量：

```js
var uid = 'W8K9hN5anj2HbYrwwpbKPpIPVprA4TpGuotrNlDt…GgcnOA==';  // 344 字符
var lzc = 'S41CtcP766IMF7DgPpFUwyk9qFFsJ0dlBVmgqZsPtfnC…';
```

二者均为 RSA 加密的凭据，**一次性使用**。

#### ⑤ 换取系统 token

```http
POST /znzhxgpt/basesys/rbac-yh/login-other
Content-Type: application/json;charset=UTF-8

{
  "tyrzpt": "1",
  "channeld": "1",
  "yhzh": "<uid 双重 URL 编码>",
  "lzc":  "<lzc 双重 URL 编码>",
  "caasual": "<16 位随机串，客户端生成>"
}
```

> 注意 `yhzh` 需要 **`encodeURIComponent` 两次**。

响应：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "cdxs": "0",
    "yhzh": "2023xxxxxx",
    "bmid": "001001002003",
    "xb": "1",
    "yhxm": "张同学",
    "token": "eyJhbGciOiJSUzI1NiJ9.eyJqdGkiOi…"
  }
}
```

**`caasual` 就是后续 `postDes` 的 DES 密钥**，服务端在此处与账号绑定。

---

### 5.2 平安打卡

#### ① 查询班次与围栏配置

```http
POST /znzhxgpt/qxj/qxj-padkglxx/queryKqDkbc
body: DES-ECB({"paramsData":{}})
```

```json
{
  "code": "200",
  "data": {
    "dksjfw": "20:00-23:30",
    "dksj": null,
    "kdk": false,
    "dkbc": "校内住宿打卡",
    "bkyy": "未到打卡时间",
    "gz": "请每位学生在每晚10:30前到达宿舍用智慧学工系统打卡报平安；学院负责老师每晚11:00前确认本院学生平安并提交至学工部。",
    "kqfwxx": [
      {
        "mc": "校内住宿打卡范围（全校统一）",
        "dkfw": 300,
        "jd": null,
        "wd": null,
        "kqdz": "学生所住宿舍楼栋坐标（自动取）"
      }
    ],
    "sfydk": 0,
    "lx": 0
  }
}
```

| 字段 | 含义 |
|---|---|
| `dksjfw` | 打卡时间窗 |
| `kdk` | 当前是否可打卡 |
| `bkyy` | 不可打卡原因 |
| `dkbc` | 打卡班次名称，**提交时原样回传** |
| `kqfwxx[].dkfw` | 围栏半径（米） |
| `kqfwxx[].kqdz` | 圆心来源说明；实际圆心 = 学生本人所住楼栋坐标 |

#### ② 围栏校验（只读，不产生打卡）

```http
POST /znzhxgpt/qxj/qxj-padkglxx/jcqqwzsjsfndk
body: DES-ECB({"paramsData":{"jd":112.9388,"wd":28.1657,"dklb":"0"}})
```

```json
{
  "code": "200",
  "data": {
    "canDk": false,
    "msg": "未到打卡时间",
    "reason": "NOT_ALLOWED",
    "needExplain": false
  }
}
```

在打卡时间窗内，`data` 会额外返回 `pcMi`（偏差米数）、`fwMi`（范围米数）、`yxMc`（院系名）。
服务端**先判时间、再判距离**。

#### ③ 提交打卡

```http
POST /znzhxgpt/qxj/qxj-padkglxx/xspadk
body: DES-ECB({
  "paramsData": {
    "jd":   112.9935974,        // 经度（GCJ-02）
    "wd":   28.1401020,         // 纬度（GCJ-02）
    "dkbc": "校内住宿打卡",       // 班次，来自 queryKqDkbc
    "dkdz": "天心校区·学生六舍"   // 打卡地址文本
  }
})
```

可选字段 `sfwcdk`（是否外出打卡），置于 `paramsData` 外层。

#### ④ 楼栋坐标数据源

```http
POST /znzhxgpt/ssgl/ss-ldxx/findLdzbCjList
body: DES-ECB({"paramsData":{}})
```

返回全部楼栋（实测 **142 栋**，覆盖天心 / 岳麓山 / 开福 / 杏林 / 麓南 5 个校区）：

```json
{
  "code": "200",
  "data": {
    "zs": 142,
    "ycj": 142,
    "xqList": ["天心校区", "岳麓山校区", "开福校区", "杏林校区", "麓南校区"],
    "list": [
      {
        "id": "t10",
        "xqmc": "天心校区",
        "xqdm": "46a9c4c3820449479f7b4fc4a304da27",
        "ldmc": "学生10舍",
        "lddm": "t10",
        "lcs": "6",
        "ldlx": "0",
        "jd": "112.99337536970505",   // GCJ-02
        "wd": "28.13967301243499",
        "jwdqr": "1",
        "cjjd": "30.00",
        "qyzt": 1,
        "zt": 1
      }
    ]
  }
}
```

#### ⑤ 打卡类别字典

```js
// 打卡类别 dklb
{ XNZS: "0" 校内住宿打卡, LX: "1" 留校打卡, XJ: "2" 销假打卡,
  FXDJ: "3" 返校登记,  XWZF: "4" 校外租房打卡 }

// 需要定位的类别
["0", "4"]

// 定位点类型
[{ 自定义位置: "0" }, { 楼栋位置: "1" }, { 校外租房地址: "2" }]

// 围栏半径（米）
{ "0": 200, "1": 50, "2": 100 }
```

---

### 5.3 工作流引擎

平台所有审批（请假、离校报备、打卡地点修改、资助认定……）都由橙单流程引擎驱动，路径前缀 `/znzhxgpt/wszhxgpt-flow/`。

**流程定义键**（`processDefinitionKey`）举例：

| Key | 业务 |
|---|---|
| `xslxwcbbsq` | 学生离校外出报备申请 |
| `shsjdkddxgsq` | 社会实践打卡地点修改申请 |
| `xslxsq` | 学生离校申请 |
| `shsjbk` | 社会实践打卡 |

**典型调用顺序**：

```jsonc
// 1) 发起并进入首个用户任务
POST /znzhxgpt/wszhxgpt-flow/flowOnlineOperation/startAndTakeUserTask/xslxwcbbsq
{ "processDefinitionKey": "xslxwcbbsq", "taskVariableData": { /* 表单字段 */ } }

// 2) 我的工单
POST /znzhxgpt/wszhxgpt-flow/flowOnlineOperation/listWorkOrder/xslxwcbbsq
{ "pageNo": 1, "pageSize": 15, "flowStatus": "RUNNING" }

// 3) 查看任务业务数据
POST /znzhxgpt/wszhxgpt-flow/flowOnlineOperation/viewTaskBusinessData/xslxwcbbsq
{ "taskId": "..." }

// 4) 提交当前节点
POST /znzhxgpt/wszhxgpt-flow/flowOnlineOperation/submitUserTask
{ "taskId": "...", "taskVariableData": { }, "approveType": "agree" }

// 5) 历史节点数据
POST /znzhxgpt/wszhxgpt-flow/flowOnlineOperation/viewHistoricTaskBusinessData/xslxwcbbsq
{ "processInstanceId": "..." }
```

任务操作类型字典：

```js
["agree" 同意, "refuse" 拒绝, "reject" 驳回,
 "rejectToStart" 驳回到起点, "rejectToTask" 驳回到历史任务]
```

---

### 5.4 心理健康预约

```jsonc
// 学生提交预约
POST /znzhxgpt/xljkrz/xljkrz-xyy/saveOrUpdate
{ "jzsj": "2026-09-20 14:00", "jzqk": "近期压力较大", "jytx": "希望一次情绪疏导" }

// 学生查看自己的档案
POST /znzhxgpt/xljkrz/xljkrz-xyy/myProfile   { }

// 咨询师审批
POST /znzhxgpt/xljkrz/xljkrz-lstd/approve
{ "id": "...", "sqbh": "...", "jzsj": "...", "jzjssj": "...", "jytx": "..." }

// 咨询师填写反馈
POST /znzhxgpt/xljkrz/xljkrz-lstd/feedback
{ "id": "...", "jzqk": "咨询情况", "zdjg": "诊断结果" }

// 未读通知数
POST /znzhxgpt/xljkrz/xljkrz-lstd/unreadCount   { }   →   { "count": 3 }

// 工作台统计
POST /znzhxgpt/xljkrz/xljkrz-lstd/dashboard     { "paramsData": {} }
  →   { cards, monthlyTrend[], latest[], trend, visitTypeDist, collegeTop }
```

---

## 六、枚举字典

逆向自前端字典定义（`DictionaryBase`）：

```js
// 贫困生认定状态
{ 99:"未申请", 0:"申请中", 1:"评议审核", 2:"辅导员审核", 3:"专干审核",
  4:"副书记审核", 5:"公示", 6:"资助中心审核", 7:"已通过",
  8:"已驳回", 9:"不通过", 10:"放弃" }

// 批次进行状态
{ 1:"未开始", 2:"进行中", 3:"已截止" }

// 页面类型
{ 1:"业务页面", 10:"流程页面" }

// 字典类型
{ 1:"数据表字典", 5:"URL字典", 20:"编码字典", 15:"自定义字典" }

// 参数值类型
{ 1:"数据字段", 2:"静态字典", 3:"直接输入" }

// 流程设计步骤
{ 0:"编辑基础信息", 1:"流程变量设置", 2:"设计流程", 3:"流程状态设置" }
```

**客户端环境常量**：

```js
deviceType: "4"                      // 移动端
appCode:    "znzhxgpt"
```

---

## 七、逆向方法与可复现步骤

### 产物获取

```bash
# PC 管理端入口
curl https://zhxg.csu.edu.cn/znzhxgpt_web/

# 移动端入口（uni-app）
curl https://zhxg.csu.edu.cn/znzhxgpt_h5/

# 移动端 chunk 名映射内嵌在主包中，格式：
#   r.p+"static/js/"+({nameMap}[id]||id)+"."+({hashMap}[id]||id)+".js"
```

### 接口提取

在 chunk 中匹配 API 定义块：

```js
// 形如
e.getQxjDkbcxx = function (t) {
  return a.default.postDes(r.API_BASE_QXJ + "/qxj-padkglxx/queryKqDkbc", t, !0);
};
```

正则：

```
(\w+)\s*=\s*function\s*\(\s*(\w+)\s*\)\s*\{\s*return\s+
[\w$]+\.default\.(postDes|post|get|put|delete)\s*\(\s*
([\w$]+)\.(API_BASE_\w+)\s*\+\s*"([^"]+)"
```

模块常量到 URL 前缀的映射（`index.js` 配置模块）：

```js
const o = (prefix = "/gw") => (p = "") => prefix + p;

API_BASE_SYS = o("/basesys")   API_BASE_YW      = o("/yw")
API_BASE_FILE = o("/file")     API_BASE_FLOW    = o("/wszhxgpt-flow")
API_BASE_AI   = o("/ai")       API_BASE_AI_V3   = o("/aiagent")
API_BASE_ZZ   = o("/zz")       API_BASE_QXJ     = o("/qxj")
API_BASE_ZHCP = o("/zhcp")     API_BASE_GFJY    = o("/gfjy")
API_BASE_SSGL = o("/ssgl")     API_BASE_YWZS    = o("/ywzs")
API_BASE_TZGG = o("/tzgg")     API_BASE_BBS     = o("/bbs")
API_BASE_XLFK = o("/xlfk")     API_BASE_XLJKRZ  = o("/xljkrz")
API_BASE_DEKT = o("/dekt")     API_BASE_XFJS    = o("/xfjs")
API_BASE_FDYDWGL = o("/fdydwgl")  API_BASE_XGXX = o("/xgxx")
API_BASE_ZGXSK   = o("/zgxsk")
```

### 覆盖度

| 项 | 数量 |
|---|---|
| 唯一端点 | **600** |
| 服务模块 | 15 |
| 提取到参数键 | 325（54.2%） |
| 提取到返回字段 | 162（27.0%） |

未提取到参数的多为「参数为变量传递」或「仅特定角色可见」的端点；其参数形态可依 §2.6 框架约定推断。

---

## 八、注意事项

- 本文档为**只读分析**产物，未对任何写接口（新增/修改/删除）发起过真实调用
- `postDes` 加密依赖 `casual`，与账号会话绑定；更换账号需重新走登录链路
- `token` 有效期见 JWT `exp` 字段，实测约 24 小时
- 部分端点路径含 `{}` 占位（如 `/delete/{id}`），实际调用需替换为具体主键
- 接口存在版本漂移风险：前端 chunk 带内容哈希，服务端升级后路径可能变化


