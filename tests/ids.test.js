import test from 'node:test';
import assert from 'node:assert/strict';
import {hash32, isUlid, tapeAngle, ulid} from '../src/shared/ids.js';

test('ULID の形と時刻順', () => {
  const a = ulid(1_000_000);
  const b = ulid(2_000_000);
  assert.ok(isUlid(a) && isUlid(b));
  assert.ok(a < b);
  assert.notEqual(ulid(), ulid());
});

test('ハッシュは安定し、テープの角度は −6〜6', () => {
  assert.equal(hash32('管理会計Ⅱ'), hash32('管理会計Ⅱ'));
  assert.notEqual(hash32('a'), hash32('b'));
  for (const s of ['a', 'b', '管理会計Ⅱ', '01HX']) {
    const d = tapeAngle(s);
    assert.ok(d >= -6 && d <= 6, String(d));
  }
});
