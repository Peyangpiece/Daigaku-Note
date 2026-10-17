// 学期の設定（SPEC §6.14）：学期名からの既定の期間・学期フォルダ名・回の日付。副作用なし。
import {sanitizeSegment} from './naming.js';
import {addDays, holidaysBetween, weekdayOf, ymd} from './holidays.js';

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 学期名の候補（選ぶか自由入力） */
export const TERM_LABELS = ['前期', '後期', '春学期', '秋学期', '第1クォーター', '第2クォーター', '第3クォーター', '第4クォーター', '通年'];

/** 学期名と年度から既定の期間。春・前期：4/1〜9/30、秋・後期：10/1〜翌 3/31、クォーターは 2 か月ごと、通年は 4/1〜翌 3/31 */
export function defaultTermDates(label, year) {
  const y = Number(year);
  const l = String(label ?? '');
  if (/前期|春/.test(l)) return {start: ymd(y, 4, 1), end: ymd(y, 9, 30)};
  if (/後期|秋/.test(l)) return {start: ymd(y, 10, 1), end: ymd(y + 1, 3, 31)};
  const q = l.match(/第?\s*([1-4])\s*(?:クォーター|Q)/i);
  if (q) {
    const ranges = {
      1: [ymd(y, 4, 1), ymd(y, 5, 31)],
      2: [ymd(y, 6, 1), ymd(y, 7, 31)],
      3: [ymd(y, 10, 1), ymd(y, 11, 30)],
      4: [ymd(y, 12, 1), ymd(y + 1, 1, 31)]
    };
    const [start, end] = ranges[q[1]];
    return {start, end};
  }
  return {start: ymd(y, 4, 1), end: ymd(y + 1, 3, 31)};
}

/** 学期フォルダ名：<西暦>_<学期名> */
export function termFolder(year, label) {
  return `${Number(year)}_${sanitizeSegment(label, {max: 20}) || '学期'}`;
}

/** 学期 ID：'2026-spring' のような安定した鍵 */
export function termId(year, label) {
  const l = String(label ?? '');
  const key = /前期|春/.test(l)
    ? 'spring'
    : /後期|秋/.test(l)
      ? 'fall'
      : /([1-4])\s*(?:クォーター|Q)/i.test(l)
        ? 'q' + l.match(/([1-4])\s*(?:クォーター|Q)/i)[1]
        : 'year';
  return `${Number(year)}-${key}`;
}

/**
 * 第 N 回の日付：開始日以降のその曜日の N 番目。祝日（includeNationalHolidays）と休講日（holidays）を飛ばす。
 * weekday は '月'〜'日'。戻りは rounds 個の 'YYYY-MM-DD'（期間を超えた分は含めない）
 */
export function roundDates({start, end, weekday, rounds = 15, holidays = [], includeNationalHolidays = true}) {
  const wd = WEEKDAYS.indexOf(weekday);
  if (wd < 0 || !start || !end) return [];
  const skip = new Set(holidays);
  if (includeNationalHolidays) for (const d of holidaysBetween(start, end)) skip.add(d);
  const out = [];
  let d = start;
  while (weekdayOf(d) !== wd) d = addDays(d, 1);
  while (d <= end && out.length < rounds) {
    if (!skip.has(d)) out.push(d);
    d = addDays(d, 7);
  }
  return out;
}

/** 今日を含む学期を返す（なければ null）。terms は {start,end} を持つ配列 */
export function currentTerm(terms, today) {
  return terms.find((t) => t.start <= today && today <= t.end) ?? null;
}

/** 学期の終わり 30 日前からは「次の学期の設定」を促す */
export function termEndingSoon(term, today, days = 30) {
  return !!term && addDays(term.end, -days) <= today && today <= term.end;
}
