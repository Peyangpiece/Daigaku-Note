// ノート（docs/SPEC-NOTEBOOK.md）：回のノートの紙の形式・ショップのノート（Pastelle）・紙の設定・ページの計算・表紙の絵。副作用なし。
// ページの計算（pageGeometry）は mm の線・点で返し、PDF（main/note-pdf.js）と画面の見本（SVG）が同じ計算を使う。
// 罫の名前と幅は、学習ノートの代表的なもの（販売店の商品ページで確かめた）。表紙は全テンプレート共通の形で、色だけを変える

/** A4 縦（mm） */
export const PAGE_W = 210;
export const PAGE_H = 297;
/** 上の欄（日付・題。header の絵を置く）の高さと、下の余白（mm）。v2 の紙と同じ */
export const HEAD_H = 20;
export const FOOT_H = 10;

/**
 * 罫の形式。kind：線の引き方。gap：はじめの行の間（ます・段の線の間）mm。range：マイノートで変えられる幅 [最小, 最大]（mm）。
 * bold：方眼の太線の間隔（ますの数。0 でなし）。rows：英習罫・五線譜の段の数。short：表紙の札の短い名前
 */
export const FORMATS = {
  a7: {kind: 'ruled', name: '横罫 A（7 mm）', short: 'A 7mm', gap: 7},
  b6: {kind: 'ruled', name: '横罫 B（6 mm）', short: 'B 6mm', gap: 6},
  c5: {kind: 'ruled', name: '横罫 C（5 mm）', short: 'C 5mm', gap: 5},
  u8: {kind: 'ruled', name: '横罫 U（8 mm）', short: 'U 8mm', gap: 8},
  ul10: {kind: 'ruled', name: '横罫 UL（10 mm）', short: 'UL 10mm', gap: 10},
  'dot-a7': {kind: 'dotruled', name: 'ドット入り罫線 A（7 mm）', short: 'A 7mm・ドット', gap: 7},
  'dot-b6': {kind: 'dotruled', name: 'ドット入り罫線 B（6 mm）', short: 'B 6mm・ドット', gap: 6},
  'dot-c5': {kind: 'dotruled', name: 'ドット入り罫線 C（5 mm）', short: 'C 5mm・ドット', gap: 5},
  grid5: {kind: 'grid', name: '方眼 5 mm（10 mm 実線入り）', short: '方眼 5mm', gap: 5, bold: 2},
  grid4: {kind: 'grid', name: '方眼 4 mm（8 mm 実線入り）', short: '方眼 4mm', gap: 4, bold: 2},
  grid6: {kind: 'grid', name: '方眼 6 mm', short: '方眼 6mm', gap: 6},
  grid7: {kind: 'grid', name: '方眼 7 mm', short: '方眼 7mm', gap: 7},
  grid12: {kind: 'grid', name: '方眼 12 mm', short: '方眼 12mm', gap: 12},
  plain: {kind: 'plain', name: '無地', short: '無地', gap: 7},
  eng13: {kind: 'english', name: '英習罫 13 段', short: '英習 13段', gap: 4, rows: 13},
  eng15: {kind: 'english', name: '英習罫 15 段', short: '英習 15段', gap: 3.5, rows: 15},
  staff: {kind: 'staff', name: '五線譜 12 段', short: '五線譜', gap: 2, rows: 12},
  dotgrid: {kind: 'dotgrid', name: 'ドット方眼 5 mm', short: 'ドット 5mm', gap: 5},
  cornell: {kind: 'cornell', name: 'コーネル式（7 mm）', short: 'コーネル', gap: 7},
  genkou: {kind: 'genkou', name: '原稿用紙（20 × 20）', short: '原稿用紙', gap: 9},
  kanji: {kind: 'kanji', name: '漢字練習（十字入りのます）', short: '漢字練習', gap: 15}
};
/** 種類ごとの変えられる幅（mm）と刻み */
export const GAP_RANGE = {
  ruled: [4, 12],
  dotruled: [4, 12],
  cornell: [4, 12],
  grid: [3, 12],
  dotgrid: [3, 12],
  english: [2.5, 5],
  staff: [1.5, 3],
  genkou: [6, 12],
  kanji: [10, 25],
  plain: [7, 7]
};
export const GAP_STEP = 0.5;
export const KIND_LABEL = {
  ruled: '横罫',
  dotruled: 'ドット入り罫線',
  grid: '方眼',
  dotgrid: 'ドット方眼',
  plain: '無地',
  english: '英習罫',
  staff: '五線譜',
  cornell: 'コーネル式',
  genkou: '原稿用紙',
  kanji: '漢字練習'
};

