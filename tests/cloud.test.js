// Google ドライブでそろえる（docs/SYNC.md）：包み方・鍵・ログイン・ドライブ・送り出し
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openBlob, openJson, sealBlob, sealJson} from '../src/shared/vault.js';
import {blobName, deriveKeys, fingerprint, newMasterKey} from '../src/main/cloud/keys.js';
import {authUrl, createDrive, emailOf, loginLoopback} from '../src/main/cloud/google.js';
import {DB_NAME, MANIFEST, createPusher} from '../src/main/cloud/sync.js';
import {createCloud} from '../src/main/cloud/index.js';
import {googleReady} from '../src/shared/google-client.js';

const enc = new TextEncoder();

// ---- 包み方・鍵 ----
test('vault：包んで開ける。名前・鍵が違う・書き換えは開けない', () => {
  const {enc: key} = deriveKeys(newMasterKey());
  const blob = sealBlob(key, enc.encode('ノート'), 'f-abc');
  assert.equal(String.fromCharCode(...blob.subarray(0, 4)), 'PNV1');
  assert.equal(new TextDecoder().decode(openBlob(key, blob, 'f-abc')), 'ノート');
  assert.throws(() => openBlob(key, blob, 'f-xyz'), /鍵が違う/);
  assert.throws(() => openBlob(deriveKeys(newMasterKey()).enc, blob, 'f-abc'), /鍵が違う/);
  const bad = blob.slice();
  bad[bad.length - 1] ^= 1;
  assert.throws(() => openBlob(key, bad, 'f-abc'), /壊れて/);
  assert.throws(() => openBlob(key, enc.encode('x'.repeat(60)), 'f-abc'), /暗号化した中身ではありません/);
  // 同じ中身でも毎回違う（使い捨ての番号）
  assert.notDeepEqual(sealBlob(key, enc.encode('a'), 'n'), sealBlob(key, enc.encode('a'), 'n'));
  assert.deepEqual(openJson(key, sealJson(key, {a: [1]}, MANIFEST), MANIFEST), {a: [1]});
});

test('鍵：用途ごとの鍵は元の鍵から決まる。資料の名前は中身と鍵から決まり、中身のハッシュは分からない', () => {
  const m = newMasterKey();
  assert.deepEqual(deriveKeys(m), deriveKeys(m));
  assert.notDeepEqual(deriveKeys(m).enc, deriveKeys(m).name);
  const a = blobName(deriveKeys(m).name, enc.encode('PDF'));
  assert.match(a, /^f-[0-9a-f]{40}$/);
  assert.equal(a, blobName(deriveKeys(m).name, enc.encode('PDF')));
  assert.notEqual(a, blobName(deriveKeys(newMasterKey()).name, enc.encode('PDF')));
  assert.match(fingerprint(m), /^[0-9A-F]{8}$/);
  assert.throws(() => deriveKeys(new Uint8Array(3)), /鍵が不正/);
});

// ---- ログイン ----
test('authUrl：PKCE・オフライン・決めた権限だけ', () => {
  const u = new URL(authUrl({clientId: 'cid', redirectUri: 'http://127.0.0.1:5000', challenge: 'ch', state: 'st'}));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.deepEqual(u.searchParams.get('scope').split(' '), [
    'https://www.googleapis.com/auth/drive.appdata',
    'openid',
    'email'
  ]);
});

const jwt = (payload) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;

test('loginLoopback：ブラウザで開いた先から戻ってきた code をトークンに替える（state が違えば受けない）', async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push([url, new URLSearchParams(init.body)]);
    return new Response(
      JSON.stringify({
        refresh_token: 'R',
        access_token: 'A',
        expires_in: 3600,
        id_token: jwt({email: 'me@example.com'})
      }),
      {status: 200}
    );
  };
  const openExternal = async (url) => {
    const u = new URL(url);
    const back = new URL(u.searchParams.get('redirect_uri'));
    // 違う state は受けない
    assert.equal((await globalThis.fetch(`${back.origin}/?code=X&state=bad`)).status, 400);
    const r = await globalThis.fetch(`${back.origin}/?code=C0DE&state=${u.searchParams.get('state')}`);
    assert.match(await r.text(), /連携しました/);
  };
  const r = await loginLoopback({clientId: 'cid', clientSecret: 'sec', openExternal, fetch});
  assert.deepEqual([r.refreshToken, r.accessToken, r.email], ['R', 'A', 'me@example.com']);
  const [url, form] = seen[0];
  assert.equal(url, 'https://oauth2.googleapis.com/token');
  assert.equal(form.get('code'), 'C0DE');
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.ok(form.get('code_verifier').length >= 43);
});

