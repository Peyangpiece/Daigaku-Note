// シークレットコード（SPEC §9.8 のポイント）：管理者が作って配るコード。入れるとポイントがもらえる（1 つのデータで 1 回）。
// コードそのものはアプリに入れない（リポジトリは公開）。ここに置くのは、塩を足したコードの SHA-256 だけ。
// コードは scripts/make-secret-code.mjs で作る（ランダムな 12 文字＝60 ビット。総当たりで当てられない長さ）。
// 作ったら下の CODES に 1 行足して版を上げる（サーバーがないので、新しいコードは次の版から使える）
import {sha256} from '@noble/hashes/sha2.js';

/** id：使ったことを覚える名前。salt：コードごとの塩。hash：hashCode(コード, salt)。amount：もらえるポイント。label：履歴に出す名前。until：使える最後の日（なければいつでも） */
export const CODES = [
  {
    id: 'launch-10000',
    salt: 'a1f4c09e7b2d5e38',
    hash: '4c896de1cb1833921a72a8c4d6986e9e6b49de04552aedc0f3aee014b36ced08',
    amount: 10000,
    label: 'はじめてのシークレットコード',
    until: null
  }
];

/** 入れたコードを比べる形にする：全角・半角、大文字・小文字、空白・ハイフンの違いは見ない */
export const normalizeCode = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-‐－ー_]/g, '');

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
/** コードの印（塩を足した SHA-256 の 16 進） */
export const hashCode = (code, salt) =>
  hex(sha256(new TextEncoder().encode(`palettenote-code:${salt}:${normalizeCode(code)}`)));

/** 入れたコードに合うもの（なければ null）。期限の過ぎたものも返し、呼ぶ側が断る */
export function findCode(code, codes = CODES) {
  const n = normalizeCode(code);
  if (n.length < 8 || n.length > 40) return null;
  return codes.find((c) => hashCode(n, c.salt) === c.hash) ?? null;
}
