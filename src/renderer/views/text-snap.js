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

/**
 * 描かれた字（ページの絵）に合わせてマーカーの箱を直す。字の幅は見積もりなので、端が字の途中に来ることがある。
 * 箱のまわりの縦の列を調べ、インクのかたまり（間に空いた列のない一続き）を作り、かたまりを字ごとにまとめる。
 * 日本語の字は「か」と濁点「゛」、「は」の左の棒と右、「に」「い」「川」のように 1 字の中にもすき間があるので、
 * edges（見積もりの字の切れ目）があれば、かたまりの真ん中が入る見積もりの字ごとにまとめる（1 字の中のすき間で切らない）。
 * そのうえで、見積もりの箱（box の左右。字の切れ目に合わせてある）と 35% 以上重なる字を丸ごと覆う。
 * edges がないときは、合わせて 1 字の幅（字の高さ × 1.05）に収まるかたまりを 1 字としてまとめる（cjk が false ならまとめない）。
 * 上下は、字がはみ出していれば広げる（狭めない）。最後に少し余白を足す（マーカーの角の丸みで字の角が見えないように）。
 * ink(x, y) は画面の座標（px）にインクがあるか。step は調べる間隔（px。canvas の 1 画素）。fh は字の高さ（px）
 */
export function fitToInk(box, ink, {fh, step = 1, pad = 1.5, cjk = true, edges = null}) {
  let {left, right, top, bottom} = box;
  const inkCol = (x) => {
    for (let y = top; y <= bottom; y += step) if (ink(x, y)) return true;
    return false;
  };
  // インクのかたまり [始め, 終わり)
  const runs = [];
  for (let x = left - fh; x <= right + fh; x += step) {
    if (!inkCol(x)) continue;
    const last = runs.at(-1);
    if (last && x - last[1] < step / 2) last[1] = x + step;
    else runs.push([x, x + step]);
  }
  const chars = [];
  if (edges?.length > 1) {
    // 見積もりの字ごとにまとめる（見積もりの字の外のかたまりは 1 つずつ）
    const slot = (x) => {
      if (x < edges[0] || x >= edges.at(-1)) return null;
      let i = 0;
      while (x >= edges[i + 1]) i++;
      return i;
    };
    let prev = null;
    for (const r of runs) {
      const k = slot((r[0] + r[1]) / 2);
      if (k !== null && k === prev) chars.at(-1)[1] = r[1];
      else chars.push([...r]);
      prev = k;
    }
  } else {
    // 1 字の幅に収まるかたまりはまとめる（日本語の字の中のすき間）
    for (const r of runs) {
      const last = chars.at(-1);
      if (cjk && last && r[1] - last[0] <= fh * 1.05) last[1] = r[1];
      else chars.push([...r]);
    }
  }
  const overlap = (c) => Math.min(c[1], right) - Math.max(c[0], left);
  const hit = chars.filter((c) => overlap(c) >= 0.35 * Math.min(c[1] - c[0], right - left));
  if (hit.length) {
    // 字がくっついて 1 つの大きなかたまりになっているところは、見積もりの端で切る
    const ends = hit.map((c) => (c[1] - c[0] > fh * 1.3 ? [Math.max(c[0], left), Math.min(c[1], right)] : c));
    left = Math.min(...ends.map((c) => c[0]));
    right = Math.max(...ends.map((c) => c[1]));
  }
  const inkRow = (y) => {
    for (let x = left; x <= right; x += step) if (ink(x, y)) return true;
    return false;
  };
  const limV = fh * 0.3;
  for (let d = 0; d < limV && inkRow(top - step); d += step) top -= step;
  for (let d = 0; d < limV && inkRow(bottom + step); d += step) bottom += step;
  return {left: left - pad, right: right + pad, top: top - pad, bottom: bottom + pad};
}

/** ImageData（明るさで判定）から ink(x, y) を作る。背景より十分暗い画素をインクとみなす。背景が暗いときは null（直さない） */
export function inkFromImage({data, width, height}, {x0, y0, scale}) {
  const lum = new Uint8Array(width * height);
  for (let i = 0; i < lum.length; i++) lum[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
  const sorted = Uint8Array.from(lum).sort();
  const bg = sorted[Math.floor(sorted.length * 0.9)];
  if (bg < 110) return null;
  const limit = bg - 48;
  return (x, y) => {
    const ix = Math.round((x - x0) * scale);
    const iy = Math.round((y - y0) * scale);
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) return false;
    return lum[iy * width + ix] < limit;
  };
}
