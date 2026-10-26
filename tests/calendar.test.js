import test from 'node:test';
import assert from 'node:assert/strict';
import {classWeekday, cleanCalendar, parseCalendar, termCalendar} from '../src/shared/calendar.js';
import {checkRounds, roundDates} from '../src/shared/term.js';

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

test('学年暦の授業回：日付の後ろ・前の印、曜日の行、振替の回', () => {
  const r = parseCalendar(
    `月曜日 ①4/13 ②4/20 ③4/27 ④5/7(木) ⑤5/11
4/15(水) 第1回
4/29(水) 第2回（祝日授業）
5/13(水) 水曜日の授業 3回目
5/14(木) 月曜の授業 第6回
5/20(水) 第1回 定期試験
`,
    {year: 2026}
  );
  const by = (w) => r.rounds.filter((x) => x.weekday === w).map((x) => [x.n, x.date]);
  assert.deepEqual(by('月'), [
    [1, '2026-04-13'],
    [2, '2026-04-20'],
    [3, '2026-04-27'],
    [4, '2026-05-07'],
    [5, '2026-05-11'],
    [6, '2026-05-14']
  ]);
  assert.deepEqual(
    by('水'),
    [
      [1, '2026-04-15'],
      [2, '2026-04-29'],
      [3, '2026-05-13']
    ],
    '定期試験の日の「第1回」は授業回にしない'
  );
  const sw = Object.fromEntries(r.swaps.map((s) => [s.date, s.weekday]));
  assert.equal(sw['2026-05-07'], '月', '月曜の行の木曜は、月曜日の授業の振替');
  assert.equal(sw['2026-05-14'], '月');
  assert.equal(sw['2026-04-29'], '水', '祝日（昭和の日）の回は、その日に授業を行う');
  assert.ok(!sw['2026-04-15'], 'ふだんの日の回は振替授業日にしない');
  assert.equal(r.unknown, 0, '回の印のある日付は分かった日付');
});

test('授業回の確かめ：計算と比べ、合わせるための開始日・休講日・振替授業日を出す', () => {
  const listed = [
    {date: '2026-04-15', weekday: '水', n: 1},
    {date: '2026-04-29', weekday: '水', n: 2},
    {date: '2026-05-13', weekday: '水', n: 3},
    {date: '2026-09-30', weekday: '水', n: 1}, // 秋学期の回（春学期の確かめでは使わない）
    {date: '2026-10-07', weekday: '水', n: 2}
  ];
  const base = {start: '2026-04-08', end: '2026-07-31', rounds: 15};
  const res = checkRounds({...base, listed});
  const [w] = res.rows;
  assert.equal(w.weekday, '水');
  assert.equal(w.complete, true);
  assert.equal(w.last, 3, '期間にいちばん多く入る並び（春学期）');
  assert.deepEqual(w.mismatches[0], {n: 1, listed: '2026-04-15', computed: '2026-04-08'});
  assert.equal(res.start, '2026-04-15', '開始日を学年暦の第 1 回に');
  assert.equal(res.end, null);
  assert.deepEqual(
    res.fix.swaps.map((s) => [s.date, s.weekday]),
    [['2026-04-29', '水']],
    '祝日の回は振替授業日に'
  );
  assert.deepEqual(
    res.fix.holidays.map((h) => h.date),
    ['2026-04-22'],
    '学年暦の回にない水曜は休講日に（5/6 は振替休日でもともと休みなので足さない）'
  );
  // 合わせると計算が学年暦に合う
  const again = checkRounds({
    ...base,
    start: res.start,
    holidays: res.fix.holidays.map((h) => h.date),
    swaps: res.fix.swaps.map(({date, weekday}) => ({date, weekday})),
    listed
  });
  assert.deepEqual(again.rows[0].mismatches, []);
  assert.equal(again.start, null);
  // 抜けのある曜日は合わせない
  const g = checkRounds({...base, listed: [listed[0], listed[2]]});
  assert.equal(g.rows[0].complete, false);
  assert.deepEqual(g.fix, {holidays: [], swaps: []});
});

// 月ごとのます目の学年暦（PDF から取り出した文字。1 週が 1 行、月〜日の順、①〜⑮ が授業回、× は閉室日）
const GRID = `《留意事項》
1.4/29（水）、7/20（月）は祝日ですが、通常授業を行います。
2026年
４月
５月
30 31 1 2 3 4 × 5 ×
6 7 ① 8 ① 9 ① 10 ① 11 × 12 ×
13 ① 14 ② 15 ② 16 ② 17 ② 18 補 19 ×
20 ② 21 ③ 22 ③ 23 ③ 24 ③ 25 補 26 ×
27 ③ 28 ④ 29 ④ 30 1 2 × 3 ×
昭和の日（祝日） 休講 休講 休講 憲法記念日（祝日）
4 × 5 × 6 × 7 ④ 8 ④ 9 補 10 ×
11 ④ 12 ⑤ 13 ⑤ 14 ⑤ 15 ⑤ 16 補 17 ×
`;

test('学年暦の授業回：月ごとのます目から日付と回を読む', () => {
  const r = parseCalendar(GRID, {year: 2026});
  const by = (w) => r.rounds.filter((x) => x.weekday === w).map((x) => `${x.date.slice(5)}#${x.n}`);
  assert.deepEqual(by('月'), ['04-13#1', '04-20#2', '04-27#3', '05-11#4']);
  assert.deepEqual(by('木'), ['04-09#1', '04-16#2', '04-23#3', '05-07#4', '05-14#5'], '4/30 の休講は回にない');
  assert.deepEqual(by('水'), ['04-08#1', '04-15#2', '04-22#3', '04-29#4', '05-13#5']);
  assert.deepEqual(
    r.swaps.map((s) => s.date),
    ['2026-04-29', '2026-07-20'],
    '「4/29、7/20 は…通常授業を行います」は、並んだ日付すべてに'
  );
  assert.equal(r.unknown, 0, '「1.4/29」の「1.4」・「４月\n５月」は日付にしない');
  // 春学期（既定の 4/1〜）を学年暦に合わせる：開始日 4/7、休講日 4/30・5/1
  const res = checkRounds({
    start: '2026-04-01',
    end: '2026-09-30',
    rounds: 15,
    holidays: [],
    swaps: r.swaps,
    listed: r.rounds
  });
  assert.equal(res.start, '2026-04-07');
  assert.deepEqual(
    res.fix.holidays.map((h) => h.date),
    ['2026-04-30', '2026-05-01']
  );
});
