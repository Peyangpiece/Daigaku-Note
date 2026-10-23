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

test('回転したページの文字入れの画像は、画面と同じ向きになる位置と角度で置く', async () => {
  const {uprightImage} = await import('../src/main/pdf-export.js');
  const r = {x: 10, y: 20, w: 30, h: 40};
  assert.deepEqual(uprightImage(0, r), {x: 10, y: 20, width: 30, height: 40});
  const r90 = uprightImage(90, r);
  // 反時計回りに 90 度：画像の幅は +y の向き（20〜60）、高さは −x の向き（40〜10）に伸びる
  assert.deepEqual([r90.x, r90.y, r90.width, r90.height, r90.rotate.angle], [40, 20, 40, 30, 90]);
  const r180 = uprightImage(180, r);
  assert.deepEqual([r180.x, r180.y, r180.width, r180.height, r180.rotate.angle], [40, 60, 30, 40, 180]);
  const r270 = uprightImage(-90, r);
  assert.deepEqual([r270.x, r270.y, r270.width, r270.height, r270.rotate.angle], [10, 60, 40, 30, 270]);
});

test('書き出し：ボールペンの線は塗りつぶした図形、マーカーは乗算の四角、文字隠しは選んだ色', async () => {
  const {encodePoints} = await import('../src/shared/ink.js');
  const body = encodePoints(Array.from({length: 10}, (_, i) => [100 + i * 3, 500, 0.5]));
  const list = [
    {id: 'I1', page: 1, kind: 'ink', rect: {x: 99, y: 499, w: 30, h: 2}, body, style: {color: '#d93025', width: 1.1}},
    {
      id: 'L1',
      page: 1,
      kind: 'line',
      rect: {x: 72, y: 300, w: 80, h: 2.5},
      body: '',
      style: {color: '#ff9ec7', width: 2.5}
    },
    {id: 'M2', page: 1, kind: 'mask', rect: {x: 72, y: 200, w: 80, h: 12}, body: '', style: {color: '#00c98d'}}
  ];
  const out = await exportAnnotatedPdf(await source(1), list);
  const p1 = await contentOf(out, 0);
  assert.match(p1.text, /0\.8509\d* 0\.1882\d* 0\.1450\d* rg/); // #d93025 の線
  assert.match(p1.text, /1 0 0 -1 0 0 cm/); // 上下を返して PDF の座標そのままに描く
  assert.match(p1.text, /101\.5 -500\.\d+ m\n/); // 線の始まり（y は上下を返した値）
  assert.match(p1.text, / -500\.\d+ v\n/); // 曲線でつなぐ
  assert.match(p1.text, /\nf\n/); // 塗りつぶし
  assert.match(p1.text, /1 0\.6196\d* 0\.7803\d* rg/); // #ff9ec7 のマーカー
  assert.match(p1.text, /0 0\.7882\d* 0\.5529\d* rg/); // #00c98d の文字隠し
});

test('書き出し：メモの手書きは、アイコンの右にスタンプ注釈として入る（線を塗りつぶした見た目）', async () => {
  const {encodePoints} = await import('../src/shared/ink.js');
  const ink = [
    {p: encodePoints(Array.from({length: 8}, (_, i) => [10 + i * 10, 20 + (i % 2) * 6, 0.5])), c: '#d93025', w: 1.1},
    {
      p: encodePoints([
        [20, 60, 0.5],
        [60, 62, 0.5],
        [90, 58, 0.5]
      ]),
      c: '#2b2b2b',
      w: 0.8,
      pressure: false
    }
  ];
  const list = [
    {
      id: 'N2',
      page: 1,
      kind: 'note',
      rect: {x: 300, y: 400, w: 20, h: 20},
      body: '本文',
      style: {color: '#8ab4f8', w: 320, h: 260, ink}
    }
  ];
  const out = await exportAnnotatedPdf(await source(1), list);
  const p1 = await contentOf(out, 0);
  const annots = p1.page.node
    .Annots()
    .asArray()
    .map((r) => p1.doc.context.lookup(r));
  assert.deepEqual(
    annots.map((d) => d.get(PDFName.of('Subtype')).toString()),
    ['/Text', '/Stamp']
  );
  const rect = annots[1]
    .lookup(PDFName.of('Rect'))
    .asArray()
    .map((n) => n.asNumber());
  assert.equal(rect[0], 324, 'アイコンの右（4pt あけて）');
  assert.ok(rect[3] <= 420 && rect[1] < rect[3], '上端はアイコンの上端にそろえる');
  const ap = annots[1].lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
  const raw = Buffer.from(ap.getContents?.() ?? ap.contents ?? []);
  const text = (ap.dict.has(PDFName.of('Filter')) ? inflateSync(raw) : raw).toString('latin1');
  assert.match(text, /0\.8509\d* 0\.1882\d* 0\.1450\d* rg/, '赤い線');
  assert.match(text, /0\.75 0 0 0\.75 0 0 cm|0\.75 0 0 -0\.75/, 'px を pt に縮める');
  assert.match(text, /\nf\n/, '塗りつぶし');
  assert.equal(annots[1].lookup(PDFName.of('Contents'), PDFHexString).decodeText(), 'メモの手書き');
  // notes: false なら、メモも手書きも入れない
  const none = await exportAnnotatedPdf(await source(1), list, {notes: false});
  const q = await contentOf(none, 0);
  assert.equal(q.page.node.Annots()?.asArray().length ?? 0, 0);
});
