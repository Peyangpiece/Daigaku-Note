// パソコンと同じ画面（iPad。docs/MOBILE.md §8）：知らせの受け渡し・窓口の通し方・配る index.html・サーバーの入口
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {open, seal} from '../src/shared/mobile-wire.js';
import {createDevices} from '../src/main/mobile/devices.js';
import {createPadApi, createPadHub} from '../src/main/mobile/pad.js';
import {PAD_INDEX, createMobileServer, padIndexHtml, staticFile} from '../src/main/mobile/server.js';
import {PAD_DENY, PAD_EXTRA, PAD_LOCAL, PAD_QUIET, PALM_SIZE, contactSize} from '../src/shared/pad-channels.js';

const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const C1 = 'client-aaaaaaaa';
const C2 = 'client-bbbbbbbb';

function fakeRepo(rows = {}) {
  const settings = new Map();
  return {
    getSetting: (k, d) => (settings.has(k) ? structuredClone(settings.get(k)) : d),
    setSetting: (k, v) => settings.set(k, structuredClone(v)),
    get: (_t, id) => rows[id] ?? null,
    updateMaterial: (id, patch) => Object.assign(rows[id], patch)
  };
}
function fakeSecrets() {
  const m = new Map();
  return {get: async (k) => m.get(k) ?? null, set: async (k, v) => m.set(k, v), remove: async (k) => m.delete(k)};
}

// ---- 知らせ ----
test('hub：知らせは画面ごとに貯め、受け取り済み（after）までは消す。待っていればすぐ返す', async () => {
  const hub = createPadHub();
  assert.deepEqual(await hub.poll('d1', C1, 0, 0), {events: [], reset: false, last: 0});
  hub.push('state.changed', {});
  hub.push('sync.progress', {n: 1});
  let r = await hub.poll('d1', C1, 0, 0);
  assert.deepEqual(
    r.events.map((e) => [e.seq, e.ch]),
    [
      [1, 'state.changed'],
      [2, 'sync.progress']
    ]
  );
  r = await hub.poll('d1', C1, 2, 0);
  assert.equal(r.events.length, 0);
  // 待っている間に知らせが来たら、すぐ返す
  const waiting = hub.poll('d1', C1, 2, 5000);
  setTimeout(() => hub.push('quiz.finished', {ok: true}), 10);
  const t0 = Date.now();
  r = await waiting;
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(r.events[0].payload, {ok: true});
});

test('hub：書いた iPad の画面には返さない（skip）。1 つの画面にだけ渡す（to）', async () => {
  const hub = createPadHub();
  await hub.poll('d1', C1, 0, 0);
  await hub.poll('d1', C2, 0, 0);
  hub.push('annotations.changed', {materialId: ULID}, {pad: true, client: C1, frame: 'frame-left'});
  hub.toFrame(C1, 'frame-scan', 'scan.photo', {id: 'x'});
  const a = await hub.poll('d1', C1, 0, 0);
  assert.deepEqual(
    a.events.map((e) => [e.ch, e.skip ?? null, e.to ?? null]),
    [
      ['annotations.changed', 'frame-left', null],
      ['scan.photo', null, 'frame-scan']
    ]
  );
  const b = await hub.poll('d1', C2, 0, 0);
  assert.deepEqual(
    b.events.map((e) => [e.ch, e.skip ?? null]),
    [['annotations.changed', null]]
  );
  // パソコンの画面から書いた（except はパソコンの画面）：iPad の画面はどれも受け取る
  hub.push('note.pages', {}, {send() {}});
  assert.equal((await hub.poll('d1', C2, 1, 0)).events[0].skip, undefined);
});

test('hub：あふれたら古いものを捨てて reset。パソコンを開き直した（知らない画面が after > 0 で来た）ときも reset', async () => {
  const hub = createPadHub({cap: 3});
  await hub.poll('d1', C1, 0, 0);
  for (let i = 0; i < 5; i++) hub.push('state.changed', {i});
  const r = await hub.poll('d1', C1, 0, 0);
  assert.equal(r.reset, true);
  assert.deepEqual(
    r.events.map((e) => e.payload.i),
    [2, 3, 4]
  );
  assert.equal((await hub.poll('d1', C1, r.last, 0)).reset, false);
  const fresh = await hub.poll('d1', C2, 40, 0);
  assert.equal(fresh.reset, true);
  hub.push('state.changed', {});
  assert.equal((await hub.poll('d1', C2, 40, 0)).events[0].seq, 41, '番号は iPad の続きから');
});

