import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

// 地图是重资产，首屏不加载 —— bundle-dynamic-imports / bundle-conditional
const DemoMap = lazy(() => import("./DemoMap"));

const CAS_LOGIN =
  "https://ca.csu.edu.cn/authserver/login?service=" +
  encodeURIComponent("https://zhxg.csu.edu.cn/fdcwonsun/caslogin_h5.jsp");
const H5_HOME = "https://zhxg.csu.edu.cn/znzhxgpt_h5/";

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
   * 原理：App.vue 的 UA 检查只在页面启动时跑一次；而 uid/lzc 挂在 query 上，
   * 登录回调页正是从 location.search 读它们。所以在提示页改 hash 而不刷新即可绕过。
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
              在官方页面里长出一块打卡面板。
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
              <a className="mb mb--primary" href={CAS_LOGIN} target="_blank" rel="noreferrer">
                前往官方登录
              </a>
              <a className="mb" href={H5_HOME} target="_blank" rel="noreferrer">
                打开打卡页
              </a>
            </div>

            <p className="caveat">
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
                <b>不用改 UA。</b>把那道拦截的逻辑拆开看 —— UA 检查只在页面启动时跑一次，
                而 <code>uid</code> / <code>lzc</code> 是挂在地址栏 query 上的，
                登录回调页正是从那里读凭据。
                <br />
                所以只要在提示页<strong>改一下 hash、不刷新</strong>，就能直接进系统。
                把下面这块牌子拖到书签栏，卡住时点一下即可。
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
                  title="拖我到书签栏"
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
                <p>把下面这块黄铜牌拖进书签栏，或点一下复制代码手动新建书签。</p>
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
              {flash("bm") ?? "← 拖住我，或点一下复制"}
              <button className="link" onClick={() => copy(bookmarklet, "code")}>
                {flash("code") ?? "复制书签代码"}
              </button>
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
                  整套工具是纯静态文件，不存在任何后端。登录发生在官方
                  <code>ca.csu.edu.cn</code>，本工具只在你<b>已经登录</b>的页面里读取浏览器本地
                  会话凭据，并且只向 <code>zhxg.csu.edu.cn</code> 发请求。
                </p>
                <p>
                  宿舍楼选择、落点历史、界面偏好全部存在你自己浏览器的
                  <code>localStorage</code>（前缀 <code>csu-padk:</code>），清空浏览器数据即彻底消失。
                  构建产物里不含任何凭据 —— 已做字符串审计。
                </p>
              </div>
            )}

            {tab === "tech" && (
              <div className="prose">
                <h3>三个关键点</h3>
                <p className="tech-h">① 移动端门禁是纯前端的</p>
                <pre>{`onLaunch() {
  isMobile = /iphone|ipod|android|harmony|windows phone|mobile/i
             .test(navigator.userAgent.toLowerCase())
  非移动端 → uni.reLaunch('/pages/public/error')
}
// 后端完全不看 UA，设备模拟即可解锁`}</pre>

                <p className="tech-h">② 请求体是 DES 密文（最容易踩的坑）</p>
                <pre>{`postDes(url, data) {
  const key = casual;                    // 16 字符
  const body = DES-ECB(JSON.stringify(data), key).toString('hex');
  return post(url, body);                // 发的是密文 Hex 串
}
// 明文直发 → 网关一律 400 Bad Request`}</pre>

                <p className="tech-h">③ 围栏圆心取自你的宿舍楼</p>
                <pre>{`queryKqDkbc → {
  dksjfw: "20:00-23:30",
  kqfwxx: [{ dkfw: 300, kqdz: "学生所住宿舍楼栋坐标（自动取）" }]
}
xspadk ← { jd, wd, dkbc, dkdz }`}</pre>
              </div>
            )}

            {tab === "deploy" && (
              <div className="prose">
                <h3>部署你自己的副本</h3>
                <p>
                  <code>npm run build</code> 产出的 <code>dist/</code> 是自包含的：引导页 + 面板本体。
                  整个目录传到任意静态托管即可（Cloudflare Pages / Vercel / GitHub Pages / 对象存储）。
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
