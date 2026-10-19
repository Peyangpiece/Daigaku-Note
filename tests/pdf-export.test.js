import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument, PDFName, PDFArray, PDFDict, PDFHexString} from 'pdf-lib';
import {inflateSync} from 'node:zlib';
import {exportAnnotatedPdf, isPng} from '../src/main/pdf-export.js';

// 2×1 の赤い PNG
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DwnwEIAA/rAv7Ik6rCAAAAAElFTkSuQmCC',
    'base64'
  )
);

async function source(pages = 2) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return doc.save();
}
const contentOf = async (bytes, n) => {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[n];
  const streams = page.node.normalizedEntries().Contents;
  const list = !streams ? [] : streams instanceof PDFArray ? streams.asArray() : [streams];
  return {
    doc,
    page,
    text: list
      .map((ref) => doc.context.lookup(ref))
      .map((s) => {
        const raw = Buffer.from(s.getContents?.() ?? s.contents ?? []);
        return (s.dict.has(PDFName.of('Filter')) ? inflateSync(raw) : raw).toString('latin1');
      })
      .join('\n')
  };
};

const annos = [
  {id: 'M1', page: 1, kind: 'mask', rect: {x: 72, y: 700, w: 100, h: 14}, body: '隠す語', style: {}},
  {
    id: 'T1',
    page: 1,
    kind: 'text',
    rect: {x: 72, y: 600, w: 50, h: 20},
    body: '文字',
    style: {size: 12, bold: false, color: '#2b2b2b'}
  },
  {id: 'N1', page: 2, kind: 'note', rect: {x: 300, y: 400, w: 20, h: 20}, body: '試験に出る', style: {color: '#8ab4f8'}}
];

test('isPng は PNG の先頭だけを通す', () => {
  assert.ok(isPng(PNG));
  assert.ok(!isPng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])));
  assert.ok(!isPng('png'));
});

test('書き出し：マーカーは水色の乗算、文字入れは画像、付箋はテキスト注釈。元の PDF は変えない', async () => {
  const src = await source();
  const before = Buffer.from(src).toString('base64');
  const out = await exportAnnotatedPdf(src, annos, {images: new Map([['T1', PNG]])});
  assert.equal(Buffer.from(src).toString('base64'), before);

  const p1 = await contentOf(out, 0);
  assert.match(p1.text, /0 0\.8235\d* 1 rg/); // #00d2ff
  assert.match(p1.text, /72 700 cm/);
  assert.match(p1.text, /100 14 l\n100 0 l/);
  assert.match(p1.text, /\/GS-?\w*\s+gs/); // 乗算の ExtGState
  const gs = p1.page.node.Resources().lookup(PDFName.of('ExtGState'), PDFDict);
  const modes = gs.values().map((ref) => p1.doc.context.lookup(ref).get(PDFName.of('BM'))?.toString());
  assert.ok(modes.includes('/Multiply'));
  assert.match(p1.text, /Do/); // 文字入れの画像

  const p2 = await contentOf(out, 1);
  const annots = p2.page.node
    .Annots()
    .asArray()
    .map((r) => p2.doc.context.lookup(r));
  assert.equal(annots.length, 1);
  assert.equal(annots[0].get(PDFName.of('Subtype')).toString(), '/Text');
  assert.equal(annots[0].lookup(PDFName.of('Contents'), PDFHexString).decodeText(), '試験に出る');
});

test('書き出し：黒く塗る・付箋を入れないを選べる。画像のない文字入れは飛ばす', async () => {
  const out = await exportAnnotatedPdf(await source(), annos, {markers: 'black', notes: false});
  const p1 = await contentOf(out, 0);
  assert.match(p1.text, /0 0 0 rg/);
  assert.doesNotMatch(p1.text, /Do/);
  const p2 = await contentOf(out, 1);
  assert.equal(p2.page.node.Annots()?.size() ?? 0, 0);
});

test('書き出し：読めない PDF はわかる言葉で失敗する', async () => {
  await assert.rejects(() => exportAnnotatedPdf(new Uint8Array([1, 2, 3]), []), /PDF を読めませんでした/);
});
