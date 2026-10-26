// 学期の設定（SPEC §6.14）：学期名からの既定の期間・学期フォルダ名・回の日付。副作用なし。
import {sanitizeSegment} from './naming.js';
import {addDays, holidaysBetween, ymd} from './holidays.js';
import {classWeekday, termCalendar} from './calendar.js';

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 学期名の候補（選ぶか自由入力） */
export const TERM_LABELS = [
  '前期',
  '後期',
  '春学期',
  '秋学期',
  '第1クォーター',
  '第2クォーター',
  '第3クォーター',
  '第4クォーター',
  '通年'
];

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
 * 第 N 回の日付：開始日以降で、その曜日の授業を行う N 番目の日。祝日（includeNationalHolidays）と休講日（holidays）を飛ばし、
 * 振替授業日（swaps：{date, weekday}。その日に別の曜日の授業を行う。祝日に授業を行う日も含む）を数える（shared/calendar.js の classWeekday）。
 * weekday は '月'〜'日'。戻りは rounds 個の 'YYYY-MM-DD'（期間を超えた分は含めない）
 */
export function roundDates({
  start,
  end,
  weekday,
  rounds = 15,
  holidays = [],
  swaps = [],
  includeNationalHolidays = true
}) {
  if (!WEEKDAYS.includes(weekday) || !start || !end || start > end) return [];
  const cal = {holidays, swaps, national: includeNationalHolidays ? holidaysBetween(start, end) : false};
  const out = [];
  for (let d = start; d <= end && out.length < rounds; d = addDays(d, 1))
    if (classWeekday(cal, d) === weekday) out.push(d);
  return out;
}

/** 学期の行（DB）と曜日から回の日付（同期の回の突き合わせと、学期を保存したときの計算し直しで同じ計算を使う） */
export function termRoundDates(term, weekday) {
  return roundDates({
    start: term.start_date,
    end: term.end_date,
    weekday,
    rounds: term.rounds ?? 15,
    ...termCalendar(term)
  });
}

const startOf = (t) => t.start ?? t.start_date;
const endOf = (t) => t.end ?? t.end_date;

/**
 * 今日を含む学期を返す（なければ null）。terms は {start,end} か DB の行 {start_date,end_date}。
 * 期間の重なる学期が 2 つ以上あれば（通年と前期など）、期間のいちばん短い学期（同じなら後に始まる学期）を選ぶ
 */
export function currentTerm(terms, today) {
  const hits = terms.filter((t) => startOf(t) <= today && today <= endOf(t));
  const span = (t) => Date.parse(endOf(t)) - Date.parse(startOf(t));
  return (
    hits.sort((a, b) => span(a) - span(b) || (startOf(b) > startOf(a) ? 1 : startOf(b) < startOf(a) ? -1 : 0))[0] ??
    null
  );
}

/** 期間が重なるほかの学期（学期の編集で知らせる） */
export function overlapping(terms, term) {
  return terms.filter((t) => t.id !== term.id && startOf(t) <= endOf(term) && startOf(term) <= endOf(t));
}

/** 学期の終わり 30 日前からは「次の学期の設定」を促す */
export function termEndingSoon(term, today, days = 30) {
  return !!term && addDays(endOf(term), -days) <= today && today <= endOf(term);
}

/**
 * 学期がまだないとき（LMS をつながずに使い始めたとき）の仮の学期。4〜9 月は春学期、10〜3 月は秋学期（1〜3 月は前の年度）。
 * 期間は defaultTermDates のまま。あとで 設定 → 学期 で直せる
 */
export function autoTerm(today) {
  const [y, m] = String(today).split('-').map(Number);
  const spring = m >= 4 && m <= 9;
  const year = m >= 4 ? y : y - 1;
  const label = spring ? '春学期' : '秋学期';
  const d = defaultTermDates(label, year);
  return {
    id: termId(year, label),
    label,
    year,
    folder: termFolder(year, label),
    start_date: d.start,
    end_date: d.end,
    rounds: 15,
    holidays_json: '[]',
    source: 'auto'
  };
}

