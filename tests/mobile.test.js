// スマホ連携（docs/MOBILE.md）：暗号化した窓口・つなぐ手順・配るファイル・スマホから呼べる窓口
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import {
  KEY_BYTES,
  fromB64,
  open,
  pack,
  pairUrl,
  randomBytes,
  readPairHash,
  seal,
  toB64,
  unpack
} from '../src/shared/mobile-wire.js';
import {PAIR_TTL_MS, createDevices, deviceName} from '../src/main/mobile/devices.js';
import {createMobileApi, photoName, photoType} from '../src/main/mobile/api.js';
import {createMobileServer, lanAddresses, staticFile, staticRoots} from '../src/main/mobile/server.js';

const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';

// ---- 包み方 ----
test('seal と open：同じ鍵で戻り、違う鍵・書き換えは通らない', () => {
  const key = randomBytes(KEY_BYTES);
  const value = {ch: 'home', arg: {n: 1, s: 'あいう'}, t: 123};
  const box = seal(key, value);
  assert.deepEqual(open(key, box).value, value);
  assert.equal(typeof open(key, box).nonce, 'string');
  assert.throws(() => open(randomBytes(KEY_BYTES), box));
  const bad = box.slice();
  bad[30] ^= 1;
  assert.throws(() => open(key, bad));
  // 同じ中身でも毎回違う（nonce が違う）
  assert.notDeepEqual(seal(key, value), box);
});

test('pack と unpack：バイト列（Uint8Array・Buffer）も運べる', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  const back = unpack(pack({a: bytes, b: [Buffer.from([7, 8])], c: 'x'}));
  assert.ok(back.a instanceof Uint8Array);
  assert.deepEqual([...back.a], [...bytes]);
  assert.deepEqual([...back.b[0]], [7, 8]);
  assert.equal(back.c, 'x');
});

test('toB64 と fromB64：base64url で往復（大きな列も）', () => {
  const big = randomBytes(200000);
  const s = toB64(big);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(fromB64(s), big);
});

test('pairUrl と readPairHash：鍵は # の後ろ（サーバーへ送られない）', () => {
  const key = randomBytes(KEY_BYTES);
  const url = pairUrl({host: '192.168.1.5', port: 47390, deviceId: ULID, key});
  assert.ok(url.startsWith('http://192.168.1.5:47390/m/#d='));
  const r = readPairHash(new URL(url).hash);
  assert.equal(r.deviceId, ULID);
  assert.deepEqual(r.key, key);
  assert.equal(readPairHash('#d=xyz&k=abc'), null);
  assert.equal(readPairHash(`#d=${ULID}&k=${toB64(randomBytes(16))}`), null);
  assert.equal(readPairHash(''), null);
});

// ---- 端末 ----
function fakeRepo() {
  const settings = new Map();
  return {
    getSetting: (k, d) => (settings.has(k) ? structuredClone(settings.get(k)) : d),
    setSetting: (k, v) => settings.set(k, structuredClone(v)),
    settings
  };
}
function fakeSecrets() {
  const m = new Map();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => m.set(k, v),
    remove: async (k) => m.delete(k),
    m
  };
}

test('deviceName：User-Agent から', () => {
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'iPhone');
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9)'), 'Android');
  assert.equal(deviceName(''), 'スマホ');
});

test('端末：作ると待ち、10 分で消える。一覧に待ちは出ない', async () => {
  let t = Date.parse('2026-10-27T00:00:00Z');
  const repo = fakeRepo();
  const secrets = fakeSecrets();
  const devices = createDevices({repo, secrets, now: () => t});
  const {id, key} = await devices.create();
  assert.equal(key.length, KEY_BYTES);
  assert.ok(devices.isPending(id));
  assert.deepEqual(await devices.keyOf(id), key);
  assert.deepEqual(await devices.list(), []);
  t += PAIR_TTL_MS + 1;
  assert.equal(await devices.keyOf(id), null);
  assert.equal(repo.getSetting('mobile.devices', []).length, 0);
  assert.equal(secrets.m.size, 0);
});