test('loginLoopback：Google でやめたら Error。時間切れも Error', async () => {
  const openExternal = async (url) => {
    const u = new URL(url);
    await globalThis.fetch(
      `${u.searchParams.get('redirect_uri')}/?error=access_denied&state=${u.searchParams.get('state')}`
    );
  };
  await assert.rejects(
    loginLoopback({clientId: 'c', clientSecret: 's', openExternal, fetch: async () => {}}),
    /やめました/
  );
  await assert.rejects(
    loginLoopback({
      clientId: 'c',
      clientSecret: 's',
      openExternal: async () => {},
      fetch: async () => {},
      timeoutMs: 50
    }),
    /終わりませんでした/
  );
  assert.equal(emailOf('broken'), null);
});

// ---- ドライブ ----
/** ドライブの偽物（appDataFolder だけ） */
function fakeDrive({failOnce = null} = {}) {
  const files = new Map(); // id → {name, bytes}
  let n = 0;
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push([init.method ?? 'GET', u.pathname, init.headers?.Authorization]);
    if (failOnce && calls.length === 1) return new Response('', {status: failOnce});
    if (u.pathname === '/drive/v3/files' && (init.method ?? 'GET') === 'GET') {
      const all = [...files].map(([id, f]) => ({id, name: f.name, size: String(f.bytes.length)}));
      const start = Number(u.searchParams.get('pageToken') || 0);
      const page = all.slice(start, start + 2); // 2 件ずつ（ページ送りを確かめる）
      return Response.json({files: page, ...(start + 2 < all.length ? {nextPageToken: String(start + 2)} : {})});
    }
    if (u.pathname.startsWith('/upload/drive/v3/files')) {
      const body = Buffer.from(init.body);
      const boundary = init.headers['Content-Type'].split('boundary=')[1];
      const parts = body.toString('latin1').split(`--${boundary}`);
      const meta = JSON.parse(parts[1].split('\r\n\r\n')[1]);
      const raw = parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
      const bytes = new Uint8Array(Buffer.from(raw, 'latin1'));
      const id = init.method === 'PATCH' ? u.pathname.split('/').pop() : `id${++n}`;
      if (init.method !== 'PATCH') assert.deepEqual(meta.parents, ['appDataFolder']);
      files.set(id, {name: init.method === 'PATCH' ? files.get(id).name : meta.name, bytes});
      return Response.json({id});
    }
    const id = u.pathname.split('/').pop();
    if (init.method === 'DELETE') {
      files.delete(id);
      return new Response(null, {status: 204});
    }
    if (u.searchParams.get('alt') === 'media' && files.has(id)) return new Response(files.get(id).bytes);
    return new Response('', {status: 404});
  };
  return {files, calls, fetch};
}

test('drive：置く・入れ替える・読む・一覧（ページ送り）・消す。401 はトークンを取り直して 1 度だけ送り直す', async () => {
  const fake = fakeDrive({failOnce: 401});
  const tokens = [];
  const drive = createDrive({
    getToken: async (fresh) => (tokens.push(fresh), fresh ? 'NEW' : 'OLD'),
    fetch: fake.fetch
  });
  const a = await drive.put('a', new Uint8Array([0, 1, 2, 13, 10, 255]));
  assert.deepEqual(tokens, [false, true]);
  assert.deepEqual(await drive.get(a.id), new Uint8Array([0, 1, 2, 13, 10, 255]));
  await drive.put('a', new Uint8Array([9]), a.id);
  assert.deepEqual(await drive.get(a.id), new Uint8Array([9]));
  await drive.put('b', new Uint8Array([1]));
  await drive.put('c', new Uint8Array([1]));
  assert.deepEqual((await drive.list()).map((f) => f.name).sort(), ['a', 'b', 'c']);
  await drive.remove(a.id);
  assert.equal((await drive.list()).length, 2);
});

test('drive：込み合い（429・5xx）は少し待って送り直す。ほかの失敗は Error', async () => {
  const fake = fakeDrive({failOnce: 503});
  const waits = [];
  const drive = createDrive({getToken: async () => 'T', fetch: fake.fetch, sleep: async (ms) => waits.push(ms)});
  await drive.put('a', new Uint8Array([1]));
  assert.deepEqual(waits, [500]);
  await assert.rejects(drive.get('nope'), /404/);
});

