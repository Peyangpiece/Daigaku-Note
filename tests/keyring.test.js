// 合言葉で包んだ鍵（src/shared/keyring.js。docs/SYNC.md §9）：同じ合言葉で同じ鍵を開く・違えば開かない・ドライブに鍵は置かない
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYRING,
  keyringBytes,
  makeKeyring,
  openKeyring,
  passphraseProblem,
  readKeyringBytes
} from '../src/shared/keyring.js';
import {newMasterKey, fingerprint} from '../src/main/cloud/keys.js';

const FAST = {N: 2 ** 10, r: 8, p: 1}; // テストは軽く（形は同じ）

test('合言葉：同じ合言葉で同じ鍵を開く（前後の空白・全角半角の違いはそろえる）。違う合言葉では開かない', async () => {
  const master = newMasterKey();
  const ring = await makeKeyring(master, 'ＰａｌｅｔｔｅＮｏｔｅ', {params: FAST, device: 'iPad'});
  assert.equal(ring.fp, fingerprint(master));
  assert.equal(ring.device, 'iPad');
  assert.deepEqual(await openKeyring(ring, '  PaletteNote '), master);
  await assert.rejects(openKeyring(ring, 'PaletteNotes'), /合言葉が違います/);
  // ドライブに置くもの：鍵そのものは入っていない・文字にして戻せる
  const bytes = keyringBytes(ring);
  assert.ok(!Buffer.from(bytes).toString().includes(Buffer.from(master).toString('base64')));
  assert.deepEqual(readKeyringBytes(bytes), ring);
  assert.equal(KEYRING, 'keyring');
});

test('合言葉：短い・長すぎるものは断る。書き換えた鍵・知らない形は開かない', async () => {
  assert.match(passphraseProblem('short'), /8 文字以上/);
  assert.match(passphraseProblem('x'.repeat(201)), /長すぎ/);
  assert.equal(passphraseProblem('ちょうどよいあいことば'), null);
  await assert.rejects(makeKeyring(newMasterKey(), 'short', {params: FAST}), /8 文字以上/);
  const ring = await makeKeyring(newMasterKey(), 'ながいあいことば', {params: FAST});
  await assert.rejects(openKeyring({...ring, fp: 'ABCDEF12'}, 'ながいあいことば'), /壊れています/);
  await assert.rejects(openKeyring({...ring, v: 99}, 'ながいあいことば'), /形が違います/);
  await assert.rejects(openKeyring({...ring, kdf: {...ring.kdf, N: 2 ** 30}}, 'ながいあいことば'), /形が違います/);
});
