// しおり：PDF のページの位置に名前を付ける。注釈と同じくファイルの SHA-256 に結び付ける。副作用なし
export const NAME_MAX = 40;

/** 次の既定の名前（しおり 1、しおり 2…）。いまある「しおりN」のいちばん大きい番号の次 */
export function nextBookmarkName(names) {
  let n = 0;
  for (const s of names) {
    const m = String(s).match(/^しおり\s*(\d+)$/);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `しおり${n + 1}`;
}

/** レンダラから受け取ったしおりを確かめて整える。おかしければ Error */
export function normalizeBookmark(b, {pages = Infinity} = {}) {
  const page = Number(b?.page);
  if (!Number.isInteger(page) || page < 1 || page > pages) throw new Error('しおりのページが不正です');
  const y = Number(b?.y ?? 0);
  if (!Number.isFinite(y)) throw new Error('しおりの位置が不正です');
  const name = String(b?.name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  if (!name) throw new Error('しおりの名前を入れてください');
  return {page, y: Math.min(1, Math.max(0, y)), name};
}
