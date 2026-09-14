import { useCallback, useEffect, useState } from "react";
import Panel from "../panel/Panel";
import { store } from "../core/store";
// 整页形态下 Panel 直接渲染在 document 中，需显式引入面板样式
// （书签注入时则是把同一份 CSS 内联进 Shadow DOM）
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

  /* ── 检查现有会话 ── */
  useEffect(() => {
    const t = localStorage.getItem("token") || "";
    const c = localStorage.getItem("casual") || localStorage.getItem("caasual") || "";
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

    if (t.length >= 32 && c.length >= 8) {
      setPhase("ready");
    } else {
      setPhase("login");
    }
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
      const res = await fetch("/__auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const j = await res.json();

      if (!j.ok) {
        setErr(j.error || "登录失败");
        setBusy(false);
        return;
      }

      localStorage.setItem("token", j.token);
      localStorage.setItem("casual", j.casual);
      localStorage.setItem(LS_PROFILE, JSON.stringify(j.user));
      if (remember) localStorage.setItem(LS_USER, j.user.xh);
      else localStorage.removeItem(LS_USER);

      setUser(j.user);
      setPassword("");
      setPhase("ready");
    } catch (e: any) {
      setErr(
        "登录服务不可用（仅本地开发服务器提供）。请改用官方页面登录后使用书签注入。"
      );
    } finally {
      setBusy(false);
    }
  }, [username, password, remember]);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("casual");
    localStorage.removeItem("caasual");
    localStorage.removeItem(LS_PROFILE);
    store.clearHistory();
    setPhase("login");
    setUser(null);
  }, []);

  /** 凭据在服务端失效（被其他设备踢下线 / 过期）→ 清掉并回到登录页 */
  const handleAuthError = useCallback((msg: string) => {
    localStorage.removeItem("token");
    localStorage.removeItem("casual");
    localStorage.removeItem("caasual");
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
