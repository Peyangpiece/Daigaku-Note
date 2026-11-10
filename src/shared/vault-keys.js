// Google ドライブに置くものの鍵（docs/SYNC.md §3）。パソコン（main/cloud/keys.js）と iPad のアプリの両方で使う。副作用なし。
// 元の鍵（32 バイト）から、用途ごとの鍵を HMAC-SHA256 で作る。iPad の画面には node:crypto がないので @noble/hashes で計算する
import {hmac} from '@noble/hashes/hmac.js';
import {sha256} from '@noble/hashes/sha2.js';
import {VAULT_KEY_BYTES} from './vault.js';

const enc = new TextEncoder();
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const checkMaster = (master) => {
  if (!(master instanceof Uint8Array) || master.length !== VAULT_KEY_BYTES) throw new Error('鍵が不正です');
};

/** 用途ごとの鍵：enc（中身を包む）・name（資料の名前を作る） */
export function deriveKeys(master) {
  checkMaster(master);
  const k = (label) => hmac(sha256, master, enc.encode(`palette-note/${label}`));
  return {enc: k('enc'), name: k('name')};
}

/** 資料の置き場の名前：中身のハッシュを名前の鍵で HMAC したもの（同じ中身は 1 度だけ送る。Google から中身のハッシュは分からない） */
export const blobName = (nameKey, bytes) => `f-${hex(hmac(sha256, nameKey, sha256(bytes))).slice(0, 40)}`;

/** 鍵の指紋（画面に出して、パソコンと iPad で同じ鍵か確かめる。鍵そのものは分からない） */
export function fingerprint(master) {
  checkMaster(master);
  const h = sha256.create();
  h.update(master);
  h.update(enc.encode('palette-note/fingerprint'));
  return hex(h.digest()).slice(0, 8).toUpperCase();
}

// ---- 鍵を iPad に渡す QR（パソコンの 設定 → データ → Google ドライブ。docs/SYNC.md §3）----
export const KEY_QR_PREFIX = 'palettenote-key:1:';

const b64url = (b) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64url = (s) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

/** QR の中身：印・鍵・指紋 */
export const keyQr = (master) => `${KEY_QR_PREFIX}${b64url(master)}:${fingerprint(master)}`;

/** QR の中身 → 鍵（形が違う・指紋が合わない（読み違え）ときは null） */
export function readKeyQr(text) {
  const s = String(text ?? '').trim();
  if (!s.startsWith(KEY_QR_PREFIX)) return null;
  const [k, fp] = s.slice(KEY_QR_PREFIX.length).split(':');
  try {
    const master = fromB64url(k ?? '');
    if (master.length !== VAULT_KEY_BYTES || fingerprint(master) !== fp) return null;
    return master;
  } catch {
    return null;
  }
}
