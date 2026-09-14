# 中南大学 智慧学工 · 逆向工作包

对 `zhxg.csu.edu.cn`（智慧学工平台）的完整逆向分析与工具实现。

---

## 快速上手

### 方式一：桌面应用（推荐）

下载 `padk.exe` 双击即可。**免安装 Node、免命令行、免浏览器**——
Rust + Tauri 打包，主程序 4.6 MB，用系统自带的 WebView2 渲染。

登录、请求全部由 Rust 侧完成，所以没有跨域、没有本地端口。

### 方式二：npm 启动（自建 / 开发）

```bash
cd 05-padk-web
npm install
npm run build
npm start
```

然后打开 **http://localhost:5173/** —— 输入学号密码，直接进入打卡页。

> `npm start` 跑的是 `server.mjs`，一个进程同时提供静态站、CAS 协议登录编排
> 和 API 同源代理。浏览器侧全程同源，不碰官方页面的 UA 门禁，也不需要装任何插件。
>
> 之所以浏览器形态必须有个本地进程：独立打卡页要请求 `/znzhxgpt/**`，离开 localhost
> 就是跨域，学校 nginx 不放行 OPTIONS 预检。桌面形态没有这个问题（Rust 直接发请求）。
> 想真正零服务端，只有书签注入形态 —— 详见 `05-padk-web/README.md`。

### 方式三：改前端

```bash
cd 05-padk-web
npm run dev        # 开发服务器，带 HMR
```

其它可用命令：

| 命令 | 用途 |
|---|---|
| `npm start` | **浏览器形态**：单机一体服务（静态 + 登录 + 代理） |
| `npm run app` | **桌面形态**：Tauri 开发模式（热重载） |
| `npm run app:build` | 打包桌面应用（Windows 出 exe / NSIS 安装包） |
| `npm run dev` | 前端开发（HMR） |
| `npm run build` | 产出 `dist/`（前端产物）+ `dist/inject.js`（书签注入包） |
| `npm run build:exe` | 打包成单文件 exe（Node SEA，90 MB，无需 Node 运行时） |
| `npm run preview` | 仅预览静态产物（无登录与代理） |

> 不要在 `npm run dev` 运行时执行 `npm run build` —— 两者会争 `node_modules/.vite`，
> 可能把 dev 进程打挂。先停 dev 再构建。

---

## 三端发布

推 tag 即触发 `.github/workflows/release.yml`，也可以在 Actions 页面手动跑：

```bash
git tag v1.0.0
git push origin v1.0.0
```

| 平台 | 产物 | 说明 |
|---|---|---|
| Windows | `padk_*_x64-setup.exe` | 直接安装 |
| macOS (Apple Silicon) | `.dmg` | **未签名**，首次打开需右键「打开」 |
| macOS (Intel) | `.dmg` | 同上 |
| Android | `.apk` | 实验性，见下 |

**macOS 未签名**是因为代码签名需要 Apple 开发者账号（$99/年）。绕过办法：

```bash
xattr -d com.apple.quarantine /Applications/padk.app
```

**iOS 不提供**：Tauri 2 技术上支持，但产物必须用开发者账号签名才能装进真机，
未签名只能跑模拟器。零预算下做不出可用产物。

**Android 仍是实验性**：Tauri CLI 生成的 Gradle 任务会在 `gen/android` 目录里执行
`beforeBuildCommand`（`npm run build`），那里没有 `package.json`，CI 里必然失败。
已设为 `continue-on-error`，不影响桌面端出包。

---

## 目录说明

```
csu-padk/
├── 01-文档/
│   ├── 智慧学工-API文档.md       600 个端点 / 15 个模块的完整接口文档
│   ├── csu-padk-逆向报告.md      门禁、加密、围栏模型的完整分析
│   └── 面板项目说明.md            工具本身的说明
│
├── 02-脚本/
│   ├── 协议登录/
│   │   ├── cas-full-login.mjs    CAS 全链路协议登录（拿 token）
│   │   └── cas-login.mjs         分步调试版，逐阶段打印
│   ├── 端点分析/
│   │   ├── api-extract.mjs       从 chunk 提取全部 API 定义
│   │   ├── api-params2.mjs       提取各接口的调用参数键
│   │   ├── api-result.mjs        提取调用方读取的返回字段
│   │   ├── api-docgen.mjs        生成 API 文档
│   │   └── ...                   40+ 个过程中写的分析脚本
│   └── 独立打卡/
│       ├── padk-shot.js          浏览器控制台一键打卡
│       ├── padk-auto.mjs         Node 无人值守自动打卡
│       └── verify-trilateration.mjs  三边定位算法验证
│
├── 03-数据/
│   ├── api-inventory.json        600 端点清单（含参数键、返回字段、模块归属）
│   ├── data-buildings.json       142 栋宿舍楼坐标
│   └── data-dkbc.json            打卡班次与围栏配置样例
│
├── 04-原始素材/                   分析过程中的中间产物（chunk 提取片段）
│
└── 05-padk-web/                  完整前端项目
    ├── src/
    │   ├── core/
    │   │   ├── crypto.ts         DES-ECB 加解密（复刻原站 postDes）
    │   │   ├── api.ts            接口封装 + 圆心探测
    │   │   ├── geo.ts            围栏距离、落点生成、坐标转换
    │   │   ├── store.ts          本地配置与历史
    │   │   └── map/              Leaflet 封装、瓦片源、地图组件
    │   ├── panel/                悬浮面板（书签注入用）
    │   ├── padk/                 独立打卡页（登录 + 身份页眉 + 面板）
    │   ├── landing/              引导页 + 原版界面 + 演示地图
    │   └── inject.tsx            注入入口
    ├── public/                   静态资源（host.html、inject.js）
    ├── dist/                     已构建产物，可直接部署
    ├── server.mjs                单机一体服务（静态 + CAS 登录 + 同源代理）
    ├── vite.casAuth.ts           dev server 的登录中间件
    ├── e2e-audit.mjs             设计规范审计（真实渲染上校验）
    ├── e2e-visual.mjs            视觉快照，产出 shots/
    └── e2e-fixtures.mjs          上面两者共用的接口桩
```

