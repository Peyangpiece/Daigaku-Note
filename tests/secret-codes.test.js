// シークレットコード（src/shared/secret-codes.js・shared/points.js の redeemCode）：管理者が配ったコードでポイントをもらう
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CODES, findCode, hashCode, normalizeCode} from '../src/shared/secret-codes.js';
import {pointsState, redeemCode} from '../src/shared/points.js';

test('コードの表：印は 64 文字の 16 進・id と塩は重ならない・ポイントは正の整数。コードそのものはリポジトリに書かない', () => {
  assert.ok(CODES.length >= 1);
  assert.equal(new Set(CODES.map((c) => c.id)).size, CODES.length);
  assert.equal(new Set(CODES.map((c) => c.salt)).size, CODES.length);
  for (const c of CODES) {
    assert.match(c.id, /^[a-z0-9-]{2,40}$/);
    assert.match(c.salt, /^[0-9a-f]{16}$/);
    assert.match(c.hash, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(c.amount) && c.amount > 0);
    assert.ok(c.until === null || /^\d{4}-\d{2}-\d{2}$/.test(c.until));
  }
  // 最初のコードは 10,000 pt
  assert.equal(CODES.find((c) => c.id === 'launch-10000')?.amount, 10000);
  // 配る形（PN-XXXX-XXXX-XXXX）の文字列を、ソースに書いていない
  const src = readFileSync(new URL('../src/shared/secret-codes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /PN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
});

test('コードの照合：全角・小文字・空白・ハイフンの違いは見ない。違うコード・短すぎるものは null', () => {
  const codes = [
    {id: 't', salt: '00112233aabbccdd', hash: hashCode('PN-TEST-ABCD-2345', '00112233aabbccdd'), amount: 5}
  ];
  assert.equal(normalizeCode(' pn－test abcd_2345 '), 'PNTESTABCD2345');
  for (const s of ['PN-TEST-ABCD-2345', 'pn test abcd 2345', 'ＰＮ－ＴＥＳＴ－ＡＢＣＤ－２３４５'])
    assert.equal(findCode(s, codes)?.id, 't', s);
  assert.equal(findCode('PN-TEST-ABCD-2346', codes), null);
  assert.equal(findCode('PN', codes), null);
  assert.equal(findCode('', codes), null);
});

test('ポイントをもらう：残高に足し履歴に残す。同じコードは 2 回目を断る。期限の過ぎたものも断る（状態は変えない）', () => {
  const now = new Date('2026-11-19T10:00:00');
  const entry = {id: 'launch-10000', amount: 10000, label: 'はじめてのシークレットコード', until: null};
  const r = redeemCode({balance: 30}, entry, {now});
  assert.equal(r.gained, 10000);
  assert.equal(r.points.balance, 10030);
  assert.deepEqual(r.points.redeemed, ['launch-10000']);
  assert.equal(r.points.history[0].kind, 'code');
  assert.equal(r.points.history[0].note, 'はじめてのシークレットコード');
  // 保存して読み直しても、使ったことを覚えている
  const saved = pointsState(JSON.parse(JSON.stringify(r.points)));
  assert.deepEqual(saved.redeemed, ['launch-10000']);
  assert.throws(() => redeemCode(saved, entry, {now}), /使用済み/);
  assert.throws(() => redeemCode({}, {...entry, id: 'old', until: '2026-11-18'}, {now}), /期限/);
  assert.equal(
    redeemCode({}, {...entry, id: 'today', until: '2026-11-19'}, {now}).gained,
    10000,
    '最後の日はまだ使える'
  );
  assert.throws(() => redeemCode({}, null, {now}), /コードが違います/);
});
