/**
 * CAS 密码加密 —— 唯一实现
 *
 * 三个运行时共用同一份代码：
 *   server.mjs        本机形态（Node）
 *   vite.casAuth.ts   开发服务器登录中间件（Node）
 *   src/edge/worker.js  Cloudflare / Vercel 边缘函数
 *
 * 只用跨运行时都存在的 Web API：crypto.subtle + TextEncoder + btoa。
 * Node 20.12+ 的 globalThis.crypto 就是 WebCrypto，与边缘运行时完全同源，
 * 所以同一份代码在两边产出的密文逐字节相同（由 npm run verify 断言）。
 *
 * 算法：
 *   key  = salt.trim() 前 16 个字符（AES-128）
 *   iv   = rand(16)
 *   data = rand(64) + password
 *   out  = base64( AES-128-CBC( data, key, iv ) )    // WebCrypto 自带 PKCS7
 *
 * rand 用 Math.random 是刻意保留：这两个值只影响密文形态，不影响服务端
 * 能否解开，换成强随机源不会带来任何安全或功能收益。
 */

/** 字符池（不含 I/L/O/0/1/9 等易混字符） */
export const AES_CHARS = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";

export function rand(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += AES_CHARS.charAt(Math.floor(Math.random() * AES_CHARS.length));
  return s;
}

const enc = new TextEncoder();
const AES_KEY_BYTES = 16;

/**
 * 派生 AES-128 密钥：按字符截断，与学校前端行为一致。
 *
 * 长度不为 16 字节时 WebCrypto 只会抛 "Invalid key length"，
 * 看不出是盐值的问题 —— 这里换成能直接定位的报错。
 */
function deriveKey(salt: string) {
  const key = enc.encode(salt.trim().slice(0, AES_KEY_BYTES));
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(
      `登录盐值长度异常：期望 ${AES_KEY_BYTES} 字节，实得 ${key.length} 字节（salt=${JSON.stringify(salt)}）`
    );
  }
  return key;
}

/** base64(Uint8Array) —— 不用 Buffer，边缘运行时里没有 */
function b64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export async function encryptPassword(plain: string, salt: string): Promise<string> {
  // 页面没给出盐值时原实现直接提交明文，这里保持同一行为
  if (!salt) return plain;
  const key = await crypto.subtle.importKey("raw", deriveKey(salt), { name: "AES-CBC" }, false, [
    "encrypt",
  ]);
  const iv = enc.encode(rand(16));
  const data = enc.encode(rand(64) + plain);
  const ct = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, data);
  return b64(new Uint8Array(ct));
}

/**
 * 固定 iv / 填充的确定性版本。
 *
 * 存在的唯一理由：让「两个运行时产出同一段密文」成为可断言的事实。
 * 仅供测试调用，业务路径不要用。
 */
export async function encryptPasswordFixed(
  plain: string,
  salt: string,
  ivStr: string,
  pad64: string
): Promise<string> {
  const key = await crypto.subtle.importKey("raw", deriveKey(salt), { name: "AES-CBC" }, false, [
    "encrypt",
  ]);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: enc.encode(ivStr) },
    key,
    enc.encode(pad64 + plain)
  );
  return b64(new Uint8Array(ct));
}

/** 会话密钥 casual：16 位字母数字，登录时生成、随登录请求提交并与会话绑定 */
export function generateCasual(n = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
