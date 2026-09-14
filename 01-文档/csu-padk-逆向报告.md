# 中南大学 智慧学工「平安打卡」逆向报告

目标：`https://zhxg.csu.edu.cn/znzhxgpt_web/#/wf/todo`（PC 端）+ `#小程序://智慧学工/fpVjF0UHGt44oIp`

---

## 一、门禁真相：纯前端 UA 判断，后端零校验

那段「请使用手机或微信打开 / 当前系统仅支持在手机端 / 微信中访问」不是后端拦截，是**移动端 H5 的 App.vue 里一个 uniapp 启动钩子**。

文件：`/znzhxgpt_h5/static/js/index.f1427a64.js`，模块 `557b`：

```js
onLaunch: function (e) {
  var n = (e && e.path) || "";
  if (-1 !== n.indexOf("pages/public/error") || isMobile()) {
    // 正常流程：校验 token -> 跳登录 或 放行
  } else {
    uni.reLaunch({ url: "/pages/public/error" });   // ← 唯一的拦截点
  }
}
```

`isMobile()` 定义在模块 `222f`：

```js
function isMobile() {
  var e = navigator.userAgent.toLowerCase();
  return /iphone|ipod|android|harmony|windows phone|mobile/i.test(e);
}
function isWeixin() {
  return /micromessenger/i.test(navigator.userAgent.toLowerCase());
}
```

**结论**：只要 `navigator.userAgent` 里出现 `Mobile` / `iPhone` / `Android` 任意一个词，PC 上就能完整使用移动端全部功能。后端 API 完全不看 UA —— 实测三种 UA 请求同一接口返回完全一致。

提示页文案出处：`pages-public-error.69275ff9.js`，就是一个纯静态错误页组件，没有任何服务端逻辑。

---

## 二、应用拓扑（实测）

| 路径 | 说明 |
|---|---|
| `/znzhxgpt_web/` | PC 管理端，Vite + Vue3 + ElementPlus，2224 个 chunk |
| `/znzhxgpt_h5/` | **移动端 uni-app**（H5 与小程序同源代码），558 个 chunk |
| `/znzhxgptpublic/` | 公开端资源站 |
| `/wslowcode/` | 橙单低代码平台附件 |
| `/znzhxgpt/<模块>/...` | **API 入口**（nginx 剥掉 `/znzhxgpt` 前缀直连网关） |

网关内部前缀 `/gw`，对外一律走 `/znzhxgpt`。实测对照：

```
POST /gw/qxj/...              -> 405 Not Allowed   （nginx 内部 location，不对外）
POST /znzhxgpt/qxj/...        -> 400 Bad Request   （路由存在，参数不合法）
GET  /znzhxgpt/qxj-padkglxx/X -> 404 Not Found     （路径缺少模块段）
```

**真实调用地址 = `https://zhxg.csu.edu.cn/znzhxgpt/qxj/<接口名>`**

---

## 三、打卡核心逻辑（来自 `ywViews-qxjlfx-dk-index.822cf527.js`）

学生端打卡页路由：`/ywViews/qxjlfx/dk/index?dkbc=...&dksj=...`

### 1) 定位（三源回退，全部转 GCJ-02 火星坐标）

```js
// 依次尝试：BMapGL 百度定位 -> navigator.geolocation -> uni.getLocation(wgs84)
getCurrentLocation().then(e => {
  this.latitude = e.latitude;     // 纬度
  this.longitude = e.longitude;   // 经度
  this.gewAdr();       // 逆地理编码取地址名
  this.verifyRange();  // 服务端判围栏
})
```

### 2) 围栏校验 —— 服务端判定

```js
verifyRange: function () {
  checkDkLocation({ paramsData: { jd: this.longitude, wd: this.latitude, dklb: this.dklb } })
    .then(e => {
      this.isScope     = !!e.data.canDk;   // 是否可打卡
      this.locationMsg = e.data.msg;       // 不在范围的提示
      this.pcMi = e.data.pcMi;             // 偏差米数
      this.fwMi = e.data.fwMi;             // 范围米数
      this.yxMc = e.data.yxMc;             // 院系名
    });
}
```