---

## 核心发现（摘要）

### 1. 移动端门禁是纯前端的

```
App.vue onLaunch:
  isMobile = () => /iphone|ipod|android|harmony|windows phone|mobile/i
                   .test(navigator.userAgent.toLowerCase())
  非移动端 → uni.reLaunch('/pages/public/error')
```

后端完全不看 UA。但注意：**伪装 UA 要用「iPhone 但不带 MicroMessenger」**，
带 MicroMessenger 会被判定为微信环境，跳 `open.weixin.qq.com` OAuth 授权。

正确的一条：

```
Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1
```

### 2. 请求体是 DES 密文（最容易踩的坑）

```js
postDes(url, data) {
  const key  = casual;                                   // 16 字符
  const body = CryptoJS.DES
    .encrypt(JSON.stringify(data), CryptoJS.enc.Utf8.parse(key),
             { mode: ECB, padding: Pkcs7 })
    .ciphertext.toString(CryptoJS.enc.Hex);
  return post(url, body);
}
```

**明文直发一律 `400 Bad Request`**，且与 body 内容无关（空对象同样 400）。

### 3. 围栏圆心 = 学生宿舍坐标，但学生端查不到

`queryKqDkbc` 返回的 `kqdz` 写着「学生所住宿舍楼栋坐标（自动取）」——
服务端知道，但 `/ssgl/**` 下所有宿舍接口对学生 token 都是 `710 权限不足`。

**解法**：`jcqqwzsjsfndk` 会返回 `pcMi`（距圆心米数），
三次测量即可用三边定位反推圆心。已在 `src/core/api.ts` 的 `probeFenceCenter()` 实现，
数学验证见 `02-脚本/独立打卡/verify-trilateration.mjs`。

### 4. 单点登录互踢

同一账号只允许一处在线，新登录会踢掉旧的，接口返回 `2031 您的账号已在其他设备登录`。
代码里已做处理（自动清理凭据并退回登录页）。

### 5. 业务成功不等于 HTTP 成功

「未到打卡时间」也是 `code: "200"`：

```json
{"code":"200","message":"未到打卡时间","data":null}
```

必须看 `message` 才能判断真伪，否则会误报「打卡成功」。

---

## 未包含的内容

为了控制体积，以下内容没有打进包里：

| 内容 | 体积 | 如何补全 |
|---|---|---|
| `node_modules` | 96 MB | 在 `05-padk-web` 下执行 `npm install` |
| 原始前端 chunk | 70 MB | 见下方抓取方法 |

### 重新抓取前端产物

```bash
# PC 管理端入口（含 chunk 名映射）
curl https://zhxg.csu.edu.cn/znzhxgpt_web/

# 移动端入口（uni-app）
curl https://zhxg.csu.edu.cn/znzhxgpt_h5/

# 移动端 chunk 文件名规则内嵌在主包 index.*.js 中：
#   r.p+"static/js/"+({nameMap}[id]||id)+"."+({hashMap}[id]||id)+".js"
```

抓下来后用 `02-脚本/端点分析/api-extract.mjs` 提取接口。

---

## 注意事项

- **token 有效期约 24 小时**，且会被其它端的登录踢下线
- 打卡窗口 **20:00 – 23:30**，窗口外服务端返回「未到打卡时间」，探测圆心也依赖窗口内的 `pcMi`
- 围栏半径 **300 米**，圆心为本人所住楼栋
- 没有任何远程后端与数据上报。`server.mjs` 是可选的**本地**进程（静态 + 登录 + 代理），
  不落盘、不记录凭据；凭据只存浏览器 `localStorage`
- 请遵守学校相关管理规定

---

## 项目依赖版本

主项目 `05-padk-web/package.json`：

```
react 18.3 / vite 5.4 / typescript 5.6
crypto-js 4.2（DES 加解密）
leaflet 1.9（地图）
puppeteer-core（端到端测试，可选）
```

`package-lock.json` 已包含，`npm install` 会还原一致的版本。