/**
 * 学年暦の授業回（listed：[{date, weekday, n}]。shared/calendar.js の parseCalendar が読む）と、学期の設定から計算した回の日付を比べる。
 * 1 つの学年暦に春と秋の回があるので、曜日ごとに回が 1 から始まり直すところで分け、学期の期間にいちばん多く入る並びを使う。
 * 戻り：{rows: 曜日ごとの {weekday, listed: 回の数, last: いちばん大きい回, complete: 第 1 回から抜けなくそろっているか,
 *   mismatches: [{n, listed: 学年暦の日付, computed: 計算した日付（なければ null）}]},
 *   start / end：合わせるときの開始日・終了日（変えないなら null。開始日は学年暦の第 1 回のいちばん早い日、終了日は最後の回より前なら延ばす）,
 *   fix: {holidays: [{date, label}], swaps: [{date, weekday, label}]}（その開始日・終了日で、足すと計算が学年暦に合う日。そろっている曜日だけ）}
 * fix は、学年暦の回の日なのに計算ではその曜日の授業がない日を振替授業日に、開始日から学年暦の最後の回までで
 * 計算ではその曜日の授業があるのに学年暦の回にない日を休講日にする（ほかの曜日の振替授業日になっている日は動かさない）
 */
export function checkRounds({start, end, rounds = 15, holidays = [], swaps = [], listed = []}) {
  const picked = [];
  for (const weekday of WEEKDAYS) {
    const runs = [];
    for (const x of listed.filter((y) => y.weekday === weekday).sort((a, b) => (a.date < b.date ? -1 : 1))) {
      const run = runs.at(-1);
      if (run && x.n > run.at(-1).n) run.push(x);
      else runs.push([x]);
    }
    const inside = (run) => run.filter((x) => x.date >= start && x.date <= end).length;
    const best = runs.filter((r) => inside(r) > 0).sort((a, b) => inside(b) - inside(a))[0];
    if (best) picked.push({weekday, mine: best});
  }
  const rows = picked.map(({weekday, mine}) => {
    const last = mine.at(-1).n;
    const computed = roundDates({start, end, weekday, rounds: Math.max(rounds, last), holidays, swaps});
    return {
      weekday,
      listed: mine.length,
      last,
      complete: mine.length === last, // 1..last が 1 つずつ（回は増える順に分けてある）
      mismatches: mine
        .filter((x) => computed[x.n - 1] !== x.date)
        .map((x) => ({n: x.n, listed: x.date, computed: computed[x.n - 1] ?? null}))
    };
  });
  const fix = {holidays: [], swaps: []};
  if (!rows.some((r) => r.mismatches.length) || !start || !end) return {rows, start: null, end: null, fix};
  const all = picked.flatMap((p) => p.mine);
  const firsts = all.filter((x) => x.n === 1).map((x) => x.date);
  const first = (firsts.length ? firsts : all.map((x) => x.date)).sort()[0];
  const lastDate = all
    .map((x) => x.date)
    .sort()
    .at(-1);
  const s0 = first,
    e0 = lastDate > end ? lastDate : end;
  const cal = {holidays, swaps, national: holidaysBetween(s0, e0)};
  const swapDates = new Set(swaps.map((x) => x.date));
  for (const [i, {weekday, mine}] of picked.entries()) {
    if (!rows[i].complete) continue;
    const dates = new Set(mine.map((x) => x.date));
    for (const x of mine)
      if (classWeekday(cal, x.date) !== weekday)
        fix.swaps.push({date: x.date, weekday, label: `${weekday}曜日の第${x.n}回`});
    for (let d = s0; d <= mine.at(-1).date; d = addDays(d, 1))
      if (!dates.has(d) && !swapDates.has(d) && classWeekday(cal, d) === weekday)
        fix.holidays.push({date: d, label: `学年暦の${weekday}曜日の回にない日`});
  }
  return {rows, start: s0 !== start ? s0 : null, end: e0 !== end ? e0 : null, fix};
}
