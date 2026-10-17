import test from 'node:test';
import assert from 'node:assert/strict';
import {GAPS, LEARNED, nextDue, reviewQueue, schedule} from '../src/shared/srs.js';

const DAY = 864e5;
const t0 = Date.UTC(2026, 9, 16);

test('初めて正解 → 1 週間後に 1 回。まちがえた → すぐ', () => {
  const first = schedule(undefined, true, t0);
  assert.equal(first.s, 3);
  assert.equal(first.due, t0 + 7 * DAY);
  const wrong = schedule(undefined, false, t0);
  assert.deepEqual(wrong, {s: 0, due: t0, at: t0, lapses: 1});
});

test('段階が進み、最後は「おぼえた」。まちがえたら 0 から', () => {
  let e = schedule(undefined, false, t0);
  let now = t0;
  for (let i = 0; i < GAPS.length; i++) {
    now = Math.max(now, e.due);
    e = schedule(e, true, now);
    assert.equal(e.s, i + 1);
    assert.equal(e.due, now + GAPS[i] * DAY);
  }
  now = e.due;
  e = schedule(e, true, now);
  assert.equal(e.s, LEARNED);
  assert.equal(schedule(e, true, now + DAY), e, 'おぼえた問題を正解しても変わらない');
  const again = schedule(e, false, now + DAY);
  assert.equal(again.s, 0);
  assert.equal(again.lapses, 2);
});

test('まだ日が来ていない問題を正解しても段階は進めない', () => {
  const e = schedule(schedule(undefined, false, t0), true, t0); // s:1, due +1日
  const same = schedule(e, true, t0 + 3600e3);
  assert.equal(same, e);
});

test('2 択は 2 回続けて正解で昇格', () => {
  const e = schedule(undefined, false, t0); // s:0
  const once = schedule(e, true, t0, {two: true});
  assert.equal(once.s, 0);
  assert.equal(once.c, 1);
  const twice = schedule(once, true, t0 + 1, {two: true});
  assert.equal(twice.s, 1);
  assert.equal(twice.c, 0);
});

test('今日の復習の並びと上限', () => {
  const items = [];
  for (let i = 0; i < 40; i++) items.push({id: 'q' + i, entry: {s: 1, due: t0 - i * 1000, lapses: i % 3}});
  items.push({id: 'future', entry: {s: 2, due: t0 + DAY}});
  items.push({id: 'learned', entry: {s: LEARNED, due: 0}});
  items.push({id: 'none', entry: null});
  const {items: q, rest} = reviewQueue(items, t0, 30);
  assert.equal(q.length, 30);
  assert.equal(rest, 10);
  assert.equal(q[0].id, 'q39', '期限を過ぎて長いものが先');
  assert.ok(!q.some((x) => ['future', 'learned', 'none'].includes(x.id)));
  const same = [
    {id: 'a', entry: {s: 1, due: t0 - 5, lapses: 0}},
    {id: 'b', entry: {s: 1, due: t0 - 5, lapses: 4}}
  ];
  assert.equal(reviewQueue(same, t0).items[0].id, 'b', '同じ期限ならまちがえた回数が多い方が先');
});

test('次の復習の日', () => {
  const items = [
    {entry: {s: 1, due: t0 + 2 * DAY}},
    {entry: {s: 1, due: t0 + 2 * DAY + 3600e3}},
    {entry: {s: 1, due: t0 + 9 * DAY}}
  ];
  assert.deepEqual(nextDue(items, t0), {due: t0 + 2 * DAY, count: 2});
  assert.equal(nextDue([], t0), null);
});
