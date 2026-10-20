// 文字隠しのマーカーを文字に合わせる計算（画面の座標・px）。pdf.js の文字列は全体の幅しか持たないので、
// 1 字ずつの幅（全角・半角の違い）を measure で測り、その比で文字列の幅を分けて字の切れ目を出す。
// items は viewer の screenItems の形 {str, left, right, top, bottom}。measure(ch) は字の相対的な幅（DOM なしでも差し替えられる）

/** 字の切れ目の x（字の数 + 1 個）。結果は item に覚えておく */
export function charEdges(it, measure) {
  if (it.edges) return it.edges;
  const chars = Array.from(it.str);
  const ws = chars.map((c) => Math.max(0.01, measure(c) || 1));
  const total = ws.reduce((a, b) => a + b, 0);
  const span = it.right - it.left;
  const edges = [it.left];
  let acc = 0;
  for (const w of ws) {
    acc += w;
    edges.push(it.left + (acc / total) * span);
  }
  it.chars = chars;
  it.edges = edges;
  return edges;
}

/**
 * 横になぞった範囲を字の切れ目に合わせる。端はいちばん近い切れ目へ（字の途中で切らない）。
 * 1 字に満たないときは、なぞった真ん中の字を覆う。戻りは {left, right}（行に字がなければ null）
 */
export function snapRange(items, x1, x2, measure) {
  const edges = [...new Set(items.flatMap((it) => charEdges(it, measure)))].sort((a, b) => a - b);
  if (!edges.length) return null;
  const near = (x) => edges.reduce((best, e) => (Math.abs(e - x) < Math.abs(best - x) ? e : best), edges[0]);
  let left = near(Math.min(x1, x2));
  let right = near(Math.max(x1, x2));
  if (right - left < 0.5) {
    const mid = (x1 + x2) / 2;
    const below = edges.filter((e) => e <= mid);
    const above = edges.filter((e) => e > mid);
    if (!below.length || !above.length) return null;
    left = below.at(-1);
    right = above[0];
  }
  return {left, right};
}

/** left〜right にある字（字の真ん中が範囲に入るもの）。上の行から順に */
export function textIn(items, left, right, measure) {
  return items
    .slice()
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .map((it) => {
      const e = charEdges(it, measure);
      return it.chars.filter((_, i) => {
        const c = (e[i] + e[i + 1]) / 2;
        return c >= left && c <= right;
      });
    })
    .flat()
    .join('');
}

// 単語の区切り（Intl.Segmenter）。「原価｜企画」のように分かれる漢字どうし・カタカナどうしはつなげて 1 語にする（ひらがなはつなげない）
const KIND = [
  [/^[\p{Script=Han}々〆ヶ]+$/u, 'han'],
  [/^[\p{Script=Katakana}ー]+$/u, 'kana'],
  [/^[\p{L}\p{N}]+$/u, 'alnum']
];
const kindOf = (s) => KIND.find(([re]) => re.test(s))?.[1] ?? null;

/** 文字列を単語に分ける。戻りは [{start, end, word}]（start・end は字の番号。空白や句読点は word: false） */
export function words(str, locale = 'ja') {
  const out = [];
  let pos = 0;
  for (const s of new Intl.Segmenter(locale, {granularity: 'word'}).segment(str)) {
    const len = Array.from(s.segment).length;
    const word = !!s.isWordLike && !!s.segment.trim();
    const prev = out.at(-1);
    const kind = word ? kindOf(s.segment) : null;
    if (prev?.word && kind && kind === prev.kind && kind !== 'alnum') prev.end += len;
    else out.push({start: pos, end: pos + len, word, kind});
    pos += len;
  }
  return out;
}

/** x の位置の単語の範囲 {left, right, str}。字でない（空白・句読点・字の外）ときは null */
export function wordAt(it, x, measure, locale = 'ja') {
  const e = charEdges(it, measure);
  const i = e.findIndex((edge, k) => k < e.length - 1 && x >= edge && x < e[k + 1]);
  if (i < 0) return null;
  const w = words(it.str, locale).find((s) => i >= s.start && i < s.end);
  if (!w?.word) return null;
  return {left: e[w.start], right: e[w.end], str: it.chars.slice(w.start, w.end).join('')};
}
