// PDF の注釈（SPEC §9.3）の形と検査。副作用なし。レンダラから来た値はここを通してから DB に入れる。
// 座標は PDF のユーザー空間（左下原点、pt）。rect の (x, y) は箱の左下、w・h は幅と高さ。
// 文字入れ：フォントはヒラギノ角ゴのみ（選べない）。変えられるのはサイズ・太字・色。
// 文字隠し（mask）：マーカー。色は赤の成分が 0 の色だけ（既定は水色）。body にはマーカーの下の文字（hiddenText）を入れる。
// ボールペン（ink）：手で書いた線。body に点の並び（shared/ink.js の encodePoints）、style に色と太さ。rect は点を囲む四角。
// アンダーライン（line）：文字の下に引くマーカーの線（乗算で重ねる四角）。style に色と太さ。
import {WIDTH_MAX, WIDTH_MIN, boundsOf, decodePoints, encodePoints} from './ink.js';
import {hiderColorOk} from './stationery.js';

export const KINDS = ['text', 'note', 'mask', 'ink', 'line'];
export const MASK_COLOR = '#00d2ff';
export const TEXT_MAX = 2000;
export const NOTE_MAX = 5000;
export const SIZE_MIN = 6;
export const SIZE_MAX = 72;
export const DEFAULT_SIZE = 12;
export const DEFAULT_TEXT_COLOR = '#2b2b2b';
export const DEFAULT_NOTE_COLOR = '#f6c445';
export const NOTE_SIZE = 20; // 付箋アイコンの一辺（pt）

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
    if (points.some(([px, py]) => Math.abs(px) > COORD_MAX || Math.abs(py) > COORD_MAX)) throw new Error('位置が不正です');
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
    cleanStyle = {color: isHex(s.color) ? s.color.toLowerCase() : DEFAULT_NOTE_COLOR};
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