/** 線の太さ（mm） */
export const WEIGHTS = {thin: 0.12, normal: 0.18, bold: 0.3};
export const WEIGHT_LABEL = {thin: '細い', normal: 'ふつう', bold: '太い'};
/** ページ上部の線（上の欄の下）：なし・1 本・2 本・日付欄つき */
export const HEADS = ['none', 'line', 'double', 'date'];
export const HEAD_LABEL = {none: 'なし', line: '1 本', double: '2 本', date: '1 本と日付の欄'};
/** はじめの色（v2 の紙と同じ灰色） */
export const DEFAULT_LINE = '#c9cfd6';
export const DEFAULT_HEAD = '#a7afb9';
export const DEFAULT_MARGIN = '#e8a0a0';
export const DEFAULT_PAPER = '#ffffff';
/** 選べる色の見本（線・紙）。ほかの色も色の欄で選べる */
export const LINE_SWATCHES = ['#c9cfd6', '#9cc0e6', '#a8d5c2', '#f2b8b5', '#e7c989', '#c8b6e2', '#9aa0a6', '#4a5568'];
export const PAPER_SWATCHES = ['#ffffff', '#fbf8f1', '#f6f7f9', '#f2f7fb', '#fdf6f6'];

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const clampGap = (kind, v, d) => {
  const [lo, hi] = GAP_RANGE[kind] ?? [d, d];
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(hi, Math.max(lo, Math.round(n / GAP_STEP) * GAP_STEP));
};

/**
 * 紙の設定（v3）を整える。知らない形式は横罫 B。
 * {v: 3, format, gap, line, weight, head, headColor, margin, marginColor, dots, bold, paper}
 */
export function cleanDesign(raw = {}) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const format = Object.hasOwn(FORMATS, d.format) ? d.format : 'b6';
  const f = FORMATS[format];
  return {
    v: 3,
    format,
    gap: clampGap(f.kind, d.gap, f.gap),
    line: hex(d.line, DEFAULT_LINE),
    weight: Object.hasOwn(WEIGHTS, d.weight) ? d.weight : 'normal',
    head: HEADS.includes(d.head) ? d.head : 'line',
    headColor: hex(d.headColor, DEFAULT_HEAD),
    // 左の余白の線（横罫・ドット入り罫線だけ）
    margin: ['ruled', 'dotruled'].includes(f.kind) && d.margin === true,
    marginColor: hex(d.marginColor, DEFAULT_MARGIN),
    // 横罫の上の点（ドット入り罫線ははじめから点あり）
    dots: f.kind === 'dotruled' ? d.dots !== false : f.kind === 'ruled' && d.dots === true,
    // 方眼の太線の間隔（ますの数。0 でなし）
    bold: f.kind === 'grid' ? (Number.isInteger(d.bold) && d.bold >= 0 && d.bold <= 10 ? d.bold : (f.bold ?? 0)) : 0,
    paper: hex(d.paper, DEFAULT_PAPER)
  };
}

/** 方眼などを左右の真ん中にそろえる：左右 8 mm ずつ空けた幅に入るだけのます。戻り {left, cols} */
function centered(gap, side = 8) {
  const cols = Math.floor((PAGE_W - 2 * side) / gap);
  return {left: (PAGE_W - cols * gap) / 2, cols};
}

/**
 * 1 ページに描くもの（mm。y は上から）。戻り：{paper, lines: [{x1, y1, x2, y2, w, c, dash?}], dots: [{x, y, r, c}]}。
 * 上の欄の下の線（head）・左の余白の線もここで返す
 */
