//! URL / 编码小工具。不引 url crate —— 这里只需要极少几件事。

/// 取 URL 的 host（小写，不含端口）
pub fn host_of(url: &str) -> String {
    let rest = match url.split_once("://") {
        Some((_, r)) => r,
        None => return String::new(),
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host);
    host.to_ascii_lowercase()
}

/// 相对落点补成绝对地址：以 "/" 开头的拼到 base 源站上
pub fn resolve(base_origin: &str, loc: &str) -> String {
    if loc.starts_with("http://") || loc.starts_with("https://") {
        loc.to_string()
    } else if loc.starts_with('/') {
        format!("{base_origin}{loc}")
    } else {
        loc.to_string()
    }
}

/// 取查询参数，等价于 new URL(u).searchParams.get(k)
pub fn query_param(url: &str, key: &str) -> String {
    let q = match url.split_once('?') {
        Some((_, q)) => q,
        None => return String::new(),
    };
    let q = q.split('#').next().unwrap_or(q);
    for kv in q.split('&') {
        let (k, v) = match kv.split_once('=') {
            Some(x) => x,
            None => (kv, ""),
        };
        if pct_decode(k) == key {
            return pct_decode(v);
        }
    }
    String::new()
}

/// 等价 encodeURIComponent
pub fn pct_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(*b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

pub fn pct_decode(s: &str) -> String {
    let bs = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bs.len());
    let mut i = 0;
    while i < bs.len() {
        if bs[i] == b'%' && i + 2 < bs.len() {
            let hex = std::str::from_utf8(&bs[i + 1..i + 3]).unwrap_or("");
            if let Ok(v) = u8::from_str_radix(hex, 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(if bs[i] == b'+' { b' ' } else { bs[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 按字符截断，用于诊断文案（不能按字节切，否则会把 UTF-8 切坏）
pub fn take_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}
