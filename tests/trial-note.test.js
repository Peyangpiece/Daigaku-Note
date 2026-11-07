import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import * as trial from '../src/main/trial-note.js';

const mark = (page = 1) => ({kind: 'mask', page, rect: {x: 10, y: 10, w: 80, h: 12}, style: {}});

test('試し書き：メモリの中だけで紙と書いたものを持ち、ページの足し引き・紙の変更ができる。閉じると消える', async () => {
  trial.endTrial();
  assert.throws(() => trial.openTrial(), /開き直して/);
  await trial.startTrial({format: 'genkou'}, '試し書き：Palette 原稿用紙');
  const o = trial.openTrial();
  assert.equal(o.material.id, trial.TRIAL_ID);
  assert.equal(o.material.trial, true);
  assert.equal(o.material.source, 'note', 'ノートとして開く（ページを足す・紙を変えるが使える）');
  assert.equal(o.paper.format, 'genkou');
  const doc = await PDFDocument.load(o.bytes);
  assert.ok(doc.getPage(0).getWidth() > doc.getPage(0).getHeight(), '原稿用紙は A4 横');

  const a = trial.saveTrialAnnotation(mark(1));
  assert.ok(a.id);
  assert.equal(trial.trialAnnotations().length, 1);
  assert.throws(() => trial.saveTrialAnnotation(mark(2)), /ページ|種類|位置/, 'ないページには書けない');

  assert.equal((await trial.addTrialPage()).pages, 2);
  const b = trial.saveTrialBookmark({page: 2, y: 0.5, name: '第2章'});
  await assert.rejects(trial.removeTrialPage(), /付箋/, '付箋のあるページは消さない');
  trial.removeTrialBookmark(b.id);
  assert.equal((await trial.removeTrialPage()).pages, 1);
  await assert.rejects(trial.removeTrialPage(), /消せません|1 ページ/, '1 ページ目（書いたものあり）は消さない');

  const p = await trial.setTrialPaper({v: 3, format: 'a7'});
  assert.equal(p.paper.format, 'a7');
  assert.equal(trial.trialAnnotations().length, 1, '紙を変えても書いたものは残る');
  trial.removeTrialAnnotation(a.id);
  assert.equal(trial.trialAnnotations().length, 0);

  trial.endTrial();
  assert.throws(() => trial.trialAnnotations(), /開き直して/);
});