test('hub：画面の番号は端末に結び付く。外した端末の待ちは終わる', async () => {
  const hub = createPadHub();
  await hub.poll('d1', C1, 0, 0);
  await assert.rejects(hub.poll('d2', C1, 0, 0), /画面の番号/);
  const waiting = hub.poll('d1', C1, 0, 5000);
  setTimeout(() => hub.drop('d1'), 10);
  const t0 = Date.now();
  await waiting;
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(hub.size, 0);
});

// ---- 窓口 ----
function padWith(rows = {}, ctx = {}) {
  const calls = [];
  const hub = createPadHub();
  const handlers = new Map([
    ['state.get', async () => ({courses: []})],
    ['annotation.save', async (arg, e) => (calls.push(['save', arg, e]), {annotation: {id: ULID}})],
    ['boom', async () => Promise.reject(new Error('だめでした'))],
    ['folder.create', async (arg) => (calls.push(['folder', arg]), {courseId: ULID})],
    ['quiet', async () => undefined]
  ]);
  const pad = createPadApi({handlers, ctx, repo: fakeRepo(rows), hub});
  return {pad, calls, hub};
}

test('窓口：パソコンの画面の窓口をそのまま呼ぶ。iPad の画面をパソコンの画面（senderFrame）に見立てる', async () => {
  const {pad, calls, hub} = padWith();
  assert.deepEqual(await pad.call({ch: 'state.get', arg: {}, client: C1, frame: 'frame-top1'}), {r: {courses: []}});
  await pad.call({ch: 'annotation.save', arg: {materialId: ULID}, client: C1, frame: 'frame-top1'});
  const [, arg, e] = calls[0];
  assert.deepEqual(arg, {materialId: ULID});
  assert.equal(e.senderFrame.pad, true);
  assert.equal(e.senderFrame.client, C1);
  // send はその画面にだけ渡す（アナログノートの写真）
  await hub.poll('d1', C1, 0, 0);
  e.senderFrame.send('scan.photo', {id: 1});
  assert.equal((await hub.poll('d1', C1, 0, 0)).events[0].to, 'frame-top1');
  // 答えがない窓口は null
  assert.deepEqual(await pad.call({ch: 'quiet', client: C1, frame: 'frame-top1'}), {r: null});
});

test('窓口：失敗はパソコンの画面と同じ {error}。知らない窓口・画面の番号の不正も {error}', async () => {
  const {pad} = padWith();
  assert.deepEqual(await pad.call({ch: 'boom', client: C1, frame: 'frame-top1'}), {r: {error: 'だめでした'}});
  assert.match((await pad.call({ch: 'nope', client: C1, frame: 'frame-top1'})).r.error, /窓口がありません/);
  assert.match((await pad.call({ch: 'state.get', client: 'x', frame: 'frame-top1'})).r.error, /画面の番号/);
});

test('窓口：パソコンのフォルダ・窓を開くもの、スマホ・iPad の設定は断る。パソコンのフォルダの登録も断る', async () => {
  const {pad, calls} = padWith();
  for (const ch of Object.keys(PAD_DENY))
    assert.equal((await pad.call({ch, client: C1, frame: 'frame-top1'})).r.error, PAD_DENY[ch]);
  for (const ch of PAD_LOCAL) assert.ok((await pad.call({ch, client: C1, frame: 'frame-top1'})).r.error);
  assert.match(
    (await pad.call({ch: 'folder.create', arg: {mode: 'link'}, client: C1, frame: 'frame-top1'})).r.error,
    /パソコンの画面/
  );
  assert.deepEqual(
    (await pad.call({ch: 'folder.create', arg: {mode: 'new', name: 'x'}, client: C1, frame: 'frame-top1'})).r,
    {courseId: ULID}
  );
  assert.equal(calls.length, 1);
});

