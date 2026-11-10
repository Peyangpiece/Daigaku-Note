// iPad アプリの「パソコンなしで使う」（docs/SYNC.md 段階 2）：鍵の QR、Google のログイン（iOS のクライアント・PKCE）、
// パソコンが送ったものをドライブから読み込む（パソコンの送り出し createPusher で実際に作ったものを読む）
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createPusher} from '../src/main/cloud/sync.js';
import {newMasterKey, fingerprint as pcFingerprint} from '../src/main/cloud/keys.js';
import {openBlob} from '../src/shared/vault.js';
import {deriveKeys, fingerprint, keyQr, readKeyQr, KEY_QR_PREFIX} from '../src/shared/vault-keys.js';
import {pull, wanted} from '../ipad/src/cloud/pull.js';
import {codeOf, createDriveReader, emailOf, exchange, refresh, startLogin} from '../ipad/src/cloud/google.js';
import {GOOGLE_IOS} from '../src/shared/google-client.js';
import {fromB64, toB64} from '../ipad/src/cloud/native.js';

/** ドライブの代わり（パソコンの送り出しと iPad の読み込みの両方が使う） */
function memDrive() {
  const files = new Map(); // id → {name, bytes}
  let n = 0;
  const gets = [];
  return {
    files,
    gets,
    async list() {
      return [...files].map(([id, f]) => ({id, name: f.name, size: f.bytes.length}));
    },
    async put(name, bytes, id = null) {
      const key = id ?? `id${++n}`;
      files.set(key, {name: id ? files.get(id).name : name, bytes});
      return {id: key};
    },
    async get(id) {
      gets.push(files.get(id)?.name);
      return files.get(id).bytes;
    },
    async remove(id) {
      files.delete(id);
    }
  };
}

const memStore = () => {
  const m = new Map();
  return {
    m,
    list: async () => [...m.keys()],
    get: async (n) => m.get(n) ?? null,
    put: async (n, b) => void m.set(n, b),
    remove: async (n) => void m.delete(n)
  };
};

function setup() {
  const userData = mkdtempSync(path.join(tmpdir(), 'dn-ipad-cloud-'));
  mkdirSync(path.join(userData, 'photos'));
  writeFileSync(path.join(userData, 'photos', 'p1.jpg'), 'JPG');
  const mats = [
    {id: 'M1', status: 'ok', path: '/x/a.pdf', sha256: 'h1', name: 'a.pdf'},
    {id: 'M2', status: 'ok', path: '/x/b.docx', sha256: 'h2', name: 'b.docx'}
  ];
  let dbText = 'DB-1';
  const drive = memDrive();
  const master = newMasterKey();
  const pusher = () =>
    createPusher({
      drive,
      master,
      exportDb: (file) => writeFileSync(file, dbText),
      materials: () => mats,
      readMaterial: async (m) => new Uint8Array(Buffer.from(m.id === 'M1' ? 'PDF-A' : 'DOC-B')),
      userData,
      device: 'pc'
    });
  return {drive, master, pusher, mats, setDb: (t) => (dbText = t)};
}

test('鍵の QR：パソコンが出した QR から同じ鍵を受け取る。指紋が合わない・形が違うものは受け取らない', () => {
  const master = newMasterKey();
  const q = keyQr(master);
  assert.ok(q.startsWith(KEY_QR_PREFIX));
  assert.deepEqual(readKeyQr(q), master);
  assert.equal(fingerprint(master), pcFingerprint(master));
  const bad = q.slice(0, -1) + (q.endsWith('A') ? 'B' : 'A'); // 指紋を 1 文字変えた（読み違え）
  for (const t of [bad, '', 'hello', `${KEY_QR_PREFIX}abc:1234`, 'http://10.0.0.2:47390/m/#d=x'])
    assert.equal(readKeyQr(t), null, t);
});

test('読み込み：パソコンが送ったデータベース・資料・アプリのファイルを、暗号化したまま iPad に置く', async () => {
  const {drive, master, pusher} = setup();
  await pusher().push();
  const store = memStore();
  const steps = [];
  const r = await pull({drive, store, master, onProgress: (p) => steps.push(p.done)});
  assert.equal(r.materials, 2);
  assert.equal(r.downloaded, 4); // データベース・資料 2・写真 1
  assert.deepEqual(steps, [0, 1, 2, 3, 4]);
  assert.ok(store.m.has('manifest') && store.m.has('db'));
  // 置いたものは暗号化したまま（平文はない）。鍵で開ける
  const keys = deriveKeys(master);
  const name = r.manifest.materials.M1.name;
  assert.ok(!Buffer.from(store.m.get(name)).toString().includes('PDF-A'));
  assert.equal(Buffer.from(openBlob(keys.enc, store.m.get(name), name)).toString(), 'PDF-A');
  assert.equal(Buffer.from(openBlob(keys.enc, store.m.get('db'), 'db')).toString(), 'DB-1');
  assert.deepEqual(
    wanted(r.manifest)
      .map((x) => x.kind)
      .sort(),
    ['db', 'file', 'material', 'material']
  );
});

test('読み込み：2 回目は何も読まない。データベースが変わったら読み直し、外れた資料は iPad からも消す', async () => {
  const {drive, master, pusher, mats, setDb} = setup();
  await pusher().push();
  const store = memStore();
  await pull({drive, store, master});
  drive.gets.length = 0;
  let r = await pull({drive, store, master});
  assert.deepEqual([r.downloaded, r.removed], [0, 0]);
  assert.deepEqual(drive.gets, ['manifest']); // 目録だけ
  // データベースが変わった（名前は同じ db）・資料が 1 つ外れた
  setDb('DB-2');
  const gone = (await pull({drive, store, master})).manifest.materials.M2.name;
  mats.pop();
  await pusher().push();
  r = await pull({drive, store, master});
  assert.deepEqual([r.downloaded, r.removed, r.materials], [1, 1, 1]);
  assert.ok(!store.m.has(gone));
  assert.equal(Buffer.from(openBlob(deriveKeys(master).enc, store.m.get('db'), 'db')).toString(), 'DB-2');
});

