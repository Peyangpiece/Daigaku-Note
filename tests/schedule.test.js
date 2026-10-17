import test from 'node:test';
import assert from 'node:assert/strict';
import {dueClassSyncs, dueDailySync, jstNow, PERIOD_PRESETS} from '../src/shared/schedule.js';

// 2026-10-16 は金曜。日本時間 10:50 = UTC 01:50
const fri1050 = new Date('2026-10-16T01:50:00Z');
const periods = PERIOD_PRESETS['90分・9:00開始・休み15分'];
const courses = [
  {id: 'a', name: '管理会計Ⅱ', weekday: '金', period: 2},
  {id: 'b', name: '意思決定論', weekday: '金', period: 4},
  {id: 'c', name: '国際ビジネス', weekday: '月', period: 2},
  {id: 'd', name: '曜日不明', weekday: '', period: 0},
  {id: 'e', name: '非表示', weekday: '金', period: 2, hidden: 1}
];

test('日本時間の日付・時刻・曜日', () => {
  assert.deepEqual(jstNow(fri1050), {date: '2026-10-16', hm: '10:50', weekday: '金'});
});

test('開始時刻を過ぎた授業だけ、同じ日に 1 回', () => {
  const due = dueClassSyncs({courses, periods}, fri1050);
  assert.deepEqual(
    due.map((x) => x.course.id),
    ['a']
  );
  const again = dueClassSyncs({courses, periods, classSynced: {a: '2026-10-16'}}, fri1050);
  assert.deepEqual(again, []);
});

test('開始から 2 時間を超えたら対象外', () => {
  const fri1300 = new Date('2026-10-16T04:00:00Z');
  assert.deepEqual(
    dueClassSyncs({courses, periods}, fri1300).map((x) => x.course.id),
    []
  );
  const fri1500 = new Date('2026-10-16T06:00:00Z');
  assert.deepEqual(
    dueClassSyncs({courses, periods}, fri1500).map((x) => x.course.id),
    ['b']
  );
});

test('授業日の判定を差し替えられる（休講日など）', () => {
  const due = dueClassSyncs({courses, periods, isClassDay: () => false}, fri1050);
  assert.deepEqual(due, []);
});

test('毎日の同期の判定', () => {
  const t1700 = new Date('2026-10-16T08:00:00Z');
  assert.equal(dueDailySync({time: '16:30', lastDay: '2026-10-15'}, t1700), true);
  assert.equal(dueDailySync({time: '16:30', lastDay: '2026-10-16'}, t1700), false);
  assert.equal(dueDailySync({time: '16:30'}, fri1050), false);
});
