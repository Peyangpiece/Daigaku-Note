// 印刷形式（1up / 2up / 4up …）の判定と、同じ資料の形式違いから 1up だけを残す決まり（SPEC §6.7）。副作用なし。

// 「4up」「2-up」「4in1」「4on1」「4アップ」「4スライド」「2分割」。直前が「第」や数字なら回番号なので除く
const LAYOUT = /(?<![第0-9])([0-9]{1,2})\s*(?:-?up|in\s*1|on\s*1|アップ|スライド|分割)(?![a-z])/i;
const LAYOUT_ALL =
  /(?<![第0-9])[0-9]{1,2}\s*(?:-?up|in\s*1|on\s*1|アップ|スライド|分割)(?![a-z])(?:なし)?(?:バージョン|版|ver\.?)?|分割なし(?:バージョン|版|ver\.?)?/gi;

/** 1up・印なし・「分割なし」は 1。印があればその数 */
export function layoutOf(name) {
  const m = String(name ?? '')
    .normalize('NFKC')
    .match(LAYOUT);
  return m ? Number(m[1]) || 1 : 1;
}

/** 形式の印・拡張子・空白・括弧を除いた名前（同じ資料の形式違いをまとめる鍵） */
export function layoutBase(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .replace(/\.[^.]+$/, '')
    .replace(LAYOUT_ALL, '')
    .replace(/[\s()（）\[\]【】_\-・]/g, '')
    .toLowerCase();
}

/** 同じ資料の形式違いがあるときは 1up（印なしを含む）だけを残す。1up がない組はそのまま */
export function preferLayout(entries, nameOf = (e) => e.name) {
  const groups = new Map();
  for (const e of entries) {
    const k = layoutBase(nameOf(e));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const keep = new Set();
  for (const g of groups.values()) {
    const one = g.filter((e) => layoutOf(nameOf(e)) === 1);
    for (const e of one.length ? one : g) keep.add(e);
  }
  return entries.filter((e) => keep.has(e));
}
