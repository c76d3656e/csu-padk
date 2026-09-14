//! CSU 平安打卡 · Tauri 后端
//!
//! 取代原来的 `server.mjs`：以前要靠本地 HTTP 服务做同源代理绕开 CORS，
//! 现在这些请求直接由 Rust 侧发出 —— 进程内的 HTTP 客户端不受浏览器
//! 同源策略约束，于是端口、代理、预检这些问题全都不存在了。
//!
//! 对外只暴露两个命令：
//!   cas_login  协议登录：用户名密码 → token / casual / 用户档案
//!   api_post   把页面上的业务请求（已是密文）转发到学校服务端

use aes::Aes128;
use base64::Engine;
use cbc::Encryptor as CbcEncryptor;
use cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const CAS: &str = "https://ca.csu.edu.cn";
const ZHXG: &str = "https://zhxg.csu.edu.cn";
const SERVICE: &str = "https://zhxg.csu.edu.cn/fdcwonsun/caslogin_h5.jsp";

// 登录页走桌面 UA；回调与换 token 走移动端 UA（官方 H5 的链路）
const UA_DESKTOP: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                          (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const UA_MOBILE: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) \
                         AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 \
                         MicroMessenger/8.0.40";

/// 金智加密用的可见字符集
const AES_CHARS: &[u8] = b"ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";

type Aes128CbcEnc = CbcEncryptor<Aes128>;

/* ────────────────────── 密码加密 ────────────────────── */

fn random_chars(n: usize) -> Vec<u8> {
    let mut rng = rand::thread_rng();
    (0..n)
        .map(|_| AES_CHARS[rng.gen_range(0..AES_CHARS.len())])
        .collect()
}

/// 复刻金智前端：随机 16 字符做 IV，随机 64 字符前置，AES-128-CBC + Pkcs7
fn encrypt_password(plain: &str, salt: &str) -> String {
    let key = salt.as_bytes();
    if key.len() != 16 {
        // salt 不是 16 字符时不做加密，与服务端的兜底行为一致
        return plain.to_string();
    }
    let iv = random_chars(16);

    let mut data = random_chars(64);
    data.extend_from_slice(plain.as_bytes());

    let ct = Aes128CbcEnc::new(key.into(), iv.as_slice().into())
        .encrypt_padded_vec_mut::<Pkcs7>(&data);

    base64::engine::general_purpose::STANDARD.encode(&ct)
}

/* ────────────────────── 登录 ────────────────────── */

#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub xh: String,
    pub xm: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bmmc: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LoginResult {
    pub token: String,
    pub casual: String,
    pub user: UserInfo,
}

/// 从 HTML 里抠一个字段；不引入正则，够用就行
fn pick(html: &str, marker: &str) -> Option<String> {
    let at = html.find(marker)?;
    let rest = &html[at + marker.len()..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// 生成 casual：16 位大小写字母 + 数字
fn generate_casual() -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..16)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // 自带 cookie jar：CAS 全程靠 JSESSIONID，手工搬运太容易错
        .cookie_store(true)
        // 自己跟随跳转，因为要在中途从 302 的 Location 里取 ticket
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败：{e}"))
}

