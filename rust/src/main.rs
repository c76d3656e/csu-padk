/*!
 * 平安打卡 · 服务端（Rust 版）
 *
 * 单文件可执行：前端资源编译期内嵌，不依赖 Node、不依赖任何外部文件。
 * 默认绑 0.0.0.0，拉起来即可对外提供服务：
 *
 *   padk.exe                 http://0.0.0.0:5173/
 *   PORT=8080 padk.exe       换端口
 *   HOST=127.0.0.1 padk.exe  只允许本机访问
 */
mod cas;
mod jar;
mod kcipher;
mod util;

use axum::{
    body::Body,
    extract::Request,
    http::{header, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use std::net::SocketAddr;

use util::pct_decode;

include!(concat!(env!("OUT_DIR"), "/assets.rs"));

const INDEX: &str = "index.html";
const PROXY_PREFIX: &str = "/znzhxgpt/";
const LOGIN_PATH: &str = "/__auth/login";

fn mime_of(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("");
    match ext {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn find(key: &str) -> Option<&'static [u8]> {
    ASSETS.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

fn serve_asset(key: &str) -> Response {
    match find(key) {
        Some(bytes) => {
            let mut resp = Response::new(Body::from(bytes));
            let h = resp.headers_mut();
            h.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime_of(key)));
            let base = key.rsplit('/').next().unwrap_or(key);
            let hashed = base
                .rsplit_once('-')
                .map(|(_, tail)| {
                    let stem = tail.split('.').next().unwrap_or("");
                    stem.len() >= 8
                })
                .unwrap_or(false)
                && (key.ends_with(".js") || key.ends_with(".css"));
            h.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static(if hashed {
                    "public, max-age=31536000, immutable"
                } else {
                    "no-cache"
                }),
            );
            resp
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn static_handler(req: Request) -> Response {
    let path = pct_decode(req.uri().path());
    let key = path.trim_start_matches('/');
    if key.is_empty() {
        return serve_asset(INDEX);
    }
    if key.contains("..") {
        return StatusCode::FORBIDDEN.into_response();
    }
    if find(key).is_some() {
        return serve_asset(key);
    }
    // 带扩展名却是没命中：真 404，别把 index.html 当 js 吐回去
    let last = key.rsplit('/').next().unwrap_or("");
    if last.contains('.') {
        return StatusCode::NOT_FOUND.into_response();
    }
    // 其余交给前端路由
    serve_asset(INDEX)
}

/* ───────────── 登录 ───────────── */

fn json_resp(v: serde_json::Value, status: StatusCode) -> Response {
    let mut resp = Response::new(Body::from(v.to_string()));
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    if status != StatusCode::OK {
        *resp.status_mut() = status;
    }
    resp
}

async fn login(req: Request) -> Response {
    if req.method() != Method::POST {
        let mut resp = Response::new(Body::from("Method Not Allowed"));
        *resp.status_mut() = StatusCode::METHOD_NOT_ALLOWED;
        resp.headers_mut()
            .insert(header::ALLOW, HeaderValue::from_static("POST"));
        return resp;
    }

    let body = match axum::body::to_bytes(req.into_body(), 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return json_resp(
            serde_json::json!({ "ok": false, "error": "请求体读取失败" }),
            StatusCode::BAD_REQUEST,
        ),
    };
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
    if !v.is_object() {
        return json_resp(
            serde_json::json!({ "ok": false, "error": "请求体不是合法 JSON" }),
            StatusCode::BAD_REQUEST,
        );
    }
    let get = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let castgc = get("castgc");
    let username = get("username");
    let password = get("password");

    if castgc.trim().is_empty() && (username.trim().is_empty() || password.is_empty()) {
        return json_resp(
            serde_json::json!({ "ok": false, "error": "缺少账号或密码，也没有可复用的会话凭据" }),
            StatusCode::BAD_REQUEST,
        );
    }

    let out = tokio::task::spawn_blocking(move || {
        if !castgc.trim().is_empty() {
            cas::castgc_login(&castgc)
        } else {
            cas::protocol_login(username.trim(), &password)
        }
    })
    .await;

    match out {
        Ok(Ok(r)) => {
            let mut obj = serde_json::json!({
                "ok": true,
                "token": r.token,
                "casual": r.casual,
                "user": {
                    "xh": r.user.xh,
                    "xm": r.user.xm,
                    "bmid": r.user.bmid,
                    "bmmc": r.user.bmmc,
                },
            });
            if let Some(t) = r.castgc {
                obj["castgc"] = serde_json::Value::String(t);
            }
            json_resp(obj, StatusCode::OK)
        }
        Ok(Err(e)) => {
            if e.is_mfa() {
                let official = format!(
                    "{}/authserver/login?service={}",
                    cas::CAS,
                    util::pct_encode(cas::SERVICE)
                );
                json_resp(
                    serde_json::json!({
                        "ok": false,
                        "error": e.message(),
                        "needMfa": true,
                        "officialUrl": official,
                    }),
                    StatusCode::OK,
                )
            } else {
                json_resp(
                    serde_json::json!({ "ok": false, "error": e.message() }),
                    StatusCode::OK,
                )
            }
        }
        Err(_) => json_resp(
            serde_json::json!({ "ok": false, "error": "登录任务异常终止" }),
            StatusCode::OK,
        ),
    }
}

/* ───────────── 同源转发 ───────────── */

const DROP_REQ_HEADERS: &[&str] = &[
    "host",
    "accept-encoding",
    "content-length",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "proxy-connection",
];

async fn proxy(req: Request) -> Response {
    let (parts, body) = req.into_parts();
    let method = parts.method.as_str().to_string();
    let pq = parts
        .uri
        .path_and_query()
        .map(|x| x.as_str().to_string())
        .unwrap_or_else(|| "/".to_string());
    let target = format!("{}{}", cas::ZHXG, pq);

    let mut headers: Vec<(String, String)> = Vec::new();
    for (k, v) in parts.headers.iter() {
        let name = k.as_str().to_ascii_lowercase();
        if DROP_REQ_HEADERS.contains(&name.as_str()) {
            continue;
        }
        if let Ok(val) = v.to_str() {
            headers.push((name, val.to_string()));
        }
    }

    let payload = match axum::body::to_bytes(body, 8 * 1024 * 1024).await {
        Ok(b) => b.to_vec(),
        Err(_) => {
            return text_resp(StatusCode::BAD_REQUEST, "请求体过大或读取失败".to_string());
        }
    };
    let send_body = if method == "GET" || method == "HEAD" {
        None
    } else {
        Some(payload)
    };

    let out = tokio::task::spawn_blocking(move || -> Result<(u16, Vec<(String, String)>, Vec<u8>), String> {
        let reqs: Vec<(&str, String)> = headers
            .iter()
            .map(|(k, v)| (k.as_str(), v.clone()))
            .collect();
        let r = cas::send(&method, &target, &reqs, send_body)?;

        // 压缩与长度由本层重新决定，上游那两个头一律不透传
        let mut out_headers: Vec<(String, String)> = Vec::new();
        out_headers.push((
            "content-type".to_string(),
            if r.content_type.is_empty() {
                "application/octet-stream".to_string()
            } else {
                r.content_type.clone()
            },
        ));
        for c in &r.set_cookie {
            out_headers.push(("set-cookie".to_string(), c.clone()));
        }
        Ok((r.status, out_headers, r.body))
    })
    .await;

    match out {
        Ok(Ok((status, hs, body))) => {
            let mut resp = Response::new(Body::from(body));
            *resp.status_mut() = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
            for (k, v) in hs {
                if let (Ok(name), Ok(val)) = (
                    header::HeaderName::try_from(k.as_str()),
                    HeaderValue::try_from(v.as_str()),
                ) {
                    resp.headers_mut().append(name, val);
                }
            }
            resp.headers_mut().insert(
                header::ACCESS_CONTROL_ALLOW_ORIGIN,
                HeaderValue::from_static("*"),
            );
            resp
        }
        Ok(Err(e)) => text_resp(StatusCode::BAD_GATEWAY, format!("上游请求失败：{e}")),
        Err(_) => text_resp(StatusCode::BAD_GATEWAY, "上游请求异常终止".to_string()),
    }
}

fn text_resp(status: StatusCode, body: String) -> Response {
    let mut resp = Response::new(Body::from(body));
    *resp.status_mut() = status;
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    resp
}

async fn dispatch(req: Request) -> Response {
    let path = req.uri().path().to_string();
    if path.starts_with(PROXY_PREFIX) {
        return proxy(req).await;
    }
    static_handler(req).await
}

/* ───────────── 启动 ───────────── */

/// 虚拟网卡 / 隧道网卡：列出来只会让人点错。
/// VMware、VirtualBox、Hyper-V、WSL、Clash TUN 在本机全是 192.168.x 或 172.x，
/// 表面上和外网卡长得一模一样。
fn is_virtual(name: &str) -> bool {
    let n = name.to_lowercase();
    [
        "vmware", "virtualbox", "vethernet", "hyper-v", "wsl", "loopback", "bluetooth", "tap-",
        "tun", "vpn", "zerotier", "tailscale", "docker", "br-",
    ]
    .iter()
    .any(|k| n.contains(k))
}

/// 枚举本机 IPv4，用于打印「别人该怎么访问」。
///
/// 走系统接口表（if-addrs → getifaddrs），不解析 ipconfig 文本：
/// ipconfig 的输出是 OEM 代码页，中文适配器名在 UTF-8 里会变成替换字符，
/// 而且子网掩码、默认网关、DNS 也是四段点分，按文本行捞地址两者都会混进来。
fn lan_ips() -> Vec<String> {
    let mut ips: Vec<String> = Vec::new();
    let Ok(ifs) = if_addrs::get_if_addrs() else { return ips };
    for itf in ifs {
        if itf.is_loopback() || is_virtual(&itf.name) {
            continue;
        }
        let if_addrs::IfAddr::V4(v4) = itf.addr else { continue };
        let ip = v4.ip.to_string();
        if ip.starts_with("169.254.") || ip.starts_with("198.18.") || ip.starts_with("198.19.") {
            continue;
        }
        if !ips.contains(&ip) {
            ips.push(ip);
        }
    }
    ips
}

#[tokio::main]
async fn main() {
    // 与 kcipher.ts 的 encryptPasswordFixed 对照用：固定 iv / 填充，输出应是同一段密文
    if std::env::args().any(|a| a == "--aes-selftest") {
        let pad = "x".repeat(64);
        let ct =
            kcipher::encrypt_password_fixed("password123", "ti7cp2M5QrePvTOj", "0123456789abcdef", &pad)
                .unwrap();
        println!("ct={ct}");
        return;
    }

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(5173);
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());

    let app = Router::new()
        .route(LOGIN_PATH, post(login))
        .fallback(dispatch);

    let addr: SocketAddr = match format!("{host}:{port}").parse() {
        Ok(a) => a,
        Err(_) => {
            eprintln!("监听地址不合法：{host}:{port}");
            std::process::exit(2);
        }
    };

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("\n  端口 {port} 起不来（{e}）。换个端口：PORT=8080 padk.exe\n");
            std::process::exit(1);
        }
    };

    println!();
    println!("  平安打卡 · 服务已启动");
    println!("  本机   http://127.0.0.1:{port}/");
    if host == "0.0.0.0" || host == "::" {
        for ip in lan_ips() {
            println!("  对外   http://{ip}:{port}/");
        }
        println!("  监听   {host}:{port}（同网段/公网可达，防火墙要放行）");
    } else {
        println!("  监听   {host}:{port}");
    }
    println!("  登录   POST {LOGIN_PATH}");
    println!("  转发   {PROXY_PREFIX}**");
    println!(
        "  静态   {} 个文件已内嵌，{} 个工作线程",
        ASSETS.len(),
        std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4)
    );
    println!("  Ctrl+C 停止");
    println!();

    if std::env::var("PADK_OPEN").ok().as_deref() == Some("1") && !cfg!(windows) {
        let _ = std::process::Command::new("xdg-open")
            .arg(format!("http://127.0.0.1:{port}/"))
            .spawn();
    }

    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
        println!("  正在停止…");
    };

    if let Err(e) = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
    {
        eprintln!("服务异常退出：{e}");
    }
}
