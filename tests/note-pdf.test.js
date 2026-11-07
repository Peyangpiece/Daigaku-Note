import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFArray, PDFDocument, decodePDFRawStream} from 'pdf-lib';
import {
  A4,
  appendNotePage,
  cleanLegacy,
  cleanPaper,
  createNotePdf,
  rebuildNotePdf,
  removeLastNotePage
} from '../src/main/note-pdf.js';
import {NOTE_TYPES} from '../src/shared/skin.js';
import {normalizeAnnotation} from '../src/shared/annotation.js';
import {createSerial} from '../src/main/serial.js';

// 1×1 の PNG（上の欄に印刷する画像の代わり）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test('ノートの紙：横罫（基本）と方眼、行の間は 6・7 mm。知らない値は横罫 6 mm', () => {
  assert.deepEqual(cleanPaper({type: 'grid', gap: 7}), {v: 2, type: 'grid', gap: 7, line: 'gray'});
  assert.deepEqual(cleanPaper({type: 'ruled', gap: 6}), {v: 2, type: 'ruled', gap: 6, line: 'gray'});
  assert.deepEqual(cleanPaper({type: 'cornell', gap: 8}), {v: 2, type: 'ruled', gap: 6, line: 'gray'});
  assert.deepEqual(cleanPaper(null), {v: 2, type: 'ruled', gap: 6, line: 'gray'});
  assert.deepEqual(cleanPaper({type: 'grid', gap: '7'}), {v: 2, type: 'grid', gap: 6, line: 'gray'}, '数だけ');
  assert.equal(cleanPaper({line: 'blue'}).line, 'blue');
  assert.equal(cleanPaper({line: 'red'}).line, 'gray', '知らない色は灰色');
});

test('ノートの線の色：新しいノートは灰色。前の版のノート（線の色を覚えていない v2）は、足すページも青のまま（v0.17.10）', async () => {
  const strokes = async (bytes, i) => {
    const doc = await PDFDocument.load(bytes);
    const c = doc.getPage(i).node.Contents();
    const list = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
    return list.map((x) => Buffer.from(decodePDFRawStream(x).decode()).toString('latin1')).join('\n');
  };
  const gray = await createNotePdf(cleanPaper({}));
  const g = await strokes(gray, 0);
  assert.match(g, /0\.788\d* 0\.811\d* 0\.839\d* RG/, '灰色 #c9cfd6');
  const old = {v: 2, type: 'ruled', gap: 6}; // 0.17.9 までに作ったノートの覚え方
  const blueDoc = await createNotePdf(old);
  const more = await appendNotePage(blueDoc, old);
  const b = await strokes(more.bytes, 1);
  assert.match(b, /0\.611\d* 0\.752\d* 0\.901\d* RG/, '足したページも青 #9cc0e6');
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

test('描き直し：同じページ数・同じ題のまま、中身（ハッシュ）は変わる', async () => {
  const d = cleanPaper({type: 'grid', gap: 7});
  const one = await createNotePdf(d, {title: '経済学原論 第3回 ノート', header: PNG});
  const two = await appendNotePage(one, d, {header: PNG});
  const re = await rebuildNotePdf(two.bytes, d, {header: PNG});
  assert.equal(re.pages, 2);
  const doc = await PDFDocument.load(re.bytes);
  assert.equal(doc.getPageCount(), 2);
  assert.equal(doc.getTitle(), '経済学原論 第3回 ノート');
  assert.notDeepEqual(Buffer.from(re.bytes), Buffer.from(two.bytes));
});

test('順番待ち：同じ鍵は 1 つずつ（前が失敗しても次は動く）、別の鍵は待たない', async () => {
  const serial = createSerial();
  const log = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const a = serial('n1', async () => {
    log.push('a+');
    await wait(30);
    log.push('a-');
    throw new Error('x');
  });
  const b = serial('n1', async () => {
    log.push('b+');
    await wait(5);
    log.push('b-');
    return 2;
  });
  const c = serial('n2', async () => {
    log.push('c');
    return 3;
  });
  await assert.rejects(a, /x/);
  assert.equal(await b, 2);
  assert.equal(await c, 3);
  assert.deepEqual(log, ['a+', 'c', 'a-', 'b+', 'b-']);
});

test('v3 の紙（持ち物のノート・マイノート）：整え方はそのまま、どの形式でも PDF を作ってページを足せる', async () => {
  const {FORMATS} = await import('../src/shared/notebooks.js');
  const d = cleanPaper({v: 3, format: 'grid5', gap: 4.5, line: '#9cc0e6', head: 'date'});
  assert.equal(d.v, 3);
  assert.equal(d.format, 'grid5');
  assert.equal(d.gap, 5, '方眼 5 mm の幅は変えられない');
  assert.equal(d.line, '#9cc0e6');
  assert.equal(cleanPaper({type: 'grid', gap: 7}).v, 2, 'v のない選び方は今までどおり v2');
  for (const format of Object.keys(FORMATS)) {
    const bytes = await createNotePdf({v: 3, format, head: 'double', margin: true});
    const {bytes: more, pages} = await appendNotePage(bytes, {v: 3, format});
    assert.equal(pages, 2, format);
    assert.ok(more.length > bytes.length);
  }
});

test('原稿用紙（v3）のノートは A4 横で作り、足すページも横', async () => {
  const paper = cleanPaper({v: 3, format: 'genkou'});
  const bytes = await createNotePdf(paper);
  const {bytes: two} = await appendNotePage(bytes, paper);
  const doc = await PDFDocument.load(two);
  for (const p of doc.getPages()) {
    const {width, height} = p.getSize();
    assert.ok(Math.abs(width - A4[1]) < 0.01 && Math.abs(height - A4[0]) < 0.01);
  }
});
