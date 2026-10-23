// フォルダ名・ファイル名の整え方（SPEC §7.1）。Mac・Windows の両方で使える名前にする。副作用なし。

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', {granularity: 'grapheme'}) : null;

/** 先頭から max コードポイントで切る。結合文字・絵文字（書記素）の途中では切らない */
export function truncateCodePoints(text, max) {
  const s = String(text ?? '');
  if ([...s].length <= max) return s;
  if (!segmenter) return [...s].slice(0, max).join('');
  let out = '',
    count = 0;
  for (const {segment} of segmenter.segment(s)) {
    const n = [...segment].length;
    if (count + n > max) break;
    out += segment;
    count += n;
  }
  return out;
}

/** 空白を整え、使えない文字を _ にし、末尾の空白とピリオドを _ にし、Windows の予約名を避ける */
export function sanitizeSegment(text, {max = 0} = {}) {
  let t = String(text ?? '')
    .normalize('NFC')
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(FORBIDDEN, '_');
  if (max > 0) t = truncateCodePoints(t, max).trim();
  t = t.replace(/[ .]+$/, (m) => '_'.repeat(m.length));
  const stem = t.replace(/\.[^.]*$/, '');
  if (RESERVED.test(stem)) t += '_';
  return t;
}

/** 授業フォルダ名（LMS の授業名から） */
export function courseFolderName(name) {
  return sanitizeSegment(name, {max: 80}) || '授業';
}

/** 回フォルダ名：第NN回_<タイトル 40 文字>。0 は「その他」。existing に同名があれば (2) (3) を足す */
export function roundFolderName(number, title, existing = []) {
  const n = Number(number) || 0;
  let base;
  if (n <= 0) base = 'その他';
  else {
    const t = sanitizeSegment(title, {max: 40});
    base = `第${String(n).padStart(2, '0')}回` + (t ? `_${t}` : '');
  }
  return uniqueName(base, (candidate) => existing.includes(candidate));
}

/** ファイル名：拡張子を保ち、幹を整える */
export function sanitizeFileName(name) {
  const raw = String(name ?? '').replace(/^.*[\\/]/, '');
  const m = raw.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
  const stem = sanitizeSegment(m?.[1] ?? raw, {max: 150}) || 'file';
  const ext = (m?.[2] ?? '').toLowerCase() === m?.[2] ? (m?.[2] ?? '') : (m?.[2] ?? '');
  return stem + ext;
}

/** 同名があれば「名前 (2).ext」の形で番号を足す。taken(candidate) が true の間は番号を増やす */
export function uniqueName(name, taken) {
  if (!taken(name)) return name;
  const m = name.match(/^(.*?)(\.[^.]+)?$/);
  const stem = m[1],
    ext = m[2] ?? '';
  for (let i = 2; i < 10000; i++) {
    const c = `${stem} (${i})${ext}`;
    if (!taken(c)) return c;
  }
  throw new Error('同じ名前が多すぎます');
}

/** 「名前 (2).pdf」の形か。元の名前と番号を返す */
export function parseNumbered(name) {
  const m = String(name).match(/^(.+) \((\d+)\)(\.[^.]+)?$/);
  return m ? {base: m[1] + (m[3] ?? ''), n: Number(m[2])} : null;
}