test('窓口：資料の中身（iPad で開く）。開ける種類・あるファイルだけ。開いた日を残す', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dn-pad-'));
  const file = path.join(dir, '第1回.docx');
  writeFileSync(file, 'hello');
  const rows = {
    [ULID]: {id: ULID, path: file, status: 'ok', mime: 'application/msword'},
    '01JABCDEFGHJKMNPQRSTVWXYZ1': {id: '01JABCDEFGHJKMNPQRSTVWXYZ1', path: path.join(dir, 'a.exe'), status: 'ok'}
  };
  const {pad} = padWith(rows);
  const {r} = await pad.call({ch: 'material.data', arg: {materialId: ULID}, client: C1, frame: 'frame-top1'});
  assert.equal(r.name, '第1回.docx');
  assert.equal(Buffer.from(r.bytes).toString(), 'hello');
  assert.ok(rows[ULID].read_at);
  assert.match(
    (
      await pad.call({
        ch: 'material.data',
        arg: {materialId: '01JABCDEFGHJKMNPQRSTVWXYZ1'},
        client: C1,
        frame: 'f1234567'
      })
    ).r.error,
    /開きません/
  );
});

test('窓口：書き出し・学年暦・バックアップは、パソコンの側の関数（ctx）へ', async () => {
  const seen = [];
  const {pad} = padWith(
    {},
    {
      pdfExportData: async (a) => (seen.push(['pdf', a]), {ok: true, name: 'a_注釈.pdf', bytes: new Uint8Array([1])}),
      readCalendarData: async (a) => (seen.push(['cal', a]), {ok: true}),
      backupExportData: async () => (seen.push(['bx']), {ok: true}),
      backupImportData: async (a) => (seen.push(['bi', a]), {ok: true})
    }
  );
  for (const ch of PAD_EXTRA.filter((c) => !['material.data', 'pdf.markStale', 'pad.touchLog'].includes(c)))
    assert.equal((await pad.call({ch, arg: {x: 1}, client: C1, frame: 'frame-top1'})).r.ok, true);
  assert.deepEqual(
    seen.map((s) => s[0]),
    ['pdf', 'cal', 'bx', 'bi']
  );
  // パソコンの側がまだ用意できていない
  const {pad: early} = padWith();
  assert.match((await early.call({ch: 'pdf.exportData', client: C1, frame: 'frame-top1'})).r.error, /準備/);
});

test('窓口の一覧：断る・iPad で受ける窓口は、パソコンの画面の窓口（preload の INVOKE）にある。iPad だけの窓口はパソコンの側にある', () => {
  const preload = readFileSync(new URL('../src/preload/preload.js', import.meta.url), 'utf8');
  const invoke = preload.slice(preload.indexOf('INVOKE'), preload.indexOf('ON ='));
  const allowed = new Set([...invoke.matchAll(/'([a-zA-Z.]+)'/g)].map((m) => m[1]));
  for (const ch of [...Object.keys(PAD_DENY), ...PAD_LOCAL]) assert.ok(allowed.has(ch), ch);
  const ipcDir = new URL('../src/main/ipc/', import.meta.url);
  const ipc = readdirSync(ipcDir)
    .map((f) => readFileSync(new URL(f, ipcDir), 'utf8'))
    .join('\n');
  for (const fn of ['pdfExportData', 'readCalendarData', 'backupExportData', 'backupImportData'])
    assert.match(ipc, new RegExp(`ctx\\.${fn} = `), fn);
});

