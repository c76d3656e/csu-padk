import { useEffect, useMemo, useRef, useState } from "react";

const CAS_LOGIN =
  "https://ca.csu.edu.cn/authserver/login?service=" +
  encodeURIComponent("https://zhxg.csu.edu.cn/fdcwonsun/caslogin_h5.jsp");
const H5_HOME = "https://zhxg.csu.edu.cn/znzhxgpt_h5/";

export default function Classic() {
  const [injectUrl, setInjectUrl] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [showTech, setShowTech] = useState(false);

  useEffect(() => {
    setInjectUrl(new URL("./inject.js", window.location.href).href);
  }, []);

  const bookmarklet = useMemo(() => {
    if (!injectUrl) return "";
    return (
      "javascript:(function(){" +
      "var s=document.createElement('script');" +
      "s.src=" + JSON.stringify(injectUrl) + "+'?t='+Date.now();" +
      "s.onerror=function(){alert('加载失败，请检查 inject.js 地址：'+" + JSON.stringify(injectUrl) + ")};" +
      "document.documentElement.appendChild(s);" +
      "})()"
    );
  }, [injectUrl]);

  // React 会警告 javascript: 形式的 href，挂载后经 DOM 直接写入以保留拖拽能力
  const bmRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (bmRef.current && bookmarklet) bmRef.current.setAttribute("href", bookmarklet);
  }, [bookmarklet]);

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(tag);
    setTimeout(() => setCopied(null), 1800);
  };

  return (
    <div className="classic-root">
      <div className="glow g1" />
      <div className="glow g2" />
      <div className="grid" />

      <div className="back-link">
        <a className="btn ghost" href="#/">
          ← 返回勘测图纸版
        </a>
      </div>

      <header className="hero">
        <div className="tag">CSU · 智慧学工</div>
        <h1>
          平安打卡
          <span className="sub">一键面板</span>
        </h1>
        <p className="lead">
          在官方页面里长出一个打卡面板。自动生成合规落点、随机轮换位置、一键完成打卡。
          <br />
          <b>纯前端，零后端</b>：不经过任何第三方服务器，token 与坐标只留在你自己的浏览器里。
        </p>

        <div className="facts">
          <div className="fact">
            <span className="k">打卡窗口</span>
            <span className="v">20:00 – 23:30</span>
          </div>
          <div className="fact">
            <span className="k">围栏半径</span>
            <span className="v">300 m</span>
          </div>
          <div className="fact">
            <span className="k">可打卡点</span>
            <span className="v">142 栋宿舍楼</span>
          </div>
          <div className="fact">
            <span className="k">落点策略</span>
            <span className="v">邻栋轮换 + 随机偏移</span>
          </div>
        </div>
      </header>

      <main className="wrap">
        <section className="steps">
          <article className="step">
            <div className="num">01</div>
            <h3>先登录官方系统</h3>
            <p>
              点下面的按钮走统一身份认证（<code>ca.csu.edu.cn</code>）。
              <b>账号密码只在官方页面输入</b>，本页面全程接触不到。
            </p>
            <div className="tip">
              <b>PC 用户注意</b>：移动端页面会拦截桌面浏览器。请先按
              <code>F12</code> → <code>Ctrl+Shift+M</code> 打开设备模拟，选任意手机型号，再点登录。
            </div>
            <div className="row">
              <a className="btn primary" href={CAS_LOGIN} target="_blank" rel="noreferrer">
                前往官方登录
              </a>
              <a className="btn ghost" href={H5_HOME} target="_blank" rel="noreferrer">
                打开打卡页
              </a>
            </div>
          </article>

          <article className="step">
            <div className="num">02</div>
            <h3>把书签拖进书签栏</h3>
            <p>
              下面那个蓝色按钮就是书签本体。直接把它拖到浏览器书签栏；
              也可以复制链接后手动新建一个书签，地址粘贴进去。
            </p>
            <div className="drag-zone">
              <a
                ref={bmRef}
                className="bookmarklet"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  copy(bookmarklet, "bm");
                }}
                title="拖我到书签栏"
              >
                {copied === "bm" ? "已复制到剪贴板" : "平安打卡"}
              </a>
              <span className="drag-hint">← 拖我，或点我复制</span>
            </div>
            <div className="row">
              <button className="btn ghost" onClick={() => copy(bookmarklet, "code")}>
                {copied === "code" ? "已复制" : "复制书签代码"}
              </button>
            </div>
          </article>

          <article className="step">
            <div className="num">03</div>
            <h3>在官方页面点一下书签</h3>
            <p>
              登录后的页面（任一 <code>zhxg.csu.edu.cn</code> 页面都行）点一下书签，
              右下角就会浮出打卡面板。首次需要选择你的宿舍楼，之后它会记住。
            </p>
            <ul className="bullets">
              <li>「地图选点」可直观看到围栏范围与周边楼栋</li>
              <li>「生成落点」每次给你一个不重复的合规坐标</li>
              <li>每次自动做围栏预检，确认服务端放行后再提交</li>
            </ul>
          </article>
        </section>

        <section className="panel-block">
          <h2>部署你自己的副本</h2>
          <p className="muted">
            这是一个纯静态站点。把 <code>dist/</code> 整个目录上传到任意静态托管
            （GitHub Pages / Cloudflare Pages / Vercel / 对象存储均可），
            再把下面地址改成你的实际地址即可。
          </p>
          <div className="field">
            <label>inject.js 的公网地址</label>
            <input
              type="text"
              value={injectUrl}
              onChange={(e) => setInjectUrl(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="row">
            <button className="btn ghost" onClick={() => copy(injectUrl, "url")}>
              {copied === "url" ? "已复制" : "复制地址"}
            </button>
            <button className="btn ghost" onClick={() => copy(bookmarklet, "code2")}>
              {copied === "code2" ? "已复制" : "复制更新后的书签代码"}
            </button>
          </div>
        </section>

        <section className="privacy">
          <div className="lock">🔒</div>
          <div>
            <h3>没有后端，也读不到你的密码</h3>
            <p>
              整个工具没有服务端。登录动作发生在官方 <code>ca.csu.edu.cn</code> 页面，
              本工具只在你已经登录的页面里读取浏览器本地存储的会话凭据，并且
              <b>只向 <code>zhxg.csu.edu.cn</code> 发起请求</b>。
              落点历史、宿舍楼选择等配置都存在你自己的 <code>localStorage</code>，
              清空浏览器数据即彻底消失。
            </p>
          </div>
        </section>

        <section className="tech">
          <button className="tech-toggle" onClick={() => setShowTech((v) => !v)}>
            {showTech ? "▲" : "▼"} 技术细节（逆向所得）
          </button>
          {showTech && (
            <div className="tech-body">
              <h4>认证链路</h4>
              <pre>{`CAS  (ca.csu.edu.cn/authserver)
  ├─ pwdEncryptSalt + execution  →  AES-128-CBC( randomString(64)+密码, key=salt, iv=random )
  └─ ticket → fdcwonsun/caslogin_h5.jsp  →  下发 uid / lzc
       └─ POST /znzhxgpt/basesys/rbac-yh/login-other
            { tyrzpt, channeld, yhzh, lzc, caasual }  →  data.token (RS256 JWT)`}</pre>

              <h4>请求体加密（关键）</h4>
              <pre>{`// postDes：body 不是明文 JSON，而是 DES 密文的 Hex 串
key = casual (16 字符，登录时前端生成并提交给服务端)
body = DES-ECB( JSON.stringify(payload), key ).toString(Hex)
// 明文直发会被网关打回 400 Bad Request`}</pre>

              <h4>打卡接口</h4>
              <pre>{`POST /znzhxgpt/qxj/qxj-padkglxx/queryKqDkbc       班次 / 时间窗 / 围栏
POST /znzhxgpt/qxj/qxj-padkglxx/jcqqwzsjsfndk    围栏校验 → { canDk, pcMi, fwMi }
POST /znzhxgpt/qxj/qxj-padkglxx/xspadk           提交 → { jd, wd, dkbc, dkdz }
POST /znzhxgpt/ssgl/ss-ldxx/findLdzbCjList       142 栋楼坐标`}</pre>

              <h4>绕开移动端门禁</h4>
              <pre>{`// zhxg 的 H5 启动钩子里唯一的拦截点
isMobile = () => /iphone|ipod|android|harmony|windows phone|mobile/i
          .test(navigator.userAgent.toLowerCase())
// 非移动端 → uni.reLaunch('/pages/public/error')
// 后端完全不看 UA，纯粹的前端判断`}</pre>
            </div>
          )}
        </section>
      </main>

      <footer className="foot">
        <span>仅供个人打卡便利使用 · 请遵守学校相关管理规定</span>
        <span className="dot-sep">·</span>
        <span>数据不出本机</span>
      </footer>
    </div>
  );
}
