import { useCallback, useEffect, useState } from "react";
import Panel from "../panel/Panel";
import { store } from "../core/store";
import { readCred, writeCred, clearCred, setCredSource, setManualCred } from "../core/api";
// Panel 直接渲染在 document 中，需显式引入面板样式
import "../panel/panel.css";

/** 只存学号，用于回填登录表单 */
const LS_USER = "csu-padk:savedUser";
/** 完整用户档案（姓名 / 学号 / 院系）。刷新后 token 还在，
 *  但 user 是内存态、会丢，页眉就只剩「已登录」——单独存一份 */
const LS_PROFILE = "csu-padk:profile";
/**
 * CAS 的长期会话凭据（CASTGC）。
 * token 只有一天寿命，CASTGC 有数天，且用它换票不需要密码 —— 云端形态
 * 被要求二次认证时，这是唯一能自动续上的路。
 */
const LS_CASTGC = "csu-padk:castgc";

export default function PadkPage() {
  const [phase, setPhase] = useState<"check" | "login" | "ready">("check");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [user, setUser] = useState<{ xh: string; xm: string; bmmc?: string } | null>(null);
  /* 手动导入面板：学校要求验证码时，协议登录无解，只能把官方会话搬过来 */
  const [manual, setManual] = useState(false);
  const [mToken, setMToken] = useState("");
  const [mCasual, setMCasual] = useState("");
  /* 手动导入时粘贴的 CASTGC（值或 name=value 都收） */
  const [mCastgc, setMCastgc] = useState("");
  /* 学校侧要求二次认证时，服务端会回一个官方登录入口；有值就把它显示出来 */
  const [officialUrl, setOfficialUrl] = useState("");

  /*
   * 一次「拿到 token 之后该做什么」的统一收口。
   * 密码登录、CASTGC 换票、手动导入三条路都以同样的状态收尾；
   * 顺手把服务端回传的 CASTGC 存下来，下次就能免密进来。
   */
  const applyLogin = useCallback((j: any): boolean => {
    const w = writeCred({ token: j.token, casual: j.casual });
    if (!w.ok) {
      setErr(`登录返回的凭据不可用：${w.detail}`);
      return false;
    }
    // 服务端会把当前有效的 CASTGC 回传（可能已轮换），以它为准
    if (j.castgc) localStorage.setItem(LS_CASTGC, String(j.castgc));
    localStorage.setItem(LS_PROFILE, JSON.stringify(j.user));
    setOfficialUrl("");
    setUser(j.user);
    setPassword("");
    setManual(false);
    setPhase("ready");
    return true;
  }, []);

  /*
   * 用保存的 CASTGC 静默换一次票。
   * 两个场景共用：打开页面时（上一次的 token 大概率已过期），以及用着用着
   * token 过期被踢回来时 —— token 只有一天寿命，这件事每天都会发生。
   * 云端形态的密码登录会被要求二次认证，只有这条 GET 换票的路不提交密码，
   * 也就绕开了那条风控，所以它是「一次导入、之后免密」的关键一环。
   */
  const renewByCastgc = useCallback(
    async (tgt: string, quiet: boolean) => {
      try {
        const res = await fetch("/__auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ castgc: tgt }),
        });
        const j = await res.json();
        if (j.ok && applyLogin(j)) return true;
        // 过期或被注销：清掉这枚凭据，退回登录页。quiet 时只留一句解释，不当故障报
        localStorage.removeItem(LS_CASTGC);
        setErr(
          quiet
            ? "上次保存的会话已经过期，重新登录一次即可。"
            : "登录状态已过期，保存的会话也不再生效 —— 请重新登录一次。"
        );
        setPhase("login");
        return false;
      } catch {
        setPhase("login");
        return false;
      }
    },
    [applyLogin]
  );

  /* ── 检查现有会话 ── */
  useEffect(() => {
    // 整页 / 桌面形态只认本工具自己登录写入的凭据。
    // 同一 origin 的 localStorage 里可能躺着**另一个学号**在官方页面留下的
    // token 与 casual —— 捡过来能通，但打的是别人的卡。宁可要求登录一次。
    setCredSource(false);
    const r = readCred();
    const saved = localStorage.getItem(LS_USER);
    if (saved) setUsername(saved);

    const profile = localStorage.getItem(LS_PROFILE);
    if (profile) {
      try {
        setUser(JSON.parse(profile));
      } catch {
        localStorage.removeItem(LS_PROFILE);
      }
    }

    if (r.ok) {
      setPhase("ready");
      return;
    }
    /*
     * 没有本地凭据，但存着 CASTGC 时先静默换一次票。
     * 云端形态的密码登录会被要求二次认证；CASTGC 代表「已经认证过的会话」，
     * 换票只是一次 GET —— 不提交密码，也就绕开了那条风控。token 每天过期
     * 一次而人不用天天登录，靠的就是这一环。
     */
    const tgt = (localStorage.getItem(LS_CASTGC) || "").trim();
    if (!tgt) {
      setPhase("login");
      return;
    }
    renewByCastgc(tgt, true);
  }, [applyLogin, renewByCastgc]);

  /* ── 登录 ── */
  const doLogin = useCallback(async () => {
    if (!username.trim() || !password) {
      setErr("请填写学号与密码");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      // 同源登录：由运行环境里的那层服务完成统一身份认证协议，
      // 浏览器只负责把学号密码发到自己的域名下（不跨域、不落盘）。
      const res = await fetch("/__auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const j: {
        ok: boolean;
        token?: string;
        casual?: string;
        user?: { xh: string; xm: string; bmmc?: string };
        error?: string;
        needMfa?: boolean;
        officialUrl?: string;
      } = await res.json();

      if (!j.ok) {
        setErr(j.error || "登录失败");
        // 二次认证 / 验证码：协议登录走不过去，直接把官方入口和导入面板摊开
        if (j.needMfa) {
          setOfficialUrl(j.officialUrl || "");
          setManual(true);
        }
        setBusy(false);
        return;
      }
      // 只写自有键（csu-padk:cred），不碰宿主页面的 token / casual ——
      // 那是官方会话的凭据，覆盖它等于把用户在官网的登录状态搞坏
      if (!applyLogin(j)) {
        setBusy(false);
        return;
      }
      if (remember) localStorage.setItem(LS_USER, j.user!.xh);
      else localStorage.removeItem(LS_USER);
    } catch (e: any) {
      setErr(
        "登录服务不可用。请确认当前页面由本工具自己的服务提供：本机形态双击 padk.exe，" +
          "云端形态用分配到的域名。直接打开静态文件（file://）时没有登录接口。"
      );
    } finally {
      setBusy(false);
    }
  }, [username, password, remember, applyLogin]);

  /* ── 手动导入：token + casual 必须成对，缺一个就整体拒绝 ── */
  const doManual = useCallback(() => {
    const r = setManualCred(mToken, mCasual);
    if (!r.ok) {
      setErr(
        r.reason === "token-invalid"
          ? "token 看起来不完整（应从 eyJ 开头的长串整段复制）"
          : r.reason === "casual-invalid"
            ? "casual 应是 16 位字母数字，与 token 来自同一次会话"
            : "凭据不可用：" + (r.detail || r.reason)
      );
      return;
    }
    setErr("");
    setMToken("");
    setMCasual("");
    setManual(false);
    setPhase("ready");
  }, [mToken, mCasual]);

  /* ── 用 CASTGC 换票：不提交密码，也就不会被要求二次认证 ── */
  const doCastgc = useCallback(async () => {
    const raw = mCastgc.trim();
    if (!raw) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/__auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ castgc: raw }),
      });
      const j: any = await res.json();
      if (!j.ok) {
        setErr(j.error || "这枚 CASTGC 没有换来登录凭据");
        return;
      }
      if (!applyLogin(j)) return;
      // 服务端没回传时用粘贴的原文兜底；只粘了值就补上名字
      if (!j.castgc) {
        localStorage.setItem(LS_CASTGC, /^CASTGC=/i.test(raw) ? raw : `CASTGC=${raw}`);
      }
      setMCastgc("");
    } catch {
      setErr("登录服务不可用 —— 当前页面不是由本工具自己的服务提供的。");
    } finally {
      setBusy(false);
    }
  }, [mCastgc, applyLogin]);

  const logout = useCallback(() => {
    clearCred();
    /*
     * 主动退出连 CASTGC 一起清：它能在数天内免密换票，
     * 留在公共电脑上等于把账号交给下一个人。token 过期被踢回登录页时不清，
     * 那是自动续期的正常路径。
     */
    localStorage.removeItem(LS_CASTGC);
    localStorage.removeItem(LS_PROFILE);
    store.clearHistory();
    setMCastgc("");
    setPhase("login");
    setUser(null);
  }, []);

  /** 凭据在服务端失效（被其他设备踢下线 / 过期）→ 清掉并回到登录页 */
  const handleAuthError = useCallback(
    (msg: string) => {
      clearCred();
      localStorage.removeItem(LS_PROFILE);
      setUser(null);
      /*
       * token 只有一天寿命，到期被踢回来是常态，不是故障。
       * 手上有 CASTGC 就直接换新的 —— 免密续期该发生在这里，而不是让用户
       * 对着一张登录表单重新输密码。
       */
      const tgt = (localStorage.getItem(LS_CASTGC) || "").trim();
      if (tgt) {
        setErr("");
        setPhase("check");
        renewByCastgc(tgt, false);
        return;
      }
      setErr(`${msg}　请重新登录。`);
      setPhase("login");
    },
    [renewByCastgc]
  );

  if (phase === "check") {
    return (
      <div className="padk-shell">
        <div className="padk-loading">正在检查登录状态…</div>
      </div>
    );
  }

  if (phase === "login") {
    return (
      <div className="padk-shell">
        <div className="padk-login">
          <div className="pl-tag">CSU · 智慧学工</div>
          <h1>平安打卡</h1>
          <p className="pl-lede">
            登录一次即可，凭据只保存在本机浏览器。
            <br />
            之后打开这个地址就能直接打卡。
          </p>

          <label className="pl-field">
            <span>学号 / 工号</span>
            <input
              type="text"
              value={username}
              autoComplete="username"
              spellCheck={false}
              placeholder="请输入学号"
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()}
            />
          </label>

          <label className="pl-field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              placeholder="请输入密码"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()}
            />
          </label>

          <label className="pl-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            记住学号
          </label>

          {err && <div className="pl-err">{err}</div>}

          {officialUrl && (
            <a className="pl-alt" href={officialUrl} target="_blank" rel="noreferrer">
              打开官方登录页完成二次验证
            </a>
          )}

          <button className="pl-btn" onClick={doLogin} disabled={busy}>
            {busy ? "登录中…" : "登录并进入打卡"}
          </button>

          <button className="pl-alt" onClick={() => { setManual(!manual); setErr(""); }}>
            {manual ? "收起" : "被要求验证码 / 二次验证？改用会话导入"}
          </button>

          {manual && (
            <div className="pl-manual">
              <p>
                <b>最省事：粘贴 CASTGC。</b>它是学校在一次登录后签发的会话凭据，数天有效；
                这边拿它换票不经过密码，也就不会被要求二次验证。取法：F12 → Application（应用）
                → Cookies → <code>https://ca.csu.edu.cn</code>，找到 <code>CASTGC</code>
                一行，复制它的 Value（只填值也行，会自动补上名字）。
              </p>
              <label className="pl-field">
                <span>CASTGC</span>
                <input
                  type="text"
                  value={mCastgc}
                  spellCheck={false}
                  placeholder="CASTGC=…"
                  onChange={(e) => setMCastgc(e.target.value)}
                />
              </label>
              <button className="pl-btn" onClick={doCastgc} disabled={!mCastgc.trim() || busy}>
                用这个会话换票
              </button>
              <p className="pl-or">
                拿不到 CASTGC 时退一步，用一次性的 token + casual（当天有效）：
                在官方页面登录一次（要二次验证就在那里过），然后按 F12 打开控制台，粘贴执行：
              </p>
              <pre>{'copy(JSON.stringify({token:localStorage.token||sessionStorage.token,casual:localStorage.casual||sessionStorage.casual}))'}</pre>
              <p>剪贴板里会得到一对 JSON，粘到下面即可。两者必须来自同一次会话，拆开用会失败。</p>
              <label className="pl-field">
                <span>token</span>
                <input
                  type="text"
                  value={mToken}
                  spellCheck={false}
                  placeholder="eyJ…"
                  onChange={(e) => setMToken(e.target.value)}
                />
              </label>
              <label className="pl-field">
                <span>casual</span>
                <input
                  type="text"
                  value={mCasual}
                  spellCheck={false}
                  placeholder="16 位字母数字"
                  onChange={(e) => setMCasual(e.target.value)}
                />
              </label>
              <button className="pl-btn" onClick={doManual} disabled={!mToken || !mCasual}>
                使用这对凭据
              </button>
            </div>
          )}

          <p className="pl-foot">
            走的是学校统一身份认证（<code>ca.csu.edu.cn</code>），
            密码仅用于本次协议登录，不会保存到任何服务器。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="padk-shell">
      <div className="padk-bar">
        <div className="pb-who">
          <span className="pb-name">{user?.xm || "已登录"}</span>
          <span className="pb-meta">
            {user
              ? [user.xh, user.bmmc].filter(Boolean).join(" · ")
              : username || "—"}
          </span>
        </div>
        <button className="pb-out" onClick={logout}>
          退出登录
        </button>
      </div>
      <Panel pageMode onAuthError={handleAuthError} />
    </div>
  );
}