// ---- 送り出し ----
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dn-cloud-'));
  const userData = path.join(dir, 'ud');
  mkdirSync(path.join(userData, 'photos'), {recursive: true});
  writeFileSync(path.join(userData, 'photos', 'p1.jpg'), 'PHOTO');
  const f1 = path.join(dir, 'a.pdf');
  const f2 = path.join(dir, 'b.docx');
  writeFileSync(f1, 'PDF-A');
  writeFileSync(f2, 'DOC-B');
  const mats = [
    {id: 'M1', name: 'a.pdf', path: f1, status: 'ok', sha256: 'h1'},
    {id: 'M2', name: 'b.docx', path: f2, status: 'ok', sha256: 'h2'},
    {id: 'M3', name: 'gone.pdf', path: path.join(dir, 'gone.pdf'), status: 'missing'}
  ];
  let dbText = 'DB-1';
  const reads = [];
  const fake = fakeDrive();
  const drive = createDrive({getToken: async () => 'T', fetch: fake.fetch});
  const master = newMasterKey();
  const pusher = (m = master) =>
    createPusher({
      drive,
      master: m,
      exportDb: (file) => writeFileSync(file, dbText),
      materials: () => mats,
      readMaterial: async (m) => {
        reads.push(m.id);
        return new Uint8Array(Buffer.from(m.id === 'M1' ? 'PDF-A' : 'DOC-B'));
      },
      userData,
      device: 'pc'
    });
  return {fake, drive, master, pusher, mats, reads, setDb: (t) => (dbText = t)};
}

test('送り出し：資料・アプリのファイル・データベース・目録を暗号化して送る。目録から中身を開ける', async () => {
  const {fake, master, pusher, reads} = setup();
  const r = await pusher().push();
  assert.equal(r.uploaded, 5); // 資料 2・写真 1・データベース・目録
  const names = [...fake.files.values()].map((f) => f.name);
  assert.ok(names.includes(MANIFEST) && names.includes(DB_NAME));
  // ドライブには平文が無い
  for (const f of fake.files.values()) assert.ok(!Buffer.from(f.bytes).toString().includes('PDF-A'));
  const keys = deriveKeys(master);
  const mf = [...fake.files.values()].find((f) => f.name === MANIFEST);
  const m = openJson(keys.enc, mf.bytes, MANIFEST);
  assert.deepEqual(Object.keys(m.materials).sort(), ['M1', 'M2']);
  assert.ok(m.files['photos/p1.jpg']);
  const blob = [...fake.files.values()].find((f) => f.name === m.materials.M1.name);
  assert.equal(Buffer.from(openBlob(keys.enc, blob.bytes, blob.name)).toString(), 'PDF-A');
  assert.deepEqual(reads.sort(), ['M1', 'M2']);
});

test('送り出し：変わっていなければ読まずに何も送らない。変わった資料・データベースだけ送り、外れたものは消す', async () => {
  const {fake, pusher, mats, reads, setDb} = setup();
  await pusher().push();
  reads.length = 0;
  let r = await pusher().push();
  assert.deepEqual([r.uploaded, r.removed, r.skipped], [0, 0, true]);
  assert.deepEqual(reads, [], '変わっていない資料は読まない');
  // 資料を 1 つ外し、データベースを変える
  mats.splice(1, 1);
  setDb('DB-2');
  r = await pusher().push();
  assert.equal(r.uploaded, 2); // データベース・目録
  assert.equal(r.removed, 1); // 外した資料
  assert.equal(fake.files.size, 4);
});

test('送り出し：ほかの鍵で作ったものがドライブにあれば止まり、消さない', async () => {
  const {fake, pusher} = setup();
  await pusher().push();
  const before = fake.files.size;
  await assert.rejects(pusher(newMasterKey()).push(), /鍵が違う/);
  assert.equal(fake.files.size, before);
});

