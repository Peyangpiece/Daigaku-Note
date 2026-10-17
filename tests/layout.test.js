import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutBase, layoutOf, preferLayout} from '../src/shared/layout.js';

test('印刷形式の判定', () => {
  assert.equal(layoutOf('第3回 資料.pdf'), 1);
  assert.equal(layoutOf('第3回 資料 4up.pdf'), 4);
  assert.equal(layoutOf('第3回 資料（2up）.pdf'), 2);
  assert.equal(layoutOf('資料_4in1.pdf'), 4);
  assert.equal(layoutOf('資料 4アップ.pdf'), 4);
  assert.equal(layoutOf('資料（2分割）.pdf'), 2);
  assert.equal(layoutOf('資料（分割なし）.pdf'), 1);
  assert.equal(layoutOf('第4回 資料.pdf'), 1, '第4回 は回番号');
  assert.equal(layoutOf('資料 2024up.pdf'), 1, '長い数字は形式ではない');
});

test('同じ資料の形式違いをまとめる鍵', () => {
  assert.equal(layoutBase('第3回 資料 4up.pdf'), layoutBase('第3回 資料.pdf'));
  assert.equal(layoutBase('第3回_資料（2分割バージョン）.pdf'), layoutBase('第3回 資料（分割なし）.pdf'));
  assert.notEqual(layoutBase('第3回 資料.pdf'), layoutBase('第4回 資料.pdf'));
});

test('1up があれば 1up だけ残し、なければ全部残す', () => {
  const files = [
    {name: '第3回 資料.pdf'},
    {name: '第3回 資料 4up.pdf'},
    {name: '第3回 資料 2up.pdf'},
    {name: '練習問題 4up.pdf'},
    {name: '練習問題 2up.pdf'},
    {name: '別の資料.pdf'}
  ];
  assert.deepEqual(
    preferLayout(files).map((f) => f.name),
    ['第3回 資料.pdf', '練習問題 4up.pdf', '練習問題 2up.pdf', '別の資料.pdf']
  );
});
