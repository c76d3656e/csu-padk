# csu-padk

智慧学工平安打卡的辅助面板。一份源码，三种跑法：

| 形态 | 适合谁 | 需要什么 |
| --- | --- | --- |
| **本机 exe** | 只在自己电脑上用，不想装 Node | 双击即用，目标机器零依赖 |
| **Cloudflare / Vercel** | 想要一个随时能打开的网址 | 一个免费账号即可 |
| **EdgeOne Makers** | 同上，但想用腾讯云的线路 | 一个腾讯云账号 |

三种形态共用 `src/core` 里的同一份实现，区别只在最外层的接线文件。

## 快速部署

点下面的按钮，会克隆本仓库、自动构建并部署。全程不需要改任何配置，也不需要环境变量、数据库或存储。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/c76d3656e/csu-padk)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fc76d3656e%2Fcsu-padk)

[![使用 EdgeOne Makers 部署](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fc76d3656e%2Fcsu-padk)

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
edgeone login        # 首次需要
edgeone makers deploy
```

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
│  ├─ core/                共享实现，两种形态都用它
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

## 三种形态是怎么共存的

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

前两条之外的请求都不进业务代码。`/znzhxgpt/**` 走同源转发而不是让浏览器直连，是为了避免跨域预检 —— 学校网关不放行 `OPTIONS`，直连会全军覆没。

前端是纯 hash 路由（`#/guide`、`#/classic`），所以任何平台都不需要配 SPA 回落规则。

## 数据与隐私

- 没有数据库，没有服务端存储。登录在 `ca.csu.edu.cn` 完成，账号密码不经过本项目的任何代码路径。
- 会话凭据、宿舍楼选择、落点历史、界面偏好全部存在浏览器的 `localStorage`（键名前缀 `csu-padk:`），清空浏览器数据即彻底消失。
- 服务进程只在内存里做一次协议转发，不落盘、不打印凭据。

## 已知边界

- 打卡有固定的时间窗，窗口外提交会被服务端拒绝，这是学校规则，与本工具无关。
- 统一身份认证可能要求验证码。出现该要求时需要用官方页面完成一次登录。
- 学校的页面结构变更会导致登录流程失效，届时需要更新 `src/core/casLogin.ts` 里的解析规则。

## 许可

MIT。仅供个人便利使用，请遵守学校的管理规定。
