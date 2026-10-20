import test from 'node:test';
import assert from 'node:assert/strict';
import {charEdges, snapRange, textIn, wordAt, words, fitToInk, inkFromImage} from '../src/renderer/views/text-snap.js';

// 全角は 2、半角は 1 の幅とみなす
const measure = (c) => (/[\x20-\x7e]/.test(c) ? 1 : 2);
const item = (str, left, right, top = 100) => ({str, left, right, top, bottom: top + 20});

test('字の切れ目：文字列の幅を字の幅の比で分ける（全角・半角）', () => {
  const it = item('原価ab', 0, 60); // 幅の比 2:2:1:1 → 20・20・10・10
  assert.deepEqual(charEdges(it, measure), [0, 20, 40, 50, 60]);
  assert.deepEqual(it.chars, ['原', '価', 'a', 'b']);
});

test('なぞった端をいちばん近い字の切れ目に合わせる。1 字に満たなければその字', () => {
  const it = item('原価企画の目的', 0, 140); // 1 字 20px
  assert.deepEqual(snapRange([it], 3, 58, measure), {left: 0, right: 60}, '字の途中から途中 → 近い切れ目');
  assert.deepEqual(snapRange([it], 23, 77, measure), {left: 20, right: 80});
  assert.deepEqual(snapRange([it], 42, 47, measure), {left: 40, right: 60}, '短すぎるときは真ん中の字');
  assert.deepEqual(snapRange([it], -30, 400, measure), {left: 0, right: 140}, '字の外まではみ出したら行の端まで');
  assert.equal(textIn([it], 20, 80, measure), '価企画');
});

test('単語：漢字どうし・カタカナどうしはつなげ、ひらがな・句読点は分ける', () => {
  const ws = words('原価企画の目的は、コストダウンです').map(
    (w) => (w.word ? '' : '*') + '原価企画の目的は、コストダウンです'.slice(w.start, w.end)
  );
  assert.deepEqual(ws.slice(0, 5), ['原価企画', 'の', '目的', 'は', '*、']);
  assert.ok(ws.includes('コストダウン'));
});

test('押した位置の単語を覆う。句読点・字の外なら null', () => {
  const it = item('原価企画の目的は、コストを下げる', 0, 320); // 1 字 20px
  assert.deepEqual(wordAt(it, 30, measure), {left: 0, right: 80, str: '原価企画'});
  assert.deepEqual(wordAt(it, 115, measure), {left: 100, right: 140, str: '目的'});
  assert.equal(wordAt(it, 170, measure), null, '「、」は覆わない');
  assert.equal(wordAt(it, 500, measure), null);
  const en = item('Cost down 2026', 0, 140); // 1 字 10px
  assert.deepEqual(wordAt(en, 62, measure), {left: 50, right: 90, str: 'down'});
});

test('描かれた字に合わせる：見積もりの端が字の途中なら、近い字のすき間へ。上下ははみ出した字まで広げる', () => {
  // 字は 20px ごと（x = 2〜17, 22〜37, …）、y = 8〜27 に描かれている。字と字のすき間は x = 18〜21
  const ink = (x, y) => x >= 0 && x < 100 && y >= 8 && y <= 27 && ((x % 20) + 20) % 20 >= 2 && ((x % 20) + 20) % 20 <= 17;
  const r = fitToInk({left: 1, right: 55, top: 10, bottom: 25}, ink, {fh: 20, pad: 0});
  assert.equal(r.left, 1, '左はすき間の上なのでそのまま');
  assert.equal(r.right, 58, '右は字（40〜57）の途中 → 右のすき間へ');
  assert.equal(r.top, 8, '上にはみ出した字まで広げる');
  assert.equal(r.bottom, 27);
  const r2 = fitToInk({left: 4, right: 43, top: 10, bottom: 25}, ink, {fh: 20, pad: 0});
  assert.deepEqual([r2.left, r2.right], [1, 41], '左は字の始まり近く → 左のすき間、右は次の字に少し入った → 左のすき間');
});

test('ImageData から字（背景より暗い画素）を見分ける。背景が暗ければ直さない', () => {
  const img = (rgb) => ({width: 2, height: 1, data: Uint8ClampedArray.from([...rgb, 255, 255, 255, 0, 255])});
  const ink = inkFromImage(img([0, 0, 0]), {x0: 10, y0: 0, scale: 1});
  assert.equal(ink(10, 0), true, '黒い字');
  assert.equal(ink(11, 0), false, '黄色の背景');
  assert.equal(inkFromImage({width: 1, height: 1, data: Uint8ClampedArray.from([20, 20, 20, 255])}, {x0: 0, y0: 0, scale: 1}), null);
});
