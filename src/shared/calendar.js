// 学年暦（SPEC §6.14）：大学の学年暦の文字から休講日・振替授業日・授業回（第 N 回の日付）を読み取る。副作用なし。
// 読み取りはアプリの中の決まりで行う（AI には送らない）。日付と、その近くの言葉（休講・休業・試験・○曜日の授業…）の組で判断し、
// 本人が画面で確かめて保存したときだけ使う。
// classWeekday：その日に行う授業の曜日（休講日・祝日なら null、振替授業日ならその曜日）。回の日付・今日の授業・授業開始の同期で使う
import {addDays, holidaysBetween, weekdayOf} from './holidays.js';

export const WD = '日月火水木金土';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
const MAX_RANGE_DAYS = 120; // 「8/1〜9/20 夏季休業」のような範囲の上限

/** 学期の行（DB）から休講日・振替授業日を取り出す。古い行（列がない・null）でも空の配列になる */
export function termCalendar(term) {
  const parse = (s) => {
    try {
      const v = JSON.parse(s ?? '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  return {
    holidays: parse(term?.holidays_json).filter((d) => typeof d === 'string' && DATE.test(d)),
    swaps: parse(term?.swaps_json).filter((s) => s && DATE.test(s.date) && WD.includes(s.weekday) && s.weekday)
  };
}

/**
 * その日に行う授業の曜日。振替授業日ならその曜日（祝日でも）、休講日・祝日なら null、ふだんはその日の曜日。
 * national：祝日を休みにするか。true なら計算、Set ならその中の日、false なら祝日を見ない
 */
export function classWeekday({holidays = [], swaps = [], national = true} = {}, date) {
  const swap = swaps.find((s) => s.date === date);
  if (swap) return swap.weekday;
  if (holidays.includes(date)) return null;
  if (national === true ? holidaysBetween(date, date).size : national instanceof Set && national.has(date)) return null;
  return WD[weekdayOf(date)];
}

/** 全角の数字・記号を半角に、波線・丸括弧をそろえる */
export function normalizeText(s) {
  return String(s ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/／/g, '/')
    .replace(/[～~−–—]/g, '〜')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[ \t　]+/g, ' ');
}

// 日付：2026/4/1・2026年4月1日・令和8年4月1日・4/1・4月1日・4.1。続けて (月)・(月曜日) があれば曜日も取る
const DATE_RE =
  /(?:(?:(\d{4})|令和\s?(\d{1,2})|R\s?(\d{1,2}))\s?[年/.]\s?)?(\d{1,2})\s?[月/.]\s?(\d{1,2})\s?日?(?:\s?\(\s?([月火水木金土日])\s?(?:曜日?)?\s?\))?/g;
// 範囲の終わり：「〜9/20」「〜20日」「〜9月20日」
const RANGE_END_RE =
  /^\s?〜\s?(?:(\d{1,2})\s?[月/.]\s?)?(\d{1,2})\s?日?(?:\s?\(\s?[月火水木金土日]\s?(?:曜日?)?\s?\))?/;

// 言葉の決まり。振替（別の曜日の授業）＞ 授業を行う ＞ 休み の順に強い
const SWAP_RE =
  /([月火水木金土])\s?曜(?:日)?\s?(?:の)?\s?(?:授業|講義|日程|時間割|扱い)|(?:授業|講義)\s?は\s?([月火水木金土])\s?曜|振替\s?(?:授業)?\s?(?:日)?\s?\(?\s?([月火水木金土])\s?曜|\(\s?([月火水木金土])\s?\)\s?(?:授業|講義)/;
const CLASS_RE =
  /(?:授業|講義)\s?(?:実施|日|を行う|あり|を行います)|平常\s?(?:通り|どおり)|通常\s?(?:通り|どおり)?\s?(?:授業|講義)/;
const HOLIDAY_RE =
  /全学休講|休講|休業|閉講|休校|創立記念|学園祭|大学祭|文化祭|入学試験|入試|一斉休|臨時休|年末年始|定期試験|期末試験|試験期間|補講|休日|休み/;

// 授業回の印：「第5回」「5回目」「⑤」。前に曜日（「月⑤」「月曜 第5回」）があれば、その曜日の授業の回
const ROUND = String.raw`(?:([月火水木金土])\s?(?:曜日?)?\s?(?:の)?\s?)?(?:第\s?(\d{1,2})\s?回(?!数)|(\d{1,2})\s?回目|([\u2460-\u2473]))`;
const ROUND_RE = new RegExp(ROUND);
const ROUND_END_RE = new RegExp(`${ROUND}\\s?$`);
// 行の頭の曜日（「月曜日 ①4/13 ②4/20 …」のように曜日ごとに回を並べた行）
const LINE_WD_RE = /^\s?[[(【]?\s?([月火水木金土])\s?(?:曜日?|(?=[\s:：)\]】]))/;
function roundOf(m) {
  if (!m) return null;
  const n = m[4] ? m[4].charCodeAt(0) - 0x2460 + 1 : Number(m[2] ?? m[3]);
  return n >= 1 && n <= 30 ? {n, weekday: m[1] ?? null} : null;
}

function classify(before, after) {
  for (const s of [after, before]) {
    const sw = s.match(SWAP_RE);
    if (sw) return {kind: 'swap', weekday: sw[1] ?? sw[2] ?? sw[3] ?? sw[4]};
  }
  for (const s of [after, before]) if (CLASS_RE.test(s)) return {kind: 'class'};
  for (const s of [after, before]) {
    const h = s.match(HOLIDAY_RE);
    if (h) return {kind: 'holiday', label: h[0]};
  }
  return null;
}

/** 年の決め方：書いてあればそれ。なければ年度（4〜12 月はその年、1〜3 月は次の年）。曜日が書いてあれば、合う年（前後 1 年）を選ぶ */
function pickYear({y, reiwa, m, d, wd}, year) {
  if (y) return y;
  if (reiwa) return 2018 + reiwa;
  const base = m >= 4 ? year : year + 1;
  if (!wd) return base;
  for (const cand of [base, base + 1, base - 1]) {
    const s = `${cand}-${pad(m)}-${pad(d)}`;
    if (validDate(s) && WD[weekdayOf(s)] === wd) return cand;
  }
  return base;
}
const validDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/**
 * 学年暦の文字から休講日・振替授業日・授業回を読み取る。year は年度（2026 年度なら 2026）。
 * 戻り：{holidays: [{date, label}], swaps: [{date, weekday, label}], rounds: [{date, weekday, n}], dates: 見つけた日付の数, unknown: 言葉の分からなかった日付の数}
 * 同じ日が両方にあれば振替授業日を優先。日付の順に並べる。
 * 授業回：日付の後ろ（行の頭の日付の前に印があれば、その行は前）の「第5回」「⑤」などを、その曜日の第 N 回として読む。
 * 曜日は、印の前の曜日（「月⑤」）＞ 振替の言葉（「月曜日の授業」）＞ 行の頭の曜日 ＞ その日の曜日。
 * ふだんと違う曜日の回・祝日の回は、振替授業日にも入れる（休講の言葉のある日の印は読まない）
 */
export function parseCalendar(text, {year} = {}) {
  const t = normalizeText(text);
  const y0 = Number.isInteger(year) ? year : new Date().getFullYear();
  const tokens = [];
  for (const m of t.matchAll(DATE_RE)) {
    const month = Number(m[4]),
      day = Number(m[5]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const y = pickYear(
      {y: m[1] ? Number(m[1]) : 0, reiwa: m[2] || m[3] ? Number(m[2] || m[3]) : 0, m: month, d: day, wd: m[6]},
      y0
    );
    const date = `${y}-${pad(month)}-${pad(day)}`;
    if (!validDate(date)) continue;
    tokens.push({date, start: m.index, end: m.index + m[0].length, month});
  }
  // 範囲「〜」：次の日付がすぐ続くか、日だけ（〜20日）が続く
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    const rest = t.slice(tk.end, tk.end + 24);
    const next = tokens[i + 1];
    if (next && /^\s?〜\s?$/.test(t.slice(tk.end, next.start))) {
      tk.until = next.date;
      tk.end = next.end; // 言葉は範囲の終わりの後ろを見る（「11/5〜11/8 大学祭（休講）」）
      next.rangeEnd = true;
      i++;
      continue;
    }
    const re = rest.match(RANGE_END_RE);
    if (re && !(next && next.start < tk.end + re[0].length)) {
      const month = re[1] ? Number(re[1]) : tk.month;
      const y = Number(tk.date.slice(0, 4)) + (month < tk.month ? 1 : 0);
      const until = `${y}-${pad(month)}-${pad(Number(re[2]))}`;
      if (validDate(until) && until >= tk.date) {
        tk.until = until;
        tk.end += re[0].length;
      }
    }
  }
  const byDate = new Map();
  const rounds = [];
  const lineOf = new Map(); // 行の頭 → {before: 印が日付の前か, weekday: 行の頭の曜日}
  const lineInfo = (tk) => {
    const ls = t.lastIndexOf('\n', tk.start - 1) + 1;
    if (!lineOf.has(ls)) {
      const first = tokens.find((x) => x.start >= ls);
      const head = t.slice(ls, first.start);
      lineOf.set(ls, {before: ROUND_END_RE.test(head), weekday: head.match(LINE_WD_RE)?.[1] ?? null});
    }
    return lineOf.get(ls);
  };
  let unknown = 0;
  let last = null;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.rangeEnd) continue;
    const next = tokens.slice(i + 1).find((x) => !x.rangeEnd);
    const prev = tokens[i - 1];
    const afterEnd = Math.min(next ? next.start : t.length, tk.end + 60);
    const after = t.slice(tk.end, afterEnd).split('\n')[0];
    const beforeStart = Math.max(prev ? prev.end : 0, tk.start - 40);
    const before = t.slice(beforeStart, tk.start).split('\n').at(-1);
    let c = classify(before, after);
    // 授業回の印（範囲の日付には付けない）
    const line = lineInfo(tk);
    const r = tk.until ? null : roundOf(line.before ? before.match(ROUND_END_RE) : after.match(ROUND_RE));
    if (r && c?.kind !== 'holiday') {
      const natural = WD[weekdayOf(tk.date)];
      const weekday = r.weekday ?? (c?.kind === 'swap' ? c.weekday : null) ?? line.weekday ?? natural;
      rounds.push({date: tk.date, weekday, n: r.n});
      if (weekday !== natural) c = {kind: 'swap', weekday};
      else if (!c && holidaysBetween(tk.date, tk.date).size) c = {kind: 'class'};
      if (!c) {
        last = null;
        continue;
      }
    }
    // 「休講日：5/1、5/2」のように同じ行に並んだ日付は、前の日付の判断を引き継ぐ（行が変わったら引き継がない）
    const sameLine = prev && !t.slice(prev.end, tk.start).includes('\n');
    if (!c && last && sameLine && /^[\s、,・/]*$/.test(before) && !/\S{3,}/.test(after)) c = last;
    if (!c) {
      unknown++;
      last = null;
      continue;
    }
    last = c;
    const until = tk.until && tk.until > tk.date ? tk.until : tk.date;
    for (let d = tk.date, n = 0; d <= until && n < MAX_RANGE_DAYS; d = addDays(d, 1), n++) {
      const entry =
        c.kind === 'holiday'
          ? {kind: 'holiday', date: d, label: c.label}
          : {
              kind: 'swap',
              date: d,
              weekday: c.kind === 'swap' ? c.weekday : WD[weekdayOf(d)],
              label: c.kind === 'swap' ? `${c.weekday}曜日の授業` : '授業を行う'
            };
      const had = byDate.get(d);
      if (!had || (had.kind === 'holiday' && entry.kind === 'swap')) byDate.set(d, entry);
    }
  }
  const all = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  // 同じ曜日の同じ回・同じ日は、先に書いてあるほう
  const seen = new Set();
  const outRounds = rounds
    .filter((x) => {
      const k1 = `${x.weekday}${x.n}`,
        k2 = `${x.weekday}${x.date}`;
      if (seen.has(k1) || seen.has(k2)) return false;
      seen.add(k1).add(k2);
      return true;
    })
    .sort((a, b) => WD.indexOf(a.weekday) - WD.indexOf(b.weekday) || a.n - b.n);
  return {
    holidays: all.filter((e) => e.kind === 'holiday').map(({date, label}) => ({date, label})),
    swaps: all.filter((e) => e.kind === 'swap').map(({date, weekday, label}) => ({date, weekday, label})),
    rounds: outRounds,
    dates: tokens.filter((x) => !x.rangeEnd).length,
    unknown
  };
}

/** 休講日・振替授業日の入力を整える（DB に入れる形）。日付の形でないもの・曜日の分からないものは捨て、同じ日は 1 つに */
export function cleanCalendar({holidays = [], swaps = []} = {}) {
  const swapDates = new Set();
  const outSwaps = [];
  for (const s of Array.isArray(swaps) ? swaps : []) {
    const date = typeof s?.date === 'string' ? s.date : '';
    const weekday = typeof s?.weekday === 'string' ? s.weekday : '';
    if (!DATE.test(date) || !weekday || !WD.includes(weekday) || swapDates.has(date)) continue;
    swapDates.add(date);
    outSwaps.push({date, weekday});
  }
  const outHolidays = [
    ...new Set(
      (Array.isArray(holidays) ? holidays : [])
        .map((h) => (typeof h === 'string' ? h : h?.date))
        .filter((d) => typeof d === 'string' && DATE.test(d) && !swapDates.has(d))
    )
  ].sort();
  return {holidays: outHolidays, swaps: outSwaps.sort((a, b) => (a.date < b.date ? -1 : 1))};
}
