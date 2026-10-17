// 日本の祝日（2007 年以降の決まり。2020・2021 年の特例は扱わない）。副作用なし。
// 日付は 'YYYY-MM-DD' の文字列で扱う（タイムゾーンに影響されないよう UTC で計算する）

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export const toDate = (s) => new Date(`${s}T00:00:00Z`);
export const fromDate = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => fromDate(new Date(toDate(s).getTime() + n * 864e5));
/** 0=日 … 6=土 */
export const weekdayOf = (s) => toDate(s).getUTCDay();

/** その月の第 n 回目の曜日（wd: 0=日…6=土）の日 */
function nthWeekday(y, m, wd, n) {
  const first = toDate(ymd(y, m, 1)).getUTCDay();
  const d = 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
  return ymd(y, m, d);
}

/** 春分の日・秋分の日（1980〜2099 年の近似式。官報の発表と一致する年のみ正確。実用上 2099 年まで合う） */
function equinox(y, which) {
  const base = which === 'spring' ? 20.8431 : 23.2488;
  return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

/** その年の祝日（振替休日・国民の休日を含む）を Map<'YYYY-MM-DD', 名前> で返す */
export function nationalHolidays(y) {
  const h = new Map();
  h.set(ymd(y, 1, 1), '元日');
  h.set(nthWeekday(y, 1, 1, 2), '成人の日');
  h.set(ymd(y, 2, 11), '建国記念の日');
  if (y >= 2020) h.set(ymd(y, 2, 23), '天皇誕生日');
  h.set(ymd(y, 3, equinox(y, 'spring')), '春分の日');
  h.set(ymd(y, 4, 29), '昭和の日');
  h.set(ymd(y, 5, 3), '憲法記念日');
  h.set(ymd(y, 5, 4), 'みどりの日');
  h.set(ymd(y, 5, 5), 'こどもの日');
  h.set(nthWeekday(y, 7, 1, 3), '海の日');
  if (y >= 2016) h.set(ymd(y, 8, 11), '山の日');
  h.set(nthWeekday(y, 9, 1, 3), '敬老の日');
  h.set(ymd(y, 9, equinox(y, 'autumn')), '秋分の日');
  h.set(nthWeekday(y, 10, 1, 2), y >= 2020 ? 'スポーツの日' : '体育の日');
  h.set(ymd(y, 11, 3), '文化の日');
  h.set(ymd(y, 11, 23), '勤労感謝の日');

  // 振替休日：日曜の祝日の後の、祝日でない最初の日
  for (const [d] of [...h]) {
    if (weekdayOf(d) !== 0) continue;
    let s = addDays(d, 1);
    while (h.has(s)) s = addDays(s, 1);
    h.set(s, '振替休日');
  }
  // 国民の休日：前日と翌日が祝日の平日（日曜・振替休日以外）
  for (let i = 0; i < 366; i++) {
    const d = addDays(ymd(y, 1, 1), i);
    if (!d.startsWith(String(y))) break;
    if (h.has(d) || weekdayOf(d) === 0) continue;
    if (h.has(addDays(d, -1)) && h.has(addDays(d, 1))) h.set(d, '国民の休日');
  }
  return h;
}

/** 期間内の祝日の集合（複数年にまたがってよい） */
export function holidaysBetween(start, end) {
  const out = new Set();
  const y0 = Number(start.slice(0, 4)),
    y1 = Number(end.slice(0, 4));
  for (let y = y0; y <= y1; y++) for (const [d] of nationalHolidays(y)) if (d >= start && d <= end) out.add(d);
  return out;
}