export function pageGeometry(raw) {
  const d = cleanDesign(raw);
  const f = FORMATS[d.format];
  const w = WEIGHTS[d.weight];
  const lines = [];
  const dots = [];
  const top = HEAD_H;
  const bottom = PAGE_H - FOOT_H;
  const L = (x1, y1, x2, y2, width = w, c = d.line, dash = null) =>
    lines.push({x1, y1, x2, y2, w: width, c, ...(dash ? {dash} : {})});
  const g = d.gap;
  let headLeft = 0;
  let headRight = PAGE_W;
  if (f.kind === 'ruled' || f.kind === 'dotruled') {
    const rows = Math.floor((bottom - top) / g);
    for (let i = 1; i <= rows; i++) L(0, top + i * g, PAGE_W, top + i * g);
    if (d.dots) {
      const {left, cols} = centered(g, 6);
      for (let i = 1; i <= rows; i++)
        for (let j = 0; j <= cols; j++) dots.push({x: left + j * g, y: top + i * g, r: w * 1.6, c: d.line});
    }
    if (d.margin) L(20, top, 20, top + rows * g, w * 1.3, d.marginColor);
  } else if (f.kind === 'grid' || f.kind === 'dotgrid') {
    const {left, cols} = centered(g);
    const rows = Math.floor((bottom - top) / g);
    headLeft = left;
    headRight = left + cols * g;
    if (f.kind === 'dotgrid') {
      for (let i = 0; i <= rows; i++)
        for (let j = 0; j <= cols; j++) dots.push({x: left + j * g, y: top + i * g, r: w * 1.7, c: d.line});
    } else {
      const thick = (k) => d.bold > 0 && k % d.bold === 0;
      for (let i = 1; i <= rows; i++) L(left, top + i * g, left + cols * g, top + i * g, thick(i) ? w * 1.9 : w);
      for (let j = 0; j <= cols; j++) L(left + j * g, top, left + j * g, top + rows * g, thick(j) ? w * 1.9 : w);
    }
  } else if (f.kind === 'english') {
    // 4 本線（上・点線・基線・下）の段を、上の欄の下から下の余白まで等しく並べる
    const n = f.rows;
    const h = 3 * g;
    const space = (bottom - top - 6 - n * h) / (n - 1);
    for (let k = 0; k < n; k++) {
      const y = top + 6 + k * (h + space);
      L(12, y, PAGE_W - 12, y);
      L(12, y + g, PAGE_W - 12, y + g, w, d.line, [1.2, 1.2]);
      L(12, y + 2 * g, PAGE_W - 12, y + 2 * g, w * 1.8);
      L(12, y + 3 * g, PAGE_W - 12, y + 3 * g);
    }
    headLeft = 12;
    headRight = PAGE_W - 12;
  } else if (f.kind === 'staff') {
    const n = f.rows;
    const h = 4 * g;
    const space = (bottom - top - 8 - n * h) / (n - 1);
    for (let k = 0; k < n; k++) {
      const y = top + 8 + k * (h + space);
      for (let m = 0; m < 5; m++) L(12, y + m * g, PAGE_W - 12, y + m * g);
      L(12, y, 12, y + h, w * 1.4);
      L(PAGE_W - 12, y, PAGE_W - 12, y + h, w * 1.4);
    }
    headLeft = 12;
    headRight = PAGE_W - 12;
  } else if (f.kind === 'cornell') {
    // 左に手がかりの欄（60 mm）・下に要約の欄（45 mm）・ほかは横罫
    const summary = bottom - 45;
    const rows = Math.floor((summary - top) / g);
    for (let i = 1; i <= rows; i++) L(0, top + i * g, PAGE_W, top + i * g);
    L(60, top, 60, summary, w * 1.9);
    L(0, summary, PAGE_W, summary, w * 1.9);
  } else if (f.kind === 'genkou') {
    // 20 × 20 のます（左右の真ん中・上下の真ん中）。外のわくは太く、真ん中の折り目に小さな印
    const n = 20;
    const left = (PAGE_W - n * g) / 2;
    const y0 = top + (bottom - top - n * g) / 2;
    for (let i = 0; i <= n; i++) L(left, y0 + i * g, left + n * g, y0 + i * g, i % n === 0 ? w * 2 : w);
    for (let j = 0; j <= n; j++) L(left + j * g, y0, left + j * g, y0 + n * g, j % n === 0 ? w * 2 : w);
    dots.push({x: PAGE_W / 2, y: y0 - 2, r: 0.7, c: d.line});
    headLeft = left;
    headRight = left + n * g;
  } else if (f.kind === 'kanji') {
    const {left, cols} = centered(g, 12);
    const rows = Math.floor((bottom - top - 4) / g);
    const y0 = top + 4;
    for (let i = 0; i <= rows; i++) L(left, y0 + i * g, left + cols * g, y0 + i * g, w * 1.4);
    for (let j = 0; j <= cols; j++) L(left + j * g, y0, left + j * g, y0 + rows * g, w * 1.4);
    // ますの中の十字（点線）
    for (let i = 0; i < rows; i++) L(left, y0 + (i + 0.5) * g, left + cols * g, y0 + (i + 0.5) * g, w, d.line, [1, 1]);
    for (let j = 0; j < cols; j++) L(left + (j + 0.5) * g, y0, left + (j + 0.5) * g, y0 + rows * g, w, d.line, [1, 1]);
    headLeft = left;
    headRight = left + cols * g;
  }
  // ページ上部の線（上の欄の下）
  const hw = Math.max(w * 2, 0.3);
  if (d.head !== 'none') L(headLeft, top, headRight, top, hw, d.headColor);
  if (d.head === 'double') L(headLeft, top - 1.2, headRight, top - 1.2, hw * 0.6, d.headColor);
  if (d.head === 'date') {
    // 右上に日付の欄：「　．　．」の 3 つの短い下線と 2 つの点
    const y = top - 5;
    const x0 = headRight - 46;
    for (const [a, b] of [
      [x0, x0 + 14],
      [x0 + 17, x0 + 29],
      [x0 + 32, x0 + 44]
    ])
      L(a, y, b, y, hw * 0.8, d.headColor);
    dots.push({x: x0 + 15.5, y: y - 0.4, r: 0.45, c: d.headColor}, {x: x0 + 30.5, y: y - 0.4, r: 0.45, c: d.headColor});
  }
  return {paper: d.paper, lines, dots, headLeft};
}

