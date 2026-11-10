// Google ドライブに置くものの包み方（docs/SYNC.md §3）。パソコン（main）と iPad のアプリの両方で使う。副作用なし。
// - 形：'PNV1'（4 バイト）＋使い捨ての番号（24 バイト）＋ XChaCha20-Poly1305 の暗号文
// - 付随データ（AAD）に置き場の名前を入れる：ほかの名前の中身とすり替えられても開けない
// - 鍵（32 バイト）は、元の鍵から用途ごとに HMAC-SHA256 で作ったもの（作るのは各端末。パソコンは main/cloud/keys.js）
import {xchacha20poly1305} from '@noble/ciphers/chacha.js';

export const VAULT_MAGIC = 'PNV1';
export const VAULT_KEY_BYTES = 32;
const NONCE = 24;
const HEAD = 4 + NONCE;
const enc = new TextEncoder();

const random = (n) => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
};
const checkKey = (key) => {
  if (!(key instanceof Uint8Array) || key.length !== VAULT_KEY_BYTES) throw new Error('鍵が不正です');
};

/** 包む。name は置き場の名前（開くときも同じ名前が要る） */
export function sealBlob(key, bytes, name) {
  checkKey(key);
  if (!(bytes instanceof Uint8Array)) throw new Error('中身が不正です');
  const nonce = random(NONCE);
  const ct = xchacha20poly1305(key, nonce, enc.encode(String(name))).encrypt(bytes);
  const out = new Uint8Array(HEAD + ct.length);
  out.set(enc.encode(VAULT_MAGIC), 0);
  out.set(nonce, 4);
  out.set(ct, HEAD);
  return out;
}

/** 開く。鍵・名前が違う、書き換えられたときは Error */
export function openBlob(key, blob, name) {
  checkKey(key);
  if (!(blob instanceof Uint8Array) || blob.length < HEAD + 16) throw new Error('中身が不正です');
  if (String.fromCharCode(...blob.subarray(0, 4)) !== VAULT_MAGIC)
    throw new Error('パレットノートの暗号化した中身ではありません');
  try {
    return xchacha20poly1305(key, blob.subarray(4, HEAD), enc.encode(String(name))).decrypt(blob.subarray(HEAD));
  } catch {
    throw new Error('鍵が違うか、中身が壊れています');
  }
}

/** JSON を包む・開く（目録） */
export const sealJson = (key, value, name) => sealBlob(key, enc.encode(JSON.stringify(value)), name);
export const openJson = (key, blob, name) => JSON.parse(new TextDecoder().decode(openBlob(key, blob, name)));
