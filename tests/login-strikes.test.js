import test from 'node:test';
import assert from 'node:assert/strict';
import {noteAutoLogin, autoLoginStopped, clearAutoLoginStrikes, BAD_LIMIT} from '../src/main/login-strikes.js';

// 設定と接続だけを持つ小さな repo
function fakeRepo() {
  const settings = new Map();
  const conn = {save_password: 1};
  return {
    conn,
    getSetting: (k, fb = null) => (settings.has(k) ? settings.get(k) : fb),
    setSetting: (k, v) => settings.set(k, v),
    removeSetting: (k) => settings.delete(k),
    updateConnection: (_id, patch) => Object.assign(conn, patch)
  };
}
const BAD = {code: 'login-bad-credentials', message: 'パスワード違い'};

test('パスワード違いは続けて 2 回で止める', () => {
  assert.equal(BAD_LIMIT, 2);
  const repo = fakeRepo();
  assert.deepEqual(noteAutoLogin(repo, 1, BAD), {stopped: false});
  assert.equal(repo.conn.save_password, 1);
  assert.deepEqual(noteAutoLogin(repo, 1, BAD, new Date('2026-11-07T12:03:43Z')), {stopped: true});
  assert.equal(repo.conn.save_password, 0);
  assert.deepEqual(autoLoginStopped(repo, 1), {at: '2026-11-07T12:03:43.000Z', message: 'パスワード違い'});
});

test('間に成功があれば数え直す。ほかの失敗は数えない', () => {
  const repo = fakeRepo();
  noteAutoLogin(repo, 1, BAD);
  noteAutoLogin(repo, 1, null);
  noteAutoLogin(repo, 1, {code: 'login-needs-user'});
  noteAutoLogin(repo, 1, {code: 'network'});
  assert.deepEqual(noteAutoLogin(repo, 1, BAD), {stopped: false}, '成功で 0 に戻っている');
  assert.equal(repo.conn.save_password, 1);
});

test('入れ直すと、数えた回数と止めた理由を消す', () => {
  const repo = fakeRepo();
  noteAutoLogin(repo, 1, BAD);
  noteAutoLogin(repo, 1, BAD);
  clearAutoLoginStrikes(repo, 1);
  assert.equal(autoLoginStopped(repo, 1), null);
  repo.conn.save_password = 1;
  assert.deepEqual(noteAutoLogin(repo, 1, BAD), {stopped: false});
});