/** ページの見本（SVG。幅 width px、高さは A4 の比）。aria は呼ぶ側で付ける */
export function pageSvg(raw, {width = 210} = {}) {
  const g = pageGeometry(raw);
  const n = (v) => +v.toFixed(2);
  const lines = g.lines
    .map(
      (l) =>
        `<line x1="${n(l.x1)}" y1="${n(l.y1)}" x2="${n(l.x2)}" y2="${n(l.y2)}" stroke="${l.c}" stroke-width="${n(Math.max(l.w, 0.15))}"${l.dash ? ` stroke-dasharray="${l.dash.join(' ')}"` : ''}/>`
    )
    .join('');
  const dots = g.dots
    .map((p) => `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(Math.max(p.r, 0.25))}" fill="${p.c}"/>`)
    .join('');
  return `<svg class="nb-page" viewBox="0 0 ${PAGE_W} ${PAGE_H}" width="${width}" height="${Math.round((width * PAGE_H) / PAGE_W)}" aria-hidden="true"><rect width="${PAGE_W}" height="${PAGE_H}" fill="${g.paper}"/>${lines}${dots}</svg>`;
}

// ---- ショップのノート（Pastelle）----

/** 表紙の色を白（amt > 0）か黒（amt < 0）へ寄せる */
export function mix(c, amt) {
  const v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const t = amt > 0 ? 255 : 0;
  const a = Math.abs(amt);
  return `#${v
    .map((x) =>
      Math.round(x + (t - x) * a)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

/**
 * ショップのノート。cover：表紙の色（テンプレートごとにちがう淡い色）。points：値段。
 * はじめから持っているのは、v0.18 までの 4 つの紙（横罫 6・7 mm、方眼 6・7 mm）にあたるノート
 */
const NB = [
  ['b6', '#8fb8e8', 0],
  ['a7', '#f2a7a0', 0],
  ['grid6', '#9fd3b8', 0],
  ['grid7', '#f3cf7a', 0],
  ['c5', '#b9a7e3', 150],
  ['u8', '#f7b98a', 150],
  ['ul10', '#7fcfd8', 150],
  ['dot-a7', '#f5a8c4', 180],
  ['dot-b6', '#9cc3a4', 180],
  ['dot-c5', '#c9b38f', 180],
  ['grid5', '#8fc7e8', 150],
  ['grid4', '#d4b0d9', 150],
  ['grid12', '#e9c46a', 150],
  ['plain', '#c8ccd2', 120],
  ['eng13', '#a3c9a8', 180],
  ['eng15', '#e8a3a3', 180],
  ['staff', '#5f6f9a', 250],
  ['dotgrid', '#e0a96d', 220],
  ['cornell', '#6fa8a0', 250],
  ['genkou', '#c97b6b', 250],
  ['kanji', '#8a9a5b', 250]
];
export const STARTER_NOTEBOOKS = NB.filter(([, , p]) => p === 0).map(([f]) => `nb-${f}`);
/** v0.18 までの紙の選び方（localStorage の note.paper）→ ノートの id */
export const LEGACY_PAPER_KEYS = {'ruled-6': 'nb-b6', 'ruled-7': 'nb-a7', 'grid-6': 'nb-grid6', 'grid-7': 'nb-grid7'};
const NICHE = new Set(['staff', 'dotgrid', 'cornell', 'genkou', 'kanji']);
export const NOTEBOOKS = NB.map(([format, cover, points]) => ({
  id: `nb-${format}`,
  type: 'notebook',
  name: `Pastelle ${FORMATS[format].name}`,
  format,
  cover,
  price: 0,
  points,
  niche: NICHE.has(format),
  maker: 'Pastelle'
}));
/** ノートの品の、はじめの紙の設定 */
export const designOf = (item) => cleanDesign({format: item?.format});

/** 色の明るさ（0〜1。WCAG の相対輝度） */
function luminance(c) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 表紙の絵（SVG。全テンプレート共通の形で、変えるのは色だけ）：一色の表紙・左の背（表紙の色を少し暗く）・
 * 下に細い線と斜体の「Pastelle」。表紙の字は「Pastelle」だけ。字と線は白で、淡い表紙（黄色など）では表紙の色を濃くした色。
 * width は表示の幅（px）
 */
export function coverArt(item, {width = 96} = {}) {
  const c = item?.cover ?? '#8fb8e8';
  const ink = luminance(c) > 0.55 ? mix(c, -0.5) : '#ffffff';
  const h = Math.round((width * 160) / 120);
  const id = `nbc-${String(item?.id ?? 'x').replace(/[^a-z0-9-]/gi, '')}`;
  return `<svg class="nb-cover" viewBox="0 0 120 160" width="${width}" height="${h}" role="img" aria-label="${esc(item?.name ?? 'ノート')}の表紙">
    <defs><clipPath id="${id}"><rect x="2" y="2" width="116" height="156" rx="4"/></clipPath></defs>
    <g clip-path="url(#${id})">
      <rect x="2" y="2" width="116" height="156" fill="${c}"/>
      <rect x="2" y="2" width="11" height="156" fill="${mix(c, -0.22)}"/>
      <path d="M13 2v156" stroke="#000000" stroke-opacity="0.12" stroke-width="0.8"/>
      <path d="M44 136h48" stroke="${ink}" stroke-opacity="0.8" stroke-width="0.6"/>
      <text x="68" y="148" text-anchor="middle" font-size="10" font-family="Georgia, 'Times New Roman', serif" font-style="italic" letter-spacing="1.6" fill="${ink}">Pastelle</text>
    </g>
    <rect x="2" y="2" width="116" height="156" rx="4" fill="none" stroke="#2b2b2b" stroke-opacity="0.55" stroke-width="1"/>
  </svg>`;
}

function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[ch]
  );
}

// ---- マイノート ----

export const MY_NOTES_MAX = 30;
/**
 * マイノートを整える：{id, name, base（もとにしたノートの id）, design}。持っていないノートのものは外す。名前は 1〜30 字
 */
export function cleanMyNotes(raw, owned) {
  const has = new Set(owned);
  const out = [];
  const ids = new Set();
  for (const n of Array.isArray(raw) ? raw : []) {
    if (!n || typeof n !== 'object' || typeof n.id !== 'string' || !/^my-[a-z0-9-]{1,40}$/.test(n.id)) continue;
    if (ids.has(n.id) || !has.has(n.base)) continue;
    const base = NOTEBOOKS.find((b) => b.id === n.base);
    if (!base) continue;
    const name =
      String(n.name ?? '')
        .trim()
        .slice(0, 30) || base.name;
    out.push({id: n.id, name, base: n.base, design: cleanDesign({...n.design, format: base.format})});
    ids.add(n.id);
    if (out.length >= MY_NOTES_MAX) break;
  }
  return out;
}