// ---- 配るページ ----
test('padIndexHtml：app.js の前に boot.js、暗号の部品を import の対応表に足し、CSP のハッシュも直す', () => {
  const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
  const out = padIndexHtml(html);
  const map = out.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(map).imports['@noble/ciphers/'], '/m/vendor/noble/');
  assert.equal(JSON.parse(map).imports.three, '../../node_modules/three/build/three.module.js');
  const hash = createHash('sha256').update(map).digest('base64');
  assert.ok(out.includes(`'sha256-${hash}'`), 'CSP のハッシュが新しい対応表のもの');
  assert.ok(out.includes('<script type="module" src="/m/p/pad/boot.js"></script>'));
  assert.ok(!out.includes('src="app.js"'));
  assert.match(out, /name="viewport"/);
  assert.match(out, /\/p\/pad\/pad\.css/);
  // Windows で取り出したファイル（改行が CRLF）でも同じ
  assert.equal(padIndexHtml(html.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')), out);
});

test('staticFile：パソコンの画面のファイル・pdf.js・three.js・iPad の部品を配る。外は配らない', () => {
  for (const p of [
    '/m/p/src/renderer/app.js',
    '/m/p/src/renderer/styles/base.css',
    '/m/p/src/shared/pad-channels.js',
    '/m/p/node_modules/pdfjs-dist/legacy/build/pdf.min.mjs',
    '/m/p/node_modules/three/build/three.module.js',
    '/m/p/pad/boot.js',
    '/m/p/pad/bridge.js',
    '/m/p/pad/pad.css'
  ])
    assert.ok(staticFile(p), p);
  assert.equal(staticFile(PAD_INDEX), null, 'index.html は直して配る');
  assert.equal(staticFile('/m/p/src/main/main.js'), null);
  assert.equal(staticFile('/m/p/node_modules/electron/index.js'), null);
  assert.equal(staticFile('/m/p/src/renderer/../main/secrets.js'), null);
});

// ---- サーバー ----
async function startServer() {
  const repo = fakeRepo();
  const devices = createDevices({repo, secrets: fakeSecrets()});
  const hub = createPadHub();
  const handlers = new Map([['state.get', async () => ({courses: [1]})]]);
  const pad = createPadApi({handlers, ctx: {}, repo, hub});
  const server = createMobileServer({devices, api: {}, pad});
  const port = await server.start(0);
  const base = `http://127.0.0.1:${port}`;
  const {id} = await devices.create();
  const key = (await devices.activate(id, 'iPad')) ?? null;
  const post = async (ch, arg = {}) => {
    const res = await fetch(`${base}/m/api`, {
      method: 'POST',
      body: Buffer.concat([Buffer.from(id), Buffer.from(seal(key, {ch, arg, t: Date.now()}))])
    });
    return open(key, new Uint8Array(await res.arrayBuffer())).value;
  };
  return {server, devices, hub, id, post, base};
}

test('サーバー：「パソコンと同じ画面」をオンにした端末だけ通す', async () => {
  const {server, devices, id, post} = await startServer();
  try {
    assert.deepEqual(await post('pad.status'), {full: false});
    const r = await post('pad.call', {ch: 'state.get', client: C1, frame: 'frame-top1'});
    assert.match(r.error, /パソコンと同じ画面/);
    devices.setFull(id, true);
    assert.deepEqual(await post('pad.status'), {full: true});
    assert.deepEqual(await post('pad.call', {ch: 'state.get', client: C1, frame: 'frame-top1'}), {r: {courses: [1]}});
    assert.equal((await devices.list())[0].full, true);
  } finally {
    await server.stop();
  }
});

test('サーバー：知らせの待ちは、同時に受ける窓口の数に数えない', async () => {
  const {server, devices, hub, id, post} = await startServer();
  try {
    devices.setFull(id, true);
    // 6 つの画面が待っていても、窓口は呼べる
    const polls = Array.from({length: 6}, (_, i) => post('pad.poll', {client: `client-${i}xxxxxxx`, wait: 3000}));
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await post('pad.call', {ch: 'state.get', client: C1, frame: 'frame-top1'}), {r: {courses: [1]}});
    hub.push('state.changed', {});
    const out = await Promise.all(polls);
    for (const r of out) assert.equal(r.events[0].ch, 'state.changed');
  } finally {
    await server.stop();
  }
});

test('サーバー：/p/・/m/p/ はパソコンの画面の入口へ。index.html は iPad 用に直して配る', async () => {
  const {server, base} = await startServer();
  try {
    let res = await fetch(`${base}/p/`, {redirect: 'manual'});
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), PAD_INDEX);
    res = await fetch(`${base}${PAD_INDEX}?pane=embed&side=left`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /\/p\/pad\/boot\.js/);
    res = await fetch(`${base}/m/p/`, {redirect: 'manual'});
    assert.equal(res.headers.get('location'), PAD_INDEX);
    res = await fetch(`${base}/m/p/src/renderer/fonts/noto-sans-jp.css`);
    assert.equal(res.status, 200);
    // 変わっていなければ送り直さない（304）
    const etag = res.headers.get('etag');
    assert.ok(etag);
    res = await fetch(`${base}/m/p/src/renderer/fonts/noto-sans-jp.css`, {headers: {'If-None-Match': etag}});
    assert.equal(res.status, 304);
    // 3D モデル（iPad はブラウザで直接読む）
    res = await fetch(`${base}/m/p/src/renderer/assets/stationery/eraser.glb`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'model/gltf-binary');
  } finally {
    await server.stop();
  }
});

