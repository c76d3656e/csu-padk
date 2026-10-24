// 把 ../../dist 下的前端资源编成静态表，产物不依赖外部文件。
use std::path::{Path, PathBuf};

fn walk(dir: &Path, root: &Path, out: &mut Vec<(String, PathBuf)>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        if p.is_dir() { walk(&p, root, out); }
        else if p.is_file() {
            let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            out.push((rel, p));
        }
    }
}

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let dist = manifest.join("../dist");
    println!("cargo:rerun-if-changed={}", dist.display());

    let mut files = Vec::new();
    walk(&dist, &dist, &mut files);

    let mut s = String::from("/// 编译期嵌入的前端资源（键名与 URL 路径一致）\npub static ASSETS: &[(&str, &[u8])] = &[\n");
    for (rel, abs) in &files {
        s.push_str(&format!("    ({:?}, include_bytes!({:?})),\n", rel, abs.display().to_string()));
    }
    s.push_str("];\n");

    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("assets.rs");
    std::fs::write(out, s).unwrap();
}
