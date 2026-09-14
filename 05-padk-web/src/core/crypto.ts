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
 */
import CryptoJS from "crypto-js";

export function encryptPayload(data: unknown, casual: string): string {
  const key = CryptoJS.enc.Utf8.parse(casual);
  const opt = { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 };
  // @ts-expect-error crypto-js 的 DES 类型定义不完整
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

/** 前端生成 casual（复刻 H5 端 generatekey(16)） */
export function generateCasual(len = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
