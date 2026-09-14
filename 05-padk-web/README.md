# 平安打卡 · 一键面板

中南大学智慧学工「平安打卡」的辅助工具。**零远程后端**：没有服务器、没有数据库、没有任何数据上报，所有配置只留在你自己的浏览器里。

进程只可能以两种形式出现，且都跑在你自己机器上：

- `server.mjs` —— 单机一体服务（静态站 + CAS 登录 + 同源代理），供独立站点形态使用
- 什么都不需要 —— 书签注入形态纯前端，注入包直接在官方页面里跑

---

## 三个入口

| 路径 | 说明 |
|---|---|
| `/` | **打卡页**（默认入口）—— Precision Glass：三级灰阶玻璃面板、衬线标题、等宽数据；实时定位与虚拟落点两种模式 |
| `#/guide` | **引导页** —— 勘测图纸风：深墨底、黄铜标注、衬线中文标题、非对称布局，首屏带交互式地图演示 |
| `#/classic` | **原版界面** —— 深色科技风，功能等价 |

样式各自作用域隔离（引导页限定在 `.sheet`，浮层面板限定在 `.root`，原版限定在 `.classic-root`），互不干扰。

---

## 它做什么

在官方页面（`zhxg.csu.edu.cn`）里注入一块悬浮打卡面板：

- 自动读取当前会话的 `token` 与 `casual`（同源读取，不经任何第三方）
- 拉取全部 **142 栋宿舍楼**坐标，按你所在楼栋计算围栏
- **地图选点**：底图上直观看到围栏圆、周边楼栋、落点分布，可直接点选或拖拽
- 每次「生成落点」给出**不重复**的合规坐标：邻栋轮换 + 随机偏移 + 历史去重
- 打卡前自动做服务端围栏预检，确认放行后再提交

---

## 地图与选点

面板内点「地图选点」展开（地图库 ~150KB，**此时才加载**，不拖累初始注入）。

| 元素 | 含义 |
|---|---|
| 蓝色虚线圈 | 服务端围栏（`300m`，来自 `queryKqDkbc`，只读） |
| 绿色实线圈 | 落点范围，**拖动圆周把手可改** |
| 蓝色图钉 | 围栏圆心，**可拖拽**；点击地图任意位置也可移动 |
| 灰色小点 | 全部楼栋，点击即设为圆心 |
| 绿色图钉 | 本次生成的落点 |
| 绿 / 橙 / 灰小点 | 历史落点：落在范围内 / 围栏内但超范围 / 已出围栏 |

配色沿用面板的语义色：**蓝 = 服务端约束（围栏），绿 = 本机落点（目标）**。
路网底图是浅色的，嵌在暗色玻璃里过亮，因此只对瓦片层做了反相处理
（矢量与图钉位于其它图层，颜色不受影响；卫星图不处理）。

底图可切换：**高德路网 / 高德卫星 / OSM**。

> 坐标系：服务端返回的楼栋坐标是 **GCJ-02（火星坐标）**，因此底图必须选 GCJ-02 系，否则会有约 500m 偏移。高德源默认匹配；OSM 是 WGS84，界面上已标注「有偏移」。

---

## 部署

先构建：

```bash
npm install
npm run build
```

产物是**自包含**的 `dist/`：

```
dist/
├── index.html              站点入口
├── host.html               本地注入调试宿主
├── assets/
│   ├── index-*.js          首屏（不含地图库）
│   ├── DemoMap-*.js        地图演示（懒加载）
│   ├── leaflet-src-*.js    地图库（懒加载）
│   └── index-*.css
└── inject.js               书签加载的面板本体
```

之后按用途选一种：

### A. 单机使用（推荐，功能最全）

```bash
npm start             # 默认 http://localhost:5173
PORT=5180 npm start   # 换端口
```

`server.mjs` 一个进程同时提供三件事：

| 能力 | 路径 | 为什么必须在这一层 |
|---|---|---|
| 静态站 | `/` | 服务 `dist/`（hash 产物长缓存，`inject.js` 每次回源） |
| CAS 登录 | `POST /__auth/login` | 票据 → uid/lzc → token 的兑换属于服务端逻辑，静态托管无处执行 |
| API 代理 | `/znzhxgpt/**` | 直连属跨域，学校 nginx 不放行 OPTIONS 预检；同源转发即可绕过 |

打开站点输入学号密码即可用，不需要装任何插件。

### B. 公网静态托管（只做分发）

