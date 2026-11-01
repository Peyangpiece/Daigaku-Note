import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {A4, appendNotePage, cleanDesign, createNotePdf, DEFAULT_LINE, DEFAULT_PAPER} from '../src/main/note-pdf.js';
import {NOTE_TYPES} from '../src/shared/skin.js';
import {normalizeAnnotation} from '../src/shared/annotation.js';

test('ノートの見た目：テンプレートの note をそのまま使い、はじめの色（default）や知らない値ははじめの値にする', () => {
  assert.deepEqual(cleanDesign({type: 'grid', paper: '#F4FBF7', line: '#cde9db', gap: 'wide', margin: false}), {
    type: 'grid',
    paper: '#f4fbf7',
    line: '#cde9db',
    gap: 'wide',
    margin: false
  });
  assert.deepEqual(cleanDesign({type: 'x', paper: 'default', line: 'default', gap: '?'}), {
    type: 'ruled',
    paper: DEFAULT_PAPER,
    line: DEFAULT_LINE,
    gap: 'normal',
    margin: true
  });
});

test('ノート：A4 縦の 1 ページで作り、ページを足すと最後に増える。見た目が同じでも中身（ハッシュ）は毎回ちがう', async () => {
  for (const type of NOTE_TYPES) {
    const bytes = await createNotePdf({type}, {title: '経済学原論 第3回 ノート'});
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1, type);
    const {width, height} = doc.getPage(0).getSize();
    assert.ok(Math.abs(width - A4[0]) < 0.01 && Math.abs(height - A4[1]) < 0.01, type);
    assert.equal(doc.getTitle(), '経済学原論 第3回 ノート');
    const more = await appendNotePage(bytes, {type});
    assert.equal(more.pages, 2, type);
    assert.equal((await PDFDocument.load(more.bytes)).getPageCount(), 2, type);
  }
  const a = Buffer.from(await createNotePdf({type: 'ruled'}));
  const b = Buffer.from(await createNotePdf({type: 'ruled'}));
  assert.notDeepEqual(a, b, '同じ授業に同じ見た目のノートを作っても、同じファイルとみなされない');
});

test('写真の貼りもの：style.ref は写真の SHA-256 だけ', () => {
  const ref = 'a'.repeat(64);
  const row = normalizeAnnotation({
    page: 1,
    kind: 'stamp',
    rect: {x: 10, y: 10, w: 120, h: 90},
    style: {type: 'photo', ref}
  });
  assert.deepEqual(JSON.parse(row.style_json), {type: 'photo', ref});
  assert.throws(() =>
    normalizeAnnotation({
      page: 1,
      kind: 'stamp',
      rect: {x: 10, y: 10, w: 120, h: 90},
      style: {type: 'photo', ref: '../x'}
    })
  );
});
