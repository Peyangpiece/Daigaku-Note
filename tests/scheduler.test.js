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
