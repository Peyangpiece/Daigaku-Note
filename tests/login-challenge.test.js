// 2 段階認証などの画面をパレットノートの画面に写して答えを待つ（src/main/browser/challenge.js）
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanAnswer, createChallenges} from '../src/main/browser/challenge.js';

test('答えの形：コードは英数字と - の 20 文字まで（全角・空白は直す）。選ぶ・待つ・やめる', () => {
  assert.deepEqual(cleanAnswer({code: ' １２３ ４５６ '}), {code: '123456'});
  assert.deepEqual(cleanAnswer({code: 'AB-12'}), {code: 'AB-12'});
  assert.equal(cleanAnswer({code: '<script>'}), null);
  assert.equal(cleanAnswer({code: 'x'.repeat(21)}), null);
  assert.deepEqual(cleanAnswer({choice: 2}), {choice: 2});
  assert.equal(cleanAnswer({choice: 9}), null);
  assert.equal(cleanAnswer({choice: '1'}), null);
  assert.deepEqual(cleanAnswer({wait: true}), {wait: true});
  assert.equal(cleanAnswer({cancel: true, code: '1'}), null);
  assert.equal(cleanAnswer(null), null);
});

test('聞く → 画面に送る・窓を前に出す → 答えで返る。閉じる知らせも送る。知らない id・2 回目の答えは受けない', async () => {
  const sent = [];
  let asked = 0;
  const ch = createChallenges({send: (p) => sent.push(p), onAsk: () => asked++});
  const p = ch.ask({label: 'K-LMS', host: 'keio.okta.com', title: '確認', text: 'コード', code: 1, choices: ['a', 2]});
  assert.equal(asked, 1);
  const {id} = sent[0];
  assert.deepEqual(sent[0], {
    id,
    label: 'K-LMS',
    host: 'keio.okta.com',
    title: '確認',
    text: 'コード',
    code: true,
    choices: ['a', '2']
  });
  assert.deepEqual(ch.list(), [sent[0]], '開き直した画面が読み直せる');
  assert.equal(ch.answer({id: 'other', code: '1'}), false);
  assert.equal(ch.answer({id, code: '123456'}), true);
  assert.deepEqual(await p, {code: '123456'});
  assert.deepEqual(sent.at(-1), {id, done: true}, '画面のダイアログを閉じる');
  assert.equal(ch.answer({id, code: '1'}), false, '2 回目は受けない');
  assert.equal(ch.waiting, 0);
});

test('答えがないまま時間が過ぎたら null（やめた扱い）。やめるも null', async () => {
  const sent = [];
  const ch = createChallenges({send: (p) => sent.push(p), timeoutMs: 20});
  // 時間切れのタイマーは unref（アプリの終わりを止めない）なので、試験の間だけ動かし続ける
  const keep = setTimeout(() => {}, 1000);
  assert.equal(await ch.ask({label: 'x'}), null);
  clearTimeout(keep);
  assert.deepEqual(sent.at(-1).done, true);
  const p = ch.ask({label: 'y'});
  ch.answer({id: sent.at(-1).id, cancel: true});
  assert.equal(await p, null);
});
