import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutSheets, parsePages, pickLandscape, sheetsHtml, SHEET_MARGIN} from '../src/shared/print-layout.js';

const SLIDE = {w: 960, h: 540}; // 16:9 のスライド（pt）
const A4P = {w: 595, h: 842}; // A4 縦（pt）

test('ページの指定：範囲・1 つ・開いた範囲・全角・重なり', () => {
  assert.deepEqual(parsePages('', 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(parsePages('1-3, 5', 10), [1, 2, 3, 5]);
  assert.deepEqual(parsePages('８-', 10), [8, 9, 10]);
  assert.deepEqual(parsePages('-2', 10), [1, 2]);
  assert.deepEqual(parsePages('２〜４、３', 10), [2, 3, 4]);
  assert.deepEqual(parsePages('3-20', 5), [3, 4, 5], '範囲外は切り詰める');
  assert.equal(parsePages('5-3', 10), null, '逆の範囲は読めない');
  assert.equal(parsePages('a', 10), null);
  assert.equal(parsePages('20', 10), null, '1 ページも残らない');
});

test('向き（自動）：横長のスライドは 1 枚に 1 ページなら横、2 ページなら縦に 2 段、4 ページなら横', () => {
  assert.equal(pickLandscape({page: SLIDE, nup: 1}), true);
  assert.equal(pickLandscape({page: SLIDE, nup: 2}), false);
  assert.equal(pickLandscape({page: SLIDE, nup: 4}), true);
  assert.equal(pickLandscape({page: A4P, nup: 1}), false);
  assert.equal(pickLandscape({page: A4P, nup: 2}), true);
  assert.equal(pickLandscape({page: SLIDE, nup: 1, orient: 'portrait'}), false, '選んだ向きはそのまま');
});

test('割り付け：紙の枚数、ページは余白の内側に縦横比を保って入る', () => {
  const pages = Array.from({length: 5}, (_, i) => ({num: i + 1, ...SLIDE}));
  for (const nup of [1, 2, 4]) {
    const l = layoutSheets(pages, {paper: 'A4', nup});
    assert.equal(l.sheets.length, Math.ceil(5 / nup), `1 枚に ${nup}`);
    for (const c of l.sheets.flat()) {
      assert.ok(c.x >= SHEET_MARGIN - 1e-9 && c.y >= SHEET_MARGIN - 1e-9);
      assert.ok(c.x + c.w <= l.w - SHEET_MARGIN + 1e-9 && c.y + c.h <= l.h - SHEET_MARGIN + 1e-9);
      assert.ok(Math.abs(c.w / c.h - SLIDE.w / SLIDE.h) < 1e-9, '縦横比を保つ');
    }
  }
  const one = layoutSheets(pages.slice(0, 1), {paper: 'A4', nup: 1});
  assert.equal(one.landscape, true);
  assert.deepEqual([one.w, one.h], [297, 210]);
  assert.ok(Math.abs(one.sheets[0][0].w - (297 - SHEET_MARGIN * 2)) < 1e-9, '横いっぱい');
  const two = layoutSheets(pages.slice(0, 2), {paper: 'A4', nup: 2});
  assert.ok(two.sheets[0][1].y > two.sheets[0][0].y, '2 ページは上下に並ぶ');
  assert.deepEqual(
    two.sheets[0].map((c) => c.num),
    [1, 2]
  );
});

test('刷る紙の HTML：@page の大きさと、ページの画像の位置（mm）', () => {
  const l = layoutSheets([{num: 3, ...SLIDE}], {paper: 'A4', nup: 1});
  const html = sheetsHtml(l, (n) => `p${n}.jpg`);
  assert.match(html, /@page \{ size: 297mm 210mm; margin: 0; \}/);
  assert.match(html, /<img src="p3\.jpg" alt="" style="left:6mm;top:[\d.]+mm;width:285mm;height:[\d.]+mm">/);
  assert.equal((html.match(/class="sheet"/g) ?? []).length, 1);
});
