import test from 'node:test';
import assert from 'node:assert/strict';
import {createScanRelay} from '../src/main/scan-relay.js';
import {createMobileApi} from '../src/main/mobile/api.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);

/** 取り込みの窓のふり：送られた写真を覚え、answer で読んだ結果を返す */
function fakeFrame(relay) {
  const got = [];
  return {
    got,
    send: (ch, payload) => got.push([ch, payload]),
    answer: (i, result) => relay.reply(got[i][1].photoId, result)
  };
}

test('スマホで撮る：窓が開いているあいだだけ受け、窓が読み終えた結果をスマホに返す', async () => {
  const relay = createScanRelay();
  assert.equal(relay.current(), null);
  assert.deepEqual(await relay.deliver('x', JPEG), {
    ok: false,
    message: 'パソコンで「アナログノート…」の窓が開いていません'
  });
  const frame = fakeFrame(relay);
  const id = relay.open(frame, '経済学原論 第3回');
  assert.deepEqual(relay.current(), {id, label: '経済学原論 第3回'});
  const p = relay.deliver(id, JPEG);
  assert.equal(frame.got.length, 1);
  assert.equal(frame.got[0][0], 'scan.photo');
  assert.equal(frame.got[0][1].id, id);
  assert.equal(frame.got[0][1].bytes, JPEG);
  frame.answer(0, {ok: true, message: '横罫 A（7 mm）を読みました', pages: 2});
  assert.deepEqual(await p, {ok: true, message: '横罫 A（7 mm）を読みました', pages: 2});
  // 窓を閉じると、待っている写真は打ち切り、もう受けない
  const q = relay.deliver(id, JPEG);
  relay.close(id);
  assert.equal((await q).ok, false);
  assert.equal(relay.current(), null);
});

test('スマホで撮る：窓が答えなければ時間切れ。開き直すと前の窓の分は打ち切る', async () => {
  const relay = createScanRelay({timeoutMs: 20});
  const id = relay.open(fakeFrame(relay), 'ノート');
  const r = await relay.deliver(id, JPEG);
  assert.equal(r.ok, false);
  assert.match(r.message, /答えがありません/);
  const p = relay.deliver(id, JPEG);
  const id2 = relay.open(fakeFrame(relay), 'ノート');
  assert.notEqual(id2, id);
  assert.match((await p).message, /開き直されました/);
});

test('スマホで撮る：撮る画面から見に来ているあいだだけ「スマホとつながっています」', () => {
  let t = 1000;
  const relay = createScanRelay({now: () => t});
  const id = relay.open(fakeFrame(relay), 'ノート');
  assert.equal(relay.phoneSeen(id), false);
  relay.current(); // ホームなどから見に来ただけ
  assert.equal(relay.phoneSeen(id), false);
  relay.current({watching: true});
  assert.equal(relay.phoneSeen(id), true);
  t += 7000; // 撮る画面を閉じた
  assert.equal(relay.phoneSeen(id), false);
  assert.equal(relay.phoneSeen('other'), false);
});

test('窓口：スマホからはアナログノートの写真（JPEG・PNG・WebP）だけを、開いている窓へ送れる', async () => {
  const relay = createScanRelay();
  const api = createMobileApi({handlers: new Map(), repo: {}, scan: relay});
  assert.deepEqual(await api['scan.waiting'](), {session: null});
  const frame = fakeFrame(relay);
  const id = relay.open(frame, '統計学 第1回');
  assert.deepEqual(await api['scan.waiting'](), {session: {id, label: '統計学 第1回'}});
  await assert.rejects(api['scan.send']({id, data: new Uint8Array(20)}), /JPEG・PNG・WebP/);
  await assert.rejects(api['scan.send']({id: 'x', data: JPEG}), /ID が不正/);
  const p = api['scan.send']({id, data: JPEG});
  await new Promise((r) => setImmediate(r));
  frame.answer(0, {ok: false, message: '四隅の目印が見つかりませんでした'});
  assert.deepEqual(await p, {ok: false, message: '四隅の目印が見つかりませんでした', pages: 0});
});
