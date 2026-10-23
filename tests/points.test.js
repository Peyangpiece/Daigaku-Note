import test from 'node:test';
import assert from 'node:assert/strict';
import {EARN, HISTORY_MAX, claimLogin, claimQuiz, dayOf, earn, pointsState, pt, spend} from '../src/shared/points.js';

const at = (s) => new Date(s);

test('ポイントの状態：保存した値を直す（負の残高・形の悪い履歴は捨てる）', () => {
  assert.deepEqual(pointsState(null), {balance: 0, history: [], lastLogin: null, quizDay: null, quizIds: []});
  const st = pointsState({balance: -5, history: [{at: 'x', kind: 'login', amount: 30}, {kind: 1}], lastLogin: 'bad'});
  assert.equal(st.balance, 0);
  assert.equal(st.history.length, 1);
  assert.equal(st.lastLogin, null);
  assert.equal(pt(1200), '1,200 pt');
});

test('もらい方：ログインボーナスとクイズは動く。チュートリアル・友達招待・有料版は準備中（断る）', () => {
  assert.equal(EARN.login.available, true);
  assert.equal(EARN.quiz.available, true);
  for (const k of ['tutorial', 'invite', 'plan']) {
    assert.equal(EARN[k].available, false, k);
    assert.throws(() => earn(null, k), /準備中/);
  }
  assert.throws(() => earn(null, 'cheat'), /ありません/);
  const {points, gained} = earn(null, 'quiz', {now: at('2026-10-23T10:00:00'), times: 3});
  assert.equal(gained, EARN.quiz.amount * 3);
  assert.equal(points.balance, gained);
  assert.deepEqual(points.history[0], {at: at('2026-10-23T10:00:00').toISOString(), kind: 'quiz', amount: gained});
});

test('ログインボーナス：その日の最初の 1 回だけ。次の日はまたもらえる', () => {
  const d1 = at('2026-10-23T08:00:00');
  const a = claimLogin(null, {now: d1});
  assert.equal(a.gained, EARN.login.amount);
  assert.equal(a.points.lastLogin, dayOf(d1));
  const b = claimLogin(a.points, {now: at('2026-10-23T23:59:00')});
  assert.equal(b.gained, 0);
  assert.equal(b.points.balance, EARN.login.amount);
  const c = claimLogin(b.points, {now: at('2026-10-24T00:01:00')});
  assert.equal(c.gained, EARN.login.amount);
  assert.equal(c.points.balance, EARN.login.amount * 2);
});

test('クイズの正解：同じ問題は 1 日 1 回まで。日が変わればまたもらえる', () => {
  const now = at('2026-10-23T10:00:00');
  const a = claimQuiz(null, 'q1', {now});
  assert.equal(a.gained, EARN.quiz.amount);
  assert.equal(claimQuiz(a.points, 'q1', {now}).gained, 0, '同じ問題の解き直し');
  const b = claimQuiz(a.points, 'q2', {now});
  assert.equal(b.gained, EARN.quiz.amount);
  assert.equal(b.points.balance, EARN.quiz.amount * 2);
  assert.equal(claimQuiz(b.points, 'q1', {now: at('2026-10-24T09:00:00')}).gained, EARN.quiz.amount);
  assert.equal(claimQuiz(null, '', {now}).gained, 0);
});

test('使う：残高から引き、足りなければ断る（状態は変えない）。履歴は新しい順に上限まで', () => {
  const st = earn(null, 'quiz', {times: 40}).points; // 200 pt
  const after = spend(st, 150, {note: '緑のボールペン 0.5'});
  assert.equal(after.balance, 50);
  assert.equal(after.history[0].amount, -150);
  assert.equal(after.history[0].kind, 'shop');
  assert.throws(() => spend(after, 51), /あと 1 pt/);
  assert.deepEqual(spend(after, 0), pointsState(after), '0 pt はそのまま');
  assert.throws(() => spend(after, -1), /不正/);
  let many = null;
  for (let i = 0; i < HISTORY_MAX + 5; i++) many = earn(many, 'quiz').points;
  assert.equal(many.history.length, HISTORY_MAX);
});
