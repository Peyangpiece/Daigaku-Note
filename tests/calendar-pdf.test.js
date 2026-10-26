import test from 'node:test';
import assert from 'node:assert/strict';
import {fillAt, isGray, pageFills} from '../src/main/calendar-pdf.js';

// pdf.js の OPS の一部（値は名前を区別できればよい）
const OPS = {
  save: 1,
  restore: 2,
  transform: 3,
  setFillRGBColor: 4,
  setFillGray: 5,
  constructPath: 6,
  fill: 7,
  eoFill: 8,
  fillStroke: 9,
  eoFillStroke: 10
};
const rect = (x0, y0, x1, y1) => [0, x0, y0, 1, x1, y0, 1, x1, y1, 1, x0, y1, 4];

test('学年暦の PDF の塗り：数字の位置にいちばん後に塗った色（穴あきの白い塗りの下の灰色）', () => {
  const ops = {
    fnArray: [OPS.transform, OPS.setFillRGBColor, OPS.constructPath, OPS.setFillRGBColor, OPS.constructPath],
    argsArray: [
      [0.5, 0, 0, 0.5, 0, 0], // 座標を半分に
      ['#d9d9d9'],
      [OPS.fill, [rect(0, 0, 200, 100)]], // 全体を灰色に
      ['#ffffff'],
      // 白：全体から右半分を抜いた（偶奇の規則の穴）
      [OPS.eoFill, [[...rect(0, 0, 200, 100), ...rect(100, 0, 200, 100)]]]
    ]
  };
  const fills = pageFills(OPS, ops);
  assert.equal(fills.length, 2);
  assert.deepEqual(fillAt(fills, 20, 20), [255, 255, 255], '左半分は白');
  assert.deepEqual(fillAt(fills, 70, 20), [217, 217, 217], '右半分（穴）は下の灰色');
  assert.equal(fillAt(fills, 150, 20), null, '塗りの外');
  assert.ok(isGray([217, 217, 217]));
  assert.ok(
    !isGray([255, 255, 255]) && !isGray([128, 128, 128]) && !isGray([204, 255, 255]),
    '白・濃い灰色・水色は灰色にしない'
  );
});
