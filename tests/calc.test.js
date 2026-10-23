import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate, formatNumber} from '../src/shared/calc.js';

const calc = (s) => formatNumber(evaluate(s));

test('電卓：四則と優先順位・かっこ・記号の別の書き方', () => {
  assert.equal(calc('1+2×3'), '7');
  assert.equal(calc('(1+2)*3'), '9');
  assert.equal(calc('10÷4'), '2.5');
  assert.equal(calc('8−3−2'), '3', '左から');
  assert.equal(calc('24/4/2'), '3', '左から');
  assert.equal(calc(' 1 + 1 '), '2', '空白は無視');
});

test('電卓：累乗・符号・％・√・π・続けて書いた掛け算', () => {
  assert.equal(calc('2^10'), '1024');
  assert.equal(calc('2^3^2'), '512', '累乗は右から');
  assert.equal(calc('-2^2'), '-4', '−2^2 は −(2^2)');
  assert.equal(calc('(-2)^2'), '4');
  assert.equal(calc('2^-1'), '0.5');
  assert.equal(calc('50%'), '0.5');
  assert.equal(calc('200×15%'), '30');
  assert.equal(calc('√9+1'), '4', '√ は直後の数だけ');
  assert.equal(calc('√(9+16)'), '5');
  assert.equal(calc('2π'), formatNumber(2 * Math.PI));
  assert.equal(calc('3(4+5)'), '27');
  assert.equal(calc('2√9'), '6');
});

test('電卓：小数の誤差を丸める', () => {
  assert.equal(calc('0.1+0.2'), '0.3');
  assert.equal(calc('1-0.9'), '0.1');
  assert.equal(calc('.5*4'), '2');
  assert.equal(calc('-0'), '0');
});

test('電卓：正しくない式は理由つきで断る', () => {
  assert.throws(() => evaluate('1/0'), /0 では割れません/);
  assert.throws(() => evaluate('(1+2'), /かっこが閉じていません/);
  assert.throws(() => evaluate('1+2)'), /かっこが合いません/);
  assert.throws(() => evaluate('1+'), /途中で終わって/);
  assert.throws(() => evaluate('√-4'), /負の数の平方根/);
  assert.throws(() => evaluate('2a'), /「a」は使えません/);
  assert.throws(() => evaluate(''), /式がありません/);
  assert.throws(() => evaluate('10^400'), /大きすぎ/);
  assert.throws(() => evaluate('*3'), /正しくありません/);
});
