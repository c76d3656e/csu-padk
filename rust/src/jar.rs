//! 域感知 cookie jar —— 与 src/core/casLogin.ts 的 Jar 行为一致。
//!
//! 必须按域分发：统一认证的会话 cookie（CASTGC）属于 ca.csu.edu.cn，
//! 而回调页在 zhxg.csu.edu.cn。混着发，回调页就拿不到自己的会话。

use crate::util::host_of;

#[derive(Clone, Debug)]
struct Cookie {
    name: String,
    value: String,
    domain: String,
    path: String,
}

#[derive(Default)]
pub struct Jar {
    m: Vec<Cookie>,
}

impl Jar {
    pub fn new() -> Self {
        Self { m: Vec::new() }
    }

    /// 记下响应里的 Set-Cookie；url 用于推断没写 Domain 属性时的默认域
    pub fn set(&mut self, lines: &[String], url: &str) {
        let host = host_of(url);
        for line in lines {
            let mut parts = line.split(';');
            let pair = parts.next().unwrap_or("");
            let (name, value) = match pair.split_once('=') {
                Some((n, v)) if !n.trim().is_empty() => (n.trim().to_string(), v.trim().to_string()),
                _ => continue,
            };
            let mut domain = host.clone();
            let mut path = "/".to_string();
            for attr in parts {
                let (k, v) = match attr.split_once('=') {
                    Some((k, v)) => (k.trim().to_ascii_lowercase(), v.trim().to_string()),
                    None => (attr.trim().to_ascii_lowercase(), String::new()),
                };
                if k == "domain" && !v.is_empty() {
                    domain = v.trim_start_matches('.').to_ascii_lowercase();
                } else if k == "path" && !v.is_empty() {
                    path = v;
                }
            }
            if domain.is_empty() {
                continue;
            }
            let next = Cookie { name, value, domain, path };
            match self
                .m
                .iter()
                .position(|c| c.name == next.name && c.domain == next.domain && c.path == next.path)
            {
                Some(at) => self.m[at] = next,
                None => self.m.push(next),
            }
        }
    }

    /// 该 URL 该带的 cookie：域后缀匹配 + 路径前缀匹配，长路径优先
    pub fn header(&self, url: &str) -> String {
        let host = host_of(url);
        if host.is_empty() {
            return String::new();
        }
        let path = {
            let rest = match url.split_once("://") {
                Some((_, r)) => r,
                None => "",
            };
            let after_authority = rest.find('/').map(|i| &rest[i..]).unwrap_or("/");
            after_authority
                .split(['?', '#'])
                .next()
                .unwrap_or("/")
                .to_string()
        };
        let mut hit: Vec<&Cookie> = self
            .m
            .iter()
            .filter(|c| {
                let d = c.domain.trim_start_matches('.');
                let domain_ok = host == d || host.ends_with(&format!(".{d}"));
                let prefix = if c.path.ends_with('/') {
                    c.path.clone()
                } else {
                    format!("{}/", c.path)
                };
                let path_ok = c.path == "/" || path == c.path || path.starts_with(&prefix);
                domain_ok && path_ok
            })
            .collect();
        hit.sort_by(|a, b| b.path.len().cmp(&a.path.len()));
        hit.iter()
            .map(|c| format!("{}={}", c.name, c.value))
            .collect::<Vec<_>>()
            .join("; ")
    }

    /// 把外部导入的 cookie 串挂到指定域上
    pub fn seed(&mut self, raw: &str, host: &str) {
        for part in raw.split(';') {
            let (name, value) = match part.split_once('=') {
                Some((n, v)) => (n.trim().to_string(), v.trim().to_string()),
                None => continue,
            };
            if name.is_empty() || value.is_empty() {
                continue;
            }
            let next = Cookie {
                name,
                value,
                domain: host.to_string(),
                path: "/".to_string(),
            };
            match self
                .m
                .iter()
                .position(|c| c.name == next.name && c.domain == next.domain && c.path == next.path)
            {
                Some(at) => self.m[at] = next,
                None => self.m.push(next),
            }
        }
    }

    /// 取某个 cookie 的值；只用于回传前端，不进任何日志
    pub fn value(&self, name: &str) -> String {
        self.m
            .iter()
            .find(|c| c.name == name)
            .map(|c| c.value.clone())
            .unwrap_or_default()
    }

    /// 只报名字，值永远不外泄 —— 诊断文案要能贴进工单
    pub fn names(&self) -> String {
        let mut seen: Vec<&str> = Vec::new();
        for c in &self.m {
            if !seen.contains(&c.name.as_str()) {
                seen.push(&c.name);
            }
        }
        if seen.is_empty() {
            "无".to_string()
        } else {
            seen.join(",")
        }
    }
}
