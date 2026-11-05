import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {exportAnnotatedPdf} from '../src/main/pdf-export.js';
import {exportAnnotatedPdfOffThread, asBuffer} from '../src/main/pdf-worker.js';
import {sha256Async} from '../src/main/pdf-save.js';
import {sha256} from '../src/main/sync/files.js';
import {encodePoints} from '../src/shared/ink.js';

// 上書き保存の重い処理はメインのスレッドを止めない（v0.16.30。ペン・筆箱が反応しなくなる不具合）

const pdf = async (pages = 3) => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
};
const inks = (n) =>
  Array.from({length: n}, (_, i) => ({
    id: `a${i}`,
    page: 1 + (i % 3),
    kind: 'ink',
    rect: {x: 50, y: 50, w: 300, h: 300},
    body: encodePoints(Array.from({length: 60}, (_, k) => [60 + k * 4, 100 + i * 3 + Math.sin(k / 4) * 8, 0.5])),
    style: {color: '#222222', width: 1.1, feel: {th: 0.45, ts: 1.2, te: 1.5}}
  }));

test('別のスレッドで作った PDF は、メインで作ったものと同じ。渡した PDF の中身はスレッドへ移る', async () => {
  const src = await pdf();
  const annotations = inks(30);
  const here = asBuffer(await exportAnnotatedPdf(src, annotations));
  const mine = new Uint8Array(src); // 自分だけの中身（移せる）
  const there = await exportAnnotatedPdfOffThread(mine, annotations);
  assert.ok(Buffer.isBuffer(there));
  assert.equal(sha256(there), sha256(here));
  assert.equal(mine.byteLength, 0, '移したので空になる（写していない）');
  // ほかと中身を分け合う Buffer は写して渡す（呼んだ側はそのまま）
  const shared = Buffer.concat([Buffer.alloc(8), src]).subarray(8);
  const again = await exportAnnotatedPdfOffThread(shared, annotations);
  assert.equal(sha256(again), sha256(here));
  assert.equal(shared.byteLength, src.byteLength);
});

test('別のスレッドで作れない PDF は、メインと同じ言葉で失敗する。そのあとも使える', async () => {
  await assert.rejects(exportAnnotatedPdfOffThread(new Uint8Array([1, 2, 3]), inks(1)), /PDF を読めませんでした/);
  const ok = await exportAnnotatedPdfOffThread(new Uint8Array(await pdf()), inks(2));
  assert.ok((await PDFDocument.load(ok)).getPageCount() === 3);
});

test('PDF を作っている間も、メインのスレッドは長く止まらない', async () => {
  const src = await pdf(20);
  const annotations = inks(400);
  let last = performance.now(),
    gap = 0;
  const iv = setInterval(() => {
    const n = performance.now();
    gap = Math.max(gap, n - last);
    last = n;
  }, 2);
  await exportAnnotatedPdfOffThread(new Uint8Array(src), annotations);
  clearInterval(iv);
  assert.ok(gap < 150, `止まった時間 ${gap.toFixed(0)}ms`);
});

test('少しずつ求めた SHA-256 は、まとめて求めたものと同じ', async () => {
  const b = Buffer.alloc(5 * 1024 * 1024 + 123, 7);
  b[100] = 1;
  assert.equal(await sha256Async(b), sha256(b));
  assert.equal(await sha256Async(Buffer.alloc(0)), sha256(Buffer.alloc(0)));
  assert.equal(await sha256Async(b.subarray(10, 20), 3), sha256(b.subarray(10, 20)));
});
