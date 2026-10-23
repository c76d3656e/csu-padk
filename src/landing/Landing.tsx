import { lazy, Suspense, useCallback, useState } from "react";

// 地图是重资产，首屏不加载 —— bundle-dynamic-imports / bundle-conditional
const DemoMap = lazy(() => import("./DemoMap"));

const CAS_LOGIN =
  "https://ca.csu.edu.cn/authserver/login?service=" +
  encodeURIComponent("https://zhxg.csu.edu.cn/fdcwonsun/caslogin_h5.jsp");
const H5_HOME = "https://zhxg.csu.edu.cn/znzhxgpt_h5/";

/** 本项目的公开仓库，自行部署时用得上 */
const REPO = "https://github.com/c76d3656e/csu-padk";
const VERCEL_DEPLOY =
  "https://vercel.com/new/clone?repository-url=" + encodeURIComponent(REPO);
const CF_DEPLOY = "https://deploy.workers.cloudflare.com/?url=" + REPO;
const EO_DEPLOY = "https://edgeone.ai/pages/new?repository-url=" + encodeURIComponent(REPO);
// 国内版是另一套产品：入口在腾讯云控制台，账号、域名、控制台都不与国际版通用
const EO_CN_DEPLOY =
  "https://console.cloud.tencent.com/edgeone/makers/new?repository-url=" + encodeURIComponent(REPO);

