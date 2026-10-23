import test from 'node:test';
import assert from 'node:assert/strict';
import {classWeekday, cleanCalendar, parseCalendar, termCalendar} from '../src/shared/calendar.js';
import {roundDates} from '../src/shared/term.js';

const SAMPLE = `2026年度 秋学期 学年暦
9月21日(月) 秋学期 授業開始
10月12日(月) スポーツの日（授業実施）
11/5(木)〜11/8(日) 大学祭（休講）
11月24日(火) 月曜日の授業を行う
12/25(金)〜1/6(水) 冬季休業
1月15日(金) 休講（大学入学共通テスト準備）
休講日：2/3(水)、2/4(木)
1/26(火)〜2/2(火) 定期試験
`;

test('学年暦の読み取り：休講日・範囲・振替授業日・祝日に授業を行う日', () => {
  const r = parseCalendar(SAMPLE, {year: 2026});
  const hol = r.holidays.map((h) => h.date);
  assert.ok(hol.includes('2026-11-05') && hol.includes('2026-11-08'), '大学祭の範囲を休講日に');
  assert.equal(hol.filter((d) => d >= '2026-11-05' && d <= '2026-11-08').length, 4);
  assert.ok(hol.includes('2026-12-25') && hol.includes('2027-01-06'), '年をまたぐ冬季休業（1〜3 月は次の年）');
  assert.ok(hol.includes('2027-01-15'), '休講の 1 日');
  assert.ok(hol.includes('2027-02-03') && hol.includes('2027-02-04'), '「休講日：」のあとに並んだ日付は引き継ぐ');
  assert.ok(hol.includes('2027-01-26') && hol.includes('2027-02-02'), '定期試験の期間');
  assert.ok(!hol.includes('2026-09-21'), '授業開始の日は休みではない');
  assert.deepEqual(
    r.swaps.map((s) => [s.date, s.weekday]),
    [
      ['2026-10-12', '月'],
      ['2026-11-24', '月']
    ],
    '祝日に授業を行う日はその曜日、振替授業日は書いてある曜日'
  );
  assert.equal(r.unknown, 1, '「授業開始」の日付は言葉が分からないので入れない');
});

test('学年暦の読み取り：全角・令和・曜日から年を直す', () => {
  const r = parseCalendar('令和８年４月２９日（水）休講\n１／１５（金）全学休講', {year: 2026});
  assert.deepEqual(
    r.holidays.map((h) => h.date),
    ['2026-04-29', '2027-01-15']
  );
  // 2026 年度の「1/15(金)」は 2027-01-15（金曜）。曜日が合わなければ前後の年を探す
  const r2 = parseCalendar('1/16(金) 休講', {year: 2025});
  assert.equal(r2.holidays[0].date, '2026-01-16');
});

test('その日に行う授業の曜日：休講日・祝日は null、振替授業日はその曜日', () => {
  const cal = {holidays: ['2026-11-06'], swaps: [{date: '2026-11-24', weekday: '月'}]};
  assert.equal(classWeekday(cal, '2026-11-06'), null, '休講日');
  assert.equal(classWeekday(cal, '2026-11-23'), null, '勤労感謝の日');
  assert.equal(classWeekday(cal, '2026-11-24'), '月', '火曜に月曜の授業');
  assert.equal(classWeekday(cal, '2026-11-25'), '水');
  assert.equal(classWeekday({...cal, swaps: [{date: '2026-11-23', weekday: '月'}]}, '2026-11-23'), '月', '祝日に授業');
});

test('回の日付：振替授業日を数え、その日のふだんの曜日の授業は飛ばす', () => {
  const base = {start: '2026-09-21', end: '2027-01-31', rounds: 15};
  const swaps = [
    {date: '2026-10-12', weekday: '月'},
    {date: '2026-11-24', weekday: '月'}
  ];
  const mon = roundDates({...base, weekday: '月', swaps});
  assert.ok(mon.includes('2026-10-12'), 'スポーツの日に授業');
  assert.ok(mon.includes('2026-11-24'), '火曜に月曜の授業');
  const tue = roundDates({...base, weekday: '火', swaps});
  assert.ok(!tue.includes('2026-11-24'), '火曜の授業はその日はない');
  assert.equal(mon.length, 15);
  assert.deepEqual(roundDates({...base, weekday: '月'}), roundDates({...base, weekday: '月', swaps: []}));
});

test('入力の整理と DB の行からの取り出し', () => {
  const c = cleanCalendar({
    holidays: ['2026-11-06', '2026-11-06', 'bad', {date: '2026-11-07'}, '2026-11-24'],
    swaps: [
      {date: '2026-11-24', weekday: '月'},
      {date: '2026-11-24', weekday: '火'},
      {date: '2026-01-01', weekday: '?'}
    ]
  });
  assert.deepEqual(c, {holidays: ['2026-11-06', '2026-11-07'], swaps: [{date: '2026-11-24', weekday: '月'}]});
  assert.deepEqual(termCalendar({holidays_json: '["2026-11-06"]', swaps_json: null}), {
    holidays: ['2026-11-06'],
    swaps: []
  });
  assert.deepEqual(termCalendar({holidays_json: 'oops'}), {holidays: [], swaps: []});
});
