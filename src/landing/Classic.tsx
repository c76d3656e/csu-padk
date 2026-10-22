import { useState } from "react";

const CAS_LOGIN =
  "https://ca.csu.edu.cn/authserver/login?service=" +
  encodeURIComponent("https://zhxg.csu.edu.cn/fdcwonsun/caslogin_h5.jsp");
const H5_HOME = "https://zhxg.csu.edu.cn/znzhxgpt_h5/";

export default function Classic() {
  const [showTech, setShowTech] = useState(false);

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
          在浏览器里跑起一块打卡面板。自动生成合规落点、随机轮换位置、一键完成打卡。
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
            <h3>打开打卡台</h3>
            <p>
              本机形态双击 <code>padk.exe</code>，浏览器会自动打开；云端形态直接用分配到的域名。
              打开后就是登录界面，不需要额外装任何东西。
            </p>
            <div className="tip">
              <b>PC 用户注意</b>：移动端页面会拦截桌面浏览器。请先按
              <code>F12</code> → <code>Ctrl+Shift+M</code> 打开设备模拟，选任意手机型号，再点登录。
            </div>
            <div className="row">
              <a className="btn primary" href="#/">
                进入打卡台
              </a>
              <a className="btn ghost" href={CAS_LOGIN} target="_blank" rel="noreferrer">
                前往官方登录
              </a>
              <a className="btn ghost" href={H5_HOME} target="_blank" rel="noreferrer">
                打开打卡页
              </a>
            </div>
          </article>

          <article className="step">
            <div className="num">02</div>
            <h3>用学号登录</h3>
            <p>
              在打卡台的登录框里输入学号与密码，由本工具代为走统一身份认证
              （<code>ca.csu.edu.cn</code>）。<b>密码只提交给官方页面</b>，本项目不打印、不落盘。
            </p>
            <ul className="bullets">
              <li>凭据保存在浏览器 localStorage，清空浏览器数据即消失</li>
              <li>遇到验证码要求时，去官方页面完成一次登录即可</li>
            </ul>
          </article>

          <article className="step">
            <div className="num">03</div>
            <h3>选宿舍楼，点打卡</h3>
            <p>
              首次需要选择你的宿舍楼（或在地图上直接点），之后它会记住。
              每次点打卡会自动生成一个合规落点。
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
            本项目提供两种跑法：本机 exe 与云端（Cloudflare / Vercel）。
            详见仓库 README，两种形态共用同一份源码。
          </p>
        </section>

        <section className="privacy">
          <div className="lock">🔒</div>
          <div>
            <h3>没有数据库，也读不到你的密码</h3>
            <p>
              整个工具没有数据库，也没有服务端存储。登录动作发生在官方{" "}
              <code>ca.csu.edu.cn</code>，本工具只向 <code>zhxg.csu.edu.cn</code> 发起业务请求。
              落点历史、宿舍楼选择等配置都存在你自己的 <code>localStorage</code>，
              清空浏览器数据即彻底消失。
            </p>
          </div>
        </section>

        <section className="tech">
          <button className="tech-toggle" onClick={() => setShowTech((v) => !v)}>
            {showTech ? "▲" : "▼"} 技术细节（实现说明）
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