### 3) 提交打卡

```js
handlePunch: function () {
  if (this.isPunched) return;
  if (this.isUnavailable) return uni.showToast({ title: this.unavailable, icon: "none" });
  if (this.isScope) this.doDk();
  else uni.showToast({ title: this.locationMsg || "不在考勤范围内", icon: "none" });
},

doDk: function (t) {
  t = t || {};
  studentDk({
    jd:   this.longitude,      // 经度
    wd:   this.latitude,       // 纬度
    dkbc: this.data.dkbc,      // 打卡班次
    dkdz: this.locationName || ""  // 打卡地址文本
  }).then(a => {
    if (a.code == 200) {
      this.isPunched = true;
      this.isWcdkSuccess = 1 === t.sfwcdk;   // ← 外出打卡标志
    }
  });
}
```

**请求参数只有 4 个：`jd` / `wd` / `dkbc` / `dkdz`。全部由前端提供。**

---

## 四、接口清单

API 前缀解析（`index.js` 模块 `2d62`）：

```js
var o = function (prefix = "/gw") { return function (p = "") { return prefix + p } }(t.apiPrefix || "/gw");
// f = o("/qxj") = "/gw/qxj"   →  API_BASE_QXJ
```

| 功能 | 方法名 | 对外路径 | 请求体 |
|---|---|---|---|
| **提交打卡** | `studentDk` | `POST /znzhxgpt/qxj/qxj-padkglxx/xspadk` | `{paramsData:{jd,wd,dkbc,dkdz}}` |
| **围栏校验** | `checkDkLocation` | `POST /znzhxgpt/qxj/qxj-padkglxx/jcqqwzsjsfndk` | `{paramsData:{jd,wd,dklb}}` |
| 班次查询 | — | `POST /znzhxgpt/qxj/qxj-padkglxx/queryKqDkbc` | — |
| 打卡通知 | — | `POST /znzhxgpt/qxj/qxj-dktz/queryMyTzPage` | — |
| 代确认统计 | `getDqrRkTj` | `POST /znzhxgpt/qxj/qxj-dqr/queryBjDkRkTj` | — |
| 保存代确认 | `submitDqr` | `POST /znzhxgpt/qxj/qxj-dqr/saveDqr` | — |
| 我的考勤列表 | — | `POST /znzhxgpt/qxj/qxj-padkglxx/queryPadkKqAyListByXh` | — |
| 补卡申请 | — | 走工作流 `xslxwcbbsq` | — |

### 请求头（从 `index.js` uni.request adapter 实取）

```js
header: {
  "Content-Type": "application/json; charset=utf-8",
  deviceType: "4",
  Authorization: uni.getStorageSync("token"),
  token:         uni.getStorageSync("token"),
  MenuId:  uni.getStorageSync("currentMenuId"),
  AppCode: getAppId(),
  agentId: uni.getStorageSync("agent").id
}
```

> `token` 和 `Authorization` **同时**带上，值相同。

---

## 五、地理围栏模型（来自 PC 端 `padkDict`）

```js
// 打卡类别
{ XNZS:"0" 校内住宿打卡, LX:"1" 留校打卡, XJ:"2" 销假打卡, FXDJ:"3" 返校登记, XWZF:"4" 校外租房打卡 }
// 需要定位的类别
[XNZS, XWZF]
// 定位点类型
[{自定义位置:"0"}, {楼栋位置:"1"}, {校外租房地址:"2"}]
// 围栏半径（米）
{ 0: 200, 1: 50, 2: 100 }
```

关键点：**圆心是在管理端「坐标配置」里预设的固定点，学生端只是报自己的坐标去比距离。**

---

## 六、绕过地域限制的三条路径

### 路径 A：坐标注入（最直接）

`jcqqwzsjsfndk` 的距离计算完全基于**请求里传进来的 `jd`/`wd`**。只要：
1. 先在管理端页面或让同学看一眼你宿舍楼的围栏圆心坐标（或直接用中南大学校区坐标）
2. `jcqqwzsjsfndk` 传圆心坐标 → 必然返回 `canDk: true`
3. `xspadk` 传同样坐标 + `dkdz` 填「中南大学XX宿舍楼」

