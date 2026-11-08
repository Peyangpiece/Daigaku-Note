// ノート（docs/SPEC-NOTEBOOK.md）：回のノートの紙の形式・ショップのノート（Palette）・紙の設定・ページの計算・表紙の絵。副作用なし。
// ページの計算（pageGeometry）は mm の線・点で返し、PDF（main/note-pdf.js）と画面の見本（SVG）が同じ計算を使う。
// 罫の名前と幅は、学習ノートの代表的なもの（販売店の商品ページで確かめた。C 5 mm だけは確かめられず、一般に知られている幅。docs/SPEC-NOTEBOOK.md §3.1）。表紙は全テンプレート共通の形で、色だけを変える

import {SCAN_DROPOUT, scanMarks} from './scan-code.js';

/** A4 縦（mm） */
export const PAGE_W = 210;
export const PAGE_H = 297;
/**
 * 上の欄（日付・題。header の絵を置く）の高さと、下の余白（mm）。A4 縦。
 * 罫を引くところの高さを 245 mm にする（コクヨのキャンパスノート A4・A 罫 7 mm は 35 行＝245 mm。v0.19.4）。上下は同じ幅
 */
export const HEAD_H = 26;
export const FOOT_H = 26;
/**
 * 紙の大きさ（mm。縦のとき）。body：罫を引くところの高さ（上下は同じ幅に空ける）。
 * A4 はキャンパスノート A4・A 罫 35 行（245 mm）。B5 はスキャン用のノート紙（docs/SPEC-SCAN.md）で、セミ B5 のキャンパスノート・A 罫 30 行（210 mm）にそろえる
 */
export const SIZES = {
  a4: {w: 210, h: 297, body: 245, label: 'A4'},
  b5: {w: 182, h: 257, body: 210, label: 'B5'}
};
/** A4 横（原稿用紙）の上の欄と下の余白（mm） */
const WIDE_HEAD = 20;
const WIDE_FOOT = 10;

/**
 * 罫の形式。kind：線の引き方。gap：はじめの行の間（ます・段の線の間）mm。range：マイノートで変えられる幅 [最小, 最大]（mm）。
 * bold：方眼の太線の間隔（ますの数。0 でなし）。rows：英習罫・五線譜の段の数。short：表紙の札の短い名前
 */
/** 漢字練習の読みの列の幅（ますの何倍か） */
const KANJI_RUBY = 0.32;

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
  // 英習罫の線の間：13 段は 3.5 mm・15 段は 3 mm（コクヨのキャンパスノートの表記。v0.19.4）
  eng13: {kind: 'english', name: '英習罫 13 段', short: '英習 13段', gap: 3.5, rows: 13},
  eng15: {kind: 'english', name: '英習罫 15 段', short: '英習 15段', gap: 3, rows: 15},
  // 五線譜：A4 縦に 12 段。線の長さ 180 mm（左右 15 mm 空ける）、五線の高さ 8 mm（線の間 2 mm）。段の端の縦線は引かない（市販の五線ノートと同じ）
  staff: {kind: 'staff', name: '五線譜 12 段', short: '五線譜', gap: 2, rows: 12, head: 'none', line: '#a7afb9'},
  dotgrid: {kind: 'dotgrid', name: 'ドット方眼 5 mm', short: 'ドット 5mm', gap: 5},
  cornell: {kind: 'cornell', name: 'コーネル式（7 mm）', short: 'コーネル', gap: 7},
  // 原稿用紙：A4 横・縦書き 20 字 × 20 行（400 字）。行と行の間にふりがなの細い行、真ん中に折り目の柱と魚尾（市販の 400 字詰めと同じ組み方）
  genkou: {
    kind: 'genkou',
    name: '原稿用紙（20 × 20・縦書き）',
    short: '原稿用紙',
    gap: 8,
    landscape: true,
    head: 'none',
    line: '#a7afb9'
  },
  // 漢字練習（書き取り）：たて書きの行ごとに、ますの右に読みの細い列。ますの中に薄い点線の十字（十字リーダー）。
  // 字数は市販の漢字練習帳の代表的なもの（行 × 1 行の字数）。ますの大きさは字数から決まる（変えられない。v0.19.6）。
  // kanji（104 字）は v0.19.0 からの品の id のまま
  ...Object.fromEntries(
    [
      ['kanji50', 5, 10],
      ['kanji84', 7, 12],
      ['kanji91', 7, 13],
      ['kanji100', 10, 10],
      ['kanji', 8, 13],
      ['kanji120', 8, 15],
      ['kanji150', 10, 15],
      ['kanji200', 10, 20]
    ].map(([id, lines, chars]) => [
      id,
      {
        kind: 'kanji',
        name: `漢字練習 ${lines * chars} 字（${lines} 行 × ${chars} 字）`,
        short: `漢字 ${lines * chars}字`,
        gap: kanjiCell(lines, chars),
        lines,
        chars,
        head: 'date',
        line: '#a7afb9'
      }
    ])
  )
};
/**
 * 幅が名前に書いてあるノート（「横罫 A（7 mm）」「方眼 5 mm」など）は、幅を変えられない（名前と中身が食いちがわないように。v0.19.4）。
 * 変えられるのは、名前に幅のない英習罫・五線譜・原稿用紙・漢字練習
 */
