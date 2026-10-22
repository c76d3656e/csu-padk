import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

// 地图是重资产，首屏不加载 —— bundle-dynamic-imports / bundle-conditional
const DemoMap = lazy(() => import("./DemoMap"));

const CAS_LOGIN =
  "https://ca.csu.edu.cn/authserver/login?service=" +
  encodeURIComponent("https://zhxg.csu.edu.cn/fdcwonsun/caslogin_h5.jsp");
const H5_HOME = "https://zhxg.csu.edu.cn/znzhxgpt_h5/";

/** 本项目的公开仓库，自行部署时用得上 */
const REPO = "https://github.com/c76d3656e/csu-padk";
const REPO_SUBDIR = REPO + "/tree/main/csu-padk";
const VERCEL_DEPLOY =
  "https://vercel.com/new/clone?repository-url=" + encodeURIComponent(REPO_SUBDIR);
const CF_DEPLOY = "https://deploy.workers.cloudflare.com/?url=" + REPO_SUBDIR;

export default function Landing() {
  const injectUrl = useMemo(
    () => (typeof window === "undefined" ? "" : new URL("./inject.js", window.location.href).href),
    []
  );
  const [customUrl, setCustomUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<"privacy" | "tech" | "deploy">("privacy");

  const effectiveUrl = customUrl ?? injectUrl;

  const bookmarklet = useMemo(() => {
    if (!effectiveUrl) return "#";
    return (
      "javascript:(function(){" +
      "var s=document.createElement('script');" +
      "s.src=" + JSON.stringify(effectiveUrl) + "+'?t='+Date.now();" +
      "s.onerror=function(){alert('加载失败，检查地址：'+" + JSON.stringify(effectiveUrl) + ")};" +
      "document.documentElement.appendChild(s);" +
      "})()"
    );
  }, [effectiveUrl]);

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

  /**
   * 门禁修复书签
   *
   * 那道「请使用手机或微信打开」的提示由官方页面在启动时判定一次；
   * 而登录回跳带回来的 uid / lzc 是挂在地址栏 query 上的。
   * 在提示页执行一次本代码，让页面直接进入打卡首页即可，不需要刷新，
   * 也不需要改浏览器的设备标识。
   */
  const healBookmarklet =
    "javascript:(function(){" +
    "if(!/[?&]uid=/.test(location.search)||!/[?&]lzc=/.test(location.search)){" +
    "alert('当前地址上没有 uid / lzc。\\n请先完整走一次统一身份认证登录，回到提示页后再点本书签。');return;}" +
    "location.hash='#/pages/login/myindex';" +
    "})();";

  /**
   * React 会拦截并警告 javascript: 形式的 href（未来版本将直接阻止），
   * 因此改成挂载后通过 DOM 直接写入，既保留拖拽到书签栏的能力，又不触发警告。
   */
  const brassRef = useRef<HTMLAnchorElement>(null);
  const healRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (brassRef.current && bookmarklet) brassRef.current.setAttribute("href", bookmarklet);
  }, [bookmarklet]);
  useEffect(() => {
    if (healRef.current) healRef.current.setAttribute("href", healBookmarklet);
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
              <a className="mb mb--primary" href="./padk.user.js" target="_blank" rel="noreferrer">
                安装油猴脚本
              </a>
              <a className="mb" href={CAS_LOGIN} target="_blank" rel="noreferrer">
                前往官方登录
              </a>
              <a className="mb" href={H5_HOME} target="_blank" rel="noreferrer">
                打开打卡页
              </a>
            </div>

            <p className="caveat">
              <b>推荐走油猴</b>：先装{" "}
              <a href="https://www.tampermonkey.net/" target="_blank" rel="noreferrer">
                Tampermonkey
              </a>
              （或 Violentmonkey），再点「安装油猴脚本」——扩展会自动弹出安装页，确认即可。
              装好后打开智慧学工页面，面板<b>自动浮出</b>，之后不用再点任何东西。
            </p>

            <p className="caveat">
              <b>不想装扩展</b>就用下面的书签。注意浏览器已禁止拖拽{" "}
              <code>javascript:</code> 链接，必须点「复制书签代码」再手动新建书签。
              <br />
              <b>桌面端</b>：先按 <kbd>F12</kbd> → <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>
              打开设备模拟，否则移动端页面会拦截。后端本身不校验 UA。
            </p>

            {/* 门禁自愈 */}
            <div className="gate">
              <div className="gate-hd">
                <span className="gate-dot" />
                卡在「请使用手机或微信打开」？
              </div>
              <p className="gate-bd">
                <b>不用改 UA。</b>那条提示由官方页面在启动时判定一次，而登录回跳带回来的{" "}
                <code>uid</code> / <code>lzc</code> 就挂在地址栏的 query 上，
                回调页正是从那里读取凭据。
                <br />
                所以只要在提示页<strong>改一下 hash、不刷新</strong>，就能直接进入系统。
                点下面的「复制修复代码」，再到书签栏右键「添加网页」把代码粘进网址栏。
              </p>
              <div className="gate-row">
                <a
                  ref={healRef}
                  className="heal"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    copy(healBookmarklet, "heal");
                  }}
                  title="点一下即复制代码"
                >
                  ⤳ 门禁修复
                </a>
                <button className="link" onClick={() => copy(healBookmarklet, "healcode")}>
                  {flash("heal") ?? flash("healcode") ?? "复制修复代码"}
                </button>
              </div>
            </div>
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
                <h3>登录官方系统</h3>
                <p>
                  走统一身份认证。账号密码只输入在 <code>ca.csu.edu.cn</code>，
                  本工具全程接触不到。
                </p>
              </div>
            </li>
            <li>
              <span className="fl-idx">02</span>
              <div>
                <h3>装书签</h3>
                <p>
                  点「<b>复制书签代码</b>」，再在书签栏右键「添加网页」，把代码粘进
                  <b>网址</b>栏保存。
                  <br />
                  浏览器已禁止把 <code>javascript:</code> 链接拖进书签栏（拖了会变成
                  <code>about:blank#blocked</code>），所以只能走「复制 → 手动新建」这条路。
                </p>
              </div>
            </li>
            <li>
              <span className="fl-idx">03</span>
              <div>
                <h3>在官方页面点一下</h3>
                <p>
                  面板浮出右下角。设置里选定宿舍楼（或地图上直接点），
                  之后每次生成落点、点打卡即可。
                </p>
              </div>
            </li>
          </ol>

          <div className="brass-zone">
            <a
              ref={brassRef}
              className="brass"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                copy(bookmarklet, "bm");
              }}
              title="拖我到书签栏"
            >
              <span className="brass-rivet" />
              平安打卡
              <span className="brass-rivet" />
            </a>
            <div className="brass-hint">
              <button className="link" onClick={() => copy(bookmarklet, "code")}>
                {flash("code") ?? "复制书签代码"}
              </button>
              {flash("bm") ?? "← 复制后到书签栏右键「添加网页」，粘进网址栏"}
            </div>
          </div>
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
                <h3>没有服务端，也读不到密码</h3>
                <p>
                  整套工具是纯静态文件，不存在任何数据库。登录发生在官方
                  <code>ca.csu.edu.cn</code>，本工具只在你<b>已经登录</b>的页面里读取浏览器本地
                  会话凭据，并且只向 <code>zhxg.csu.edu.cn</code> 发请求。
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
                <h3>三种运行形态，同一份源码</h3>
                <p>
                  仓库里的 <code>csu-padk/</code> 是一个自包含的目录，三套入口共用
                  <code>src/core</code> 里的同一份实现：
                </p>
                <ul>
                  <li>
                    <b>本机 exe</b>：<code>npm run build &amp;&amp; npm run build:exe</code>，产出双击即用的
                    单文件，目标机器不需要装 Node。
                  </li>
                  <li>
                    <b>Cloudflare</b>：Workers + 静态资源，<code>wrangler.jsonc</code> 已配置好，
                    一条命令或点下面的按钮即可部署。
                  </li>
                  <li>
                    <b>Vercel</b>：静态站点 + 一个 Edge Function，<code>vercel.json</code> 已配置好。
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
                </div>

                <p>
                  部署完成后打开站点根地址即可使用，无需配置任何环境变量、数据库或存储。
                  仓库的 <code>csu-padk/README.md</code> 里有完整的命令行步骤与目录说明。
                </p>

                <label className="field">
                  <span>inject.js 公网地址</span>
                  <input
                    type="text"
                    value={effectiveUrl}
                    spellCheck={false}
                    onChange={(e) => setCustomUrl(e.target.value)}
                  />
                </label>
                <p>
                  上面这一项用于书签 / 油猴形态：把面板脚本托管到任意可公开访问的地址，
                  再把地址填进书签代码即可。填本机 exe 的地址时，只有你自己的电脑能访问。
                </p>
                <div className="row">
                  <button className="mb" onClick={() => copy(effectiveUrl, "url")}>
                    {flash("url") ?? "复制地址"}
                  </button>
                  <button className="mb" onClick={() => copy(bookmarklet, "code2")}>
                    {flash("code2") ?? "复制书签代码"}
                  </button>
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
