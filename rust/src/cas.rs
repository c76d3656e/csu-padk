//! 统一身份认证登录编排 —— 与 src/core/casLogin.ts 逐条对应。
//!
//!   1. GET  /authserver/login?service=…        取 pwdEncryptSalt / execution
//!   2. GET  /authserver/checkNeedCaptcha.htl   判断是否需要验证码
//!   3. POST /authserver/login                  成功即 302 + ticket
//!   4. 跟随 ticket 回调（≤5 跳）                从页面取 uid / lzc
//!   5. POST /znzhxgpt/basesys/rbac-yh/login-other  换 token

use std::io::Read;
use std::sync::OnceLock;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};

use crate::jar::Jar;
use crate::kcipher::{encrypt_password, generate_casual};
use crate::util::{host_of, pct_encode, query_param, resolve, take_chars};

pub const CAS: &str = "https://ca.csu.edu.cn";
pub const ZHXG: &str = "https://zhxg.csu.edu.cn";
pub const SERVICE: &str = "https://zhxg.csu.edu.cn/fdcwonsun/caslogin_h5.jsp";
pub const UA_DESKTOP: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
pub const UA_MOBILE: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40";

#[derive(Debug, Clone)]
pub struct LoginUser {
    pub xh: String,
    pub xm: String,
    pub bmid: serde_json::Value,
    pub bmmc: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LoginResult {
    pub token: String,
    pub casual: String,
    /// rememberMe 签发的 TGT，有它就能免密换票
    pub castgc: Option<String>,
    pub user: LoginUser,
}

#[derive(Debug, Clone)]
pub enum LoginError {
    /// 瞬时失败，重走一遍完整流程通常就过
    Retryable(String),
    /// 密码已通过，卡在二次认证，重试无意义
    Mfa(String),
    Fatal(String),
}

impl LoginError {
    pub fn message(&self) -> &str {
        match self {
            LoginError::Retryable(m) | LoginError::Mfa(m) | LoginError::Fatal(m) => m,
        }
    }
    pub fn is_mfa(&self) -> bool {
        matches!(self, LoginError::Mfa(_))
    }
}

/// 共享连接池 + 固定超时；redirects(0) 让 3xx 原样回给我们自己判断
pub fn agent() -> &'static ureq::Agent {
    static A: OnceLock<ureq::Agent> = OnceLock::new();
    A.get_or_init(|| {
        ureq::AgentBuilder::new()
            .redirects(0)
            .timeout_connect(Duration::from_secs(10))
            .timeout_read(Duration::from_secs(25))
            .timeout_write(Duration::from_secs(25))
            .build()
    })
}

pub struct RawResp {
    pub status: u16,
    pub location: String,
    pub content_type: String,
    pub set_cookie: Vec<String>,
    pub body: Vec<u8>,
}

impl RawResp {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
    /// JS 的 body.length 是 UTF-16 码元数，BMP 内与字符数一致
    pub fn text_len(&self) -> usize {
        self.text().chars().count()
    }
}

pub fn send(
    method: &str,
    url: &str,
    headers: &[(&str, String)],
    body: Option<Vec<u8>>,
) -> Result<RawResp, String> {
    let mut req = agent().request(method, url);
    for (k, v) in headers {
        req = req.set(k, v);
    }
    let res = match body {
        Some(b) => req.send_bytes(&b),
        None => req.call(),
    };
    // 4xx/5xx 在 ureq 里是 Err(Status)，但对 CAS 来说它们就是正常响应
    let resp = match res {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => return Err(format!("{e}")),
    };
    let status = resp.status();
    let location = resp.header("location").unwrap_or("").to_string();
    let content_type = resp.header("content-type").unwrap_or("").to_string();
    let set_cookie: Vec<String> = resp.all("set-cookie").iter().map(|s| s.to_string()).collect();
    let mut body = Vec::new();
    let _ = resp.into_reader().read_to_end(&mut body);
    Ok(RawResp { status, location, content_type, set_cookie, body })
}

/* ───────────── 页面解析 ───────────── */