test('変わった知らせ：iPad で変えたらほかの画面へ（書いた画面には返さない）。読むだけ・書き込みのたびのものは知らせない', async () => {
  const {pad, hub} = padWith();
  await hub.poll('d1', C1, 0, 0);
  await pad.call({ch: 'folder.create', arg: {mode: 'new', name: 'x'}, client: C1, frame: 'frame-top1'});
  await pad.call({ch: 'state.get', client: C1, frame: 'frame-top1'});
  await pad.call({ch: 'annotation.save', arg: {}, client: C1, frame: 'frame-top1'});
  const r = await hub.poll('d1', C1, 0, 0);
  assert.deepEqual(
    r.events.map((e) => [e.ch, e.skip]),
    [['state.changed', 'frame-top1']]
  );
});

test('PAD_QUIET：名前はパソコンの画面の窓口か iPad だけの窓口（書き間違いがない）', () => {
  const preload = readFileSync(new URL('../src/preload/preload.js', import.meta.url), 'utf8');
  const invoke = preload.slice(preload.indexOf('INVOKE'), preload.indexOf('ON ='));
  const allowed = new Set([...[...invoke.matchAll(/'([a-zA-Z.]+)'/g)].map((m) => m[1]), ...PAD_EXTRA]);
  for (const ch of PAD_QUIET) assert.ok(allowed.has(ch), ch);
});

test('ホーム画面に追加したアプリ：範囲（scope）は / で、iPad の画面（/p/）もアプリの中（Safari のバーを出さない）', () => {
  const m = JSON.parse(readFileSync(new URL('../src/mobile/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(m.scope, '/');
  assert.ok(PAD_INDEX.startsWith(m.scope) && m.start_url.startsWith(m.scope));
  // 範囲が /m/ のままの古いアイコンでも、iPad の画面はアプリの中（/m/ の下に置く）
  assert.ok(PAD_INDEX.startsWith('/m/'));
  assert.equal(m.display, 'standalone');
  // iPad の画面からホーム画面に追加しても、同じアプリになる
  const out = padIndexHtml(readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8'));
  assert.match(out, /<link rel="manifest" href="\/m\/app\/manifest\.webmanifest" \/>/);
});

test('窓口：iPad の書き込みは、ファイルへの上書きをパソコンで次に開いたときに回す（pdf.stale）', async () => {
  const rows = {[ULID]: {id: ULID, name: '第1回.pdf', path: '/x/第1回.pdf', status: 'ok'}};
  const repo = fakeRepo(rows);
  const pad = createPadApi({handlers: new Map(), ctx: {}, repo, hub: createPadHub()});
  const r = await pad.call({ch: 'pdf.markStale', arg: {materialId: ULID}, client: C1, frame: 'frame-top1'});
  assert.deepEqual(r.r, {ok: true, changed: false, name: '第1回.pdf'});
  await pad.call({ch: 'pdf.markStale', arg: {materialId: ULID}, client: C1, frame: 'frame-top1'});
  assert.deepEqual(repo.getSetting('pdf.stale', []), [ULID]);
});

test('触れた面の大きさの記録（pad.touchLog）：ログに残すだけ。数でないものは 0、200 件まで', async () => {
  const lines = [];
  const pad = createPadApi({
    handlers: new Map(),
    ctx: {},
    repo: fakeRepo({}),
    hub: createPadHub(),
    log: (m) => lines.push(m)
  });
  const r = await pad.call({
    ch: 'pad.touchLog',
    arg: {sizes: [24.4, 'x', 130], palm: 1},
    client: C1,
    frame: 'frame-top1'
  });
  assert.deepEqual(r.r, {ok: true});
  assert.deepEqual(lines, ['pad touch: 触れた面の大きさ 24,0,130（手のひら 1 件）']);
  await pad.call({ch: 'pad.touchLog', arg: {sizes: []}, client: C1, frame: 'frame-top1'});
  assert.equal(lines.length, 1); // 空なら残さない
});

test('手のひらの見分け（触れた面の大きさ）：長いほうで見る。値がなければ 0', () => {
  assert.equal(contactSize({width: 120, height: 40}), 120);
  assert.equal(contactSize({width: 1, height: 1}), 1);
  assert.equal(contactSize({}), 0);
  assert.ok(PALM_SIZE > 60, '指（およそ 1〜2cm）を手のひらと取り違えない');
});
