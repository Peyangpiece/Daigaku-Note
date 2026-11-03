import test from 'node:test';
import assert from 'node:assert/strict';
import {ORDER_SCOPE, applyOrder, cleanColor, cleanKeys, hasOrder} from '../src/shared/arrange.js';

test('並べ替え：覚えた鍵の順に並べ、知らないものはもとの並びのまま後ろへ', () => {
  const items = ['a', 'b', 'c', 'd'];
  assert.deepEqual(
    applyOrder(items, (x) => x, ['c', 'a']),
    ['c', 'a', 'b', 'd']
  );
  assert.deepEqual(
    applyOrder(items, (x) => x, ['z', 'd', 'b']),
    ['d', 'b', 'a', 'c']
  ); // もうない鍵は飛ばす
  assert.deepEqual(
    applyOrder(items, (x) => x, []),
    items
  );
  assert.deepEqual(
    applyOrder(items, (x) => x, undefined),
    items
  );
  assert.equal(hasOrder(['a']), true);
  assert.equal(hasOrder([]), false);
});

test('並べ替え：鍵・範囲・色を確かめる', () => {
  assert.deepEqual(cleanKeys(['a', '', 'a', 'b']), ['a', '', 'b']);
  assert.equal(cleanKeys('a'), null);
  assert.equal(cleanKeys([1]), null);
  assert.equal(cleanKeys(['x'.repeat(401)]), null);
  assert.equal(cleanKeys(Array.from({length: 501}, (_, i) => String(i))), null);
  assert.ok(ORDER_SCOPE.test('home:classes'));
  assert.ok(ORDER_SCOPE.test('home:folders'));
  assert.ok(ORDER_SCOPE.test('course:01HZY3V9Q4M7K2N8P5R6S0T1W2'));
  assert.ok(!ORDER_SCOPE.test('course:../x'));
  assert.ok(!ORDER_SCOPE.test('home:other'));
  assert.equal(cleanColor(3), 3);
  assert.equal(cleanColor(null), null);
  assert.equal(cleanColor(0), undefined);
  assert.equal(cleanColor(6), undefined);
  assert.equal(cleanColor('2'), undefined);
});