test('読み込み：ドライブに何もない・鍵が違うときは、分かる言葉で止める（iPad のものは消さない）', async () => {
  const store = memStore();
  await assert.rejects(pull({drive: memDrive(), store, master: newMasterKey()}), /まだデータがありません/);
  const {drive, pusher} = setup();
  await pusher().push();
  store.m.set('keep', new Uint8Array([1]));
  await assert.rejects(pull({drive, store, master: newMasterKey()}), /鍵が合いません/);
  assert.ok(store.m.has('keep'));
});

test('読み込み：ドライブの中身がすり替えられていたら置かない', async () => {
  const {drive, master, pusher} = setup();
  await pusher().push();
  // 資料の中身を、ほかの名前の中身に入れ替える（同じ鍵で包んだものでも、名前が違うので開けない）
  const all = [...drive.files.values()];
  const a = all.find((f) => f.name.startsWith('f-'));
  const b = all.find((f) => f.name.startsWith('f-') && f !== a);
  a.bytes = b.bytes;
  const store = memStore();
  await assert.rejects(pull({drive, store, master}));
  assert.ok(!store.m.has('manifest')); // 目録は置かない（途中のものは次に読み直す）
});

test('Google のログイン：PKCE の URL（iOS のクライアントの戻り先・code_challenge は verifier の SHA-256）', () => {
  const {url, verifier, state} = startLogin();
  const q = new URL(url).searchParams;
  assert.equal(q.get('client_id'), GOOGLE_IOS.clientId);
  assert.equal(q.get('redirect_uri'), GOOGLE_IOS.redirectUri);
  assert.ok(GOOGLE_IOS.redirectUri.startsWith(`${GOOGLE_IOS.scheme}:/`));
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
  assert.equal(q.get('state'), state);
  assert.match(q.get('scope'), /drive\.appdata/);
  // 戻ってきた URL
  assert.equal(codeOf(`${GOOGLE_IOS.redirectUri}?state=${state}&code=C1`, state), 'C1');
  assert.equal(codeOf('https://example.com/?code=x', state), null);
  assert.throws(() => codeOf(`${GOOGLE_IOS.redirectUri}?state=other&code=C1`, state), /不正/);
  assert.throws(() => codeOf(`${GOOGLE_IOS.redirectUri}?error=access_denied&state=${state}`, state), /やめられ/);
});

test('Google のログイン：code をトークンに替える（秘密は送らない）・取り直す・失敗を言葉にする', async () => {
  const sent = [];
  const idToken = `x.${Buffer.from(JSON.stringify({email: 'a@example.com'})).toString('base64url')}.y`;
  const http = {
    post: async (url, body) => {
      const p = Object.fromEntries(new URLSearchParams(body));
      sent.push(p);
      if (p.grant_type === 'authorization_code')
        return {status: 200, json: {refresh_token: 'R', access_token: 'A', expires_in: 3600, id_token: idToken}};
      if (p.refresh_token === 'BAD') return {status: 400, json: {error: 'invalid_grant'}};
      return {status: 200, json: {access_token: 'A2', expires_in: 3600}};
    }
  };
  const r = await exchange(http, {code: 'C', verifier: 'V'});
  assert.deepEqual([r.refreshToken, r.accessToken, r.email], ['R', 'A', 'a@example.com']);
  assert.equal(sent[0].code_verifier, 'V');
  assert.equal(sent[0].redirect_uri, GOOGLE_IOS.redirectUri);
  assert.ok(!('client_secret' in sent[0]));
  assert.equal((await refresh(http, {refreshToken: 'R'})).accessToken, 'A2');
  await assert.rejects(refresh(http, {refreshToken: 'BAD'}), /invalid_grant/);
  assert.equal(emailOf('broken'), null);
});

test('ドライブを読む：一覧のページ送り・401 で 1 度だけ取り直す・中身はバイト列', async () => {
  const tokens = [];
  let first = true;
  const http = {
    get: async (url, headers, binary) => {
      if (first) {
        first = false;
        return {status: 401};
      }
      if (binary) return {status: 200, bytes: new Uint8Array([1, 2, 3])};
      const page = new URL(url).searchParams.get('pageToken');
      return page
        ? {status: 200, json: {files: [{id: '2', name: 'b', size: '2'}]}}
        : {status: 200, json: {files: [{id: '1', name: 'a', size: '1'}], nextPageToken: 'P'}};
    }
  };
  const d = createDriveReader({http, getToken: async (fresh) => (tokens.push(fresh), fresh ? 'NEW' : 'OLD')});
  assert.deepEqual(await d.list(), [
    {id: '1', name: 'a', size: 1},
    {id: '2', name: 'b', size: 2}
  ]);
  assert.deepEqual(tokens.slice(0, 2), [false, true]);
  assert.deepEqual(await d.get('1'), new Uint8Array([1, 2, 3]));
});

test('base64（アプリの中のファイルとのやりとり）：大きなものも行き来する', () => {
  const b = new Uint8Array(300_000).map((_, i) => i % 256);
  assert.deepEqual(fromB64(toB64(b)), b);
});
