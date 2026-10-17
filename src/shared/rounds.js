// 回（第 N 回）の番号の読み取り（SPEC §6.8）。副作用なし。

const KANJI = {一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10};

/** 漢数字（一〜九十九）を数に。読めなければ NaN */
export function kanjiToNumber(s) {
  const t = String(s ?? '').trim();
  if (!t) return NaN;
  if (/^\d+$/.test(t)) return Number(t);
  let n = 0,
    cur = 0;
  for (const ch of t) {
    const v = KANJI[ch];
    if (v === undefined) return NaN;
    if (v === 10) {
      n += (cur || 1) * 10;
      cur = 0;
    } else cur = v;
  }
  return n + cur;
}

const MAX_ROUND = 60;
const ok = (n) => (Number.isInteger(n) && n >= 1 && n <= MAX_ROUND ? n : 0);

const PATTERNS = [
  // 第3回・第03回・第三回・第十五回・第3講・第3週（「第3限」は時限なので除く）
  /第\s*([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*(?:回|講|週)/,
  // 3回目・３回目
  /(?<![0-9])([0-9]{1,2})\s*回目/,
  // Week 3・Lecture 3・Lesson 03・Session 3・Class 3・Lec.3・Wk3
  /\b(?:week|wk|lecture|lec|lesson|session|class)\.?\s*#?\s*0?([0-9]{1,2})\b/i,
  // L03・L3（単独のトークン）
  /(?:^|[\s_\-\[(（])L0?([0-9]{1,2})(?=$|[\s_\-\]）)．.])/,
  // #3
  /#\s*0?([0-9]{1,2})\b/
];

/** セクション名・見出し・リンク文から回の番号を読む。読めなければ 0 */
export function parseRound(text) {
  const t = String(text ?? '').normalize('NFKC');
  for (const re of PATTERNS) {
    const m = t.match(re);
    if (m) {
      const n = ok(kanjiToNumber(m[1]));
      if (n) return n;
    }
  }
  return 0;
}

/** ファイル名から回を読む。parseRound に加えて「03_原価企画.pdf」「3-資料.pdf」の先頭の番号も読む（日付・年は除く） */
export function fileRound(filename) {
  const name = String(filename ?? '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .normalize('NFKC');
  const n = parseRound(name);
  if (n) return n;
  const m = name.match(/^0?([0-9]{1,2})(?:[_\-\s.．、]|$)(?![0-9/])/);
  if (m) return ok(Number(m[1]));
  return 0;
}

/** 回の判定を優先順で行う（SPEC §6.8）。各 hint は文字列または数。最初に取れたものを返す */
export function resolveRound({connector, section, notice, filename}) {
  if (Number.isInteger(connector) && connector >= 1) return {round: ok(connector), from: 'lms'};
  const s = parseRound(section);
  if (s) return {round: s, from: 'lms'};
  const n = parseRound(notice);
  if (n) return {round: n, from: 'notice'};
  const f = fileRound(filename);
  if (f) return {round: f, from: 'filename'};
  return {round: 0, from: 'none'};
}

/** 回の名前からタイトル部分（番号の表記を除いたもの）を取る。「第3回 原価企画」→「原価企画」 */
export function roundTitle(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/第\s*(?:[0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*(?:回|講|週)\s*[:：\-－—・.]?\s*/, '')
    .replace(/^(?:[0-9]{1,2})\s*回目\s*[:：\-－—・.]?\s*/, '')
    .replace(/^\s*(?:week|lecture|lesson|session|class)\.?\s*#?\s*0?[0-9]{1,2}\s*[:：\-－—・.]?\s*/i, '')
    .trim();
}
