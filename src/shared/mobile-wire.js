// スマホ連携（docs/MOBILE.md §3）のやりとりの形。パソコン（main）とスマホのページの両方で使う。副作用なし。
// - 中身は JSON（バイト列は {"$b": base64}）。それを端末ごとの鍵で XChaCha20-Poly1305 で暗号化する（@noble/ciphers。
//   スマホのページは HTTPS でないので WebCrypto が使えない）
// - 送るバイト列は「使い捨ての番号（24 バイト）＋暗号文」。番号は毎回乱数で作る
import {xchacha20poly1305} from '@noble/ciphers/chacha.js';

export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const MAX_SKEW_MS = 5 * 60 * 1000; // 時刻のずれの許し（これより古い・先の要求は受け付けない）

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const REV = new Int16Array(128).fill(-1);
for (let i = 0; i < ABC.length; i++) REV[ABC.charCodeAt(i)] = i;
REV['+'.charCodeAt(0)] = 62;
REV['/'.charCodeAt(0)] = 63;

/** バイト列 → base64url（= なし） */
export function toB64(bytes) {
  let out = '';
  const n = bytes.length;
  const parts = [];
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i],
      b = i + 1 < n ? bytes[i + 1] : 0,
      c = i + 2 < n ? bytes[i + 2] : 0;
    const t = (a << 16) | (b << 8) | c;
    out += ABC[(t >> 18) & 63] + ABC[(t >> 12) & 63];
    if (i + 1 < n) out += ABC[(t >> 6) & 63];
    if (i + 2 < n) out += ABC[t & 63];
    if (out.length > 8192) {
      parts.push(out);
      out = '';
    }
  }
  parts.push(out);
  return parts.join('');
}

/** base64url（または base64）→ バイト列。形が悪ければ投げる */
export function fromB64(s) {
  const str = String(s).replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((str.length * 3) / 4));
  let o = 0,
    acc = 0,
    bits = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const v = code < 128 ? REV[code] : -1;
    if (v < 0) throw new Error('base64 の形が不正です');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return out.subarray(0, o);
}

/** 値を JSON の文字列にする。Uint8Array（と Node の Buffer）は {"$b": base64url} に */
export function pack(value) {
  return JSON.stringify(value, (_k, v) => {
    if (v instanceof Uint8Array) return {$b: toB64(v)};
    if (v && v.type === 'Buffer' && Array.isArray(v.data)) return {$b: toB64(Uint8Array.from(v.data))};
    return v;
  });
}

/** pack の逆 */
export function unpack(text) {
  return JSON.parse(text, (_k, v) =>
    v && typeof v === 'object' && typeof v.$b === 'string' && Object.keys(v).length === 1 ? fromB64(v.$b) : v
  );
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** 乱数のバイト列（ブラウザ・Node とも crypto.getRandomValues。HTTPS でなくても使える） */
export function randomBytes(n) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536))); // 1 回 64KB まで
  return b;
}

/** 値を暗号化する：使い捨ての番号＋暗号文のバイト列 */
export function seal(key, value) {
  const nonce = randomBytes(NONCE_BYTES);
  const ct = xchacha20poly1305(key, nonce).encrypt(enc.encode(pack(value)));
  const out = new Uint8Array(NONCE_BYTES + ct.length);
  out.set(nonce, 0);
  out.set(ct, NONCE_BYTES);
  return out;
}

/** seal の逆。鍵が違う・書き換えられていれば投げる。戻りは {value, nonce}（番号は送り直しの見張りに使う） */
export function open(key, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length <= NONCE_BYTES + 16) throw new Error('中身が不正です');
  const nonce = bytes.subarray(0, NONCE_BYTES);
  const pt = xchacha20poly1305(key, nonce).decrypt(bytes.subarray(NONCE_BYTES));
  return {value: unpack(dec.decode(pt)), nonce: toB64(nonce)};
}

/** QR に入れるスマホの入口の URL（鍵は # の後ろ。サーバーには送られない） */
export const pairUrl = ({host, port, deviceId, key}) => `http://${host}:${port}/m/#d=${deviceId}&k=${toB64(key)}`;

/** pairUrl の # の後ろを読む。形が悪ければ null */
export function readPairHash(hash) {
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  const deviceId = p.get('d');
  const k = p.get('k');
  if (!deviceId || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(deviceId) || !k) return null;
  try {
    const key = fromB64(k);
    return key.length === KEY_BYTES ? {deviceId, key} : null;
  } catch {
    return null;
  }
}
