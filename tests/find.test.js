// PDF の中の検索（views/viewer/find.js）：文字のつなぎ方と、見つけた所の四角
import test from 'node:test';
import assert from 'node:assert/strict';
import {pageChars, rectsOf} from '../src/renderer/views/viewer/find.js';

const tc = {
  items: [
    {str: 'Ｑuick ', transform: [10, 0, 0, 10, 100, 700], width: 60, height: 10},
    {str: 'brown fox', transform: [10, 0, 0, 10, 160, 700], width: 90, height: 10}
  ]
};

test('検索：空白を除き、全角・半角と大文字・小文字をそろえてつなぐ。2 つのかたまりにまたがっても探せる', () => {
  const chars = pageChars(tc);
  const s = chars.map((c) => c.c).join('');
  assert.equal(s, 'quickbrownfox');
  const at = s.indexOf('quickbrown');
  assert.equal(at, 0);
  const rects = rectsOf(tc, chars, at, at + 'quickbrown'.length);
  assert.equal(rects.length, 2, 'かたまりごとに四角');
  // 1 つ目：Quick（5 文字。かたまりは 6 文字で幅 60）→ x 100〜150
  assert.deepEqual(rects[0].map(Math.round), [100, 698, 150, 710]);
  // 2 つ目：brown（9 文字中の 5 文字。幅 90）→ x 160〜210
  assert.deepEqual(rects[1].map(Math.round), [160, 698, 210, 710]);
});
