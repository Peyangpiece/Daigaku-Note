import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanUses, features, isRole} from '../src/shared/profile.js';

test('使う人と使い方から、出す機能を決める', () => {
  assert.ok(isRole('student') && isRole('worker') && !isRole('') && !isRole('toString'));
  // まだ選んでいない人は全部を出す（前の版と同じ）
  assert.deepEqual(features({}), {lms: true, quiz: true, terms: true, foldersFirst: false});
  assert.deepEqual(features({role: 'student', uses: ['lms', 'review']}), {
    lms: true,
    quiz: true,
    terms: true,
    foldersFirst: false
  });
  assert.deepEqual(features({role: 'student', uses: ['files']}), {
    lms: false,
    quiz: false,
    terms: true,
    foldersFirst: true
  });
  // 社会人は学期を使わず、自分のフォルダが先
  assert.deepEqual(features({role: 'worker', uses: ['work']}), {
    lms: false,
    quiz: false,
    terms: false,
    foldersFirst: true
  });
  assert.deepEqual(features({role: 'worker', uses: ['cert', 'course']}), {
    lms: true,
    quiz: true,
    terms: false,
    foldersFirst: true
  });
  // ほかの人の使い方や知らない鍵は外す
  assert.deepEqual(cleanUses('student', ['lms', 'cert', 'lms', 'x']), ['lms']);
  assert.deepEqual(cleanUses('worker', 'cert'), []);
});
