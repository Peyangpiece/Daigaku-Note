// 印刷の割り付け（v0.27.14）：用紙・向き・1 枚に何ページ（1・2・4）から、紙の上のページの位置を決める。
// 印刷の窓のプレビュー（renderer/views/viewer/print-dialog.js）と、実際に刷る紙（main/ipc/pdf.js の print.run）が
// 同じ計算を使うので、プレビューで見たとおりに刷れる。単位は mm。副作用なし

/** 用紙（縦置きの幅・高さ mm）。B 判は日本の JIS */
export const PAPERS = {
  A4: {label: 'A4', w: 210, h: 297},
  A3: {label: 'A3', w: 297, h: 420},
  B5: {label: 'B5', w: 182, h: 257},
  B4: {label: 'B4', w: 257, h: 364},
  Letter: {label: 'レター', w: 215.9, h: 279.4}
};
/** 紙の外側の余白（プリンタは紙の端まで刷れないので、端を切らないように） */
export const SHEET_MARGIN = 6;
/** 1 枚に 2・4 ページのときの、ページの間 */
export const CELL_GAP = 4;
export const NUPS = [1, 2, 4];

const PT_TO_MM = 25.4 / 72;

/**
 * 刷るページの指定（「1-3, 5, 8-」）を、1 から数えたページ番号の並びにする。空・「すべて」なら全部。
 * 範囲外は切り詰め、重なりは 1 回だけ、順は小さい順。読めないときは null
 */
export function parsePages(text, total) {
  const s = String(text ?? '')
    .normalize('NFKC')
    .replace(/[〜～~ー－−]/g, '-')
    .replace(/[、，]/g, ',')
    .trim();
  if (!s) return Array.from({length: total}, (_, i) => i + 1);
  const set = new Set();
  for (const part of s.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d*)-(\d*)$/.exec(part) ?? /^(\d+)$/.exec(part);
    if (!m) return null;
    const from = m[2] === undefined ? Number(m[1]) : m[1] ? Number(m[1]) : 1;
    const to = m[2] === undefined ? from : m[2] ? Number(m[2]) : total;
    if (from > to) return null;
    for (let p = Math.max(1, from); p <= Math.min(total, to); p++) set.add(p);
  }
  return set.size ? [...set].sort((a, b) => a - b) : null;
}

/** 1 枚に n ページの並び（列・行）。2 ページは紙の長い辺の向きに並べる */
function grid(nup, landscape) {
  if (nup === 4) return {cols: 2, rows: 2};
  if (nup === 2) return landscape ? {cols: 2, rows: 1} : {cols: 1, rows: 2};
  return {cols: 1, rows: 1};
}

/** 向きを決めたときの紙と枠（ページを置く升目）。fit はページ（pt）が升目に入る大きさ（mm） */
function frame(paper, nup, landscape) {
  const p = PAPERS[paper] ?? PAPERS.A4;
  const w = landscape ? p.h : p.w;
  const h = landscape ? p.w : p.h;
  const {cols, rows} = grid(nup, landscape);
  const cw = (w - SHEET_MARGIN * 2 - CELL_GAP * (cols - 1)) / cols;
  const ch = (h - SHEET_MARGIN * 2 - CELL_GAP * (rows - 1)) / rows;
  return {w, h, cols, rows, cw, ch};
}

const fitScale = (f, page) => Math.min(f.cw / (page.w * PT_TO_MM), f.ch / (page.h * PT_TO_MM));

/**
 * 紙の向き：'portrait'・'landscape' はそのまま。'auto' は、最初のページが大きく刷れるほう
 * （横長のスライドを 1 枚に 1 ページなら横、2 ページなら縦に 2 段）
 */
export function pickLandscape({paper = 'A4', nup = 1, orient = 'auto', page = {w: 595, h: 842}} = {}) {
  if (orient === 'portrait') return false;
  if (orient === 'landscape') return true;
  return fitScale(frame(paper, nup, true), page) > fitScale(frame(paper, nup, false), page) + 1e-9;
}

/**
 * 割り付け。pages：刷るページの大きさ（pt）の並び（{num, w, h}）。
 * 戻り：{w, h, landscape, sheets: [[{num, x, y, w, h}...]...]}（mm。紙の左上から）。ページは升目の真ん中に、縦横比を保って置く
 */
export function layoutSheets(pages, {paper = 'A4', nup = 1, orient = 'auto'} = {}) {
  nup = NUPS.includes(Number(nup)) ? Number(nup) : 1;
  const landscape = pickLandscape({paper, nup, orient, page: pages[0] ?? {w: 595, h: 842}});
  const f = frame(paper, nup, landscape);
  const sheets = [];
  pages.forEach((page, i) => {
    const k = i % nup;
    if (k === 0) sheets.push([]);
    const col = k % f.cols;
    const row = Math.floor(k / f.cols);
    const s = fitScale(f, page);
    const w = page.w * PT_TO_MM * s;
    const h = page.h * PT_TO_MM * s;
    const cx = SHEET_MARGIN + col * (f.cw + CELL_GAP);
    const cy = SHEET_MARGIN + row * (f.ch + CELL_GAP);
    sheets.at(-1).push({num: page.num, x: cx + (f.cw - w) / 2, y: cy + (f.ch - h) / 2, w, h});
  });
  return {w: f.w, h: f.h, landscape, sheets};
}

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * 刷る紙の HTML（隠した窓で開いて刷る）。src(num)：ページの画像の URL。
 * 紙 1 枚を 1 ページ（@page の大きさ）にし、ページの画像を mm で置く
 */
export function sheetsHtml(layout, src) {
  const {w, h} = layout;
  const body = layout.sheets
    .map(
      (cells) =>
        `<div class="sheet">${cells
          .map(
            (c) =>
              `<img src="${src(c.num)}" alt="" style="left:${r2(c.x)}mm;top:${r2(c.y)}mm;width:${r2(c.w)}mm;height:${r2(c.h)}mm">`
          )
          .join('')}</div>`
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>印刷</title><style>
@page { size: ${r2(w)}mm ${r2(h)}mm; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.sheet { position: relative; width: ${r2(w)}mm; height: ${r2(h)}mm; overflow: hidden; break-after: page; page-break-after: always; }
.sheet:last-child { break-after: auto; page-break-after: auto; }
img { position: absolute; display: block; }
</style></head><body>${body}</body></html>`;
}
