// スキャン用のノート紙（docs/SPEC-SCAN.md）の目印と形式のコード。副作用なし。
// 紙の四隅に目印（左上・右上・左下は黒い四角、右下は中の白い四角：向きが分かる）、下の端の真ん中に形式のコードを刷る。
// コードは全ページ同じ（ページごとに変えない）。中身：形式の番号 6 ビット・版 4 ビット・検査 6 ビット（合わせて 16 ビット）。
// 読み取り（写真から紙を見つけて直す）は、目印の位置と、コードの区切り（前 101・後ろ 1011）を手がかりにする

/** 形式の番号（コードに入れる）。並びは変えない（刷った紙が読めなくなる）。新しい形式は後ろに足す */
export const SCAN_FORMAT_IDS = [
  'a7',
  'b6',
  'c5',
  'u8',
  'ul10',
  'dot-a7',
  'dot-b6',
  'dot-c5',
  'grid5',
  'grid4',
  'grid6',
  'grid7',
  'grid12',
  'plain',
  'eng13',
  'eng15',
  'staff',
  'dotgrid',
  'cornell',
  'genkou',
  'kanji50',
  'kanji84',
  'kanji91',
  'kanji100',
  'kanji',
  'kanji120',
  'kanji150',
  'kanji200'
];
/** コードの版（紙の組み方を変えたら上げる。0〜15） */
export const SCAN_CODE_VERSION = 1;

/** 目印・コードの寸法（mm） */
export const SCAN_MARK = {
  inset: 6, // 紙の端から目印の外側まで
  size: 5, // 目印の一辺
  hole: 2.2, // 右下の目印の中の白い四角の一辺
  module: 1.5, // コードの 1 ビットの幅
  codeH: 3.5, // コードの高さ
  codeFromBottom: 12.5 // 紙の下の端からコードの上の端まで
};
/** 目印とコードの色（黒。罫線のドロップアウトカラーと見分ける） */
export const SCAN_INK = '#1a1a1a';
/** 罫線の色（ドロップアウトカラー：薄い水色。取り込むときに色で見分けて消す） */
export const SCAN_DROPOUT = '#8fcbea';

const START = [1, 0, 1];
const STOP = [1, 0, 1, 1];
const bitsOf = (n, len) => Array.from({length: len}, (_, i) => (n >> (len - 1 - i)) & 1);
const numOf = (bits) => bits.reduce((a, b) => a * 2 + b, 0);
const check = (id, ver) => (id * 7 + ver * 13 + 29) % 64;

/** 形式のコード（0・1 の並び。前後の区切りを含む 23 ビット）。知らない形式は null */
export function encodeScanCode(format, version = SCAN_CODE_VERSION) {
  const id = SCAN_FORMAT_IDS.indexOf(format);
  if (id < 0 || id > 63 || version < 0 || version > 15) return null;
  return [...START, ...bitsOf(id, 6), ...bitsOf(version, 4), ...bitsOf(check(id, version), 6), ...STOP];
}

/** コードを読む。戻り {format, version} か null（区切り・検査が合わない） */
export function decodeScanCode(bits) {
  if (!Array.isArray(bits) || bits.length !== 23) return null;
  if (START.some((b, i) => bits[i] !== b) || STOP.some((b, i) => bits[19 + i] !== b)) return null;
  const id = numOf(bits.slice(3, 9));
  const version = numOf(bits.slice(9, 13));
  if (numOf(bits.slice(13, 19)) !== check(id, version)) return null;
  const format = SCAN_FORMAT_IDS[id];
  return format ? {format, version} : null;
}

/**
 * 目印とコードの形（mm・上から）。戻り：塗る形の並び [{pts, c}]。w・h は紙の大きさ、format は形式
 */
export function scanMarks(w, h, format) {
  const {inset: m, size: s, hole, module, codeH, codeFromBottom} = SCAN_MARK;
  const rect = (x, y, rw, rh) => [
    [x, y],
    [x + rw, y],
    [x + rw, y + rh],
    [x, y + rh]
  ];
  const polys = [
    {pts: rect(m, m, s, s), c: SCAN_INK},
    {pts: rect(w - m - s, m, s, s), c: SCAN_INK},
    {pts: rect(m, h - m - s, s, s), c: SCAN_INK}
  ];
  // 右下：中に白い四角を抜いた枠（4 本の帯で描く）
  const x = w - m - s;
  const y = h - m - s;
  const t = (s - hole) / 2;
  polys.push(
    {pts: rect(x, y, s, t), c: SCAN_INK},
    {pts: rect(x, y + s - t, s, t), c: SCAN_INK},
    {pts: rect(x, y + t, t, hole), c: SCAN_INK},
    {pts: rect(x + s - t, y + t, t, hole), c: SCAN_INK}
  );
  const bits = encodeScanCode(format) ?? [];
  const x0 = (w - bits.length * module) / 2;
  const cy = h - codeFromBottom;
  bits.forEach((b, i) => {
    if (b) polys.push({pts: rect(x0 + i * module, cy, module, codeH), c: SCAN_INK});
  });
  return polys;
}
