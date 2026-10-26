import test from 'node:test';
import assert from 'node:assert/strict';
import {Scheduler} from '../src/main/scheduler.js';

// 日付の変わり目（バックアップ）は積むが、LMS をつないでいなければ同期は積まない
function ctxWith(connections) {
  const settings = new Map();
  const queued = [];
  const repo = {
    getSetting: (k, d) => (settings.has(k) ? settings.get(k) : d),
    setSetting: (k, v) => settings.set(k, v),
    listConnections: () => connections,
    listTerms: () => [],
    listCourses: () => []
  };
  return {ctx: {repo, jobs: {enqueue: (kind, p) => queued.push([kind, p])}}, queued};
}
const evening = () => new Date('2026-10-20T09:00:00Z'); // 日本時間 18:00（毎日の同期 16:30 を過ぎている）

test('LMS をつないでいないときは同期を積まない', () => {
  const {ctx, queued} = ctxWith([]);
  new Scheduler(ctx, {now: evening}).tick();
  assert.deepEqual(
    queued.map(([k]) => k),
    ['backup'],
    'レシピの更新はまだ仕組みがないので積まない'
  );
});

test('LMS をつないでいれば毎日の同期を積む', () => {
  const {ctx, queued} = ctxWith([{id: 'c', kind: 'recipe', status: 'ok'}]);
  new Scheduler(ctx, {now: evening}).tick();
  assert.ok(queued.some(([k, p]) => k === 'sync' && p.kind === 'full'));
});

test('今日の復習の知らせ：9:00 を過ぎたら 1 日 1 回、復習があるときだけ出す', () => {
  const {ctx} = ctxWith([]);
  const shown = [];
  ctx.notifier = {show: (n) => shown.push(n)};
  ctx.quiz = {review: () => ({questions: [1, 2, 3], next: null})};
  const morning = () => new Date('2026-10-20T00:30:00Z'); // 日本時間 9:30
  const s = new Scheduler(ctx, {now: morning});
  s.tick();
  s.tick();
  assert.equal(shown.length, 1, '同じ日に 2 回は出さない');
  assert.match(shown[0].body, /3 問/);
  assert.equal(shown[0].route, '/review');
  const early = () => new Date('2026-10-21T22:00:00Z'); // 日本時間 7:00（翌々日）
  new Scheduler(ctx, {now: early}).tick();
  assert.equal(shown.length, 1, '9:00 より前は出さない');
  ctx.quiz = {review: () => ({questions: [], next: null})};
  new Scheduler(ctx, {now: () => new Date('2026-10-22T01:00:00Z')}).tick();
  assert.equal(shown.length, 1, '復習がなければ出さない');
});