/// 找 anchor 之后的第一个 value="…"
fn attr_after(html: &str, anchor: &str) -> String {
    let Some(i) = html.find(anchor) else { return String::new() };
    let rest = &html[i..];
    let Some(j) = rest.find("value=\"") else { return String::new() };
    let rest = &rest[j + 7..];
    match rest.find('"') {
        Some(k) => rest[..k].to_string(),
        None => String::new(),
    }
}

/// 找 key = 'v' / key = "v" 这类赋值，返回引号内的内容
fn assign_value(html: &str, key: &str) -> String {
    let Some(i) = html.find(key) else { return String::new() };
    let rest = &html[i + key.len()..];
    let rest = rest.trim_start();
    let Some(rest) = rest.strip_prefix('=') else { return String::new() };
    let rest = rest.trim_start();
    let mut cs = rest.chars();
    let Some(q) = cs.next() else { return String::new() };
    if q != '"' && q != '\'' {
        return String::new();
    }
    let body = &rest[q.len_utf8()..];
    match body.find(q) {
        Some(k) => body[..k].to_string(),
        None => String::new(),
    }
}

fn between<'a>(s: &'a str, start: &str, end: &str) -> &'a str {
    let Some(i) = s.find(start) else { return "" };
    let rest = &s[i + start.len()..];
    match rest.find(end) {
        Some(j) => &rest[..j],
        None => "",
    }
}

/// 学校网关的「仅限校园网访问」提示页。状态码是 200，只能认正文
fn is_gateway_block(html: &str) -> bool {
    html.contains("仅限校园网访问") || html.contains("系统访问提示") || html.contains("仅限校内网络访问")
}

/// 从 token 的 payload 里取院系名；拿不到不影响登录
fn read_bmmc(token: &str) -> Option<String> {
    let seg = token.split('.').nth(1)?;
    let s = seg.replace('-', "+").replace('_', "/");
    let pad = (4 - s.len() % 4) % 4;
    let bytes = STANDARD.decode(format!("{}{}", s, "=".repeat(pad))).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let inner = v.get("user_info")?.as_str()?;
    let p: serde_json::Value = serde_json::from_str(inner).ok()?;
    p.get("bmmc")?.as_str().map(|x| x.to_string())
}

/* ───────────── 主流程 ───────────── */

pub fn protocol_login(username: &str, password: &str) -> Result<LoginResult, LoginError> {
    let mut attempt = 0;
    loop {
        match protocol_login_once(username, password) {
            Ok(r) => return Ok(r),
            Err(LoginError::Retryable(m)) => {
                if attempt >= 1 {
                    return Err(LoginError::Fatal(format!(
                        "{m} 已经重试过一次仍未通过，请改用官方页面登录一次。"
                    )));
                }
                attempt += 1;
                std::thread::sleep(Duration::from_millis(400));
            }
            Err(e) => return Err(e),
        }
    }
}

