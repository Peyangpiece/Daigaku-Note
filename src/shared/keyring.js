// 鍵を合言葉で包んで、Google ドライブに置く（docs/SYNC.md §9）。パソコンと iPad の両方で使う。副作用なし。
// - 合言葉から「包む鍵」を scrypt で作る（時間とメモリのかかる計算：合言葉を総当たりで当てられにくくする）
// - 元の鍵（32 バイト）を、包む鍵で XChaCha20-Poly1305 で包む（vault.js の sealBlob。名前は keyring）
// - ドライブに置くのは、包んだ鍵・scrypt の条件・鍵の印だけ（合言葉そのものは、どこにも置かない）
// 合言葉を忘れると、ドライブのデータは誰にも開けない（パソコン・iPad にある鍵とデータは、そのまま使える）
import {scryptAsync} from '@noble/hashes/scrypt.js';
import {openBlob, sealBlob, VAULT_KEY_BYTES} from './vault.js';
import {fingerprint} from './vault-keys.js';

export const KEYRING = 'keyring'; // ドライブの置き場の名前
export const KEYRING_VERSION = 1;
export const PASSPHRASE_MIN = 8;
// scrypt の重さ：N=2^15・r=8（メモリ 32MB）。iPad（第 8 世代）で 1〜2 秒ほど。重くしたら版を上げて、開く側は書いてある条件で計算する
export const SCRYPT = {N: 2 ** 15, r: 8, p: 1};

const te = new TextEncoder();
const b64 = (u) => btoa(String.fromCharCode(...u));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** 合言葉をそろえる（前後の空白を除き、文字の形を NFKC でそろえる。全角・半角の違いで開けなくならないように） */
const norm = (p) =>
  String(p ?? '')
    .trim()
    .normalize('NFKC');

/** 合言葉として使えるか（使えなければ、その理由） */
export function passphraseProblem(p) {
  const s = norm(p);
  if (s.length < PASSPHRASE_MIN) return `合言葉は ${PASSPHRASE_MIN} 文字以上にしてください`;
  if (s.length > 200) return '合言葉が長すぎます';
  return null;
}

const kek = (passphrase, salt, {N, r, p}, onProgress) =>
  scryptAsync(te.encode(norm(passphrase)), salt, {N, r, p, dkLen: 32, onProgress});

/** 鍵を合言葉で包む。戻り：ドライブに置く JSON（文字列にして置く） */
export async function makeKeyring(
  master,
  passphrase,
  {params = SCRYPT, device = '', now = new Date(), onProgress} = {}
) {
  if (!(master instanceof Uint8Array) || master.length !== VAULT_KEY_BYTES) throw new Error('鍵が不正です');
  const problem = passphraseProblem(passphrase);
  if (problem) throw new Error(problem);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const k = await kek(passphrase, salt, params, onProgress);
  return {
    v: KEYRING_VERSION,
    kdf: {name: 'scrypt', N: params.N, r: params.r, p: params.p, salt: b64(salt)},
    key: b64(sealBlob(k, master, KEYRING)),
    fp: fingerprint(master),
    at: now.toISOString(),
    device
  };
}

/** 合言葉で鍵を開く。合言葉が違う・形が違うときは Error */
export async function openKeyring(ring, passphrase, {onProgress} = {}) {
  if (!ring || ring.v !== KEYRING_VERSION || ring.kdf?.name !== 'scrypt')
    throw new Error('合言葉の鍵の形が違います（アプリを新しくしてください）');
  const {N, r, p, salt} = ring.kdf;
  if (![N, r, p].every((x) => Number.isInteger(x) && x > 0) || N > 2 ** 20) throw new Error('合言葉の鍵の形が違います');
  const k = await kek(passphrase, unb64(salt), {N, r, p}, onProgress);
  let master;
  try {
    master = openBlob(k, unb64(ring.key), KEYRING);
  } catch {
    throw new Error('合言葉が違います');
  }
  if (fingerprint(master) !== ring.fp) throw new Error('合言葉の鍵が壊れています');
  return master;
}

export const keyringBytes = (ring) => te.encode(JSON.stringify(ring));
export const readKeyringBytes = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
