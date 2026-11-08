import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveScan, cornerMove} from '../src/shared/scan-live.js';

const at = (dx = 0) => ({tl: [100 + dx, 100], tr: [500 + dx, 100], br: [500 + dx, 660], bl: [100 + dx, 660]});
const sheet = (dx = 0, format = 'a7') => ({marks: at(dx), format});

test('その場で読む：紙が止まったら 1 回だけ取り込み、外すまで同じ紙は取らない', () => {
  const live = createLiveScan();
  assert.equal(live.step(null).phase, 'none');
  const phases = [];
  for (let i = 0; i < 6; i++) phases.push(live.step(sheet()).phase);
  assert.deepEqual(phases, ['steady', 'steady', 'steady', 'capture', 'done', 'done']);
  // 外す（3 回見えない）と、次の紙を待つ
  live.step(null);
  live.step(null);
  assert.equal(live.armed, false, '一瞬隠れただけでは、まだ同じ紙');
  live.step(null);
  assert.equal(live.armed, true);
  const next = [];
  for (let i = 0; i < 4; i++) next.push(live.step(sheet(0, 'b6')).phase);
  assert.equal(next.at(-1), 'capture');
});

test('その場で読む：動いている間・コードが読めない間は取り込まない。読めなかったら同じ紙をもう一度', () => {
  const live = createLiveScan();
  for (let i = 0; i < 8; i++) assert.notEqual(live.step(sheet(i * 20)).phase, 'capture', '手ぶれで動いている');
  for (let i = 0; i < 5; i++) assert.equal(live.step(sheet(200, null)).phase, 'nocode');
  let p;
  for (let i = 0; i < 4; i++) p = live.step(sheet(200)).phase;
  assert.equal(p, 'capture');
  live.retry();
  for (let i = 0; i < 4; i++) p = live.step(sheet(200)).phase;
  assert.equal(p, 'capture', '読めなかった紙をもう一度読む');
  assert.ok(cornerMove(at(0), at(3)) < 0.012 && cornerMove(at(0), at(20)) > 0.012);
});