export const gapFixed = (format) => /\d\s*mm/.test(FORMATS[format]?.name ?? '');

/**
 * 漢字練習のますの大きさ（mm）：紙の罫を引くところ（左右 12 mm・高さ body から上の 3 mm を除いたところ）に、
 * ますと読みの列（ますの KANJI_RUBY 倍）が入る大きさ。0.5 mm 刻みで切り下げ
 */
function kanjiCell(lines, chars, size = 'a4') {
  const z = SIZES[size] ?? SIZES.a4;
  const s = Math.min((z.w - 24) / (lines * (1 + KANJI_RUBY)), (z.body - 3) / chars); // 上の欄の下を 3 mm あける
  return Math.floor(s * 2) / 2;
}

/** 種類ごとの変えられる幅（mm）と刻み */
export const GAP_RANGE = {
  ruled: [4, 12],
  dotruled: [4, 12],
  cornell: [4, 12],
  grid: [3, 12],
  dotgrid: [3, 12],
  english: [2.5, 5],
  staff: [1.5, 3],
  genkou: [6, 9],
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
// ふつうは v0.18 までの紙と同じ（横罫 0.5 pt。方眼はその 0.8 倍の 0.4 pt）
export const WEIGHTS = {thin: 0.12, normal: 0.176, bold: 0.3};
export const WEIGHT_LABEL = {thin: '細い', normal: 'ふつう', bold: '太い'};
/** ページ上部の線（上の欄の下）：なし・1 本・2 本・日付欄つき */
export const HEADS = ['none', 'line', 'double', 'date'];
export const HEAD_LABEL = {none: 'なし', line: '1 本', double: '2 本', date: '1 本と日付の欄'};
/** はじめの色（v2 の紙と同じ灰色） */
export const DEFAULT_LINE = '#c9cfd6';
export const DEFAULT_HEAD = '#a7afb9';
export const DEFAULT_MARGIN = '#e8a0a0';
export const DEFAULT_PAPER = '#ffffff';
/** 選べる色の見本（線・紙）。ほかの色も色の欄で選べる。茶・緑は原稿用紙によくある罫の色 */
export const LINE_SWATCHES = [
  '#c9cfd6',
  '#a7afb9',
  '#9cc0e6',
  '#a8d5c2',
  '#f2b8b5',
  '#e7c989',
  '#c8b6e2',
  '#b98a6e',
  '#7fa88a',
  '#4a5568'
];
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
  const size = Object.hasOwn(SIZES, d.size) ? d.size : 'a4';
  return {
    v: 3,
    format,
    // 紙の大きさ（a4・b5）と、スキャン用のノート紙か（四隅の目印と形式のコードを刷る。docs/SPEC-SCAN.md）
    size,
    scan: d.scan === true,
    // アナログノートから取り込んだページ（スキャン用の紙と同じ大きさ・同じ位置の罫。目印とコードはなし。上の欄の字は刷らない）
    analog: d.scan === true || d.analog === true,
    gap:
      f.kind === 'kanji'
        ? kanjiCell(f.lines, f.chars, size)
        : gapFixed(format)
          ? f.gap
          : clampGap(f.kind, d.gap, f.gap),
    line: hex(d.line, f.line ?? DEFAULT_LINE),
    weight: Object.hasOwn(WEIGHTS, d.weight) ? d.weight : 'normal',
    head: HEADS.includes(d.head) ? d.head : (f.head ?? 'line'),
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

/**
 * スキャン用のノート紙の設定（B5・四隅の目印と形式のコードつき・罫はドロップアウトカラー。docs/SPEC-SCAN.md）。
 * 刷る紙（scripts/scan-sheets.mjs）と、取り込んだときのアプリの紙が同じ設定を使う
 */
export function scanDesign(format) {
  return cleanDesign({format, size: 'b5', scan: true, line: SCAN_DROPOUT, headColor: SCAN_DROPOUT, head: 'date'});
}

/**
 * アナログノートを取り込んだページの紙：デジタルの Palette ノートの罫の色・形で、スキャン用の紙と同じ大きさ・同じ位置（書いた線がずれない）。
 * 目印と形式のコードは描かない
 */
export function analogDesign(format) {
  return cleanDesign({format, size: 'b5', analog: true, head: 'date'});
}

/** ページの大きさ（mm）。紙の大きさ（A4・B5）の縦。原稿用紙だけ横 */
export function pageSize(raw) {
  const d = cleanDesign(raw);
  const z = SIZES[d.size];
  return FORMATS[d.format].landscape ? {w: z.h, h: z.w} : {w: z.w, h: z.h};
}

/** 方眼などを左右の真ん中にそろえる：左右 side mm ずつ空けた幅に入るだけのます。戻り {left, cols} */
function centered(gap, side = 8, W = PAGE_W) {
  const cols = Math.floor((W - 2 * side) / gap);
  return {left: (W - cols * gap) / 2, cols};
}

/**
 * 1 ページに描くもの（mm。y は上から）。戻り：{w, h, paper, lines: [{x1, y1, x2, y2, w, c, dash?}], dots: [{x, y, r, c}],
 * polys: [{pts: [[x, y]…], c}]（塗る形。原稿用紙の魚尾）, headLeft}。w・h はページの大きさ（原稿用紙は A4 横）。
 * 上の欄の下の線（head）・左の余白の線もここで返す
 */
export function pageGeometry(raw) {
  const d = cleanDesign(raw);
  const f = FORMATS[d.format];
  const w = WEIGHTS[d.weight];
  const {w: W, h: H} = pageSize(d);
  const lines = [];
  const dots = [];
  const polys = [];
  const z = SIZES[d.size];
  const top = W > H ? WIDE_HEAD : (H - z.body) / 2;
  // スキャン用の紙は、下の端の形式のコード（紙の端から 16 mm まで）にかからないよう、横の紙の下を 18 mm 空ける
  const bottom = H - (W > H ? (d.analog ? 18 : WIDE_FOOT) : (H - z.body) / 2);
  const L = (x1, y1, x2, y2, width = w, c = d.line, dash = null) =>
    lines.push({x1, y1, x2, y2, w: width, c, ...(dash ? {dash} : {})});
  // 原稿用紙は 20 ますが上下に入る大きさまで（B5 横では 7.5 mm まで）
  const g = f.kind === 'genkou' ? Math.min(d.gap, Math.floor(((bottom - top) / 20) * 2) / 2) : d.gap;
  let headLeft = 0;
  let headRight = W;
  if (f.kind === 'ruled' || f.kind === 'dotruled') {
    const rows = Math.floor((bottom - top) / g);
    for (let i = 1; i <= rows; i++) L(0, top + i * g, W, top + i * g);
    if (d.dots) {
      const {left, cols} = centered(g, 6, W);
      for (let i = 1; i <= rows; i++)
        for (let j = 0; j <= cols; j++) dots.push({x: left + j * g, y: top + i * g, r: w * 1.6, c: d.line});
    }
    if (d.margin) L(20, top, 20, top + rows * g, w * 1.3, d.marginColor);
  } else if (f.kind === 'grid' || f.kind === 'dotgrid') {
    // 太線があるときは、ますの数を太線の間隔の倍数にそろえ、外のわくが太線で閉じるようにする（v0.19.4）
    const fit = (n) => (f.kind === 'grid' && d.bold > 0 ? Math.floor(n / d.bold) * d.bold : n);
    const room = centered(g, 8, W);
    const cols = fit(room.cols);
    const left = (W - cols * g) / 2;
    const rows = fit(Math.floor((bottom - top) / g));
    headLeft = left;
    headRight = left + cols * g;
    if (f.kind === 'dotgrid') {
      // 上の線があれば、いちばん上の点の列は線と重なるので打たない
      for (let i = d.head === 'none' ? 0 : 1; i <= rows; i++)
        for (let j = 0; j <= cols; j++) dots.push({x: left + j * g, y: top + i * g, r: w * 1.7, c: d.line});
    } else {
      // 方眼の線は横罫より細い（v0.18 までの紙と同じ 0.8 倍）。太線はその 1.9 倍。
      // いちばん上の線も引く（上の線を「なし」にしても、方眼の上のわくが残る。上の線があればその下に重なる）
      const gw = w * 0.8;
      const thick = (k) => d.bold > 0 && k % d.bold === 0;
      for (let i = 0; i <= rows; i++) L(left, top + i * g, left + cols * g, top + i * g, thick(i) ? gw * 1.9 : gw);
      for (let j = 0; j <= cols; j++) L(left + j * g, top, left + j * g, top + rows * g, thick(j) ? gw * 1.9 : gw);
    }
  } else if (f.kind === 'english') {
    // 4 本線（上・点線・基線・下）の段を、上の欄の下から下の余白まで等しく並べる
    const n = f.rows;
    const h = 3 * g;
    const space = (bottom - top - 6 - n * h) / (n - 1);
    for (let k = 0; k < n; k++) {
      const y = top + 6 + k * (h + space);
      L(12, y, W - 12, y);
      L(12, y + g, W - 12, y + g, w, d.line, [1.2, 1.2]);
      L(12, y + 2 * g, W - 12, y + 2 * g, w * 1.8);
      L(12, y + 3 * g, W - 12, y + 3 * g);
    }
    headLeft = 12;
    headRight = W - 12;
  } else if (f.kind === 'staff') {
    // 12 段を上の欄の下から下の余白まで等しく並べる。線の長さ 180 mm（左右 15 mm）。段の端に縦線は引かない
    const n = f.rows;
    const h = 4 * g;
    const side = 15;
    const space = (bottom - top - 10 - n * h) / (n - 1);
    for (let k = 0; k < n; k++) {
      const y = top + 6 + k * (h + space);
      for (let m = 0; m < 5; m++) L(side, y + m * g, W - side, y + m * g);
    }
    headLeft = side;
    headRight = W - side;
  } else if (f.kind === 'cornell') {
    // コーネル式の決まりの寸法：左に手がかりの欄（2.5 インチ＝63.5 mm）・下に要約の欄（2 インチ＝50.8 mm）・ほかは横罫
    const summary = bottom - 50.8;
    const rows = Math.floor((summary - top) / g);
    for (let i = 1; i <= rows; i++) L(0, top + i * g, W, top + i * g);
    L(63.5, top, 63.5, summary, w * 1.9);
    L(0, summary, W, summary, w * 1.9);
  } else if (f.kind === 'genkou') {
    // A4 横・縦書き 20 字 × 20 行。右半分と左半分に 10 行ずつ、そのあいだに折り目の柱（魚尾の印つき）。
    // 行（縦に 20 ます）と行のあいだには、ふりがなを書く細い行（ますの 0.4 倍）。外のわくと柱の両がわは太い線
    const n = 20;
    const ruby = Math.round(g * 0.4 * 100) / 100;
    const pillar = Math.round(g * 1.25 * 100) / 100;
    const half = 10 * g + 9 * ruby;
    const total = 2 * half + pillar;
    const x0 = (W - total) / 2;
    const y0 = top + (bottom - top - n * g) / 2;
    const y1 = y0 + n * g;
    const thick = w * 2.6;
    for (const hx of [x0, x0 + half + pillar]) {
      for (let k = 0; k < 10; k++) {
        const cx = hx + k * (g + ruby);
        // ますの縦の線（行の左右）。半分の外の端はわく（太い線）で描くので、ここでは引かない
        if (k > 0) L(cx, y0, cx, y1);
        if (k < 9) L(cx + g, y0, cx + g, y1);
        for (let i = 1; i < n; i++) L(cx, y0 + i * g, cx + g, y0 + i * g);
      }
      // 半分ごとのわく
      L(hx, y0, hx + half, y0, thick);
      L(hx, y1, hx + half, y1, thick);
      L(hx, y0, hx, y1, thick);
      L(hx + half, y0, hx + half, y1, thick);
    }
    // 柱の上と下の線（わくと同じ太さ）
    L(x0 + half, y0, x0 + half + pillar, y0, thick);
    L(x0 + half, y1, x0 + half + pillar, y1, thick);
    // 魚尾：柱の上の方に、下の辺に V の切れ込みのある帯（折り目の目印）
    const pl = x0 + half;
    const pr = pl + pillar;
    const fy = y0 + g * 1.6;
    const fh = pillar * 0.62;
    polys.push({
      pts: [
        [pl, fy],
        [pr, fy],
        [pr, fy + fh],
        [(pl + pr) / 2, fy + fh * 0.5],
        [pl, fy + fh]
      ],
      c: d.line
    });
    headLeft = x0;
    headRight = x0 + total;
  } else if (f.kind === 'kanji') {
    // 書き取り（v0.19.6）：行（たて）ごとに、ます（g）の右に読みの列（g × KANJI_RUBY）。行は f.lines 本、1 行に f.chars 字。
    // わくは左右の真ん中、上は上の欄のすぐ下。外のわくは太く、ますと読みの列の境は細い線。ますの中の十字は薄い点線
    const n = f.lines;
    const m = f.chars;
    const r = Math.round(g * KANJI_RUBY * 100) / 100;
    const total = n * (g + r);
    const x0 = (W - total) / 2;
    const y0 = top + 3; // 上の欄（日付）のすぐ下から
    const y1 = y0 + m * g;
    const thick = w * 2.6;
    for (let i = 0; i <= m; i++) L(x0, y0 + i * g, x0 + total, y0 + i * g, i % m === 0 ? thick : w);
    for (let k = 0; k < n; k++) {
      const cx = x0 + k * (g + r);
      if (k > 0) L(cx, y0, cx, y1);
      L(cx + g, y0, cx + g, y1);
    }
    L(x0, y0, x0, y1, thick);
    L(x0 + total, y0, x0 + total, y1, thick);
    // 十字リーダー：罫線より薄い色の細い点線
    const faint = mix(d.line, 0.45);
    const fw = w * 0.75;
    for (let k = 0; k < n; k++) {
      const cx = x0 + k * (g + r);
      L(cx + g / 2, y0, cx + g / 2, y1, fw, faint, [0.7, 0.9]);
      for (let i = 0; i < m; i++) L(cx, y0 + (i + 0.5) * g, cx + g, y0 + (i + 0.5) * g, fw, faint, [0.7, 0.9]);
    }
    headLeft = x0;
    headRight = x0 + total;
  }
  // ページ上部の線（上の欄の下）
  // 上の欄の下の線：v0.18 までの紙と同じく、横罫 0.9 pt・方眼 0.8 pt（ふつうの太さのとき）
  const hw = w * (f.kind === 'grid' || f.kind === 'dotgrid' ? 1.6 : 1.8);
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
  // headerY：上の欄の字（回のノートの授業・回・題・日付）の下の端（上の線の 4 mm 上）
  // スキャン用のノート紙：四隅の目印と、下の端の形式のコード（docs/SPEC-SCAN.md）。刷った紙とアプリの紙で同じものを描く
  if (d.scan) polys.push(...scanMarks(W, H, d.format));
  return {w: W, h: H, top, bottom, paper: d.paper, lines, dots, polys, headLeft, headerY: top - 4};
}

/**
 * 一覧の札に拡大して見せるところ（mm）：ページの左上（上の欄の線と罫の始まり）。
 * 原稿用紙は真ん中の柱と魚尾、五線譜は線の左の端が入るところ。幅 w・高さ h（4:5）
 */
export function cropOf(raw) {
  const d = cleanDesign(raw);
  const g = pageGeometry(d);
  const kind = FORMATS[d.format].kind;
  const w = 56;
  const h = 70;
  if (kind === 'genkou') return {x: g.w / 2 - w / 2, y: Math.min(...g.lines.map((l) => l.y1)) - 5, w, h}; // わくの上から
  if (kind === 'staff') return {x: 8, y: g.top - 6, w, h};
  if (kind === 'kanji') {
    // わくの左上の角から
    const left = Math.min(...g.lines.map((l) => l.x1));
    const upper = Math.min(...g.lines.map((l) => l.y1).filter((y) => y >= g.top));
    return {x: left - 4, y: upper - 4, w, h};
  }
  if (kind === 'cornell') return {x: 63.5 - w / 2, y: g.top - 8, w, h}; // 手がかりの欄の線が入るところ
  return {x: 0, y: g.top - 8, w, h};
}

/**
 * ページの見本（SVG。幅 width px、高さはページの比。原稿用紙は横長）。aria は呼ぶ側で付ける。
 * thumb：小さな見本（線が消えないよう最小の太さを付ける）。crop：{x, y, w, h}（mm）を切り出して拡大して見せる（一覧の札）。
 * mm：true なら width・height を mm で書く（試し書きの実際の大きさ）
 */
export function pageSvg(raw, {width = 210, thumb = false, crop = null, mm = false} = {}) {
  const g = pageGeometry(raw);
  const box = crop ?? {x: 0, y: 0, w: g.w, h: g.h};
  const scale = width / box.w; // 1 mm あたりの px
  // 小さな見本（thumb）は、線が 1 画素より細くなって消えないよう、線と点に最小の太さを付ける（mm に直す）。
  // 太くしたぶんは少しだけ薄くする（はっきり見えるよう 0.7 より薄くはしない）
  const minW = thumb ? 0.9 / scale : 0.15;
  const minR = thumb ? 0.75 / scale : 0.25;
  const n = (v) => +v.toFixed(2);
  const lines = g.lines
    .map(
      (l) =>
        `<line x1="${n(l.x1)}" y1="${n(l.y1)}" x2="${n(l.x2)}" y2="${n(l.y2)}" stroke="${l.c}" stroke-width="${n(Math.max(l.w, minW))}"${l.w < minW ? ` stroke-opacity="${n(Math.max(0.7, l.w / minW))}"` : ''}${l.dash ? ` stroke-dasharray="${l.dash.join(' ')}"` : ''}/>`
    )
    .join('');
  const dots = g.dots
    .map((p) => `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(Math.max(p.r, minR))}" fill="${p.c}"/>`)
    .join('');
  const polys = g.polys
    .map((p) => `<polygon points="${p.pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${p.c}"/>`)
    .join('');
  const height = (width * box.h) / box.w;
  const size = mm ? `width="${n(box.w)}mm" height="${n(box.h)}mm"` : `width="${width}" height="${Math.round(height)}"`;
  return `<svg class="nb-page${g.w > g.h ? ' nb-page--wide' : ''}" viewBox="${n(box.x)} ${n(box.y)} ${n(box.w)} ${n(box.h)}" ${size} aria-hidden="true"><rect width="${g.w}" height="${g.h}" fill="${g.paper}"/>${lines}${dots}${polys}</svg>`;
}

// ---- ショップのノート（Palette）----

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
  ['kanji50', '#b7c97a', 200],
  ['kanji84', '#7fb08f', 200],
  ['kanji91', '#d8a46f', 200],
  ['kanji100', '#9b8fc4', 200],
  ['kanji', '#8a9a5b', 200],
  ['kanji120', '#5f8fb0', 200],
  ['kanji150', '#c48f9b', 200],
  ['kanji200', '#6f7f6a', 200]
];
export const STARTER_NOTEBOOKS = NB.filter(([, , p]) => p === 0).map(([f]) => `nb-${f}`);
/** v0.18 までの紙の選び方（localStorage の note.paper）→ ノートの id */
export const LEGACY_PAPER_KEYS = {'ruled-6': 'nb-b6', 'ruled-7': 'nb-a7', 'grid-6': 'nb-grid6', 'grid-7': 'nb-grid7'};
const NICHE = new Set([
  'staff',
  'dotgrid',
  'cornell',
  'genkou',
  'kanji',
  'kanji50',
  'kanji84',
  'kanji91',
  'kanji100',
  'kanji120',
  'kanji150',
  'kanji200'
]);
export const NOTEBOOKS = NB.map(([format, cover, points]) => ({
  id: `nb-${format}`,
  type: 'notebook',
  name: `Palette ${FORMATS[format].name}`,
  format,
  cover,
  price: 0,
  points,
  niche: NICHE.has(format)
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
 * 下に細い線と斜体の「Palette」。表紙の字は「Palette」だけ。字と線は白で、淡い表紙（黄色など）では表紙の色を濃くした色。
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
      <text x="68" y="148" text-anchor="middle" font-size="10" font-family="Georgia, 'Times New Roman', serif" font-style="italic" letter-spacing="1.6" fill="${ink}">Palette</text>
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
