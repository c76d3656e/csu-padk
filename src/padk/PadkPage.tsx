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

    setPhase(r.ok ? "ready" : "login");
  }, []);

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
      } = await res.json();

      if (!j.ok) {
        setErr(j.error || "登录失败");
        setBusy(false);
        return;
      }

      // 只写自有键（csu-padk:cred），不碰宿主页面的 token / casual ——
      // 那是官方会话的凭据，覆盖它等于把用户在官网的登录状态搞坏
      const w = writeCred({ token: j.token!, casual: j.casual! });
      if (!w.ok) {
        setErr(`登录返回的凭据不可用：${w.detail}`);
        setBusy(false);
        return;
      }
      localStorage.setItem(LS_PROFILE, JSON.stringify(j.user));
      if (remember) localStorage.setItem(LS_USER, j.user!.xh);
      else localStorage.removeItem(LS_USER);

      setUser(j.user as any);
      setPassword("");
      setPhase("ready");
    } catch (e: any) {
      setErr(
        "登录服务不可用。请确认当前页面由本工具自己的服务提供：本机形态双击 padk.exe，" +
          "云端形态用分配到的域名。直接打开静态文件（file://）时没有登录接口。"
      );
    } finally {
      setBusy(false);
    }
  }, [username, password, remember]);

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

  const logout = useCallback(() => {
    clearCred();
    localStorage.removeItem(LS_PROFILE);
    store.clearHistory();
    setPhase("login");
    setUser(null);
  }, []);

  /** 凭据在服务端失效（被其他设备踢下线 / 过期）→ 清掉并回到登录页 */
  const handleAuthError = useCallback((msg: string) => {
    clearCred();
    localStorage.removeItem(LS_PROFILE);
    setUser(null);
    setErr(`${msg}　请重新登录。`);
    setPhase("login");
  }, []);

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

          <button className="pl-btn" onClick={doLogin} disabled={busy}>
            {busy ? "登录中…" : "登录并进入打卡"}
          </button>

          <button className="pl-alt" onClick={() => { setManual(!manual); setErr(""); }}>
            {manual ? "收起" : "学校要求验证码？改用手动导入"}
          </button>

          {manual && (
            <div className="pl-manual">
              <p>
                在官方页面登录一次，然后按 F12 打开控制台，粘贴执行：
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
