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