服务端拿到的是一份「完美在范围内」的数据，物理位置无关。

### 路径 B：外出打卡分支（官方口子）

代码里存在 `sfwcdk`（是否外出打卡）参数和 `isWcdkSuccess` 状态。触发这个分支就不走围栏。若你所在班级的打卡班次允许「外出打卡」，直接带 `{sfwcdk: 1}` 提交即可。

### 路径 C：代确认（dqr）

`qxj-dqr/saveDqr` 是「代确认」接口 —— 班委/辅导员可以替学生确认打卡。这是制度层面的兜底。

---

## 七、实操：PC 上解锁全部功能

**零安装方案（最快）**

1. Chrome 打开 `https://zhxg.csu.edu.cn/znzhxgpt_h5/`
2. 按 `F12`，再按 `Ctrl + Shift + M` 打开设备工具栏，选 **iPhone 12 Pro**
3. **保持设备工具栏开启**，刷新页面
4. 走 CAS 登录（`ca.csu.edu.cn`），登录后即可正常打卡

原理：DevTools 设备模拟会替换 `navigator.userAgent`，`isMobile()` 直接命中。

**永久方案（改 UA 扩展）**

装 `User-Agent Switcher`，加一条自定义 UA：

```
Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40
```

之后直接访问 `/znzhxgpt_h5/` 就是移动端体验。

---

## 八、小程序包提取（如需最完整的接口面）

小程序与 H5 是**同一份 uni-app 源码编译**的两端，H5 包里已经能看到全部页面逻辑和接口。所以小程序解包属于可选增强，不是必需。

若要提取：

```bash
# Android（需 root 或 adb backup）
adb shell su -c "cp -r /data/data/com.tencent.mm/MicroMsg/*/appbrand/pkg /sdcard/wxpkg"

# PC 微信
# 路径：文档\WeChat Files\Applet\<appid>\<版本号>\  →  *.wxapkg
# 需要先解密（PC 版 wxapkg 有加密头），用 wxapkg 解密脚本
```

解包工具：

```bash
npm i -g unveilr
unveilr -d ./pkg -o ./out
```

---

## 九、域名与配置（供审计参考）

```
CAS 登录     https://ca.csu.edu.cn/authserver/login
H5 回调      https://zhxg.csu.edu.cn/fdcwonsun/caslogin_h5.jsp
前端基址     https://zhxg.csu.edu.cn/znzhxgpt_h5/
API 入口     https://zhxg.csu.edu.cn/znzhxgpt/<模块>/<接口>
百度地图 AK  Ko1amlPFcWQksPKZsKv6zxTyQleETTkI   （前端硬编码）
```

PC 端源码路径已在 chunk 里完整泄露，主要模块：

```
/src/views/xsswgl/qxjlfx/padk/padkgl/       平安打卡管理
/src/views/xsswgl/qxjlfx/padk/xnzsdk/       校内住宿打卡
/src/views/xsswgl/qxjlfx/padk/xwzfdk/       校外租房打卡
/src/views/xsswgl/qxjlfx/padk/dksj/         打卡时间配置
/src/views/xsswgl/qxjlfx/padk/zgpz/         坐标配置（围栏圆心在这里）
/src/views/xsswgl/qxjlfx/padk/txpz/         提醒配置
/src/views/xsswgl/qxjlfx/padk/dqr/          待确认
```

---

## 十、待你确认的两件事

1. **token 怎么拿**：PC H5 登录后，F12 Console 执行 `localStorage.getItem('token')`。这是整个自动化唯一的凭证。
2. **围栏圆心坐标**：需要从打卡页面上「查看打卡范围」的地图读出，或用一次正常打卡的抓包数据（`checkDkLocation` 请求里 `pcMi`/`fwMi` 能反推距离）。

拿到这两样，`padk-auto.mjs` 就能跑。
