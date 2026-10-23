import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampMinutes,
  formatClock,
  isDone,
  isRunning,
  newTimer,
  pauseTimer,
  startTimer,
  timerLeft
} from '../src/shared/timer.js';

test('タイマー：分の入力を 1〜180 の整数にする', () => {
  assert.equal(clampMinutes('25'), 25);
  assert.equal(clampMinutes(' 7.4 '), 7);
  assert.equal(clampMinutes('0'), 1);
  assert.equal(clampMinutes('999'), 180);
  assert.equal(clampMinutes(''), null);
  assert.equal(clampMinutes('abc'), null);
});

test('タイマー：残りの表し方（秒は切り上げ、1 時間以上は時:分:秒）', () => {
  assert.equal(formatClock(25 * 60000), '25:00');
  assert.equal(formatClock(61000), '1:01');
  assert.equal(formatClock(200), '0:01', '0.2 秒残りは 0:01');
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(-5), '0:00');
  assert.equal(formatClock(3600000 + 5000), '1:00:05');
});

test('タイマー：動かす・一時停止・続きから・終わり（時刻から数えるので遅れない）', () => {
  let t = newTimer(60000);
  assert.equal(isRunning(t), false);
  assert.equal(timerLeft(t, 0), 60000);
  t = startTimer(t, 1000);
  assert.equal(timerLeft(t, 21000), 40000);
  assert.equal(startTimer(t, 5000), t, '動いている間にもう一度押しても変わらない');
  t = pauseTimer(t, 21000);
  assert.equal(isRunning(t), false);
  assert.equal(timerLeft(t, 999999), 40000, '止めている間は減らない');
  t = startTimer(t, 100000);
  assert.equal(timerLeft(t, 130000), 10000);
  assert.equal(isDone(t, 139999), false);
  assert.equal(isDone(t, 140000), true);
  assert.equal(timerLeft(t, 150000), 0);
  t = startTimer(pauseTimer(t, 150000), 200000);
  assert.equal(timerLeft(t, 200000), 60000, '0 になったあとに動かすと最初から');
});
