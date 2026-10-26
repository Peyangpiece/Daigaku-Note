import test from 'node:test';
import assert from 'node:assert/strict';
import {MIN_MASKS, clozeFromMasks, clozeSentence} from '../src/shared/cloze.js';
import {BLANK, checkQuestion} from '../src/shared/quiz.js';

const page = [
  '原価企画とは、製品の企画・設計の段階で目標原価を設定し、それを達成する活動である。',
  '目標原価は、予定売価から目標利益を差し引いて求める。',
  '標準原価計算では、原価差異を分析して改善につなげる。',
  '直接労務費差異は、賃率差異と作業時間差異に分けられる。',
  '損益分岐点は、固定費を貢献利益率で割って求める。'
].join('\n');
const masks = [
  {text: '目標原価', page: 1, file: '第3回.pdf', context: page},
  {text: '予定売価', page: 1, file: '第3回.pdf', context: page},
  {text: '原価差異', page: 1, file: '第3回.pdf', context: page},
  {text: '賃率差異', page: 1, file: '第3回.pdf', context: page},
  {text: '貢献利益率', page: 1, file: '第3回.pdf', context: page}
];

test('穴埋めの一文：隠した語を含む一文を引用にし、語を [＿] にする。PDF の読み取りで入った改行や空白は無視して探す', () => {
  const r = clozeSentence(page, '貢献利益率');
  assert.equal(r.quote, '損益分岐点は、固定費を貢献利益率で割って求める。');
  assert.equal(r.q, `損益分岐点は、固定費を${BLANK}で割って求める。`);
  const broken = clozeSentence('損益分岐点は、固定費を貢献\n利益率で割って求める。', '貢献利益率');
  assert.equal(broken.q, `損益分岐点は、固定費を${BLANK}で割って求める。`);
  assert.equal(clozeSentence(page, '限界利益'), null, '資料にない語は作らない');
  assert.equal(clozeSentence(page, ''), null);
});

test('穴埋めの一文：短い文は前後へ広げて 20 字以上、長い文は語のまわり 200 字以内に絞る', () => {
  const short = clozeSentence('目標原価。これは重要な概念で、企画の段階で決める。', '目標原価');
  assert.ok(short.quote.length >= 20 && short.q.includes(BLANK));
  const long = '前置き'.repeat(60) + '。ここで目標原価を決める' + '補足'.repeat(80) + '。';
  const r = clozeSentence(long, '目標原価');
  assert.ok(r.quote.length <= 200 && r.quote.includes('目標原価') && r.q.split(BLANK).length === 2);
});

test(`マーカーからの穴埋め：${MIN_MASKS} つの語から cloze を作り、誤答はほかの語から 3 つ。すべて checkQuestion に通る`, () => {
  const qs = clozeFromMasks(masks);
  assert.equal(qs.length, 5);
  for (const q of qs) {
    assert.deepEqual(checkQuestion(q), []);
    assert.equal(q.type, 'cloze');
    assert.equal(q.o.length, 3);
    assert.ok(!q.o.includes(q.a));
    assert.ok(q.src.quote.includes(q.a), '引用には隠した語がそのまま入る');
  }
  assert.equal(qs.find((q) => q.a === '賃率差異').q, `直接労務費差異は、${BLANK}と作業時間差異に分けられる。`);
});

test('マーカーからの穴埋め：同じ語は 1 問、資料にない語は飛ばす、違う語が 4 つ未満なら作らない', () => {
  const dup = clozeFromMasks([...masks, {text: '目標原価', page: 2, file: 'x', context: page}]);
  assert.equal(dup.length, 5);
  const missing = clozeFromMasks([...masks, {text: '限界利益', page: 1, file: 'x', context: page}]);
  assert.equal(missing.length, 5);
  assert.deepEqual(clozeFromMasks(masks.slice(0, 3)), []);
  assert.deepEqual(clozeFromMasks([]), []);
});
