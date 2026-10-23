import test from 'node:test';
import assert from 'node:assert/strict';
import {SWIPE_COMMIT, SWIPE_COOLDOWN, SWIPE_DISTANCE, SWIPE_IDLE, createSwipe} from '../src/shared/swipe.js';

/** 動きを n 回に分けて渡す（time から 16ms おき）。最後の戻り値と、次の時刻を返す */
const move = (s, dx, dy = 0, time = 0, n = 10) => {
  let r = null;
  for (let i = 0; i < n; i++) r = s.feed(dx / n, dy / n, time + i * 16);
  return {r, t: time + n * 16};
};

test('スワイプ：指に合わせて progress を返し、離したとき十分なら切り替え、足りなければ元に戻す', () => {
  const s = createSwipe();
  const {r} = move(s, -SWIPE_DISTANCE / 2);
  assert.ok(Math.abs(r.progress + 0.5) < 1e-9, '右へ払う（deltaX が負）と戻る向き');
  assert.equal(s.end(), 'back');
  const f = createSwipe();
  move(f, SWIPE_DISTANCE * SWIPE_COMMIT * 1.1);
  assert.equal(f.end(), 'forward');
  const small = createSwipe();
  move(small, -SWIPE_DISTANCE * SWIPE_COMMIT * 0.5);
  assert.equal(small.end(), null, '足りなければ元に戻す');
});

test('スワイプ：置いた瞬間の縦のぶれで縦と決めつけない。縦のスクロールの途中でも、はっきり横に動かせば横になる', () => {
  const s = createSwipe();
  s.feed(0, 3, 0); // 置いた瞬間の小さな縦のぶれ（まだ向きを決めない）
  const {r} = move(s, -SWIPE_DISTANCE / 2, 0, 16);
  assert.ok(r && r.progress < 0, '横のスワイプ');
  assert.equal(s.end(), 'back');
  const v = createSwipe();
  const a = move(v, 0, 200); // 縦のスクロール
  assert.equal(a.r, null);
  const b = move(v, -SWIPE_DISTANCE / 2, 0, a.t); // そのまま横へ
  assert.ok(b.r && b.r.progress < 0, '縦から横へ切り替わる');
  assert.equal(v.end(), 'back');
});

test('スワイプ：縦のスクロールは切り替えない。斜め（縦が大きい）も同じ', () => {
  const s = createSwipe();
  move(s, 20, 300);
  assert.equal(s.end(), null);
  const d = createSwipe();
  move(d, -SWIPE_DISTANCE / 2, -SWIPE_DISTANCE);
  assert.equal(d.end(), null);
});

test('スワイプ：切り替えたあとの慣性では何もしない。途切れたら次のスワイプ。やめたスワイプも同じ', () => {
  const s = createSwipe();
  const a = move(s, -SWIPE_DISTANCE);
  assert.equal(s.end(), 'back');
  const b = move(s, -SWIPE_DISTANCE, 0, a.t + 16); // 慣性
  assert.equal(b.r, null);
  assert.equal(s.end(), null);
  const c = move(s, -SWIPE_DISTANCE / 2, 0, b.t + SWIPE_COOLDOWN + 1);
  assert.ok(c.r && c.r.progress < 0, '次のスワイプ');
  const x = createSwipe();
  x.feed(-20, 0, 0);
  x.cancel();
  assert.equal(move(x, -SWIPE_DISTANCE, 0, 16).r, null);
  assert.ok(move(x, -SWIPE_DISTANCE / 2, 0, 16 * 11 + SWIPE_COOLDOWN + SWIPE_IDLE).r.progress < 0);
});
