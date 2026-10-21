import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createSecrets} from '../src/main/secrets.js';
import {JobRunner} from '../src/main/jobs.js';
import {LMS_TERMS_VERSION} from '../src/shared/lms-terms.js';

// いまの版の利用規約に同意している設定
const agreed = (key) => (key === 'lms.terms' ? {version: LMS_TERMS_VERSION} : null);

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
    repo: {listConnections: () => connections, getSetting: agreed},
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

test('同期のジョブ：1 つの接続が失敗しても（未対応の種類など）、ほかの接続は同期する', async () => {
  const connections = [
    {id: 'g', kind: 'generic', label: '汎用', status: 'ok'},
    {id: 'a', kind: 'api', label: 'Moodle', status: 'ok'}
  ];
  const ran = [];
  const ctx = {
    repo: {listTerms: () => [{id: 't', start_date: '2000-01-01', end_date: '2999-12-31'}], listConnections: () => connections, getSetting: agreed},
    registry: {
      forConnection: (c) => {
        if (c.kind === 'generic') throw new Error('未対応の接続の種類: generic');
        return c.id;
      }
    },
    browser: {state: 'ready'},
    engine: {
      run: async ({connection}) => {
        ran.push(connection.id);
        return {courses: 2, materials: 3, failures: 0, status: 'ok', events: []};
      }
    }
  };
  const r = await new JobRunner(ctx).run({kind: 'sync', payload: {}});
  assert.deepEqual(ran, ['a']);
  assert.equal(r.courses, 2);
  assert.equal(r.failures, 1);
  assert.equal(r.status, 'failed');
  assert.match(r.message, /汎用：この接続の種類はまだ同期できません/);
});

test('利用規約：いまの版に同意していなければ、同期もログインもせずに知らせる', async () => {
  let ran = 0;
  const ctx = {
    repo: {listTerms: () => [], listConnections: () => [{id: 'a', kind: 'api', label: 'Moodle', status: 'ok'}], getSetting: (k) => (k === 'lms.terms' ? {version: '2000-01-01'} : null)},
    registry: {forConnection: () => 'x'},
    engine: {run: async () => ran++, restoreSession: async () => ran++}
  };
  const jobs = new JobRunner(ctx);
  const s = await jobs.run({kind: 'sync', payload: {}});
  assert.equal(s.status, 'terms-required');
  assert.match(s.message, /利用規約に同意してください/);
  assert.equal((await jobs.run({kind: 'login', payload: {}})).status, 'terms-required');
  assert.equal(ran, 0);
});
