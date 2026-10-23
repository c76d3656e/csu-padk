# csu-padk

智慧学工平安打卡的辅助面板。一份源码，四种跑法：

| 形态 | 适合谁 | 需要什么 |
| --- | --- | --- |
| **本机 exe** | 只在自己电脑上用，不想装 Node | 双击即用，目标机器零依赖 |
| **Cloudflare / Vercel** | 想要一个随时能打开的网址 | 一个免费账号即可 |
| **EdgeOne Makers（国内版）** | 同上，但想用腾讯云的国内线路 | 一个腾讯云账号 |
| **EdgeOne Pages（国际版）** | 同上，但人在境外或不想实名 | 一个邮箱 |

四种形态共用 `src/core` 里的同一份实现，区别只在最外层的接线文件。

**先看这一条再选形态**：登录要经过学校的 `ca.csu.edu.cn`，学校网关按出口 IP 下发策略。**EdgeOne 的出口在中国大陆，可以正常登录；Cloudflare / Vercel 的出口在境外，登录会被拦**（打卡本身仍可用，用「手动导入」搬一对凭据即可）。详见「[云端形态的出口网络](#云端形态的出口网络)」。

## 快速部署

点下面的按钮，会克隆本仓库、自动构建并部署。全程不需要改任何配置，也不需要环境变量、数据库或存储。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/c76d3656e/csu-padk)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fc76d3656e%2Fcsu-padk)

