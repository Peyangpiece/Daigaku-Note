import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createSecrets} from '../src/main/secrets.js';
import {JobRunner} from '../src/main/jobs.js';

// 復号できるかを切り替えられる偽の safeStorage（キーチェーンの許可がない版を真似る）
const fakeSafeStorage = () => {
  const ss = {
    allow: true,
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`),
    decryptString: (b) => {
      if (!ss.allow) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      return b.toString().slice(4);
    }
  };
  return ss;
};

test('秘密：復号できなければ null を返し、暗号文は残して「読めない」と分かる', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dn-secrets-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const ss = fakeSafeStorage();
  const secrets = createSecrets(path.join(dir, 'secrets.json'), null, ss);
  await secrets.set('conn:c1:password', {user: 'u', password: 'p'});
  ss.allow = false;
  assert.equal(await secrets.get('conn:c1:password'), null);
  assert.equal(secrets.isLocked('conn:c1:'), true);
  assert.equal(secrets.isLocked('conn:c2:'), false);
  assert.deepEqual(secrets.keys(), ['conn:c1:password'], '暗号文は消さない（許可すればまた読める）');
  ss.allow = true;
  assert.deepEqual(await secrets.get('conn:c1:password'), {user: 'u', password: 'p'});
  assert.equal(secrets.isLocked('conn:c1:'), false);
});

test('起動時のログインのジョブ：接続ごとにログインし、キーチェーンで読めないときはその旨を知らせる', async () => {
  const connections = [
    {id: 'a', kind: 'moodle', label: 'Moodle', status: 'login-required'},
    {id: 'b', kind: 'recipe', label: 'WebClass', status: 'ok'},
    {id: 'm', kind: 'manual', label: '手動', status: 'ok'},
    {id: 'd', kind: 'moodle', label: '止めた', status: 'disabled'}
  ];
  const tried = [];
  const notified = [];
  const ctx = {
    repo: {listConnections: () => connections},
    registry: {forConnection: (c) => c.id},
    browser: {state: 'ready'},
    secrets: {isLocked: (prefix) => prefix === 'conn:b:'},
    engine: {
      restoreSession: async ({connection, connector}) => {
        tried.push(connector);
        return connection.id === 'a' ? {status: 'ok', loggedIn: true} : {status: 'login-required', error: new Error('ID とパスワードがありません')};
      }
    }
  };
  const jobs = new JobRunner(ctx, {notify: (ch, p) => notified.push([ch, p])});
  const r = await jobs.run({kind: 'login', payload: {}});
  assert.deepEqual(tried, ['a', 'b'], '手動・止めた接続は試さない');
  assert.equal(r.loggedIn, 1);
  assert.equal(r.failures, 1);
  assert.match(r.message, /キーチェーン.*常に許可/);
  assert.equal(notified[0][0], 'login.required');
  assert.equal(notified[0][1].connectionId, 'b');

  ctx.browser = {state: 'pending'};
  tried.length = 0;
  await jobs.run({kind: 'login', payload: {}});
  assert.deepEqual(tried, ['a'], 'ブラウザの準備ができていなければ画面操作型は次の同期に任せる');
});
