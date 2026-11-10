// Google ドライブに置くものの鍵（docs/SYNC.md §3）：元の鍵（32 バイト）から、用途ごとの鍵を HMAC-SHA256 で作る
import {createHash, createHmac, randomBytes} from 'node:crypto';
import {VAULT_KEY_BYTES} from '../../shared/vault.js';

export const newMasterKey = () => new Uint8Array(randomBytes(VAULT_KEY_BYTES));

/** 用途ごとの鍵：enc（中身を包む）・name（資料の名前を作る） */
export function deriveKeys(master) {
  if (!(master instanceof Uint8Array) || master.length !== VAULT_KEY_BYTES) throw new Error('鍵が不正です');
  const k = (label) => new Uint8Array(createHmac('sha256', master).update(`palette-note/${label}`).digest());
  return {enc: k('enc'), name: k('name')};
}

/** 資料の置き場の名前：中身のハッシュを名前の鍵で HMAC したもの（同じ中身は 1 度だけ送る。Google から中身のハッシュは分からない） */
export const blobName = (nameKey, bytes) =>
  `f-${createHmac('sha256', nameKey).update(createHash('sha256').update(bytes).digest()).digest('hex').slice(0, 40)}`;

/** 鍵の指紋（画面に出して、パソコンと iPad で同じ鍵か確かめる。鍵そのものは分からない） */
export const fingerprint = (master) =>
  createHash('sha256').update(master).update('palette-note/fingerprint').digest('hex').slice(0, 8).toUpperCase();