[![使用 EdgeOne Makers 部署](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.cloud.tencent.com/edgeone/makers/new?repository-url=https%3A%2F%2Fgithub.com%2Fc76d3656e%2Fcsu-padk)

[![Deploy with EdgeOne Pages](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fc76d3656e%2Fcsu-padk)

EdgeOne 是两套独立的产品，域名、控制台、账号都不通用。**上面第一个按钮是国内版（EdgeOne Makers），第二个是国际版（EdgeOne Pages）**，同一份源码两边都能部署，参数、`edgeone.json`、`edge-functions/` 目录约定完全一致。

| 版本 | 一键部署地址 | 账号 | 适合 |
| --- | --- | --- | --- |
| 国内版 EdgeOne Makers | `console.cloud.tencent.com/edgeone/makers/new` | 腾讯云账号，需实名 | 想要国内节点、访问更快 |
| 国际版 EdgeOne Pages | `edgeone.ai/pages/new` | 邮箱即可，无需实名 | 人在境外，或不想走实名 |

两者的差别不在按钮能力上，而在账号与访问策略：

- **国内版必须先登录腾讯云**。点按钮会 302 到 `cloud.tencent.com/login`，登录后自动带上仓库地址回到创建页 —— 控制台产品都必须登录才能进，这一步无法省掉。国际版的落地页不需要登录就能打开，但真正部署时同样要账号。
- **国内版绑定自定义域名、且加速区域含中国大陆时，必须先完成工信部备案**。不改域名、直接用平台分配的地址则不受影响。
- **国内版的项目域名有访问限制**：中国大陆网络环境下须用控制台生成的预览链接（3 小时有效），非中国大陆网络环境可直接访问。想要一个长期稳定的网址就得绑自定义域名，也就是要备案。

三条里只有第一条是「必须登录」，后两条在「不改域名、从校园网外访问」的前提下都不构成阻碍 —— 国际版更适合当默认入口，只是因为省了实名这一步。

部署完成后打开分配到的域名即可使用。也可以先 Fork 本仓库再点按钮，这样后续改动会自动重新部署。

## 本机 exe

```bash
npm install
npm run build        # 产出 dist/
npm run build:exe    # 产出 padk.exe
```

`padk.exe` 是单文件，双击启动后浏览器会自动打开 `http://localhost:5173/`。前端产物已经内嵌进 exe，拷到别的 Windows 电脑上也能直接跑，不需要安装 Node。

两点注意：

- SEA 产物与构建平台的架构绑定。在 Windows x64 上构建出来的 exe 只能在 Windows x64 上运行；换平台需要重新构建。
- 手机想连同一个 WiFi 使用，用电脑的局域网 IP 访问即可（`http://192.168.x.x:5173/`），服务默认监听所有网卡。

## 命令行部署

不想点按钮也可以手动来。

**Cloudflare**：

```bash
npx wrangler login   # 首次需要
npm run build        # 先产出 dist/
npm run deploy       # = wrangler deploy
```

配置写在 `wrangler.jsonc`：Worker 入口是 `src/edge/worker.js`，静态资源目录是 `dist/`，只有 `/__auth/login` 和 `/znzhxgpt/*` 两个前缀会先进 Worker，其余请求由静态资源直接返回。

**Vercel**：

```bash
npm i -g vercel
vercel --prod
```

配置写在 `vercel.json`：静态输出目录 `dist/`，两个接口路径被重写到 Edge Function `api/edge.js`。

**EdgeOne Makers**：

```bash
npm i -g edgeone
edgeone login        # 首次需要，登录的是国际版 edgeone.ai
edgeone makers deploy
```

国内版没有等价的 CLI 一键命令（`edgeone` 这个包连的是 `edgeone.ai`），走控制台：导入 Git 仓库 → 构建命令 `npm run build`、输出目录 `dist` → 创建。

配置写在 `edgeone.json`：构建命令 `npm run build`，输出目录 `dist/`。接口由 `edge-functions/` 下的两个文件承担 —— 目录即路由，`__auth/login.js` 对应 `/__auth/login`，`znzhxgpt/[[default]].js` 兜住 `/znzhxgpt/` 下的所有层级。

## 本地开发

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # 类型检查
npm run verify       # 自检，不联网、不需要账号
npm start            # 不打包 exe，直接跑本机服务（先跑一次 npm run build）
```

`npm run verify` 会断言三件事：加密实现与参考实现在多种输入下逐字节一致、接口层的各种响应形态、本机服务的静态与接口路由。改完共享代码后跑一次，比手点界面快得多。

## 文件组织

```
.
├─ index.html              站点入口，head 里把接口根置空（走同源转发）
├─ package.json
├─ tsconfig.json
├─ vite.config.ts          站点构建
├─ vite.casAuth.ts         开发服务器的登录中间件
├─ wrangler.jsonc          Cloudflare 配置
├─ vercel.json             Vercel 配置
├─ edgeone.json            EdgeOne Makers 配置
├─ edge-functions/         EdgeOne Makers 接口（目录即路由）
│  ├─ __auth/login.js      登录入口
│  └─ znzhxgpt/[[default]].js  转发兜底
│
├─ src/
│  ├─ core/                共享实现，四种形态都用它
│  │  ├─ casLogin.ts       统一身份认证登录编排（唯一实现）
│  │  ├─ kcipher.ts        登录密码加密（唯一实现）
│  │  ├─ crypto.ts         业务请求体的加解密
│  │  ├─ api.ts            业务接口封装
│  │  ├─ cred.ts           凭据读写与校验
│  │  ├─ geo.ts            坐标与围栏计算
│  │  ├─ store.ts          本地偏好与历史
│  │  └─ map/              地图视图（Leaflet 封装）
│  │
│  ├─ edge/                边缘侧接线
│  │  ├─ handler.js        平台无关的接口层（登录 + 同源转发）
│  │  └─ worker.js         Cloudflare Workers 入口
│  │
│  ├─ server/server.mjs    本机服务入口（也是 exe 的唯一入口）
│  │
│  ├─ panel/               打卡面板界面
│  ├─ padk/                打卡页外壳（登录 + 面板）
│  ├─ landing/             说明页
│  └─ main.tsx             站点入口
│
├─ api/edge.js             Vercel Edge Function 入口
└─ scripts/
   ├─ serve.mjs            npm start 的启动器
   ├─ build-exe.mjs        exe 打包
   └─ verify.mjs           自检
```

## 四种形态是怎么共存的

业务逻辑只有一份，放在 `src/core`。运行环境各有一个极薄的接线文件：

```
浏览器 ──┬─→ 本机服务   src/server/server.mjs           ─┐
         ├─→ Cloudflare src/edge/worker.js              ─┤
         ├─→ Vercel     api/edge.js                     ─┼─→ src/edge/handler.js ─→ src/core/casLogin.ts
         └─→ EdgeOne    edge-functions/**/*.js          ─┘                          src/core/kcipher.ts
```

`handler.js` 不认识任何平台 API —— 入参是标准 `Request`，出参是标准 `Response`，平台差异（静态资源从哪取、请求怎么进来）全部由外层文件吸收。本机服务把 Node 的 `http` 对象转成 `Request`，三个边缘平台本来就以 `Request` 为入口，EdgeOne 的 `onRequest(context)` 与 Cloudflare 的 `onRequest(context)` 是同一套签名。

EdgeOne 的 `edge-functions/` 会被平台自己编译，所以那两个文件直接 `import` 项目里的 `.ts` 共享模块，不需要预先打包。

登录密码的加密只用 Web 标准 API（`crypto.subtle` + `TextEncoder` + `btoa`）。Node 20.12+ 的 `globalThis.crypto` 就是 WebCrypto，与边缘运行时同源，所以同一份代码在两边产出的密文逐字节相同 —— 这一点由 `npm run verify` 断言。

## 接口路径

| 路径 | 作用 |
| --- | --- |
| `GET /` 及静态资源 | 站点本身 |
| `POST /__auth/login` | 统一身份认证协议登录，返回会话凭据 |
| `/znzhxgpt/**` | 转发到学校服务端，浏览器侧始终同源 |

前两条之外的请求都不进业务代码。`/znzhxgpt/**` 走同源转发而不是让浏览器直连，是因为学校网关**放行跨域读取，但不放行预检**：`POST` 带 `Origin` 会正常回 `Access-Control-Allow-Origin: <你的源>`，可 `OPTIONS` 预检一律 `403`。于是只要请求里出现自定义头（`token`、`Authorization`、`deviceType`…），浏览器就必须先发预检，然后死在 `403` 上。走同源转发就绕开了这一整条链路。

前端是纯 hash 路由（`#/guide`、`#/classic`），所以任何平台都不需要配 SPA 回落规则。

## 为什么不能托管在纯静态空间

同一套网关限制决定了：**只有静态托管、没有任何服务端执行能力的平台用不了**，GitHub Pages 就是典型。实测（真实浏览器，页面在第三方源上）：

| 请求形态 | 结果 |
| --- | --- |
| `POST` + 自定义头（本项目的真实形态） | 预检 403 → `Failed to fetch` |
| `POST` + `Content-Type: text/plain`、token 放 query | 200，响应体可读 |

而且登录侧没有替代方案：`ca.csu.edu.cn` 一个 CORS 头都不返回，跨域连 `GET /authserver/login` 都读不到。

把请求降级成「简单请求」理论上能打通业务接口，但代价是把 token 从请求头挪到 URL（进日志、进 Referer），且登录流程仍无解 —— 为了一个免费静态空间不值得。所以本项目的三种云端形态都自带服务端执行环境（Cloudflare Workers / Vercel Edge Function / EdgeOne Edge Function），接口路径一律同源转发。

GitHub Pages 只适合放一个跳转页：一个只有几行的 `index.html`，打开后跳到你自己的云端域名。

## 云端形态的出口网络

本机 exe 从你自己的网络发出请求，和浏览器直接访问学校系统没有区别。Cloudflare / Vercel / EdgeOne 的请求则从**机房出口**发出，而学校网关按「出口 IP 属于哪个网络 + 访问哪个路径」下发策略。

关键结论：**决定能不能登录的是出口机房在哪个国家/地区，不是用了哪个平台。**

| 出口 | 实测 IP | `ca.csu.edu.cn/authserver/login` |
| --- | --- | --- |
| 本机（校园网 / 家用宽带） | 你自己的公网 IP | 200，35440 字节 CAS 登录页（含 `pwdEncryptSalt`） |
| Cloudflare | 境外机房，每次部署都变 | **200，6329 字节「系统访问提示」页** |
| EdgeOne（国际版） | 219.135.97.145（广州）、125.88.199.149（广州电信）、171.108.210.233（南宁电信） | 200，35446 字节 CAS 登录页（含 `pwdEncryptSalt`） |

拦截页的状态码是 **200**，正文是「您访问的系统（网站）因工作需要仅限校园网访问，如需访问请先注册登录学校VPN」—— 只看状态码会误判成正常。

由此：

- **Cloudflare / Vercel 的出口在境外，`ca.csu.edu.cn` 整个域被拦**，登录必须经过它，所以这两个平台的「用学号密码登录」走不通；但**业务接口（`/znzhxgpt/**`）在它们的出口下仍然可达**，配合「手动导入」搬进去的凭据，打卡本身是好的。
- **EdgeOne 的出口在中国大陆**（电信 / 联通），`ca.csu.edu.cn` 可达，所以 EdgeOne 上「用学号密码登录」可以走通 —— 不需要手动导入。
- 本机 exe 从你自己的网络发出请求，所以在任何网络环境下都和浏览器直接访问一致。

**真正的限制在浏览器侧。** 学校网关放行跨域读取、但拒绝预检：

| 请求形态 | 结果 |
| --- | --- |
| POST + 自定义头（`token` / `AppCode` / `deviceType`） | 浏览器先发 `OPTIONS` 预检 → **403** → `Failed to fetch` |
| POST + `Content-Type: application/json`，无自定义头 | 200，响应体可读 |
| GET（任意路径） | 200，响应体可读 |

`ca.csu.edu.cn` 则一个 CORS 头都不返回。所以「让浏览器直连学校系统」这条路走不通 —— 这正是本项目必须有服务端转发的原因：浏览器只跟同源的站点说话，跨域那一段由站点的边缘函数承担。

另外，CAS 的登录页只对白名单内的 `service` 参数给出，白名单外会直接回一页「不允许的请求」。本项目用的 `service` 是学校自己的 `zhxg.csu.edu.cn/fdcwonsun/caslogin_h5.jsp`，属于白名单内，所以换域名部署不影响登录页这一步。

### 登录失败时怎么判断原因

登录失败时面板会把原因写成一句话。按这几条对号入座：

| 面板提示 | 含义 | 怎么办 |
| --- | --- | --- |
| 「没返回登录页，而是学校网关的『仅限校园网访问』提示页」 | 出口 IP 被学校侧拒绝 | 换成 EdgeOne 或本机 exe |
| 「没有返回登录页（既没有加密盐，也没有会话 cookie）」 | 同上，网关换了拦截页形态 | 同上 |
| 「把这次登录退回了登录页（会话与表单令牌对不上）」 | 会话层瞬时失配，已自动重试一次 | 重试后仍失败时改用官方页面登录 |
| 「回了 302，但没有带回票据」 | 登录没被受理（同一会话重复提交会被 CAS 判为 Webflow 会话失效） | 已自动换新会话重试一次 |
| 「没有接受这次登录」+「诊断 status=401」 | 账号密码不对，或该账号被要求验证码 | 核对密码；需要验证码时见下一节 |
| 「要求二次认证（多因子）」 | 密码已经验过，学校侧要求短信 / OTP / 人脸这一步。CAS 用 302 把请求送去 `/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true` | 改用它下面的「会话导入」：填一枚 `CASTGC`，不提交密码就能换票（见「一次导入，之后免密」）。**重试没有意义** |

二次认证与图形验证码是两条不同的路，别混：

- **图形验证码**（`checkNeedCaptcha.htl` 回 `isNeed:true`）拦在提交密码之前，答题失败时 CAS 回 200 + 登录页正文。
- **二次认证**（`reAuthCheck`）发生在密码通过之后，CAS 直接 302 进 MFA 页面，正文里根本没有登录表单。协议客户端没有那条流程的会话，跟过去只会被踢回登录页；重试也只是再被要求一次，还会把风控计数刷高。所以这一次不做自动重试，只把官方入口和导入面板递到用户手上。

登录协议本身还做了几件事，它们和出口无关，但在任何形态下都在起作用：

- **CAS 标准协议兜底**：拿到票据后直接请求 `/authserver/serviceValidate`（3.0 端点 `/authserver/p3/serviceValidate` 也一并尝试），从 XML 里取回账号，不依赖回调页的 HTML 结构与重定向链。回调页对无 CAS 会话的协议客户端会回 403 空体，这条路实测可用 —— 无效票据会明确回 `INVALID_TICKET`，说明接口是通的。
- **回调链提前退出**：某些出口下 CAS 会把回调请求 302 到 `weixinQYLogin.do`，再跳到 `open.weixin.qq.com` 的企业微信授权。协议客户端没有那条路径的会话，跟下去只会越走越远，所以识别到回调链回到 CAS 登录页时就停下，转去走 serviceValidate。
- **跨步骤复用同一个域感知会话**：CAS 的会话（`CASTGC` / `JSESSIONID`）签在 `ca.csu.edu.cn`，回调页在 `zhxg.csu.edu.cn`。两者必须共用一份 cookie 存储，但发送时按域过滤 —— 否则回调页那一跳会丢掉 CAS 会话，拿不到票据。表单里带 `rememberMe=true` 让 CAS 签发长期会话，正是为这一跳准备的。

判断一个云端站点到底是「出口被拦」还是「业务接口本身不通」，在站点页面的控制台里执行：

```js
const r = await fetch("/znzhxgpt/ssgl/ss-ldxx/findLdzbCjList", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
const t = await r.text();
console.log(t.startsWith('{"') ? "业务接口可达" : "业务接口被出口限制");
```

**另一个与出口无关的硬限制是验证码。** 学校侧判定需要验证码时，程序化登录无解，只能先在官方页面登录一次；登录成功后的凭据会存在浏览器里，后续打卡不需要再登录。

## 需要验证码时怎么办

学校侧判定某个账号需要验证码时，程序化登录就走不通了（CAS 的验证码是图形码，绕不过也不该绕）。但此时你在官方页面上是登录着的，浏览器里已经有一对可用的 `token` 与 `casual` —— 把它们搬进面板即可。

在面板登录页点「学校要求验证码？改用手动导入」：

1. 在官方页面（`zhxg.csu.edu.cn`）完成一次正常登录。
2. 按 F12 打开控制台，粘贴执行：

```js
copy(JSON.stringify({ token: localStorage.token || sessionStorage.token, casual: localStorage.casual || sessionStorage.casual }))
```

3. 剪贴板里会得到一对 JSON，粘进面板的两个输入框，点「使用这对凭据」。

**两者必须来自同一次会话。** 服务端用「当前会话绑定的 casual」解 DES 密文，token 与 casual 拆开配会得到 400。面板会先校验格式再写入，格式不对就整体拒绝，不会写半截。

凭据只写进浏览器的 `localStorage`（键名 `csu-padk:cred`），与任何服务端无关。

## 一次导入，之后免密（CASTGC）

二次认证（`reAuthCheck`）在密码通过之后才发生，所以协议登录在境外出口上注定过不去。但它拦的是「提交密码」这一步，拦不到已经签出的会话。CAS 在登录成功时会下发一枚 `CASTGC`（TGT，`rememberMe=true` 的产物，能活几天）——带着它 GET 一次登录页，CAS 直接 302 出新票据，全程不提交密码。这就是云端形态的免密入口。

拿这枚会话（在本机执行，走你的本地出口，不会被拦）：

```bash
node scripts/diag-login.mjs <学号> --castgc
```

输入密码后，成功的话会直接打印一行 `CASTGC=...`。也可以在已登录的浏览器里按 F12 → Application → Cookies → `https://ca.csu.edu.cn` → 复制 `CASTGC` 的 Value。

在云端面板的登录页点「被要求验证码 / 二次验证？改用会话导入」，把它贴进第一个输入框，点「用这个会话换票」。换到 `token` 后：

- 关掉页面明天再来，不需要再输密码 —— 打开时自动用存下的 CASTGC 换新票。
- 打卡过程中 `token` 到期（它只有一天寿命），会静默续期，不会把你踢回登录表单。
- CASTGC 自己也过期或被注销时，面板会说明一句并退回登录页，重新导入一次即可。
- 点「退出登录」会连它一起清掉。公用电脑上记得点。

存在浏览器的 `localStorage`（键名 `csu-padk:castgc`），不经任何服务端。它等同账号的登录态，几天内可免密换票 —— 不要贴给别人、不要提交进仓库。

`CASTGC` 是否也能在云端（EdgeOne 国内出口）换到票，取决于学校侧对国内出口是否也做二次认证要求；本机实测可以。若云端换票同样被送去 `reAuthCheck`，面板会直接说明，那条路就只剩手动导入 `token` + `casual`。

## 数据与隐私

- 没有数据库，没有服务端存储。登录在 `ca.csu.edu.cn` 完成，账号密码不经过本项目的任何代码路径。
- 会话凭据、宿舍楼选择、落点历史、界面偏好全部存在浏览器的 `localStorage`（键名前缀 `csu-padk:`），清空浏览器数据即彻底消失。
- 服务进程只在内存里做一次协议转发，不落盘、不打印凭据。

## 已知边界

- 打卡有固定的时间窗，窗口外提交会被服务端拒绝，这是学校规则，与本工具无关。
- **Cloudflare / Vercel 的机房出口在境外，学校网关拦住 `ca.csu.edu.cn`**，所以这两个平台上「用学号密码登录」走不通 —— 换 EdgeOne，或用「手动导入」搬一对凭据进去（见上一节），或用本机 exe。
- **EdgeOne 的出口在中国大陆，登录可以走通**。但出口 IP 属于机房、会变，学校侧策略调整时仍可能被拦，届时面板会明确报出「仅限校园网访问」。
- 统一身份认证可能要求验证码。出现该要求时用登录页的「手动导入」搬一次官方会话，见上一节。
- 学校的页面结构变更会导致登录流程失效，届时需要更新 `src/core/casLogin.ts` 里的解析规则。
- 学校网关会回显任意 `Origin`（`Access-Control-Allow-Origin` 跟随请求方），所以跨域**读取**放行、**预检**拒绝。这个组合意味着：一旦哪天网关开始正常放行 `OPTIONS`，本项目就可以多出一种「纯静态托管 + 浏览器直连」的形态；在那之前必须依赖同源转发。

## 许可

MIT。仅供个人便利使用，请遵守学校的管理规定。
