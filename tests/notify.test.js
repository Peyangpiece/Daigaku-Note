import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotifier} from '../src/main/notify.js';

function fakes({enabled = true, rounds = {}} = {}) {
  const shown = [];
  class Notification {
    static isSupported() {
      return true;
    }
    constructor(opts) {
      this.opts = opts;
      this.handlers = {};
    }
    on(ev, fn) {
      this.handlers[ev] = fn;
    }
    show() {
      shown.push(this);
    }
  }
  const opened = [];
  const repo = {
    getSetting: (k, d) => (k === 'ui.notifications' ? enabled : d),
    get: (table, id) => (table === 'round' ? (rounds[id] ?? null) : null)
  };
  let day = '2026-10-23';
  const n = createNotifier({
    repo,
    Notification,
    openWindow: (r) => opened.push(r),
    now: () => new Date(`${day}T03:00:00Z`)
  });
  return {n, shown, opened, setDay: (d) => (day = d)};
}

test('通知：新しい資料・ログインの必要・クイズの完成。押すとその画面を開く', () => {
  const {n, shown, opened} = fakes({rounds: {r1: {id: 'r1', number: 3, title: '原価企画', course_id: 'c1'}}});
  assert.equal(n.onEvent('sync.finished', {status: 'ok', materials: 5, courses: 3}), true);
  assert.equal(shown[0].opts.body, '新しい資料 5 件を保存しました');
  assert.equal(n.onEvent('sync.finished', {status: 'ok', materials: 0}), false, '何もなければ出さない');
  assert.equal(n.onEvent('login.required', {connectionId: 'x', label: 'Moodle'}), true);
  assert.match(shown[1].opts.body, /Moodle/);
  assert.equal(n.onEvent('quiz.finished', {roundId: 'r1', ok: true, count: 12}), true);
  assert.equal(shown[2].opts.body, '第3回 原価企画 のクイズ（12 問）ができました');
  shown[2].handlers.click();
  assert.deepEqual(opened, ['/course/c1']);
  assert.equal(n.onEvent('quiz.finished', {roundId: 'r1', ok: false, message: 'API キーを確かめてください'}), true);
  assert.equal(shown[3].opts.title, 'クイズを作れませんでした');
  assert.equal(n.onEvent('state.changed', {}), false, '関係のない知らせは出さない');
});

test('通知：同じ失敗は 1 日 1 回。設定で止められる', () => {
  const {n, shown, setDay} = fakes();
  assert.equal(n.onEvent('sync.finished', {status: 'failed', message: 'LMS に接続できませんでした'}), true);
  assert.equal(
    n.onEvent('sync.finished', {status: 'failed', message: 'LMS に接続できませんでした'}),
    false,
    '同じ日はもう出さない'
  );
  assert.equal(n.onEvent('login.required', {connectionId: 'a', label: 'A'}), true);
  assert.equal(n.onEvent('login.required', {connectionId: 'a', label: 'A'}), false);
  assert.equal(n.onEvent('login.required', {connectionId: 'b', label: 'B'}), true, '別の接続は別に数える');
  setDay('2026-10-24');
  assert.equal(n.onEvent('sync.finished', {status: 'failed', message: 'x'}), true, '日が変われば出す');
  assert.equal(shown.length, 4);
  const off = fakes({enabled: false});
  assert.equal(off.n.onEvent('sync.finished', {status: 'ok', materials: 3}), false);
  assert.equal(off.shown.length, 0);
});
