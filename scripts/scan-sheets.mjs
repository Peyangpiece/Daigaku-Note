// スキャン用の Palette ノート紙（B5）の印刷データを作る（docs/SPEC-SCAN.md）。
// 使い方：node scripts/scan-sheets.mjs [出力フォルダ]（既定は dist/scan）
//   palette-scan-b5-all.pdf：全形式を 1 ページずつ（試し刷り用）
//   palette-scan-b5-<形式>.pdf：形式ごと（1 ページ。印刷所にはこれを渡し、50 枚に刷る）
// 紙の絵はアプリと同じ計算（shared/notebooks.js の pageGeometry）で描くので、刷った紙と取り込んだ紙が同じになる。
// 印刷は「実際のサイズ（100%）」で、B5 の用紙に刷る
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {FORMATS, scanDesign} from '../src/shared/notebooks.js';
import {SCAN_FORMAT_IDS} from '../src/shared/scan-code.js';
import {drawNotePage, pageSizePt} from '../src/main/note-pdf.js';

const out = path.resolve(process.argv[2] ?? 'dist/scan');
await mkdir(out, {recursive: true});

const make = async (formats, title) => {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator('パレットノート');
  doc.setProducer('パレットノート');
  for (const f of formats) {
    const d = scanDesign(f);
    drawNotePage(doc.addPage(pageSizePt(d)), d);
  }
  return doc.save();
};

await writeFile(
  path.join(out, 'palette-scan-b5-all.pdf'),
  await make(SCAN_FORMAT_IDS, 'Palette スキャンノート B5（全形式）')
);
for (const f of SCAN_FORMAT_IDS)
  await writeFile(
    path.join(out, `palette-scan-b5-${f}.pdf`),
    await make([f], `Palette スキャンノート B5 ${FORMATS[f].name}`)
  );
console.log(`${SCAN_FORMAT_IDS.length} 形式を ${out} に書き出しました`);
