// PDF の注釈（SPEC §9.3）の形と検査。副作用なし。レンダラから来た値はここを通してから DB に入れる。
// 座標は PDF のユーザー空間（左下原点、pt）。rect の (x, y) は箱の左下、w・h は幅と高さ。
// 文字入れ：フォントはヒラギノ角ゴのみ（選べない）。変えられるのはサイズ・太字・色。
// 文字隠し（mask）：マーカー。色は赤の成分が 0 の色だけ（既定は水色）。body にはマーカーの下の文字（hiddenText）を入れる。
// ボールペン（ink）：手で書いた線。body に点の並び（shared/ink.js の encodePoints）、style に色と太さ。rect は点を囲む四角。
// アンダーライン（line）：文字の下に引くマーカーの線（乗算で重ねる四角）。style に色と太さ。
// 貼りもの（stamp）：シール帳のシール・素材の図・メモ帳からちぎった紙。style.type で分け、style.ref にシール・図の id。
//   ちぎった紙（memo）は body に書いた文字、style に紙の色と文字の大きさ。rect は貼った四角（大きさを変えられる）
//   付箋（index）はページの端から外へはみ出して貼る目印。body に短い言葉、style に色
import {WIDTH_MAX, WIDTH_MIN, boundsOf, decodePoints, encodePoints} from './ink.js';
import {hiderColorOk} from './stationery.js';
import {isBuiltinSticker} from './stickers.js';
import {isFigure} from './figures.js';

export const KINDS = ['text', 'note', 'mask', 'ink', 'line', 'stamp'];
export const STAMP_TYPES = ['sticker', 'figure', 'memo', 'index'];
export const INDEX_LABEL_MAX = 12; // 付箋（インデックス）に書ける文字数
export const INDEX_COLOR = '#f28b82';
export const STAMP_MIN = 8; // 貼りものの一辺の最小（pt）
export const MEMO_COLOR = '#fffdf6'; // メモ帳の紙の既定の色
export const MEMO_SIZE = 10; // ちぎった紙の文字の大きさ（pt）
export const MASK_COLOR = '#00d2ff';
export const TEXT_MAX = 2000;
export const NOTE_MAX = 5000;
export const SIZE_MIN = 6;
export const SIZE_MAX = 72;
export const DEFAULT_SIZE = 12;
export const DEFAULT_TEXT_COLOR = '#2b2b2b';
export const DEFAULT_NOTE_COLOR = '#f6c445';
export const NOTE_SIZE = 20; // 付箋アイコンの一辺（pt）
export const NOTE_POP_MIN = 160; // メモの吹き出しの幅・高さ（画面 px）の範囲
export const NOTE_POP_MAX = 900;
export const NOTE_INK_MAX = 300; // メモの中の手書きの線の数の上限
export const NOTE_INK_SCALE = 1.6; // メモの中の手書きの太さ：ペンの太さ（pt）を吹き出しの px に（ページの 100% 表示より少し太く）
export const NOTE_INK_PT_PER_PX = 0.75; // 書き出し：吹き出しの px を PDF の pt に（100% 表示のときの大きさ）
const NOTE_INK_COORD_MAX = 4000; // メモの中の点の座標（吹き出しの左上からの px）

/**
 * 赤シートで消える色か：赤く見える色（赤が強く、緑・青が弱い）。文字入れの赤・赤のボールペンは、本物の赤シートと同じく下に入ると見えなくなる
 * 条件：赤 160 以上、緑 100 以下、青 70 以下、赤と緑・青の差が 70 以上（#d93025 の赤、#e03131 などが当たり、橙 #e37400・桃 #c2185b は当たらない）
 */
export function hidesUnderRedSheet(hex) {
  if (!isHex(hex)) return false;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  return r >= 160 && g <= 100 && b <= 70 && r - Math.max(g, b) >= 70;
}

