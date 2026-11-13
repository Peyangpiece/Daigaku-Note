// 暗記モード（SPEC §9.3.3）：順番と 1 周の進み方（shared/memorize.js）、記録（repo.setMemorized）
import test from 'node:test';
import assert from 'node:assert/strict';
import {memoOrder, memoRound} from '../src/shared/memorize.js';
import {openDatabase} from '../src/main/db/db.js';
import {Repo} from '../src/main/db/repo.js';
import {annotationToClient, normalizeAnnotation} from '../src/shared/annotation.js';

const mask = (key, page, x, y, h = 12) => ({key, page, rect: {x, y, w: 40, h}});

test('順番：ページ → 上から → 同じ行は左から（PDF の座標は下が 0）', () => {
  const order = memoOrder([
    mask('p2', 2, 10, 700),
    mask('low', 1, 10, 100),
    mask('right', 1, 300, 702), // left と同じ行（上の辺がほぼ同じ）
    mask('left', 1, 50, 700),
    mask('top', 1, 400, 780)
  ]).map((a) => a.key);
  assert.deepEqual(order, ['top', 'left', 'right', 'low', 'p2']);
});

test('1 周：覚えた・まだを付けて進み、終わったら「まだ」だけでもう 1 周', () => {
  const r = memoRound(['a', 'b', 'c']);
  assert.equal(r.current(), 'a');
  r.answer(true);
  r.answer(false);
  assert.equal(r.current(), 'c');
  assert.equal(r.state.done, false);
  r.answer(false);
  assert.equal(r.state.done, true);
  assert.equal(r.current(), null);
  assert.deepEqual([r.state.known, r.state.unknown], [['a'], ['b', 'c']]);
  r.again();
  assert.deepEqual([r.state.keys, r.state.index, r.state.done], [['b', 'c'], 0, false]);
  r.answer(true);
  r.answer(true);
  r.again();
  assert.equal(r.state.done, true, '「まだ」がなければ終わり');
  assert.equal(memoRound([]).state.done, true);
});

test('記録：覚えた・まだを注釈に残す（ほかのファイルの注釈には付けない。中身と更新の時刻は変えない）', async () => {
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  const row = normalizeAnnotation({page: 1, kind: 'mask', rect: {x: 10, y: 20, w: 40, h: 12}, body: '原価', style: {}});
  const a = repo.saveAnnotation('sha-a', null, row);
  assert.equal(annotationToClient(a).memorized, null, 'まだ確かめていない');
  repo.setMemorized('sha-a', a.id, true);
  const b = repo.get('annotation', a.id);
  assert.equal(annotationToClient(b).memorized, true);
  assert.equal(b.updated_at, a.updated_at);
  repo.setMemorized('sha-other', a.id, false);
  assert.equal(annotationToClient(repo.get('annotation', a.id)).memorized, true);
  repo.setMemorized('sha-a', a.id, false);
  assert.equal(annotationToClient(repo.get('annotation', a.id)).memorized, false);
  // 書き直しても記録は消えない（saveAnnotation は memorized に触れない）
  repo.saveAnnotation('sha-a', a.id, {...row, body: '原価計算'});
  assert.equal(annotationToClient(repo.get('annotation', a.id)).memorized, false);
});
