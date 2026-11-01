import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {A4, appendNotePage, cleanLegacy, cleanPaper, createNotePdf, removeLastNotePage} from '../src/main/note-pdf.js';
import {NOTE_TYPES} from '../src/shared/skin.js';
import {normalizeAnnotation} from '../src/shared/annotation.js';

// 1×1 の PNG（上の欄に印刷する画像の代わり）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test('ノートの紙：横罫（基本）と方眼、行の間は 6・7 mm。知らない値は横罫 6 mm', () => {
  assert.deepEqual(cleanPaper({type: 'grid', gap: 7}), {v: 2, type: 'grid', gap: 7});
  assert.deepEqual(cleanPaper({type: 'ruled', gap: 6}), {v: 2, type: 'ruled', gap: 6});
  assert.deepEqual(cleanPaper({type: 'cornell', gap: 8}), {v: 2, type: 'ruled', gap: 6});
  assert.deepEqual(cleanPaper(null), {v: 2, type: 'ruled', gap: 6});
  assert.deepEqual(cleanPaper({type: 'grid', gap: '7'}), {v: 2, type: 'grid', gap: 6}, '数だけ');
});

test('ノート：A4 縦の 1 ページで作り、ページを足すと最後に増える。見た目が同じでも中身（ハッシュ）は毎回ちがう', async () => {
  for (const paper of [
    {type: 'ruled', gap: 6},
    {type: 'ruled', gap: 7},
    {type: 'grid', gap: 6},
    {type: 'grid', gap: 7}
  ]) {
    const d = cleanPaper(paper);
    const bytes = await createNotePdf(d, {title: '経済学原論 第3回 ノート', header: PNG});
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    const {width, height} = doc.getPage(0).getSize();
    assert.ok(Math.abs(width - A4[0]) < 0.01 && Math.abs(height - A4[1]) < 0.01);
    assert.equal(doc.getTitle(), '経済学原論 第3回 ノート');
    const more = await appendNotePage(bytes, d, {header: PNG});
    assert.equal(more.pages, 2);
    assert.equal((await PDFDocument.load(more.bytes)).getPageCount(), 2);
  }
  const a = Buffer.from(await createNotePdf(cleanPaper({})));
  const b = Buffer.from(await createNotePdf(cleanPaper({})));
  assert.notDeepEqual(a, b, '同じ授業に同じ紙のノートを作っても、同じファイルとみなされない');
});

test('前の版のノート（テンプレートの見た目。v のない design）も、同じ見た目でページを足せる', async () => {
  assert.equal(cleanLegacy({type: 'x'}).type, 'ruled');
  for (const type of NOTE_TYPES) {
    const old = await createNotePdf({type});
    const more = await appendNotePage(old, {type});
    assert.equal(more.pages, 2, type);
  }
});

test('最後のページを消す：2 ページ以上のときだけ。1 ページは残す', async () => {
  const one = await createNotePdf(cleanPaper({}));
  await assert.rejects(removeLastNotePage(one), /1 ページは残します/);
  const two = await appendNotePage(one, cleanPaper({}));
  const back = await removeLastNotePage(two.bytes);
  assert.equal(back.pages, 1);
  assert.equal((await PDFDocument.load(back.bytes)).getPageCount(), 1);
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