export default function Landing() {
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<"privacy" | "tech" | "deploy">("privacy");

  const copy = useCallback(async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(tag);
    setTimeout(() => setCopied(null), 1600);
  }, []);

  const flash = (tag: string) => (copied === tag ? "已复制" : null);

  return (
    <div className="sheet">
      {/* 图纸边框与标题栏 */}
      <div className="frame" aria-hidden="true">
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
      </div>
      <div className="grain" aria-hidden="true" />
      <div className="contour" aria-hidden="true" />

      <header className="crown">
        <div className="crown-l">
          <span className="mark" />
          <span className="crown-id">CSU / XG · SURVEY SHEET 01</span>
        </div>
        <div className="crown-r">
          <a href="#">打卡台</a>
          <span className="sep">／</span>
          <a href="#/classic">原版界面</a>
        </div>
      </header>

      <main>
        {/* ── Hero：非对称，左文右图 ── */}
        <section className="hero">
          <div className="hero-copy">
            <div className="axis">
              <span className="axis-line" />
              <span className="axis-label">N 28.16° · E 112.93°</span>
            </div>

            <h1>
              <span className="h1-a">平安</span>
              <span className="h1-b">打卡</span>
            </h1>

            <p className="lede">
              把打卡这件事收进一块面板。
              <br />
              自动标注围栏、轮换落点、一键提交。
            </p>

            <dl className="spec">
              <div>
                <dt>打卡窗口</dt>
                <dd className="mono">20:00 — 23:30</dd>
              </div>
              <div>
                <dt>围栏半径</dt>
                <dd className="mono">
                  300<small>m</small>
                </dd>
              </div>
              <div>
                <dt>可用打卡点</dt>
                <dd className="mono">
                  142<small>栋</small>
                </dd>
              </div>
            </dl>

            <div className="hero-actions">
              <a className="mb mb--primary" href="#/">
                打开打卡台
              </a>
              <a className="mb" href={CAS_LOGIN} target="_blank" rel="noreferrer">
                前往官方登录
              </a>
              <a className="mb" href={H5_HOME} target="_blank" rel="noreferrer">
                打开打卡页
              </a>
            </div>

            <p className="caveat">
              <b>整个工具就跑在这一页里</b>：账号密码只输入在官方{" "}
              <code>ca.csu.edu.cn</code>，本工具接触不到；
              落点、围栏、宿舍楼全部留在你自己的浏览器。
            </p>

            <p className="caveat">
              <b>桌面浏览器</b>：先按 <kbd>F12</kbd> → <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>{" "}
              打开设备模拟，否则学校页面会按移动端判定把你拦下。后端本身不校验 UA。
            </p>
          </div>

          <div className="hero-map">
            <Suspense
              fallback={
                <div className="map-ph">
                  <span className="map-ph-grid" />
                  <span className="map-ph-txt">正在载入测绘视图…</span>
                </div>
              }
            >
              <DemoMap />
            </Suspense>
          </div>
        </section>

        {/* ── 流程 ── */}
        <section className="flow">
          <h2 className="sect">
            <span className="sect-num">Ⅰ</span> 使用流程
          </h2>

          <ol className="flow-list">
            <li>
              <span className="fl-idx">01</span>
              <div>
                <h3>打开本页</h3>
                <p>
                  本机形态双击 <code>padk.exe</code>，浏览器会自动打开；
                  云端形态直接用分配到的域名。打开就能看到打卡台。
                </p>
              </div>
            </li>
            <li>
              <span className="fl-idx">02</span>
              <div>
                <h3>用学号登录</h3>
                <p>
                  登录由本工具代为走统一身份认证，账号密码只提交给{" "}
                  <code>ca.csu.edu.cn</code>，本工具不留存、不落盘。
                  需要验证码时会提示你去官方页面完成一次。
                </p>
              </div>
            </li>
            <li>
              <span className="fl-idx">03</span>
              <div>
                <h3>选宿舍楼，打卡</h3>
                <p>
                  设置里选定宿舍楼（或地图上直接点），之后每次生成落点、点打卡即可。
                  提交前自动做一次围栏预检，不在围栏内就不提交。
                </p>
              </div>
            </li>
          </ol>
        </section>

        {/* ── 详情标签页 ── */}
        <section className="detail">
          <div className="tabs" role="tablist">
            {(
              [
                ["privacy", "数据安全"],
                ["tech", "技术原理"],
                ["deploy", "自行部署"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                className={"tab" + (tab === k ? " on" : "")}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="tab-body">
            {tab === "privacy" && (
              <div className="prose">
                <h3>没有数据库，也读不到密码</h3>
                <p>
                  没有数据库，也没有服务端存储。账号密码只在登录那一刻交给官方{" "}
                  <code>ca.csu.edu.cn</code>，本项目不打印、不落盘。
                </p>
                <p>
                  宿舍楼选择、落点历史、界面偏好全部存在你自己浏览器的
                  <code>localStorage</code>（前缀 <code>csu-padk:</code>），清空浏览器数据即彻底消失。
                  构建产物里不含任何凭据。
                </p>
              </div>
            )}

            {tab === "tech" && (
              <div className="prose">
                <h3>三个关键点</h3>

                <p className="tech-h">① 设备判定发生在页面启动时</p>
                <p>
                  官方打卡页启动时会看一次浏览器的设备标识，非移动端会被重定向到提示页。
                  该判定只在启动时执行一次，后端不参与 —— 打开浏览器的设备模拟即可进入。
                </p>

                <p className="tech-h">② 请求体需要加密</p>
                <p>
                  业务接口不收明文 JSON。本工具用登录时拿到的 16 位会话密钥对请求体做
                  DES-ECB 加密后以十六进制提交；密钥与登录会话绑定，换一次登录就换一次。
                  明文直发会被网关直接拒绝。
                </p>

                <p className="tech-h">③ 围栏圆心取自你的宿舍楼</p>
                <p>
                  预检接口会返回打卡时间窗与围栏半径，圆心则取自你在设置里选定的宿舍楼坐标。
                  提交前先做一次预检，落点不在围栏内就不提交，避免无意义的失败记录。
                </p>
              </div>
            )}

            {tab === "deploy" && (
              <div className="prose">
                <h3>四种运行形态，同一份源码</h3>
                <p>
                  仓库根目录是一个自包含的项目，四个入口共用 <code>src/core</code> 里的同一份实现：
                </p>
                <ul>
                  <li>
                    <b>本机 exe</b>：<code>npm install &amp;&amp; npm run build &amp;&amp; npm run build:exe</code>
                    ，产出双击即用的单文件，目标机器不需要装 Node。
                  </li>
                  <li>
                    <b>Cloudflare</b>：Workers + 静态资源，<code>wrangler.jsonc</code> 已配置好，
                    一条命令或点下面的按钮即可部署。
                  </li>
                  <li>
                    <b>Vercel</b>：静态站点 + 一个 Edge Function，<code>vercel.json</code> 已配置好。
                  </li>
                  <li>
                    <b>EdgeOne</b>：静态站点 + 两个 Edge Function，<code>edgeone.json</code> 与{" "}
                    <code>edge-functions/</code> 已配置好。两套产品同一份源码都能部署 ——
                    国内版 Makers 用腾讯云账号（需实名，国内节点），国际版 Pages 用邮箱即可。
                  </li>
                </ul>

                <div className="row">
                  <a href={VERCEL_DEPLOY} target="_blank" rel="noreferrer">
                    <img
                      src="https://vercel.com/button"
                      alt="Deploy with Vercel"
                      height={32}
                    />
                  </a>
                  <a href={CF_DEPLOY} target="_blank" rel="noreferrer">
                    <img
                      src="https://deploy.workers.cloudflare.com/button"
                      alt="Deploy to Cloudflare"
                      height={32}
                    />
                  </a>
                  <a href={EO_CN_DEPLOY} target="_blank" rel="noreferrer">
                    <img
                      src="https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg"
                      alt="使用 EdgeOne Makers 部署（国内版）"
                      height={32}
                    />
                  </a>
                  <a href={EO_DEPLOY} target="_blank" rel="noreferrer">
                    <img
                      src="https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg"
                      alt="Deploy with EdgeOne Pages（国际版）"
                      height={32}
                    />
                  </a>
                </div>

                <p className="dim">
                  上面两个 EdgeOne 按钮是两套独立的产品：左边是国内版 Makers（腾讯云账号，需实名，国内节点），
                  右边是国际版 Pages（邮箱即可）。参数、<code>edgeone.json</code>、
                  <code>edge-functions/</code> 约定完全一致。国内版点进去会先跳腾讯云登录 ——
                  控制台产品都要登录，这一步省不掉；不绑自定义域名、从校园网外访问，则不受备案与预览链接的限制。
                </p>

                <p>
                  部署完成后打开站点根地址即可使用，无需配置任何环境变量、数据库或存储。
                  <code>README.md</code> 里有完整的命令行步骤与目录说明。
                </p>

                <div className="row">
                  <button className="mb" onClick={() => copy(REPO, "repo")}>
                    {flash("repo") ?? "复制仓库地址"}
                  </button>
                  <a className="mb" href={REPO} target="_blank" rel="noreferrer">
                    打开仓库
                  </a>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="foot">
        <span>个人打卡便利工具 · 请遵守学校管理规定</span>
        <span className="sep">／</span>
        <span className="mono">DATA STAYS LOCAL</span>
      </footer>
    </div>
  );
}
