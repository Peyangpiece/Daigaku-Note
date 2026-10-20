import test from 'node:test';
import assert from 'node:assert/strict';
import {fileRound, kanjiToNumber, parseRound, resolveRound, roundTitle} from '../src/shared/rounds.js';

test('漢数字', () => {
  assert.equal(kanjiToNumber('三'), 3);
  assert.equal(kanjiToNumber('十'), 10);
  assert.equal(kanjiToNumber('十五'), 15);
  assert.equal(kanjiToNumber('二十'), 20);
  assert.equal(kanjiToNumber('12'), 12);
  assert.ok(Number.isNaN(kanjiToNumber('百')));
});

test('回の番号をいろいろな表記から読む', () => {
  const cases = [
    ['第3回 原価企画', 3],
    ['第03回', 3],
    ['第３回', 3],
    ['第三回', 3],
    ['第十五回', 15],
    ['第3講', 3],
    ['第3週', 3],
    ['3回目', 3],
    ['Week 3', 3],
    ['week3', 3],
    ['Lecture 03', 3],
    ['Lec. 7', 7],
    ['Lesson 12', 12],
    ['L03 slides', 3],
    ['[L3]', 3],
    ['#3 資料', 3],
    ['第3限', 0],
    ['2026年10月3日', 0],
    ['イントロダクション', 0],
    ['第99回', 0],
    ['', 0],
    [null, 0]
  ];
  for (const [input, expected] of cases) assert.equal(parseRound(input), expected, String(input));
});

test('ファイル名から回を読む（先頭の番号も）', () => {
  assert.equal(fileRound('第3回_資料.pdf'), 3);
  assert.equal(fileRound('03_原価企画.pdf'), 3);
  assert.equal(fileRound('3-資料.pdf'), 3);
  assert.equal(fileRound('lecture03.pdf'), 3);
  assert.equal(fileRound('/path/to/L05.pdf'), 5);
  assert.equal(fileRound('2026_シラバス.pdf'), 0);
  assert.equal(fileRound('10月09日.pdf'), 0);
  assert.equal(fileRound('資料.pdf'), 0);
});

test('優先順で回を決める', () => {
  assert.deepEqual(resolveRound({connector: 4, section: '第2回', filename: '03.pdf'}), {round: 4, from: 'lms'});
  assert.deepEqual(resolveRound({section: '第2回 x', filename: '03.pdf'}), {round: 2, from: 'lms'});
  assert.deepEqual(resolveRound({section: '一般', notice: '【第03回，10/09】', filename: 'x.pdf'}), {round: 3, from: 'notice'});
  assert.deepEqual(resolveRound({section: '一般', filename: '05_資料.pdf'}), {round: 5, from: 'filename'});
  assert.deepEqual(resolveRound({section: '一般', filename: '資料.pdf'}), {round: 0, from: 'none'});
});

test('回の名前からタイトルを取る', () => {
  assert.equal(roundTitle('第3回 原価企画'), '原価企画');
  assert.equal(roundTitle('第03回：原価企画'), '原価企画');
  assert.equal(roundTitle('Week 3 - Cost planning'), 'Cost planning');
  assert.equal(roundTitle('イントロダクション'), 'イントロダクション');
  assert.equal(roundTitle('第3回'), '');
});

test('授業画面の並び：今週の回が先頭、前の回は新しい順で後ろ、「その他」は最後', async () => {
  const {orderRounds, weekStart} = await import('../src/shared/rounds.js');
  assert.equal(weekStart('2026-10-20'), '2026-10-19', '火曜 → その週の月曜');
  assert.equal(weekStart('2026-10-25'), '2026-10-19', '日曜は前の月曜から');
  assert.equal(weekStart('2026-10-19'), '2026-10-19');
  const r = (number, date) => ({id: `r${number}`, number, date});
  const rounds = [r(0, null), r(3, '2026-10-16'), r(1, '2026-10-02'), r(4, '2026-10-23'), r(2, '2026-10-09'), r(5, '2026-10-30')];
  const ids = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.map((x) => x.id)]));
  assert.deepEqual(ids(orderRounds(rounds, '2026-10-20')), {current: ['r4', 'r5'], past: ['r1', 'r2', 'r3'], other: ['r0']});
  assert.deepEqual(ids(orderRounds(rounds, '2026-10-24')).current[0], 'r4', '授業の日が過ぎても同じ週なら先頭');
  assert.deepEqual(ids(orderRounds(rounds, '2026-10-26')).current, ['r5'], '今週に回がなければ次の回');
  assert.deepEqual(ids(orderRounds(rounds, '2026-11-10')), {current: [], past: ['r1', 'r2', 'r3', 'r4', 'r5'], other: ['r0']}, '学期のあと');
  assert.deepEqual(ids(orderRounds([r(2, null), r(1, null)], '2026-10-20')).current, ['r1', 'r2'], '日付がなければ回の順');
});
