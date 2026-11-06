import test from 'node:test';
import assert from 'node:assert/strict';
import {MANABO_URL, cleanUses, features, importFor, isChukyo, isRole} from '../src/shared/profile.js';

test('使う人と使い方から、出す機能を決める', () => {
  assert.ok(isRole('student') && isRole('worker') && !isRole('') && !isRole('toString'));
  // まだ選んでいない人は全部を出す（前の版と同じ）
  assert.deepEqual(features({}), {lms: true, quiz: true, terms: true, foldersFirst: false});
  // manabo とつなぐ（lms）のは中京大学の学生だけ（v0.17.0）
  assert.deepEqual(features({role: 'student', uses: ['lms', 'review'], university: '中京大学'}), {
    lms: true,
    quiz: true,
    terms: true,
    foldersFirst: false
  });
  assert.deepEqual(features({role: 'student', uses: ['lms', 'review'], university: '愛知教育大学'}), {
    lms: false,
    quiz: true,
    terms: true,
    foldersFirst: true
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
    lms: false,
    quiz: true,
    terms: false,
    foldersFirst: true
  });
  assert.ok(isChukyo('中京大学') && isChukyo(' 中京大 ') && isChukyo('中京大学'.normalize('NFKC')));
  assert.ok(!isChukyo('愛知教育大学') && !isChukyo('中京学院大学') && !isChukyo('') && !isChukyo(null));
  // ほかの人の使い方や知らない鍵は外す
  assert.deepEqual(cleanUses('student', ['lms', 'cert', 'lms', 'x']), ['lms']);
  assert.deepEqual(cleanUses('worker', 'cert'), []);
});

test('授業資料の自動取り込みは社会人には出さない。中京大学の manabo のアドレス（v0.17.6）', () => {
  assert.ok(importFor('student') && importFor(null));
  assert.ok(!importFor('worker'));
  assert.equal(new URL(MANABO_URL).hostname, 'manabo.cnc.chukyo-u.ac.jp');
});
