import test from 'node:test';
import assert from 'node:assert/strict';
import {SWIPE_IDLE, SWIPE_THRESHOLD, createSwipe} from '../src/shared/swipe.js';

/** 横の動きを 10 回に分けて渡し、決まった向きを返す（time から 16ms おき） */
const run = (s, dx, dy = 0, time = 0, n = 10) => {
  let go = null;
  for (let i = 0; i < n; i++) go = s.feed(dx / n, dy / n, time + i * 16).go ?? go;
  return go;
};

test('スワイプ：右へ払う（deltaX が負）と戻る、左へ払うと進む。量が足りなければ何もしない', () => {
  assert.equal(run(createSwipe(), -SWIPE_THRESHOLD - 10), 'back');
  assert.equal(run(createSwipe(), SWIPE_THRESHOLD + 10), 'forward');
  assert.equal(run(createSwipe(), -SWIPE_THRESHOLD / 2), null);
  const s = createSwipe();
  const r = s.feed(-SWIPE_THRESHOLD / 4, 0, 0);
  assert.equal(r.go, null);
  assert.equal(r.progress, -0.25, '目印の動き');
});

test('スワイプ：1 回の払いで決まるのは 1 回だけ（慣性の wheel で何ページも戻らない）。間があけば次の払い', () => {
  const s = createSwipe();
  assert.equal(run(s, -SWIPE_THRESHOLD * 3, 0, 0, 30), 'back');
  let again = 0;
  for (let i = 0; i < 20; i++) if (s.feed(-50, 0, 500 + i * 16).go) again++;
  assert.equal(again, 0, '慣性');
  assert.equal(run(s, -SWIPE_THRESHOLD - 10, 0, 500 + 20 * 16 + SWIPE_IDLE + 1), 'back', '次の払い');
});

test('スワイプ：縦のスクロールは数えない（途中で横に振れても）。やめたスワイプは決まらない', () => {
  const s = createSwipe();
  s.feed(2, 40, 0); // 縦で始まった
  assert.equal(run(s, -SWIPE_THRESHOLD * 2, 0, 16), null);
  assert.equal(run(createSwipe(), -SWIPE_THRESHOLD * 2, -SWIPE_THRESHOLD * 3), null, '斜め（縦が大きい）');
  const c = createSwipe();
  c.feed(-20, 0, 0);
  c.cancel();
  assert.equal(run(c, -SWIPE_THRESHOLD * 2, 0, 16), null);
});
