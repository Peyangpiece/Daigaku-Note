import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanAlign, cleanRuns, fromSegments, paintRuns, textSegments} from '../src/shared/text-runs.js';
import {normalizeAnnotation} from '../src/shared/annotation.js';

const BASE = '#2b2b2b';

test('部分の色：選んだ範囲だけ塗り、重なる所は塗り直し、隣の同じ色はつなぐ', () => {
  let runs = paintRuns([], 2, 5, '#d93025', BASE, 10);
  assert.deepEqual(runs, [[2, 5, '#d93025']]);
  runs = paintRuns(runs, 4, 8, '#1a73e8', BASE, 10); // 後から塗った色が勝つ
  assert.deepEqual(runs, [
    [2, 4, '#d93025'],
    [4, 8, '#1a73e8']
  ]);
  runs = paintRuns(runs, 4, 8, '#d93025', BASE, 10); // 同じ色が隣り合えば 1 つに
  assert.deepEqual(runs, [[2, 8, '#d93025']]);
  runs = paintRuns(runs, 3, 6, BASE, BASE, 10); // 箱の色に戻した所は持たない
  assert.deepEqual(runs, [
    [2, 3, '#d93025'],
    [6, 8, '#d93025']
  ]);
});

test('部分の色：本文を色の切れ目に分け、切れ目から本文と runs を作り直せる', () => {
  const body = 'あいうえお\nかき';
  const runs = [
    [1, 3, '#d93025'],
    [6, 8, '#1a73e8']
  ];
  const segs = textSegments(body, runs);
  assert.deepEqual(segs, [
    {t: 'あ', c: null},
    {t: 'いう', c: '#d93025'},
    {t: 'えお\n', c: null},
    {t: 'かき', c: '#1a73e8'}
  ]);
  assert.deepEqual(fromSegments(segs, BASE), {body, runs});
  assert.deepEqual(textSegments('', []), [{t: '', c: null}], '空でも 1 つ（箱の中身が空の span）');
});

test('部分の色：形の悪いもの・範囲の外・重なりを整える', () => {
  assert.deepEqual(
    cleanRuns(
      [
        [0, 3, '#D93025'], // 大文字は小文字に
        [2, 4, '#1a73e8'], // 前と重なる所は前の色
        [5, 99, '#00aa00'], // 本文の長さで切る
        [1.5, 2, '#000000'], // 整数でない
        [3, 3, '#000000'], // 長さ 0
        'x',
        [0, 1, 'red'] // 色の形が違う
      ],
      8,
      BASE
    ),
    [
      [0, 3, '#d93025'],
      [3, 4, '#1a73e8'],
      [5, 8, '#00aa00']
    ]
  );
  assert.deepEqual(cleanRuns(null, 5, BASE), []);
  assert.equal(cleanAlign('center'), 'center');
  assert.equal(cleanAlign('right'), 'right');
  assert.equal(cleanAlign('left'), null, '左は既定なので持たない');
  assert.equal(cleanAlign('justify'), null);
});

test('文字入れの保存：部分の色と揃えを残す（左揃え・箱と同じ色の所は持たない）', () => {
  const row = normalizeAnnotation({
    kind: 'text',
    page: 1,
    rect: {x: 10, y: 10, w: 50, h: 14},
    body: '赤い字と青い字',
    style: {
      size: 12,
      color: '#2B2B2B',
      align: 'right',
      runs: [
        [0, 2, '#d93025'],
        [2, 4, '#2b2b2b'],
        [4, 6, '#1a73e8'],
        [6, 50, '#00aa00']
      ]
    }
  });
  assert.deepEqual(JSON.parse(row.style_json), {
    size: 12,
    bold: false,
    color: '#2b2b2b',
    align: 'right',
    runs: [
      [0, 2, '#d93025'],
      [4, 6, '#1a73e8'],
      [6, 7, '#00aa00']
    ]
  });
  const plain = normalizeAnnotation({
    kind: 'text',
    page: 1,
    rect: {x: 0, y: 0, w: 1, h: 1},
    body: 'a',
    style: {align: 'left'}
  });
  assert.deepEqual(Object.keys(JSON.parse(plain.style_json)), ['size', 'bold', 'color'], '前の版と同じ形');
});
