// 並べ替えと付箋の色（右クリック →「並べ替え」「色を変える」）。メインが保存の前に確かめ、画面が並びに当てる
// 並びは設定 ui.order（{範囲: [鍵]}）、付箋の色は設定 ui.stickyColors（{授業の id: {鍵: 1〜5}}）に覚える

/** 並びの範囲：授業の付箋（course:<授業の id>）・ホームの授業（home:classes）・ホームの自分のフォルダ（home:folders） */
export const ORDER_SCOPE = /^(course:[0-9A-HJKMNP-TV-Z]{26}|home:classes|home:folders)$/;
const MAX_KEYS = 500;
const MAX_KEY = 400; // 下のフォルダの相対パスも鍵にするので長め

/** 並べる鍵の一覧を確かめる（文字列だけ・重ねない・数と長さに上限）。不正なら null */
export function cleanKeys(keys) {
  if (!Array.isArray(keys) || keys.length > MAX_KEYS) return null;
  if (!keys.every((k) => typeof k === 'string' && k.length <= MAX_KEY)) return null;
  return [...new Set(keys)];
}

/** 付箋の色の番号（1〜5 の --pop。null はもとの色に戻す）。不正なら undefined */
export const cleanColor = (c) => (c === null ? null : Number.isInteger(c) && c >= 1 && c <= 5 ? c : undefined);

/**
 * 覚えた並び（saved）に合わせて並べる。覚えた鍵の順に並べ、覚えていないもの（あとから増えたもの）は
 * もとの並びのまま後ろに付ける。覚えた鍵のうち、もうないものは飛ばす
 */
export function applyOrder(items, keyOf, saved) {
  if (!Array.isArray(saved) || !saved.length) return items;
  const rank = new Map(saved.map((k, i) => [k, i]));
  const known = items.filter((x) => rank.has(keyOf(x))).sort((a, b) => rank.get(keyOf(a)) - rank.get(keyOf(b)));
  return [...known, ...items.filter((x) => !rank.has(keyOf(x)))];
}

/** 覚えた並びがあるか（あれば「これまでの回」の見出しのような、日付で分けた並びはやめる） */
export const hasOrder = (saved) => Array.isArray(saved) && saved.length > 0;
