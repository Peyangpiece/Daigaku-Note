// 授業開始の同期の判定（SPEC §6.5・§8.5）。時限の開始時刻は大学ごとの設定（periods）。副作用なし。
import {WEEKDAYS} from './term.js';

/** 時限の開始時刻のプリセット（SPEC §18.5） */
export const PERIOD_PRESETS = {
  '90分・9:00開始・休み15分': {1: '09:00', 2: '10:45', 3: '13:00', 4: '14:45', 5: '16:30', 6: '18:15'},
  '90分・9:00開始・休み10分': {1: '09:00', 2: '10:40', 3: '13:00', 4: '14:40', 5: '16:20', 6: '18:00'},
  '90分・8:50開始': {1: '08:50', 2: '10:30', 3: '13:00', 4: '14:40', 5: '16:20', 6: '18:00'},
  '90分・9:30開始': {1: '09:30', 2: '11:10', 3: '13:30', 4: '15:10', 5: '16:50', 6: '18:30'},
  '100分・9:00開始': {1: '09:00', 2: '10:50', 3: '13:00', 4: '14:50', 5: '16:40', 6: '18:30'},
  '105分・9:00開始': {1: '09:00', 2: '10:55', 3: '13:00', 4: '14:55', 5: '16:50', 6: '18:45'}
};

const minutes = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** 日本時間での 'YYYY-MM-DD' と 'HH:MM' */
export function jstNow(now = new Date()) {
  const date = now.toLocaleDateString('sv-SE', {timeZone: 'Asia/Tokyo'});
  const hm = now.toLocaleTimeString('en-GB', {timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit'});
  return {date, hm, weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]};
}

/**
 * いま同期すべき授業：開始時刻を過ぎていて（graceMinutes 以内）、今日まだ同期していない、今日が授業日のもの。
 * courses: [{id, weekday, period}]  periods: {1:'09:00',…}  classSynced: {courseId: 'YYYY-MM-DD'}
 * isClassDay(course, date): 授業日か（既定は曜日の一致だけ。学期の設定があれば休講日・学期外を除く関数を渡す）
 */
export function dueClassSyncs({courses, periods, classSynced = {}, isClassDay}, now = new Date(), graceMinutes = 120) {
  const {date, hm, weekday} = jstNow(now);
  const out = [];
  for (const c of courses) {
    if (!c || c.hidden || c.sync_enabled === 0) continue;
    if (!c.weekday || !c.period) continue;
    const start = periods?.[c.period];
    if (!start) continue;
    const today = isClassDay ? isClassDay(c, date) : c.weekday === weekday;
    if (!today) continue;
    if (classSynced[c.id] === date) continue;
    const diff = minutes(hm) - minutes(start);
    if (diff >= 0 && diff <= graceMinutes) out.push({course: c, date, start});
  }
  return out;
}

/** 毎日の全体の同期の判定：設定の時刻を過ぎていて、今日まだなら true */
export function dueDailySync({time = '16:30', lastDay}, now = new Date()) {
  const {date, hm} = jstNow(now);
  return hm >= time && lastDay !== date;
}
