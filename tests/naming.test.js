import test from 'node:test';
import assert from 'node:assert/strict';
import {
  courseFolderName,
  parseNumbered,
  roundFolderName,
  sanitizeFileName,
  sanitizeSegment,
  truncateCodePoints,
  uniqueName
} from '../src/shared/naming.js';

test('使えない文字・空白・末尾のピリオドと空白を整える', () => {
  assert.equal(sanitizeSegment('原価/企画: 第3回?'), '原価_企画_ 第3回_');
  assert.equal(sanitizeSegment('  a　　b   c  '), 'a b c');
  assert.equal(sanitizeSegment('名前. '), '名前_', '末尾の空白はトリム、ピリオドは _');
  assert.equal(sanitizeSegment('名前..'), '名前__');
  assert.equal(sanitizeSegment('tab\tnew\nline'), 'tab new line');
  assert.equal(sanitizeSegment('ctl\u0001x'), 'ctl_x');
});

test('Windows の予約名を避ける', () => {
  assert.equal(sanitizeSegment('CON'), 'CON_');
  assert.equal(sanitizeSegment('com1.pdf'), 'com1.pdf_');
  assert.equal(sanitizeSegment('CONSOLE'), 'CONSOLE');
});

test('40 文字で切り、絵文字の途中では切らない', () => {
  assert.equal(truncateCodePoints('あ'.repeat(50), 40), 'あ'.repeat(40));
  // 👨‍👩‍👧 は 5 コードポイントの 1 書記素。39 文字のあとに置くと 44 になるので丸ごと落ちる
  const s = 'a'.repeat(39) + '👨‍👩‍👧' + 'b';
  assert.equal(truncateCodePoints(s, 40), 'a'.repeat(39));
  assert.equal([...truncateCodePoints('x'.repeat(10) + '🎉'.repeat(40), 40)].length, 40);
});

test('回フォルダ名：ゼロ埋め・タイトル・その他・衝突', () => {
  assert.equal(roundFolderName(2, '原価企画'), '第02回_原価企画');
  assert.equal(roundFolderName(3, ''), '第03回');
  assert.equal(roundFolderName(0, '何か'), 'その他');
  assert.equal(roundFolderName(12, 'A/B'), '第12回_A_B');
  assert.equal(roundFolderName(1, 'あ'.repeat(60)), '第01回_' + 'あ'.repeat(40));
  assert.equal(roundFolderName(4, '同名', ['第04回_同名']), '第04回_同名 (2)');
  assert.equal(roundFolderName(4, '同名', ['第04回_同名', '第04回_同名 (2)']), '第04回_同名 (3)');
});

test('授業フォルダ名・ファイル名', () => {
  assert.equal(courseFolderName('管理会計Ⅱ'), '管理会計Ⅱ');
  assert.equal(courseFolderName('  '), '授業');
  assert.equal(sanitizeFileName('第3回 原価企画.pdf'), '第3回 原価企画.pdf');
  assert.equal(sanitizeFileName('../evil/na:me.PDF'), 'na_me.PDF');
  assert.equal(sanitizeFileName('.pdf'), 'file.pdf');
  assert.equal(sanitizeFileName(''), 'file');
});

test('同名の番号付け', () => {
  const taken = new Set(['a.pdf', 'a (2).pdf']);
  assert.equal(uniqueName('a.pdf', (n) => taken.has(n)), 'a (3).pdf');
  assert.equal(uniqueName('b.pdf', (n) => taken.has(n)), 'b.pdf');
  assert.equal(uniqueName('noext', (n) => n === 'noext'), 'noext (2)');
  assert.deepEqual(parseNumbered('a (2).pdf'), {base: 'a.pdf', n: 2});
  assert.equal(parseNumbered('a.pdf'), null);
});