fn protocol_login_once(username: &str, password: &str) -> Result<LoginResult, LoginError> {
    let fatal = |m: String| LoginError::Fatal(m);
    let retry = |m: String| LoginError::Retryable(m);

    let mut jar = Jar::new();
    let login_url = format!("{CAS}/authserver/login?service={}", pct_encode(SERVICE));

    // 1. 取登录页 → salt / execution
    let mut res = send("GET", &login_url, &[("User-Agent", UA_DESKTOP.into())], None)
        .map_err(retry)?;
    jar.set(&res.set_cookie, &login_url);
    let html = res.text();
    let salt = attr_after(&html, "id=\"pwdEncryptSalt\"");
    let mut exec = attr_after(&html, "id=\"execution\"");
    if exec.is_empty() {
        exec = "e1s1".to_string();
    }

    if salt.is_empty() && is_gateway_block(&html) {
        return Err(retry("统一认证这一次没返回登录页，而是学校网关的「仅限校园网访问」提示页 —— 这个出口 IP 不在校园网允许范围内。".into()));
    }
    if salt.is_empty() && res.location.contains("weixinQYLogin") {
        return Err(fatal("统一认证走了企业微信授权分支，请稍后重试".into()));
    }
    if salt.is_empty() {
        return Err(retry("统一认证这一次没有返回登录页（既没有加密盐，也没有会话 cookie）—— 出口 IP 被学校侧拒绝时就是这个样子。".into()));
    }

    // 2. 是否需要验证码
    let captcha_url = format!(
        "{CAS}/authserver/checkNeedCaptcha.htl?username={}&_={}",
        pct_encode(username),
        now_ms()
    );
    res = send(
        "GET",
        &captcha_url,
        &[
            ("User-Agent", UA_DESKTOP.into()),
            ("Cookie", jar.header(&captcha_url)),
        ],
        None,
    )
    .map_err(retry)?;
    jar.set(&res.set_cookie, &captcha_url);
    let need_captcha = serde_json::from_slice::<serde_json::Value>(&res.body)
        .ok()
        .and_then(|v| v.get("isNeed").and_then(|x| x.as_bool()))
        .unwrap_or(false);

    // 3. 提交登录
    let enc = encrypt_password(password, &salt).map_err(|e| fatal(e))?;
    let form = [
        ("username", username.to_string()),
        ("password", enc),
        ("lt", String::new()),
        ("execution", exec),
        ("_eventId", "submit".into()),
        ("cllt", "userNameLogin".into()),
        ("dllt", "generalLogin".into()),
        ("captcha", String::new()),
        ("rmShown", "1".into()),
        ("rememberMe", "true".into()),
    ]
    .iter()
    .map(|(k, v)| format!("{}={}", pct_encode(k), pct_encode(v)))
    .collect::<Vec<_>>()
    .join("&");

    res = send(
        "POST",
        &login_url,
        &[
            ("User-Agent", UA_DESKTOP.into()),
            ("Content-Type", "application/x-www-form-urlencoded".into()),
            ("Cookie", jar.header(&login_url)),
        ],
        Some(form.into_bytes()),
    )
    .map_err(retry)?;
    jar.set(&res.set_cookie, &login_url);

    if res.status != 302 {
        let body = res.text();
        let tip = between(
            body.split("id=\"showErrorTip\"").nth(1).unwrap_or(""),
            ">",
            "<",
        )
        .to_string();
        let diag = format!(
            "诊断 status={} len={} salt={} cookie=[{}] 验证码={}",
            res.status,
            res.text_len(),
            if body.contains("pwdEncryptSalt") { "有" } else { "无" },
            jar.names(),
            if need_captcha { "是" } else { "否" }
        );
        if body.contains("accountLogin_account_pwd_error") || res.status == 401 {
            return Err(fatal(format!(
                "统一认证判定用户名或密码不正确（status={}）。{diag}",
                res.status
            )));
        }
        if body.contains("inputUserNameTip") {
            return Err(fatal(format!(
                "统一认证没有接受这次登录（账号或密码不正确，或该账号被要求验证码）。{diag}"
            )));
        }
        if need_captcha {
            return Err(fatal(format!("该账号需要验证码，请改用官方页面登录。{diag}")));
        }
        let tip = tip.trim().to_string();
        return Err(fatal(format!(
            "{}。{diag}",
            if tip.is_empty() { "账号或密码不正确".to_string() } else { tip }
        )));
    }

    finish_with_ticket(&res.location, &mut jar)
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn finish_with_ticket(location: &str, jar: &mut Jar) -> Result<LoginResult, LoginError> {
    let ticket_url = resolve(ZHXG, location);

    // 二次认证（多因子）：密码已过，卡在短信 / OTP，重试只会多刷一次风控
    let lower = ticket_url.to_ascii_lowercase();
    if lower.contains("reautloginview") || lower.contains("reauthcheck") || lower.contains("/reauth") {
        return Err(LoginError::Mfa(
            "统一认证要求二次认证（多因子）：密码这一步已经通过，卡在短信 / 二次验证这一关，             跟图形验证码无关。协议登录无法自动完成，请在官方页面登录一次（完成二次验证），             再用「手动导入」把 token 与 casual 搬进来。"
                .into(),
        ));
    }

    if lower.contains("/authserver/login") {
        let why = query_param(&ticket_url, "exception.message");
        return Err(LoginError::Retryable(format!(
            "统一认证把这次登录退回了登录页（会话与表单令牌对不上）。{}",
            if why.is_empty() {
                String::new()
            } else {
                format!(" CAS 原话：{why}")
            }
        )));
    }

    let ticket = query_param(&ticket_url, "ticket");
    if ticket.is_empty() {
        return Err(LoginError::Retryable(format!(
            "统一认证回了 302，但没有带回票据 —— 这次登录没有被受理（location={}）。",
            take_chars(&ticket_url, 120)
        )));
    }

    // 4. 跟随回调拿 uid / lzc
    let mut cur = ticket_url.clone();
    let mut hops: Vec<String> = Vec::new();
    let mut trace: Vec<String> = vec![format!("ticket len={}", ticket.chars().count())];
    for hop in 0..5 {
        if cur.is_empty() {
            break;
        }
        let mut headers: Vec<(&str, String)> = vec![("User-Agent", UA_DESKTOP.into())];
        let ck = jar.header(&cur);
        if !ck.is_empty() {
            headers.push(("Cookie", ck));
        }
        let r = match send("GET", &cur, &headers, None) {
            Ok(r) => r,
            Err(e) => {
                trace.push(format!("#{hop} ERR {e}"));
                break;
            }
        };
        jar.set(&r.set_cookie, &cur);
        let t = r.text();
        let next = r.location.clone();
        trace.push(format!(
            "#{hop} {} len={}{} → {}",
            r.status,
            t.chars().count(),
            if t.contains("uid") { " uid" } else { "" },
            take_chars(&next, 80).replace('-', "-")
        ));
        hops.push(t.clone());
        if r.status == 403 && t.is_empty() {
            break;
        }
        if next.is_empty() {
            break;
        }
        if next.split('?').next().unwrap_or("").ends_with("/authserver/login") {
            break;
        }
        cur = resolve(ZHXG, &next);
    }

    let body = hops.iter().find(|t| t.contains("uid")).cloned().unwrap_or_default();
    let mut uid = assign_value(&body, "uid");
    let lzc = assign_value(&body, "lzc");

    // 没有 uid 时用 CAS 标准协议 serviceValidate：不依赖 HTML、不需要会话
    if uid.is_empty() {
        for ep in ["/authserver/serviceValidate", "/authserver/p3/serviceValidate"] {
            let url = format!(
                "{CAS}{ep}?service={}&ticket={}",
                pct_encode(SERVICE),
                pct_encode(&ticket)
            );
            match send("GET", &url, &[("User-Agent", UA_DESKTOP.into())], None) {
                Ok(v) => {
                    let xml = v.text();
                    uid = between(&xml, "<cas:user>", "</cas:user>").to_string();
                    let code = if xml.contains("code=\"") {
                        xml.split("code=\"")
                            .nth(1)
                            .unwrap_or("")
                            .split('"')
                            .next()
                            .unwrap_or("")
                            .to_string()
                    } else {
                        String::new()
                    };
                    trace.push(format!(
                        "serviceValidate{} {} len={}{}{}",
                        if ep.contains("p3") { "(p3)" } else { "" },
                        v.status,
                        xml.chars().count(),
                        if code.is_empty() { String::new() } else { format!(" {code}") },
                        if uid.is_empty() { "" } else { " uid" }
                    ));
                    if !uid.is_empty() {
                        break;
                    }
                }
                Err(e) => trace.push(format!(
                    "serviceValidate{} ERR {e}",
                    if ep.contains("p3") { "(p3)" } else { "" }
                )),
            }
        }
    }

    if uid.is_empty() {
        let detail = trace.join(" | ");
        return Err(LoginError::Fatal(format!("未取得登录凭据（uid）。回调链：{detail}")));
    }

    // 5. 换 token（casual 在此与这次会话绑定）
    let casual = generate_casual(16);
    let login_other = format!("{ZHXG}/znzhxgpt/basesys/rbac-yh/login-other");
    let payload = serde_json::json!({
        "tyrzpt": "1",
        "channeld": "1",
        "yhzh": pct_encode(&pct_encode(&uid)),
        "lzc": pct_encode(&pct_encode(&lzc)),
        "caasual": casual,
    })
    .to_string();

    let r5 = send(
        "POST",
        &login_other,
        &[
            ("Content-Type", "application/json;charset=UTF-8".into()),
            ("deviceType", "4".into()),
            ("AppCode", "znzhxgpt".into()),
            ("User-Agent", UA_MOBILE.into()),
            ("Origin", ZHXG.into()),
            ("Referer", format!("{ZHXG}/znzhxgpt_h5/")),
            ("Cookie", jar.header(&login_other)),
        ],
        Some(payload.into_bytes()),
    )
    .map_err(|e| LoginError::Fatal(format!("换取登录令牌失败：{e}")))?;

    let j: serde_json::Value = serde_json::from_slice(&r5.body).unwrap_or(serde_json::Value::Null);
    let token = j
        .pointer("/data/token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if token.is_empty() {
        let code = match j.get("code") {
            Some(serde_json::Value::Number(n)) => n.to_string(),
            Some(serde_json::Value::String(s)) if !s.is_empty() => s.clone(),
            _ => String::new(),
        };
        let msg = j.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let why = [code, msg]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        return Err(LoginError::Fatal(format!(
            "换取登录令牌失败{}（账号已识别，卡在会话绑定这一步）",
            if why.is_empty() { String::new() } else { format!("：{why}") }
        )));
    }

    let bmmc = read_bmmc(&token);
    let castgc = {
        let v = jar.value("CASTGC");
        if v.is_empty() { None } else { Some(v) }
    };
    let get = |k: &str| -> serde_json::Value {
        j.pointer(&format!("/data/{k}")).cloned().unwrap_or(serde_json::Value::Null)
    };
    Ok(LoginResult {
        token,
        casual,
        castgc,
        user: LoginUser {
            xh: get("yhzh").as_str().unwrap_or("").to_string(),
            xm: get("yhxm").as_str().unwrap_or("").to_string(),
            bmid: get("bmid"),
            bmmc,
        },
    })
}

/// 用 CASTGC 免密换票 —— 云端形态真正可用的自动登录入口
pub fn castgc_login(cookie: &str) -> Result<LoginResult, LoginError> {
    let raw = cookie.trim().to_string();
    if raw.is_empty() {
        return Err(LoginError::Fatal("没有拿到 CASTGC —— 请从浏览器复制一次再导入".into()));
    }

    let mut jar = Jar::new();
    jar.seed(&raw, &host_of(CAS));
    let login_url = format!("{CAS}/authserver/login?service={}", pct_encode(SERVICE));
    let res = send(
        "GET",
        &login_url,
        &[
            ("User-Agent", UA_DESKTOP.into()),
            ("Cookie", jar.header(&login_url)),
        ],
        None,
    )
    .map_err(LoginError::Fatal)?;
    jar.set(&res.set_cookie, &login_url);

    if res.status == 200 {
        let html = res.text();
        if is_gateway_block(&html) {
            return Err(LoginError::Retryable(
                "统一认证这一次没返回跳转，而是学校网关的「仅限校园网访问」提示页 —— 这个出口 IP 不在校园网允许范围内。".into(),
            ));
        }
        return Err(LoginError::Fatal(format!(
            "CASTGC 已经不被认可：统一认证没有换票，而是把登录页又发了一次（{} 字节）。它通常只有几天有效期，过期或在浏览器里退出过登录就会这样 —— 重新导入一次即可。",
            html.len()
        )));
    }

    if res.location.is_empty() {
        return Err(LoginError::Fatal(format!(
            "CASTGC 换票没有落到任何地址（status={}），请重新导入一次",
            res.status
        )));
    }

    match finish_with_ticket(&res.location, &mut jar) {
        Ok(r) => Ok(r),
        Err(LoginError::Retryable(m)) => Err(LoginError::Fatal(format!(
            "CASTGC 没有换来票据：{m}导入的会话大概率已经过期或被注销，重新导入一次即可。"
        ))),
        Err(e) => Err(e),
    }
}
