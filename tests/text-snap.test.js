import test from 'node:test';
import assert from 'node:assert/strict';
import {charEdges, snapRange, textIn, wordAt, words} from '../src/renderer/views/text-snap.js';

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