/** メモの中の手書き（style.ink）を整える。形の悪い線は捨てる。戻りは配列（なければ空） */
function cleanNoteInk(ink) {
  if (!Array.isArray(ink)) return [];
  const out = [];
  for (const s of ink.slice(0, NOTE_INK_MAX)) {
    const points = typeof s?.p === 'string' ? decodePoints(s.p) : null;
    if (
      !points ||
      points.some(
        ([x, y]) =>
          x < -NOTE_INK_COORD_MAX || y < -NOTE_INK_COORD_MAX || x > NOTE_INK_COORD_MAX || y > NOTE_INK_COORD_MAX
      )
    )
      continue;
    const w = num(s.w);
    const stroke = {
      p: encodePoints(points),
      c: isHex(s.c) ? s.c.toLowerCase() : DEFAULT_TEXT_COLOR,
      w: Number.isNaN(w) ? 1.1 : Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, round2(w)))
    };
    if (s.pressure === false) stroke.pressure = false;
    out.push(stroke);
  }
  return out;
}
const popSize = (v) => {
  const n = num(v);
  return Number.isNaN(n) ? null : Math.round(Math.min(NOTE_POP_MAX, Math.max(NOTE_POP_MIN, n)));
};

const COORD_MAX = 20000; // A0 の長辺が約 3370pt。これを超える値は壊れた入力とみなす
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const round2 = (v) => Math.round(v * 100) / 100;

/** 文字入れのサイズを範囲に収める（0.5pt 刻み）。数でなければ既定 */
export function clampSize(v, fallback = DEFAULT_SIZE) {
  const n = num(Number(v));
  if (Number.isNaN(n)) return fallback;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n * 2) / 2));
}

/**
 * レンダラから来た注釈を検査して、annotation 表の列の形にする。不正なら Error を投げる。
 * 戻り値：{page, kind, rect_json, body, style_json}
 */
