import test from 'node:test';
import assert from 'node:assert/strict';
import {currentTerm, defaultTermDates, roundDates, termEndingSoon, termFolder, termId} from '../src/shared/term.js';

test('学期名からの既定の期間', () => {
  assert.deepEqual(defaultTermDates('秋学期', 2026), {start: '2026-10-01', end: '2027-03-31'});
  assert.deepEqual(defaultTermDates('前期', 2026), {start: '2026-04-01', end: '2026-09-30'});
  assert.deepEqual(defaultTermDates('第3クォーター', 2026), {start: '2026-10-01', end: '2026-11-30'});
  assert.deepEqual(defaultTermDates('通年', 2026), {start: '2026-04-01', end: '2027-03-31'});
});

test('学期フォルダ名と ID', () => {
  assert.equal(termFolder(2026, '秋学期'), '2026_秋学期');
  assert.equal(termFolder(2026, '後期/A'), '2026_後期_A');
  assert.equal(termId(2026, '秋学期'), '2026-fall');
  assert.equal(termId(2026, '第2クォーター'), '2026-q2');
});

test('回の日付：金曜 15 回、祝日と休講日を飛ばす', () => {
  const dates = roundDates({
    start: '2026-09-21',
    end: '2027-01-31',
    weekday: '金',
    rounds: 15,
    holidays: ['2026-11-06'] // 大学の休講日（学園祭）
  });
  assert.equal(dates.length, 15);
  assert.equal(dates[0], '2026-09-25');
  assert.ok(!dates.includes('2026-11-06'), '休講日を飛ばす');
  assert.ok(!dates.includes('2027-01-01'), '元日（金曜）を飛ばす');
  assert.ok(dates.every((d) => new Date(d + 'T00:00:00Z').getUTCDay() === 5));
});

test('回の日付：月曜は祝日が多い', () => {
  const dates = roundDates({start: '2026-09-21', end: '2027-01-31', weekday: '月', rounds: 15});
  assert.ok(!dates.includes('2026-09-21'), '敬老の日');
  assert.ok(!dates.includes('2026-10-12'), 'スポーツの日');
  assert.ok(!dates.includes('2027-01-11'), '成人の日');
  assert.equal(dates.length, 15);
});

test('今日の学期と終わりの判定', () => {
  const terms = [
    {id: 'a', start: '2026-04-01', end: '2026-09-30'},
    {id: 'b', start: '2026-10-01', end: '2027-03-31'}
  ];
  assert.equal(currentTerm(terms, '2026-10-17').id, 'b');
  assert.equal(currentTerm(terms, '2027-04-01'), null);
  assert.equal(termEndingSoon(terms[1], '2027-03-05'), true);
  assert.equal(termEndingSoon(terms[1], '2027-02-01'), false);
});

test('DB の行（start_date/end_date）でも今日の学期を選べる', () => {
  const rows = [
    {id: 'a', start_date: '2026-04-01', end_date: '2026-09-30'},
    {id: 'b', start_date: '2026-10-01', end_date: '2027-03-31'}
  ];
  assert.equal(currentTerm(rows, '2026-10-17').id, 'b');
  assert.equal(termEndingSoon(rows[1], '2027-03-10'), true);
});

test('LMS をつながずに使い始めたときの仮の学期：4〜9 月は春学期、10〜3 月は秋学期（1〜3 月は前の年度）', async () => {
  const {autoTerm} = await import('../src/shared/term.js');
  const fall = autoTerm('2026-10-20');
  assert.equal(fall.label, '秋学期');
  assert.equal(fall.year, 2026);
  assert.equal(fall.start_date, '2026-10-01');
  assert.equal(fall.end_date, '2027-03-31');
  assert.equal(fall.source, 'auto');
  assert.equal(autoTerm('2027-02-10').id, fall.id, '1〜3 月は前の年度の秋学期');
  const spring = autoTerm('2026-05-01');
  assert.equal(spring.label, '春学期');
  assert.equal(spring.start_date, '2026-04-01');
  assert.equal(spring.end_date, '2026-09-30');
});

test('期間が重なる学期（通年と前期）では、期間の短い学期を今の学期にする', async () => {
  const {overlapping} = await import('../src/shared/term.js');
  const terms = [
    {id: 'year', start_date: '2026-04-01', end_date: '2027-03-31'},
    {id: 'spring', start_date: '2026-04-01', end_date: '2026-09-30'},
    {id: 'fall', start_date: '2026-10-01', end_date: '2027-03-31'}
  ];
  assert.equal(currentTerm(terms, '2026-05-01').id, 'spring');
  assert.equal(currentTerm(terms, '2026-11-01').id, 'fall');
  assert.deepEqual(
    overlapping(terms, terms[1]).map((t) => t.id),
    ['year']
  );
  assert.deepEqual(
    overlapping(terms, terms[0]).map((t) => t.id),
    ['spring', 'fall']
  );
});