/// 协议登录：把 CAS 的整套流程收敛成一次调用
///
/// 注意：定义在 lib.rs 里的命令**不能加 pub** —— Tauri 的胶水代码会生成
/// `__cmd__<name>` 宏，pub 会让它重复导出（E0255）。官方文档明确写了这条限制。
#[tauri::command]
async fn cas_login(username: String, password: String) -> Result<LoginResult, String> {
    let client = build_client()?;
    let login_url = format!("{CAS}/authserver/login?service={SERVICE}");

    // ① 取登录页，解析 salt 与 execution
    let res = client
        .get(&login_url)
        .header(reqwest::header::USER_AGENT, UA_DESKTOP)
        .send()
        .await
        .map_err(|e| format!("访问统一身份认证失败：{e}"))?;

    let html = res.text().await.map_err(|e| e.to_string())?;
    let salt = pick(&html, "id=\"pwdEncryptSalt\" value=\"").unwrap_or_default();
    let execution =
        pick(&html, "id=\"execution\" name=\"execution\" value=\"").unwrap_or_else(|| "e1s1".into());

    if salt.is_empty() {
        return Err("未能从登录页解析加密盐，页面结构可能已变更".into());
    }

    // ② 是否需要验证码（需要的话前端也没法处理，直接报错更清楚）
    let captcha_url = format!(
        "{CAS}/authserver/checkNeedCaptcha.htl?username={username}&_={}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let need_captcha = match client
        .get(&captcha_url)
        .header(reqwest::header::USER_AGENT, UA_DESKTOP)
        .send()
        .await
    {
        Ok(r) => r
            .text()
            .await
            .map(|t| t.contains("\"isNeed\":true"))
            .unwrap_or(false),
        Err(_) => false,
    };

    // ③ 提交登录
    let form = [
        ("username", username.clone()),
        ("password", encrypt_password(&password, &salt)),
        ("lt", String::new()),
        ("execution", execution),
        ("_eventId", "submit".into()),
        ("cllt", "userNameLogin".into()),
        ("dllt", "generalLogin".into()),
        ("captcha", String::new()),
        ("rmShown", "1".into()),
    ];

    let res = client
        .post(&login_url)
        .header(reqwest::header::USER_AGENT, UA_DESKTOP)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("提交登录失败：{e}"))?;

    if res.status().as_u16() != 302 {
        let body = res.text().await.unwrap_or_default();
        if need_captcha {
            return Err("该账号需要验证码，请在官方页面登录一次".into());
        }
        let tip = pick(&body, "id=\"showErrorTip\"")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "账号或密码不正确".into());
        return Err(tip);
    }

    // ④ 跟随回调，从页面里取 uid / lzc
    let mut cur = res
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if cur.starts_with('/') {
        cur = format!("{ZHXG}{cur}");
    }

    let mut body = String::new();
    for _ in 0..5 {
        if cur.is_empty() {
            break;
        }
        let r = match client
            .get(&cur)
            .header(reqwest::header::USER_AGENT, UA_MOBILE)
            .send()
            .await
        {
            Ok(r) => r,
            Err(_) => break,
        };
        let next = r
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let t = r.text().await.unwrap_or_default();
        if t.contains("uid") {
            body = t;
        }
        match next {
            Some(n) => cur = if n.starts_with('/') { format!("{ZHXG}{n}") } else { n },
            None => break,
        }
    }

    let uid = pick_loose(&body, "uid").ok_or("未取得登录凭据（uid）")?;
    let lzc = pick_loose(&body, "lzc").unwrap_or_default();

    // ⑤ 兑换 token
    let casual = generate_casual();
    let payload = serde_json::json!({
        "tyrzpt": "1",
        "channeld": "1",
        "yhzh": urlencode(&urlencode(&uid)),
        "lzc": urlencode(&urlencode(&lzc)),
        "caasual": casual,
    });

    let r5 = client
        .post(format!("{ZHXG}/znzhxgpt/basesys/rbac-yh/login-other"))
        .header(reqwest::header::CONTENT_TYPE, "application/json;charset=UTF-8")
        .header("deviceType", "4")
        .header("AppCode", "znzhxgpt")
        .header(reqwest::header::USER_AGENT, UA_MOBILE)
        .header(reqwest::header::ORIGIN, ZHXG)
        .header(reqwest::header::REFERER, format!("{ZHXG}/znzhxgpt_h5/"))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("换取 token 失败：{e}"))?;

    let j: serde_json::Value = r5.json().await.map_err(|e| e.to_string())?;
    let data = j.get("data").ok_or_else(|| {
        j.get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("换取 token 失败")
            .to_string()
    })?;
    let token = data
        .get("token")
        .and_then(|t| t.as_str())
        .ok_or("响应里没有 token")?
        .to_string();

    // 院系名藏在 JWT 的 user_info 里，解不出来也不影响使用
    let bmmc = decode_bmmc(&token);

    Ok(LoginResult {
        token,
        casual,
        user: UserInfo {
            xh: data.get("yhzh").and_then(|v| v.as_str()).unwrap_or("").into(),
            xm: data.get("yhxm").and_then(|v| v.as_str()).unwrap_or("").into(),
            bmmc,
        },
    })
}

/// 页面里的 uid / lzc 是 `uid = 'xxx'` 或 `uid: "xxx"` 两种写法
fn pick_loose(body: &str, key: &str) -> Option<String> {
    for sep in [" = ", "=", ": "] {
        let marker = format!("{key}{sep}");
        if let Some(at) = body.find(&marker) {
            let rest = body[at + marker.len()..].trim_start();
            let quote = rest.chars().next()?;
            if quote == '\'' || quote == '"' {
                let inner = &rest[1..];
                if let Some(end) = inner.find(quote) {
                    return Some(inner[..end].to_string());
                }
            }
        }
    }
    None
}

/// 从 JWT payload 里取院系名
fn decode_bmmc(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(payload))
        .ok()?;
    let json: serde_json::Value = serde_json::from_slice(&raw).ok()?;
    let info = json.get("user_info")?.as_str()?;
    let parsed: serde_json::Value = serde_json::from_str(info).ok()?;
    parsed.get("bmmc")?.as_str().map(|s| s.to_string())
}

/// 最小化的 percent-encode（只处理会破坏 URL 的字符）
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/* ────────────────────── 业务请求转发 ────────────────────── */

#[derive(Deserialize)]
pub struct PostArgs {
    /// 形如 /znzhxgpt/qxj/qxj-padkglxx/queryKqDkbc
    pub path: String,
    pub token: String,
    /// 前端已经用 casual 加密好的密文（DES-ECB Hex）
    pub body: String,
    #[serde(default)]
    pub agent_id: String,
}

/// 转发页面的业务请求。密文在前端生成，这里只负责发出去并带回响应。
/// 同样不能加 pub，原因见 cas_login 上方。
#[tauri::command]
async fn api_post(args: PostArgs) -> Result<String, String> {
    let client = build_client()?;
    let url = format!("{ZHXG}{}", args.path);

    let res = client
        .post(&url)
        .header(reqwest::header::CONTENT_TYPE, "application/json; charset=utf-8")
        .header("deviceType", "4")
        .header("AppCode", "znzhxgpt")
        .header("Authorization", args.token.clone())
        .header("token", args.token)
        .header("agentId", args.agent_id)
        .body(args.body)
        .send()
        .await
        .map_err(|e| format!("请求失败：{e}"))?;

    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;

    if status == 400 {
        return Err("请求被拒绝（加密密钥 casual 不匹配，请重新登录）".into());
    }
    Ok(text)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![cas_login, api_post])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