export function normalizeAnnotation(input, {pageCount = Infinity} = {}) {
  if (!input || typeof input !== 'object') throw new Error('注釈が不正です');
  const {kind, page, rect, body, style} = input;
  if (!KINDS.includes(kind)) throw new Error('注釈の種類が不正です');
  if (!Number.isInteger(page) || page < 1 || page > pageCount) throw new Error('ページが不正です');
  if (!rect || typeof rect !== 'object') throw new Error('位置が不正です');
  const x = num(rect.x),
    y = num(rect.y),
    w = num(rect.w),
    h = num(rect.h);
  if ([x, y, w, h].some(Number.isNaN)) throw new Error('位置が不正です');
  if (Math.abs(x) > COORD_MAX || Math.abs(y) > COORD_MAX || w < 0 || h < 0 || w > COORD_MAX || h > COORD_MAX)
    throw new Error('位置が不正です');
  const s = style && typeof style === 'object' ? style : {};
  const width = (v, fallback) => {
    const n = num(v);
    return Number.isNaN(n) ? fallback : Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, round2(n)));
  };
  if (kind === 'ink') {
    // 点の並びから四角を作り直す（レンダラから来た rect は使わない）
    const points = typeof body === 'string' ? decodePoints(body) : null;
    if (!points) throw new Error('線が不正です');
    if (points.some(([px, py]) => Math.abs(px) > COORD_MAX || Math.abs(py) > COORD_MAX))
      throw new Error('位置が不正です');
    const cleanStyle = {color: isHex(s.color) ? s.color.toLowerCase() : DEFAULT_TEXT_COLOR, width: width(s.width, 1.1)};
    if (s.pressure === false) cleanStyle.pressure = false; // 筆圧の取れない道具で書いた（太さの変え方が違う。shared/ink.js）
    const b = boundsOf(points, cleanStyle.width);
    return {
      page,
      kind,
      rect_json: JSON.stringify({x: round2(b.x), y: round2(b.y), w: round2(b.w), h: round2(b.h)}),
      body: encodePoints(points),
      style_json: JSON.stringify(cleanStyle)
    };
  }
  if (kind === 'stamp') {
    if (w < STAMP_MIN || h < STAMP_MIN) throw new Error('貼りものの大きさが不正です');
    const type = STAMP_TYPES.includes(s.type) ? s.type : null;
    let cleanStyle;
    if (type === 'memo') {
      if (typeof body === 'string' && body.length > TEXT_MAX)
        throw new Error(`本文が長すぎます（${TEXT_MAX} 文字まで）`);
      cleanStyle = {
        type,
        color: isHex(s.color) ? s.color.toLowerCase() : MEMO_COLOR,
        size: clampSize(s.size, MEMO_SIZE)
      };
    } else if (type === 'index') {
      if (typeof body === 'string' && [...body].length > INDEX_LABEL_MAX)
        throw new Error(`付箋の言葉が長すぎます（${INDEX_LABEL_MAX} 文字まで）`);
      cleanStyle = {type, color: isHex(s.color) ? s.color.toLowerCase() : INDEX_COLOR};
    } else if (type === 'figure' && isFigure(s.ref)) cleanStyle = {type, ref: s.ref};
    else if (type === 'sticker' && (isBuiltinSticker(s.ref) || /^[0-9a-f]{64}$/.test(s.ref ?? '')))
      cleanStyle = {type, ref: s.ref};
    else throw new Error('貼りものが不正です');
    return {
      page,
      kind,
      rect_json: JSON.stringify({x: round2(x), y: round2(y), w: round2(w), h: round2(h)}),
      body: (type === 'memo' || type === 'index') && typeof body === 'string' ? body : '',
      style_json: JSON.stringify(cleanStyle)
    };
  }
  const text = typeof body === 'string' ? body : '';
  const max = kind === 'note' ? NOTE_MAX : TEXT_MAX;
  if (text.length > max) throw new Error(`本文が長すぎます（${max} 文字まで）`);
  let cleanStyle;
  if (kind === 'text') {
    cleanStyle = {
      size: clampSize(s.size),
      bold: s.bold === true,
      color: isHex(s.color) ? s.color.toLowerCase() : DEFAULT_TEXT_COLOR
    };
  } else if (kind === 'note') {
    // メモ：色のほかに、吹き出しの大きさ（w・h。画面 px）と中の手書き（ink：線ごとに点・色・太さ）
    cleanStyle = {color: isHex(s.color) ? s.color.toLowerCase() : DEFAULT_NOTE_COLOR};
    const w = popSize(s.w),
      h = popSize(s.h);
    if (w) cleanStyle.w = w;
    if (h) cleanStyle.h = h;
    const ink = cleanNoteInk(s.ink);
    if (ink.length) cleanStyle.ink = ink;
  } else if (kind === 'line') {
    if (w === 0 || h === 0) throw new Error('マーカーの大きさが不正です');
    cleanStyle = {color: isHex(s.color) ? s.color.toLowerCase() : '#ffe14d', width: width(s.width, 2.5)};
  } else {
    if (w === 0 || h === 0) throw new Error('マーカーの大きさが不正です');
    // 赤シートで隠れる色（赤の成分が 0）だけ。既定の水色は保存しない（前の版の注釈と同じ形）
    cleanStyle = hiderColorOk(s.color) && s.color.toLowerCase() !== MASK_COLOR ? {color: s.color.toLowerCase()} : {};
  }
  return {
    page,
    kind,
    rect_json: JSON.stringify({
      x: round2(x),
      y: round2(y),
      w: kind === 'note' ? NOTE_SIZE : round2(w),
      h: kind === 'note' ? NOTE_SIZE : round2(h)
    }),
    body: text,
    style_json: JSON.stringify(cleanStyle)
  };
}

/** annotation 表の行をレンダラへ渡す形にする */
export function annotationToClient(row) {
  return {
    id: row.id,
    page: row.page,
    kind: row.kind,
    rect: JSON.parse(row.rect_json),
    body: row.body ?? '',
    style: row.style_json ? JSON.parse(row.style_json) : {},
    z: row.z
  };
}
