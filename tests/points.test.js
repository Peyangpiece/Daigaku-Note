import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY,
  EARN,
  HISTORY_MAX,
  WEEK_DAYS,
  claimDaily,
  claimLogin,
  claimQuiz,
  dayOf,
  earn,
  pointsState,
  pt,
  spend,
  weekOf
} from '../src/shared/points.js';
import {createLedger} from '../src/main/points-ledger.js';

const at = (s) => new Date(s);

test('ポイントの状態：保存した値を直す（負の残高・形の悪い履歴は捨てる）', () => {
  assert.deepEqual(pointsState(null), {
    balance: 0,
    history: [],
    lastLogin: null,
    quizDay: null,
    quizIds: [],
    usedDay: null,
    used: {},
    writeDays: [],
    weekPaid: null
  });
  const st = pointsState({balance: -5, history: [{at: 'x', kind: 'login', amount: 30}, {kind: 1}], lastLogin: 'bad'});
  assert.equal(st.balance, 0);
  assert.equal(st.history.length, 1);
  assert.equal(st.lastLogin, null);
  assert.equal(pt(1200), '1,200 pt');
});

test('もらい方：開いた・クイズは動く。チュートリアル・友達招待・有料版は準備中（断る）', () => {
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

test('ノートを使ったときのポイント：同じものは 1 日 1 回、種類ごとに 1 日の上限まで。日が変わればまた数える', () => {
  const now = at('2026-11-16T10:00:00'); // 月曜
  // 書き込んだページ：6 ページまで。同じページは 2 回数えない
  let st = null;
  let total = 0;
  for (let i = 1; i <= 8; i++) {
    const r = claimDaily(st, 'page', `fileA:${i}`, {now});
    st = r.points;
    total += r.gained;
  }
  assert.equal(total, EARN.page.amount * DAILY.page);
  assert.equal(claimDaily(st, 'page', 'fileA:1', {now}).gained, 0, '同じページ');
  assert.equal(st.history.length, 1, '同じ日の同じもらい方は、履歴の 1 行にまとめる');
  assert.equal(st.history[0].amount, EARN.page.amount * DAILY.page);
  // 資料を初めて開いた・暗記モードで確かめた
  assert.equal(claimDaily(st, 'read', 'M1', {now}).gained, EARN.read.amount);
  assert.equal(claimDaily(st, 'recall', 'A1', {now}).gained, EARN.recall.amount);
  // 次の日はまた数える
  const next = claimDaily(st, 'page', 'fileA:1', {now: at('2026-11-17T09:00:00')});
  assert.equal(next.gained, EARN.page.amount);
  assert.deepEqual(next.points.used.page, ['fileA:1']);
  // 知らない種類・鍵なしは数えない
  assert.equal(claimDaily(st, 'login', 'x', {now}).gained, 0);
  assert.equal(claimDaily(st, 'page', '', {now}).gained, 0);
});

test('週のボーナス：その週（月曜から日曜）に書いた日が 4 日になったら 1 回。週が変われば数え直す。切れても失うものはない', () => {
  assert.equal(weekOf('2026-11-18'), '2026-11-16', '水曜 → その週の月曜');
  assert.equal(weekOf('2026-11-22'), '2026-11-16', '日曜も同じ週');
  assert.equal(weekOf('2026-11-23'), '2026-11-23');
  let st = null;
  const write = (day) => {
    const r = claimDaily(st, 'write', day, {now: at(`${day}T20:00:00`)});
    st = r.points;
    return r.gained;
  };
  assert.equal(write('2026-11-16'), EARN.write.amount);
  assert.equal(claimDaily(st, 'write', '2026-11-16', {now: at('2026-11-16T23:00:00')}).gained, 0, '1 日 1 回');
  assert.equal(write('2026-11-17'), EARN.write.amount);
  assert.equal(write('2026-11-19'), EARN.write.amount, '1 日あいても数え続ける');
  assert.equal(WEEK_DAYS, 4);
  assert.equal(write('2026-11-21'), EARN.write.amount + EARN.week.amount, '4 日目に週のボーナス');
  assert.equal(write('2026-11-22'), EARN.write.amount, '同じ週は 1 回だけ');
  const before = st.balance;
  // 次の週：3 日では出ない。ポイントは減らない
  for (const d of ['2026-11-23', '2026-11-24', '2026-11-25']) assert.equal(write(d), EARN.write.amount);
  assert.equal(st.balance, before + EARN.write.amount * 3);
  assert.deepEqual(st.writeDays, ['2026-11-23', '2026-11-24', '2026-11-25']);
});

test('台帳：書き込みを保存したとき、今日作った書き込みが残っているページだけを数える', () => {
  const settings = new Map();
  const repo = {getSetting: (k, d) => settings.get(k) ?? d, setSetting: (k, v) => settings.set(k, v)};
  const now = at('2026-11-16T15:00:00');
  const ledger = createLedger({repo, now: () => now});
  const row = (page, created) => ({page, created_at: at(created).toISOString()});
  // 今日のページ 2 つ（1 ページ目に 2 つ書いても 1 ページ）と、きのう書いたページ
  const gained = ledger.wrote('fileA', [
    row(1, '2026-11-16T14:00:00'),
    row(1, '2026-11-16T14:05:00'),
    row(3, '2026-11-16T14:10:00'),
    row(5, '2026-11-15T10:00:00')
  ]);
  assert.equal(gained, EARN.write.amount + EARN.page.amount * 2);
  assert.equal(settings.get('points').balance, gained);
  // もう一度保存しても増えない。書いてすぐ消したもの（残っていない）は数えない
  assert.equal(ledger.wrote('fileA', [row(1, '2026-11-16T14:00:00')]), 0);
  assert.equal(ledger.wrote('fileB', []), 0);
  assert.equal(ledger.claim('recall', 'A1'), EARN.recall.amount);
  assert.equal(ledger.claim('recall', 'A1'), 0);
});
