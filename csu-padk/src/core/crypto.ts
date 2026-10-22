/**
 * 请求体加解密 —— 逐字复刻 PC 端 http 封装
 *
 * 原始实现（来自 znzhxgpt_web / js/index-CtIQ-390.js）：
 *   yr = (t, r) => {
 *     const o = CryptoJS.enc.Utf8.parse(r);
 *     const s = { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 };
 *     return CryptoJS.DES.encrypt(JSON.stringify(t), o, s).ciphertext.toString();
 *   }
 *   ur = (t, r) => CryptoJS.DES.decrypt(
 *     { ciphertext: CryptoJS.enc.Hex.parse(t) },
 *     CryptoJS.enc.Utf8.parse(r),
 *     { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
 *   ).toString(CryptoJS.enc.Utf8);
 *
 * postDes(r, o) { const n = casual; const u = yr(o, n); return this.service.post(r, u, s) }
 *
 * 即：body = DES-ECB( JSON.stringify(payload), key = casual ) 的 Hex 字符串
 *
 * 本文件只管请求体的 DES 封装。casual 的生成在 core/kcipher.ts ——
 * 它与 CAS 登录共用同一份字符池，散成两处迟早会分叉。
 */
import CryptoJS from "crypto-js";

export function encryptPayload(data: unknown, casual: string): string {
  const key = CryptoJS.enc.Utf8.parse(casual);
  const opt = { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 };
  const out = CryptoJS.DES.encrypt(JSON.stringify(data), key, opt);
  return out.ciphertext.toString(CryptoJS.enc.Hex);
}

export function decryptPayload(hex: string, casual: string): string {
  const key = CryptoJS.enc.Utf8.parse(casual);
  const opt = { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 };
  const out = CryptoJS.DES.decrypt(
    // @ts-expect-error crypto-js 的 CipherParams 需要 CipherParams 实例
    { ciphertext: CryptoJS.enc.Hex.parse(hex) },
    key,
    opt
  );
  return out.toString(CryptoJS.enc.Utf8);
}