`dist/` 整个上传，但**没有登录与代理**：独立打卡页会提示「登录服务不可用」，
接口也会被 CORS 拦下。这一形态的用途是分发引导页与书签。

| 平台 | 做法 |
|---|---|
| Cloudflare Pages | 构建命令 `npm run build`，输出目录 `dist` |
| Vercel | 同上 |
| GitHub Pages | `dist/` 推到 `gh-pages` 分支 |
| 对象存储 / 宝塔 | 直接上传 `dist/` 内所有文件 |

> `inject.js` 必须能通过**固定 URL** 访问（不要加 hash）。构建流程已自动处理。

### C. 书签注入（唯一真正零服务端的形态）

在已登录的 `zhxg.csu.edu.cn` 页面里加载 `inject.js`。那里本来就同源，
凭据直接从宿主 `localStorage` 读取、请求同源发出，不需要任何本地进程。

---

## 使用

### 单机形态

1. `npm start` → 打开 http://localhost:5173/
2. 输入学号密码，登录后直接进入打卡页（不需要装插件、不需要打开官方页面）
3. 首次选定宿舍楼作为围栏圆心：等定位自动确认，或点「选宿舍楼」手动指定
4. 「生成落点」→「提交虚拟落点」；人就在宿舍时也可以直接用「实时定位」

### 注入形态

1. 打开站点 → 「前往官方登录」
   - **PC 用户**：先按 `F12` → `Ctrl`+`Shift`+`M` 打开设备模拟选手机型号（移动端页面会拦截桌面浏览器，后端本身不校验 UA）
2. 把书签拖进书签栏
3. 在登录后的任意 `zhxg.csu.edu.cn` 页面点一下书签 → 右下角浮出面板
4. 同上，选定圆心后生成落点

---

## 本地开发

```bash
npm start             # 单机服务（跑构建产物），日常用这个
npm run dev           # 前端开发（HMR），改 UI 时用
npm run build:inject  # 仅重建 inject.js
npm run preview       # 仅预览静态产物 http://localhost:4173
```

> `npm run dev` 与 `npm run build` 不要同时跑 —— 两者会争 `node_modules/.vite`，
> 可能导致 dev 进程直接退出。先停 dev 再构建。

---

## 技术原理

### 1. 移动端门禁是纯前端的

```
zhxg.csu.edu.cn/znzhxgpt_h5/static/js/index.*.js  →  App.vue onLaunch
  isMobile = () => /iphone|ipod|android|harmony|windows phone|mobile/i
                   .test(navigator.userAgent.toLowerCase())
  非移动端 → uni.reLaunch({ url: "/pages/public/error" })
```

后端**完全不看 UA**。设备模拟 / UA 切换即可解锁。

### 2. 请求体是 DES 加密的（最容易踩的坑）

```js
postDes(r, o, s = {}) {
  const n = fe().casual;              // casual，16 字符
  const u = yr(o, n);                 // 加密
  return this.service.post(r, u, s);  // 发的是密文 Hex 串
}

yr = (t, r) => CryptoJS.DES.encrypt(
  JSON.stringify(t),
  CryptoJS.enc.Utf8.parse(r),
  { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
).ciphertext.toString();              // Hex 输出
```

**明文直发会被网关打回 `400 Bad Request`**，且与 body 内容无关（空对象也 400），因为请求根本没进业务逻辑。
`src/core/crypto.ts` 已逐字复刻，并实测服务端可正常解密。

### 3. 围栏模型

```json
{ "mc": "校内住宿打卡范围（全校统一）", "dkfw": 300,
  "jd": null, "wd": null, "kqdz": "学生所住宿舍楼栋坐标（自动取）" }
```

圆心 = **你本人所住宿舍楼坐标**，半径 **300 米**。落点算法（`src/core/geo.ts`）：

1. 以你楼栋为圆心，取 `neighborRadius`（默认 250m）内的所有楼栋作候选池
2. 随机选一栋（排除最近用过的，保证轮换）
3. 在该楼栋周围 15–90m 随机偏移（面积均匀采样，避免中心过密）
4. 与全部历史落点比对，要求间隔 ≥ `minSeparation`（默认 45m），最多尝试 60 次

实测连续 6 次生成：全部落在围栏内，任意两点最近 83.5m。

### 4. 接口

