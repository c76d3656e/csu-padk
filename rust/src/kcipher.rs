//! CAS 密码加密 —— 与 src/core/kcipher.ts 逐字节等价。
//!
//!   key  = salt.trim() 前 16 字节（AES-128）
//!   iv   = rand(16)
//!   data = rand(64) + password
//!   out  = base64( AES-128-CBC(data, key, iv) )   // PKCS7
//!
//! CBC 十几行手写，省掉一个 crate —— 这里只需要「一个方向、一条链」。

use aes::cipher::{generic_array::GenericArray, BlockEncrypt, KeyInit};
use aes::Aes128;
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::Rng;

/// 字符池（不含 I/L/O/0/1/9 等易混字符）
pub const AES_CHARS: &[u8] = b"ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
const CASUAL_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const KEY_LEN: usize = 16;

pub fn rand_str(n: usize, chars: &[u8]) -> String {
    let mut rng = rand::thread_rng();
    (0..n)
        .map(|_| chars[rng.gen_range(0..chars.len())] as char)
        .collect()
}

fn derive_key(salt: &str) -> Result<Vec<u8>, String> {
    let bytes = salt.trim().as_bytes();
    let key: &[u8] = &bytes[..bytes.len().min(KEY_LEN)];
    if key.len() != KEY_LEN {
        return Err(format!(
            "登录盐值长度异常：期望 {KEY_LEN} 字节，实得 {} 字节（salt={:?}）",
            key.len(),
            salt
        ));
    }
    Ok(key.to_vec())
}

/// AES-128-CBC + PKCS7
fn cbc_encrypt(key: &[u8], iv: &[u8], data: &[u8]) -> Vec<u8> {
    let mut buf = data.to_vec();
    let pad = 16 - buf.len() % 16;
    buf.extend(std::iter::repeat(pad as u8).take(pad));

    let cipher = Aes128::new(GenericArray::from_slice(key));
    let mut prev = [0u8; 16];
    prev[..iv.len().min(16)].copy_from_slice(&iv[..iv.len().min(16)]);

    let mut out = Vec::with_capacity(buf.len());
    for chunk in buf.chunks(16) {
        let mut blk = [0u8; 16];
        for i in 0..16 {
            blk[i] = chunk[i] ^ prev[i];
        }
        let mut ga = *GenericArray::from_slice(&blk);
        cipher.encrypt_block(&mut ga);
        out.extend_from_slice(&ga);
        prev.copy_from_slice(&ga);
    }
    out
}

/// 页面没给盐值时原实现直接提交明文，这里保持同一行为
pub fn encrypt_password(plain: &str, salt: &str) -> Result<String, String> {
    if salt.is_empty() {
        return Ok(plain.to_string());
    }
    let key = derive_key(salt)?;
    let iv = rand_str(16, AES_CHARS).into_bytes();
    let data = format!("{}{}", rand_str(64, AES_CHARS), plain).into_bytes();
    Ok(STANDARD.encode(cbc_encrypt(&key, &iv, &data)))
}

/// 固定 iv / 填充的确定性版本。存在的唯一理由：让「两套实现产出同一段密文」
/// 成为可断言的事实（对应 kcipher.ts 的 encryptPasswordFixed），业务路径不要用。
pub fn encrypt_password_fixed(
    plain: &str,
    salt: &str,
    iv: &str,
    pad64: &str,
) -> Result<String, String> {
    let key = derive_key(salt)?;
    let data = format!("{pad64}{plain}").into_bytes();
    Ok(STANDARD.encode(cbc_encrypt(&key, iv.as_bytes(), &data)))
}

/// 会话密钥 casual：16 位字母数字，登录时生成并与会话绑定
pub fn generate_casual(n: usize) -> String {
    rand_str(n, CASUAL_CHARS)
}