// ---- 連携 ----
test('連携：クライアント ID がなければ準備中。連携していなければ送らない', async () => {
  assert.equal(googleReady({clientId: '', clientSecret: ''}), false);
  const settings = new Map();
  const repo = {
    getSetting: (k, d) => settings.get(k) ?? d,
    setSetting: (k, v) => settings.set(k, v),
    removeSetting: (k) => settings.delete(k)
  };
  const secrets = {get: async () => null, set: async () => {}, remove: async () => {}};
  const cloud = createCloud({repo, secrets, config: {clientId: '', clientSecret: ''}});
  assert.deepEqual(
    {...(await cloud.status())},
    {
      ready: false,
      linked: false,
      locked: false,
      passphrase: false,
      email: null,
      linkedAt: null,
      last: null,
      busy: false,
      fingerprint: null
    }
  );
  await assert.rejects(cloud.link(), /準備中/);
  await assert.rejects(cloud.push(), /連携していません/);
});

test('クライアント ID：パソコン用（デスクトップ）と iPad 用（iOS）が入っている。秘密はリポジトリに入れず、作るときに入れる', async () => {
  const {GOOGLE_DESKTOP, GOOGLE_IOS} = await import('../src/shared/google-client.js');
  assert.match(GOOGLE_DESKTOP.clientId, /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
  assert.match(GOOGLE_IOS.clientId, /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
  assert.notEqual(GOOGLE_DESKTOP.clientId, GOOGLE_IOS.clientId);
  assert.equal(GOOGLE_DESKTOP.clientSecret, '', 'リポジトリには秘密を書かない');
  const {loadClientSecret} = await import('../src/main/cloud/client-secret.js');
  assert.equal(loadClientSecret({env: {GOOGLE_DESKTOP_CLIENT_SECRET: ' s1 '}, read: () => 'f'}), 's1');
  assert.equal(loadClientSecret({env: {}, read: () => 'from-file\n'}), 'from-file');
  assert.equal(
    loadClientSecret({
      env: {},
      read: () => {
        throw new Error('なし');
      }
    }),
    ''
  );
  assert.equal(googleReady({clientId: GOOGLE_DESKTOP.clientId, clientSecret: 'x'}), true);
});

test('送り出し：資料を授業ごとにまとめた形（repo.listMaterialsAll）で渡されても送る（v0.23.1 で直した）', async () => {
  const {fake, drive, master} = setup();
  const userData = mkdtempSync(path.join(tmpdir(), 'dn-cloud-grouped-'));
  const grouped = {C1: [{id: 'M1', status: 'ok', path: '/x/a.pdf', sha256: 'h1', name: 'a.pdf'}]};
  const r = await createPusher({
    drive,
    master,
    exportDb: (file) => writeFileSync(file, 'DB'),
    materials: () => grouped,
    readMaterial: async () => new Uint8Array(Buffer.from('PDF')),
    userData,
    device: 'pc'
  }).push();
  assert.equal(r.uploaded, 3); // 資料 1・データベース・目録
  const mf = [...fake.files.values()].find((f) => f.name === MANIFEST);
  assert.deepEqual(Object.keys(openJson(deriveKeys(master).enc, mf.bytes, MANIFEST).materials), ['M1']);
});

test('つなぎ方：main.js は資料を授業ごとの形から並びにして送り出しに渡す', () => {
  const main = readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8');
  assert.match(main, /materials: \(\) => Object\.values\(repo\.listMaterialsAll\(\)\)\.flat\(\)/);
});

test('合言葉：鍵を合言葉で包んでドライブに置き、ほかの端末は合言葉で同じ鍵を開く。送っても合言葉の鍵は消さない', async () => {
  const {toB64, fromB64} = await import('../src/shared/mobile-wire.js');
  const fake = fakeDrive();
  const fetch = async (url, init) =>
    String(url).startsWith('https://oauth2.googleapis.com/token')
      ? Response.json({access_token: 'A', expires_in: 3600})
      : fake.fetch(url, init);
  const userData = mkdtempSync(path.join(tmpdir(), 'dn-cloud-pass-'));
  const device = (key) => {
    const settings = new Map([['cloud.account', {email: 'a@example.com'}]]);
    const store = new Map([['cloud.google', {refreshToken: 'R'}]]);
    if (key) store.set('cloud.key', toB64(key));
    const repo = {
      getSetting: (k, d) => settings.get(k) ?? d,
      setSetting: (k, v) => settings.set(k, v),
      removeSetting: (k) => settings.delete(k)
    };
    const secrets = {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => void store.set(k, v),
      remove: async (k) => void store.delete(k)
    };
    const cloud = createCloud({
      repo,
      secrets,
      fetch,
      config: {clientId: 'c', clientSecret: 's'},
      exportDb: (f) => writeFileSync(f, 'DB'),
      materials: () => [],
      readMaterial: async () => new Uint8Array(),
      userData,
      openExternal: () => {}
    });
    return {cloud, store};
  };
  const master = newMasterKey();
  const pc = device(master);
  await assert.rejects(pc.cloud.setPassphrase('short'), /8 文字以上/);
  await pc.cloud.setPassphrase('ながいあいことば');
  assert.equal((await pc.cloud.status()).passphrase, true);
  const names = () => [...fake.files.values()].map((f) => f.name);
  assert.ok(names().includes('keyring'));
  // ドライブにあるのは包んだ鍵だけ（鍵そのものは置かない）
  const ring = [...fake.files.values()].find((f) => f.name === 'keyring');
  assert.ok(!Buffer.from(ring.bytes).toString().includes(toB64(master)));
  await pc.cloud.push();
  assert.ok(names().includes('keyring'), '送っても消さない');
  // 鍵のない端末：合言葉で開く
  const other = device(null);
  assert.equal((await other.cloud.status()).locked, true);
  await assert.rejects(other.cloud.unlock('ちがうあいことば'), /合言葉が違います/);
  await other.cloud.unlock('ながいあいことば');
  assert.deepEqual(fromB64(other.store.get('cloud.key')), master);
  assert.equal((await other.cloud.status()).fingerprint, fingerprint(master));
});

test('送り出し：送った端末の種類を目録に書く。ほかの端末のデータがあれば送らない（上書きして消さない）', async () => {
  const {fake, drive, master} = setup();
  const userData = mkdtempSync(path.join(tmpdir(), 'dn-cloud-origin-'));
  const make = (origin, allow) =>
    createPusher({
      drive,
      master,
      exportDb: (file) => writeFileSync(file, `DB-${origin}`),
      materials: () => [],
      readMaterial: async () => new Uint8Array(),
      userData,
      device: origin === 'ipad' ? 'iPad-1' : 'pc',
      origin,
      allow
    });
  // iPad だけで始めて送った
  const r = await make('ipad').push();
  assert.equal(r.manifest.origin, 'ipad');
  // パソコンは iPad のデータを上書きしない（main/cloud/index.js と同じ決まり）
  const pcAllow = (prev) => (prev?.origin === 'ipad' ? 'iPad のデータがあります' : null);
  await assert.rejects(make('pc', pcAllow).push(), /iPad のデータがあります/);
  const mf = [...fake.files.values()].find((f) => f.name === MANIFEST);
  assert.equal(openJson(deriveKeys(master).enc, mf.bytes, MANIFEST).origin, 'ipad', '目録はそのまま');
});

test('パソコン：iPad が送ったデータは、取り込むまで上書きしない（画面に「取り込む」を出す）。取り込んだあとは送る', async () => {
  const {toB64} = await import('../src/shared/mobile-wire.js');
  const {IPAD_HELD} = await import('../src/main/cloud/index.js');
  const {ADOPTED} = await import('../src/main/cloud/adopt.js');
  const fake = fakeDrive();
  const fetch = async (url, init) =>
    String(url).startsWith('https://oauth2.googleapis.com/token')
      ? Response.json({access_token: 'A', expires_in: 3600})
      : fake.fetch(url, init);
  const userData = mkdtempSync(path.join(tmpdir(), 'dn-cloud-held-'));
  const master = newMasterKey();
  // iPad が送った
  const ipad = await createPusher({
    drive: createDrive({getToken: async () => 'A', fetch}),
    master,
    exportDb: (f) => writeFileSync(f, 'DB-ipad'),
    materials: () => [],
    readMaterial: async () => new Uint8Array(),
    userData,
    device: 'iPad-1',
    origin: 'ipad'
  }).push();
  const settings = new Map([['cloud.account', {email: 'a@example.com'}]]);
  const store = new Map([
    ['cloud.google', {refreshToken: 'R'}],
    ['cloud.key', toB64(master)]
  ]);
  const cloud = createCloud({
    repo: {
      getSetting: (k, d) => settings.get(k) ?? d,
      setSetting: (k, v) => settings.set(k, v),
      removeSetting: (k) => settings.delete(k)
    },
    secrets: {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => void store.set(k, v),
      remove: async (k) => void store.delete(k)
    },
    fetch,
    config: {clientId: 'c', clientSecret: 's'},
    exportDb: (f) => writeFileSync(f, 'DB-pc'),
    materials: () => [],
    readMaterial: async () => new Uint8Array(),
    userData,
    openExternal: () => {}
  });
  await assert.rejects(cloud.push(), (e) => e.message === IPAD_HELD);
  assert.equal((await cloud.status()).last.ipad, true, '画面に「iPad のデータを取り込む」を出す');
  // 取り込んだ（次の起動で入れ替わったデータベースに、取り込んだ目録の時刻が入っている）
  settings.set(ADOPTED, ipad.manifest.at);
  const r = await cloud.push();
  assert.equal(r.manifest.origin, 'pc');
  assert.equal((await cloud.status()).last.ok, true);
});

test('パソコン：ほかのパソコンが送ったデータは上書きしない（入れ直した空のパソコンでドライブの資料を消さない）。置き換えると決めたら送る', async () => {
  const {toB64} = await import('../src/shared/mobile-wire.js');
  const {OTHER_HELD, BASE} = await import('../src/main/cloud/index.js');
  const fake = fakeDrive();
  const fetch = async (url, init) =>
    String(url).startsWith('https://oauth2.googleapis.com/token')
      ? Response.json({access_token: 'A', expires_in: 3600})
      : fake.fetch(url, init);
  const master = newMasterKey();
  /** 1 台のパソコン（同じアカウント・同じ鍵）。mats：そのパソコンにある資料 */
  const pc = (name, mats, legacy = null) => {
    const settings = new Map([['cloud.account', {email: 'a@example.com'}]]);
    if (legacy) settings.set('cloud.last', legacy);
    const store = new Map([
      ['cloud.google', {refreshToken: 'R'}],
      ['cloud.key', toB64(master)]
    ]);
    const cloud = createCloud({
      repo: {
        getSetting: (k, d) => settings.get(k) ?? d,
        setSetting: (k, v) => settings.set(k, v),
        removeSetting: (k) => settings.delete(k)
      },
      secrets: {
        get: async (k) => store.get(k) ?? null,
        set: async (k, v) => void store.set(k, v),
        remove: async (k) => void store.delete(k)
      },
      fetch,
      config: {clientId: 'c', clientSecret: 's'},
      exportDb: (f) => writeFileSync(f, `DB-${name}`),
      materials: () => mats,
      readMaterial: async (m) => new Uint8Array(Buffer.from(`中身-${m.id}`)),
      userData: mkdtempSync(path.join(tmpdir(), `dn-cloud-${name}-`)),
      openExternal: () => {}
    });
    return {cloud, settings};
  };
  const names = () => [...fake.files.values()].map((f) => f.name).sort();

  // 1 台目が資料を送る。同じパソコンは、そのあとも送れる
  const pc1 = pc('pc1', [{id: 'M1', status: 'ok', path: 'a.pdf', sha256: 'h1'}]);
  await pc1.cloud.push();
  assert.ok(pc1.settings.get(BASE), '送った目録の時刻を覚える');
  assert.equal((await pc1.cloud.push()).skipped, true);
  const before = names();
  assert.equal(before.length, 3, '資料・データベース・目録');

  // 入れ直した空のパソコン（同じ鍵）：送らない。ドライブはそのまま
  const pc2 = pc('pc2', []);
  await assert.rejects(pc2.cloud.push(), (e) => e.message === OTHER_HELD);
  assert.deepEqual(names(), before, 'ドライブの資料は消えない');
  assert.equal((await pc2.cloud.status()).last.other, true, '画面に「取り込む」「置き換える」を出す');
  // 1 台目は続けて送れる
  await pc1.cloud.push();

  // 前の版（送った印を残していなかった）で送ったことのあるパソコンは、そのまま送れる
  const old = pc('pc1', [{id: 'M1', status: 'ok', path: 'a.pdf', sha256: 'h1'}], {ok: true, at: '2026-11-01'});
  await old.cloud.push();
  assert.ok(old.settings.get(BASE));

  // 置き換えると決めたときだけ、空のパソコンのデータで置き換わる
  const r = await pc2.cloud.replace();
  assert.equal(r.removed, 1);
  assert.equal(names().length, 2);
  assert.equal((await pc2.cloud.status()).last.ok, true);
  // 置き換えられた 1 台目は、もう黙っては送らない
  await assert.rejects(pc1.cloud.push(), (e) => e.message === OTHER_HELD);
});