```
POST /znzhxgpt/qxj/qxj-padkglxx/queryKqDkbc      班次 / 时间窗 / 围栏配置
POST /znzhxgpt/qxj/qxj-padkglxx/jcqqwzsjsfndk   围栏校验 → { canDk, pcMi, fwMi }
POST /znzhxgpt/qxj/qxj-padkglxx/xspadk          提交 → { jd, wd, dkbc, dkdz }
POST /znzhxgpt/ssgl/ss-ldxx/findLdzbCjList      142 栋楼坐标
```

认证：header 里同时带 `token` 与 `Authorization`（值相同）。

---

## 性能

按 Vercel React 最佳实践处理，几处关键取舍：

| 做法 | 收益 |
|---|---|
| 地图 `React.lazy` + `Suspense` 懒加载 | 首屏 bundle 不含 150KB 地图库，实测 `index-*.js` 中无 `leaflet` 字符串 |
| 拖拽中的高频坐标存 `ref` 而非 `state` | 拖圆心时不会触发 React 重渲染，只做 Leaflet 增量 `setLatLng` |
| 回调统一收进 `cbRef` | 地图事件监听器只注册一次，不随 props 变化重建 |
| 派生状态在 render 阶段计算 | 邻栋距离、围栏内楼栋数不用 `useEffect` + `useState` 中转 |
| `memo` 包裹地图组件 | 面板其他状态变化不引起地图重绘 |
| 楼栋遍历用一次循环 + 距离过滤 | 避免多次 `filter`/`map` 链式遍历 |
| CSS 经 `?inline` 注入 Shadow DOM | 面板样式与宿主页面完全隔离，不污染官方 UI |

---

## 隐私

- **没有任何远程后端**。`server.mjs` 是可选的本地进程，只做同源转发与登录编排，
  不落盘、不记录凭据；注入形态下连它都不需要
- 账号密码只在本地进程与 `ca.csu.edu.cn` 之间转发一次，不经任何第三方
- 只从宿主页面的 `localStorage` / `sessionStorage` 读取会话凭据，只向 `zhxg.csu.edu.cn` 发请求
- 落点历史、宿舍楼选择等配置存在你自己浏览器的 `localStorage`（前缀 `csu-padk:`）
- 构建产物已做字符串审计：**不含任何 token / casual / 学号痕迹**
- 演示地图使用**合成数据**，不含真实校内坐标

---

## 已知限制

- 打卡窗口 `20:00–23:30`，窗口外服务端返回「未到打卡时间」，属正常
- 两种登录路径：单机形态由 `server.mjs` 走 CAS 协议登录（不必打开官方页面）；
  静态托管与注入形态则必须先在官方页面登录，再由面板读取会话
- 地图依赖第三方瓦片服务；若瓦片不可达可在设置里切到 OSM。瓦片版权归各服务商所有，个人使用
- 若学校后续更换 `casual` 生成逻辑或加密算法，需同步更新 `src/core/crypto.ts`
- 面板只在 `*.csu.edu.cn` 域内工作（同源要求）

---

## 目录

```
src/
├── core/
│   ├── crypto.ts        DES-ECB 加解密（复刻原站 yr/ur）
│   ├── api.ts           接口封装 + 本地凭据读取
│   ├── geo.ts           围栏距离、落点生成、WGS84→GCJ02
│   ├── store.ts         本地配置与历史（localStorage）
│   └── map/
│       ├── tiles.ts     瓦片源定义（GCJ02 / WGS84 标注）
│       ├── leaflet.ts   懒加载 + Shadow DOM 样式注入 + 内联 SVG 图标
│       └── MapView.tsx  地图容器：圆、把手、图钉、增量绘制
├── panel/
│   ├── Panel.tsx        悬浮面板
│   └── panel.css
├── landing/
│   ├── Landing.tsx      勘测图纸版
│   ├── DemoMap.tsx      交互演示（合成数据，懒加载）
│   ├── classic.css      原版样式（作用域隔离）
│   └── Landing 样式：landing.css
├── inject.tsx           注入入口
└── main.tsx             hash 路由
```

项目根：

```
server.mjs      单机一体服务（静态 + CAS 登录 + 同源代理），npm start 跑它
vite.casAuth.ts dev server 的登录中间件（与 server.mjs 同一套编排逻辑）
scripts/merge.mjs  把注入包回填到 dist/ 与 public/
e2e-audit.mjs   设计规范审计：在真实渲染结果上校验硬性规则与对比度
e2e-visual.mjs  视觉快照，产出 shots/
e2e-fixtures.mjs 上面两者共用的接口桩数据
```