test('端末：初めてつながると鍵が新しくなり（QR の鍵は使えない）、名前が付く。外すと鍵も消える', async () => {
  const t = Date.parse('2026-10-27T00:00:00Z');
  const repo = fakeRepo();
  const secrets = fakeSecrets();
  const devices = createDevices({repo, secrets, now: () => t});
  const {id, key} = await devices.create();
  const fresh = await devices.activate(id, 'Mozilla/5.0 (iPhone)');
  assert.notDeepEqual(fresh, key);
  assert.equal(devices.isPending(id), false);
  assert.deepEqual(await devices.keyOf(id), fresh);
  // 2 回目の activate はしない（待ちでなければ null）
  assert.equal(await devices.activate(id, ''), null);
  const [d] = await devices.list();
  assert.equal(d.name, 'iPhone');
  assert.equal(d.key, undefined);
  devices.rename(id, '  私の   iPhone ');
  assert.equal((await devices.list())[0].name, '私の iPhone');
  assert.throws(() => devices.rename(id, '   '));
  await devices.remove(id);
  assert.deepEqual(await devices.list(), []);
  assert.equal(await devices.keyOf(id), null);
  assert.equal(secrets.m.size, 0);
});

// ---- 写真 ----
test('photoType：中身の頭で見る', () => {
  const pad = (head) => new Uint8Array([...head, ...new Array(16).fill(0)]);
  assert.equal(photoType(pad([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(photoType(pad([0x89, 0x50, 0x4e, 0x47])), 'png');
  assert.equal(photoType(pad([0, 0, 0, 0x18, ...Buffer.from('ftypheic')])), 'heic');
  assert.equal(photoType(pad([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')])), 'webp');
  assert.equal(photoType(pad([...Buffer.from('%PDF-1.7')])), null);
  assert.equal(photoType('not bytes'), null);
});

test('photoName：日本時間で、2 枚目からは番号', () => {
  const at = new Date('2026-10-27T03:04:05Z'); // 日本時間 12:04:05
  assert.equal(photoName('jpg', at, 0), '写真_20261027_120405.jpg');
  assert.equal(photoName('png', at, 1), '写真_20261027_120405_2.png');
});

// ---- スマホから呼べる窓口 ----
function apiWith(rows = {}) {
  const calls = [];
  const sent = [];
  const handlers = new Map([
    ['annotation.save', async (arg) => (calls.push(['save', arg]), {annotation: {id: ULID, ...arg.annotation}})],
    ['annotation.remove', async (arg) => (calls.push(['remove', arg]), {ok: true})],
    ['material.uploadData', async (arg) => (calls.push(['upload', arg]), {added: arg.files.length})],
    ['quiz.answer', async (arg) => (calls.push(['answer', arg]), {ok: true})],
    ['sticker.data', async (arg) => (calls.push(['sticker', arg]), {data: {}})]
  ]);
  const repo = {
    ...fakeRepo(),
    get: (table, id) => rows[id] ?? null
  };
  const api = createMobileApi({
    handlers,
    repo,
    getWindow: () => ({webContents: {send: (...a) => sent.push(a)}}),
    now: () => new Date('2026-10-27T03:04:05Z')
  });
  return {api, calls, sent, repo};
}

test('窓口：スマホで書けるのはコメント・マーカー・文字隠しだけ。書いたらパソコンの画面に知らせる', async () => {
  const {api, calls, sent, repo} = apiWith({[ULID]: {id: ULID, kind: 'ink'}});
  const M = '01JABCDEFGHJKMNPQRSTVWXYZ1';
  await assert.rejects(
    api['annotation.save']({materialId: M, annotation: {kind: 'ink', page: 1}}),
    /コメント・マーカー・文字隠し/
  );
  await assert.rejects(
    api['annotation.save']({materialId: M, annotation: {id: ULID, kind: 'note', page: 1}}),
    /パソコンで直して/
  );
  await assert.rejects(api['annotation.remove']({materialId: M, annotationId: ULID}), /パソコンで直して/);
  await api['annotation.save']({materialId: M, annotation: {kind: 'mask', page: 1, rect: {x: 0, y: 0, w: 5, h: 5}}});
  assert.equal(calls.length, 1);
  assert.deepEqual(repo.getSetting('pdf.stale', []), [M]);
  assert.deepEqual(sent, [['annotations.changed', {materialId: M}]]);
  await assert.rejects(api['annotation.save']({materialId: 'x', annotation: {kind: 'note'}}), /ID が不正/);
});

test('窓口：復習の答えはいつも review として記録する', async () => {
  const {api, calls} = apiWith();
  await api['quiz.answer']({questionId: ULID, answer: '○', seconds: 3, mode: 'exam'});
  assert.equal(calls[0][1].mode, 'review');
});

test('窓口：写真は中身を確かめ、名前を付けて回のフォルダへ', async () => {
  const {api, calls} = apiWith();
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(1)]);
  await api['photo.upload']({courseId: ULID, roundId: null, files: [{data: jpg}]});
  assert.equal(calls[0][0], 'upload');
  assert.equal(calls[0][1].files[0].name, '写真_20261027_120405.jpg');
  await assert.rejects(api['photo.upload']({courseId: ULID, files: [{data: new Uint8Array(20)}]}), /写真/);
  await assert.rejects(api['photo.upload']({courseId: ULID, files: []}), /枚まで/);
  // 設定・接続・パスワードなどの窓口はない
  for (const ch of ['settings.set', 'connector.save', 'backup.run', 'secrets.get', 'mobile.pair'])
    assert.equal(Object.hasOwn(api, ch), false, ch);
});

// ---- 配るファイル ----
test('staticFile：決めた場所の中だけ。.. や隠しファイル・知らない種類は配らない', () => {
  const roots = staticRoots();
  assert.ok(staticFile('/m/', roots).endsWith(path.join('mobile', 'index.html')));
  assert.ok(staticFile('/m/app/app.js', roots).endsWith(path.join('src', 'mobile', 'app.js')));
  assert.ok(staticFile('/m/shared/mobile-wire.js', roots));
  assert.ok(staticFile('/m/pdfjs/legacy/build/pdf.min.mjs', roots));
  assert.ok(staticFile('/m/vendor/noble/chacha.js', roots));
  for (const bad of [
    '/m/app/../main/main.js',
    '/m/app/%2e%2e/main/main.js',
    '/m/shared/..%2f..%2fpackage.json',
    '/m/app/.env',
    '/m/pdfjs/package.json/../../../package.json',
    '/m/app/foo.sqlite',
    '/m/app//app.js',
    '/main/main.js',
    '/m/app/%E0%A4%A'
  ])
    assert.equal(staticFile(bad, roots), null, bad);
});

test('lanAddresses：家庭・大学の内向きの番号だけ、Wi-Fi を先に', () => {
  const r = lanAddresses({
    lo0: [{family: 'IPv4', internal: true, address: '127.0.0.1'}],
    docker0: [{family: 'IPv4', internal: false, address: '172.17.0.1'}],
    en0: [
      {family: 'IPv4', internal: false, address: '192.168.10.3'},
      {family: 'IPv6', internal: false, address: 'fe80::1'}
    ],
    utun3: [{family: 'IPv4', internal: false, address: '100.64.0.2'}]
  });
  assert.deepEqual(r, ['192.168.10.3', '172.17.0.1']);
});

// ---- 窓口の通し ----
async function startServer({slow = null} = {}) {
  const repo = fakeRepo();
  const secrets = fakeSecrets();
  const devices = createDevices({repo, secrets});
  const api = {
    async echo(arg) {
      return {got: arg};
    },
    async boom() {
      throw new Error('だめでした');
    },
    async slow() {
      await slow;
      return {ok: true};
    }
  };
  const server = createMobileServer({devices, api});
  const port = await server.start(0);
  const base = `http://127.0.0.1:${port}`;
  const post = async (deviceId, key, msg) => {
    const head = Buffer.from(deviceId, 'ascii');
    const res = await fetch(`${base}/m/api`, {
      method: 'POST',
      headers: {'Content-Type': 'application/octet-stream'},
      body: Buffer.concat([head, Buffer.from(seal(key, msg))])
    });
    const body = new Uint8Array(await res.arrayBuffer());
    return {status: res.status, body};
  };
  return {server, devices, base, post};
}

test('サーバー：QR の鍵であいさつ → 新しい鍵。古い鍵はもう通らない。知らない端末は 403', async () => {
  const {server, devices, post} = await startServer();
  try {
    const {id, key} = await devices.create();
    // 待ちのうちは hello だけ
    let r = await post(id, key, {ch: 'echo', arg: {}, t: Date.now()});
    assert.equal(r.status, 403);
    r = await post(id, key, {ch: 'hello', arg: {}, t: Date.now()});
    assert.equal(r.status, 200);
    const fresh = open(key, r.body).value.key;
    assert.equal(fresh.length, KEY_BYTES);
    // 古い鍵（QR の鍵）は開けない
    r = await post(id, key, {ch: 'echo', arg: {a: 1}, t: Date.now()});
    assert.equal(r.status, 400);
    r = await post(id, fresh, {ch: 'echo', arg: {a: 1}, t: Date.now()});
    assert.equal(r.status, 200);
    assert.deepEqual(open(fresh, r.body).value, {got: {a: 1}});
    // 失敗は {error}、ない窓口も {error}
    r = await post(id, fresh, {ch: 'boom', t: Date.now()});
    assert.equal(open(fresh, r.body).value.error, 'だめでした');
    r = await post(id, fresh, {ch: 'settings.set', t: Date.now()});
    assert.match(open(fresh, r.body).value.error, /スマホからはできません/);
    r = await post(ULID, fresh, {ch: 'echo', t: Date.now()});
    assert.equal(r.status, 403);
  } finally {
    await server.stop();
  }
});

test('サーバー：時刻のずれ・同じ要求の送り直しは 409', async () => {
  const {server, devices, base} = await startServer();
  try {
    const {id, key} = await devices.create();
    const sealed = (k, msg) => Buffer.concat([Buffer.from(id, 'ascii'), Buffer.from(seal(k, msg))]);
    const send = (body) => fetch(`${base}/m/api`, {method: 'POST', body});
    assert.equal((await send(sealed(key, {ch: 'hello', t: Date.now() - 10 * 60 * 1000}))).status, 409);
    const res = await send(sealed(key, {ch: 'hello', t: Date.now()}));
    assert.equal(res.status, 200);
    const fresh = open(key, new Uint8Array(await res.arrayBuffer())).value.key;
    const once = sealed(fresh, {ch: 'echo', arg: {}, t: Date.now()});
    assert.equal((await send(once)).status, 200);
    assert.equal((await send(once)).status, 409);
  } finally {
    await server.stop();
  }
});

test('サーバー：画面のファイルを配り、外のファイルは 404', async () => {
  const {server, base} = await startServer();
  try {
    let res = await fetch(`${base}/m/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /大学ノート/);
    res = await fetch(`${base}/m/app/app.js`);
    assert.match(res.headers.get('content-type'), /javascript/);
    res = await fetch(`${base}/m/app/..%2f..%2fpackage.json`);
    assert.equal(res.status, 404);
    res = await fetch(`${base}/`, {redirect: 'manual'});
    assert.equal(res.status, 302);
    res = await fetch(`${base}/m/app/app.js`, {method: 'PUT'});
    assert.equal(res.status, 405);
  } finally {
    await server.stop();
  }
});

/** 生の要求：Content-Length を言うだけ言って、本文は少しだけ送る（送り切らない）。戻りは {status}（つながりが切れたら status: 0） */
function rawPost(port, {length, chunk = Buffer.alloc(0), end = false}) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/m/api',
        method: 'POST',
        headers: length == null ? {} : {'Content-Length': length}
      },
      (res) => {
        res.resume();
        resolve({status: res.statusCode});
        req.destroy();
      }
    );
    req.on('error', () => resolve({status: 0}));
    req.write(chunk);
    if (end) req.end();
  });
}

test('サーバー：大きすぎる本文は読まずに 413。知らない端末は本文を読む前に 403。待ちの端末の大きな本文は 413', async () => {
  const {server, devices} = await startServer();
  try {
    const port = server.port;
    // 100MB と言う要求：1 バイトも読まずに断る
    assert.equal((await rawPost(port, {length: 100 * 1024 * 1024})).status, 413);
    // 知らない端末が 40MB 送ると言う：先頭 26 バイトだけで断る（残りを待たない）
    const t0 = Date.now();
    const r = await rawPost(port, {length: 40 * 1024 * 1024, chunk: Buffer.from(ULID + 'x'.repeat(100))});
    assert.equal(r.status, 403);
    assert.ok(Date.now() - t0 < 2000, '残りの本文を待たない');
    // QR を読んだだけの端末：あいさつより大きな本文は断る
    const {id} = await devices.create();
    assert.equal((await rawPost(port, {length: 1024 * 1024, chunk: Buffer.from(id + 'x'.repeat(100))})).status, 413);
    // 長さを言わない（chunked）・短すぎる
    assert.equal((await rawPost(port, {length: null, chunk: Buffer.from('abc'), end: true})).status, 400);
    assert.equal((await rawPost(port, {length: 10, chunk: Buffer.from('0123456789'), end: true})).status, 400);
  } finally {
    await server.stop();
  }
});

test('サーバー：同時に受ける要求は 4 件まで。それより多ければ 503', async () => {
  let release;
  const slow = new Promise((r) => (release = r));
  const {server, devices, post} = await startServer({slow});
  try {
    const {id, key} = await devices.create();
    const hi = await post(id, key, {ch: 'hello', t: Date.now()});
    const fresh = open(key, hi.body).value.key;
    const waiting = [1, 2, 3, 4].map(() => post(id, fresh, {ch: 'slow', t: Date.now()}));
    await new Promise((r) => setTimeout(r, 200));
    const r = await post(id, fresh, {ch: 'echo', t: Date.now()});
    assert.equal(r.status, 503);
    release();
    for (const w of await Promise.all(waiting)) assert.equal(w.status, 200);
    const after = await post(id, fresh, {ch: 'echo', arg: {a: 1}, t: Date.now()});
    assert.equal(after.status, 200, '終わればまた受ける');
  } finally {
    await server.stop();
  }
});

test('端末：前と違う所（IP）・違うブラウザからつながったら知らせる値を返す（最初の 1 回・同じ所では返さない）', async () => {
  let t = Date.parse('2026-10-27T00:00:00Z');
  const devices = createDevices({repo: fakeRepo(), secrets: fakeSecrets(), now: () => t});
  const {id} = await devices.create();
  await devices.activate(id, 'Mozilla/5.0 (iPhone)');
  assert.equal(devices.seen(id, {ip: '::ffff:192.168.1.20', ua: 'UA-1'}), null, '最初は覚えるだけ');
  assert.equal((await devices.list())[0].ip, '192.168.1.20');
  t += 1000;
  assert.equal(devices.seen(id, {ip: '192.168.1.20', ua: 'UA-1'}), null, '同じ所');
  const moved = devices.seen(id, {ip: '192.168.1.99', ua: 'UA-1'});
  assert.deepEqual(
    {from: moved.from, to: moved.to, ua: moved.uaChanged, name: moved.name},
    {from: '192.168.1.20', to: '192.168.1.99', ua: false, name: 'iPhone'}
  );
  assert.equal(devices.seen(id, {ip: '192.168.1.99', ua: 'UA-1'}), null, '新しい所を覚えた');
  assert.equal(devices.seen(id, {ip: '192.168.1.99', ua: 'UA-2'}).uaChanged, true);
});

test('サーバー：つないだスマホが前と違う所からつながったら onMoved を呼ぶ', async () => {
  const repo = fakeRepo();
  const devices = createDevices({repo, secrets: fakeSecrets()});
  const movedList = [];
  const server = createMobileServer({devices, api: {}, onMoved: (d) => movedList.push(d)});
  const port = await server.start(0);
  try {
    const {id, key} = await devices.create();
    const send = async (k, msg, ua) => {
      const res = await fetch(`http://127.0.0.1:${port}/m/api`, {
        method: 'POST',
        headers: {'User-Agent': ua},
        body: Buffer.concat([Buffer.from(id, 'ascii'), Buffer.from(seal(k, msg))])
      });
      return new Uint8Array(await res.arrayBuffer());
    };
    const fresh = open(key, await send(key, {ch: 'hello', t: Date.now()}, 'UA-1')).value.key;
    await send(fresh, {ch: 'hello', t: Date.now()}, 'UA-1');
    assert.equal(movedList.length, 0);
    await send(fresh, {ch: 'hello', t: Date.now()}, 'UA-other');
    assert.equal(movedList.length, 1);
    assert.equal(movedList[0].uaChanged, true);
  } finally {
    await server.stop();
  }
});
