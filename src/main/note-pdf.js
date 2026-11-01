// 授業の回のノート（SPEC §8.6）：A4 縦の白紙の PDF を作る・ページを足す・最後の白紙のページを消す。
// 紙は、よくある白い紙に青い罫線（v0.14.2。テンプレートの見た目には合わせない）。横罫（基本）と方眼、行の間は 6 mm（B 罫）と 7 mm（A 罫）。
// 上の欄（日付・題）には、授業・回・題・日付を薄い字で印刷する（レンダラが描いた PNG。日本語のフォントを PDF に入れないため）。
// ノートは PDF なので、PDF の編集画面でできること（ペン・マーカー・文字入れ・貼りもの・しおり・書き出し）がそのまま使える。
// v0.14.0〜0.14.1 で作ったノート（テンプレートの見た目。v のない design）は、足すページも前の見た目で描く（drawLegacyPage）
import {PDFDocument, rgb} from 'pdf-lib';
import {NOTE_GAPS, NOTE_TYPES} from '../shared/skin.js';

export const A4 = [595.28, 841.89]; // pt（210 × 297 mm）
const MM = 72 / 25.4;

// ---- 紙（v0.14.2〜） ----
export const NOTE_PAPER = '#ffffff';
export const NOTE_LINE = '#9cc0e6'; // 罫線（よくある学習ノートの青）
export const NOTE_HEAD = '#6f9fd6'; // 題の欄の下の線（少し濃い青）
export const NOTE_TYPES_V2 = ['ruled', 'grid'];
export const NOTE_GAPS_MM = [6, 7];
const HEAD_H = 20; // 上の欄（日付・題）の高さ mm
const FOOT_H = 10; // 下の余白 mm

/** 紙の選び方を整える：{v: 2, type: 'ruled'|'grid', gap: 6|7}（知らない値は横罫 6 mm） */
export function cleanPaper(raw = {}) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {v: 2, type: NOTE_TYPES_V2.includes(d.type) ? d.type : 'ruled', gap: NOTE_GAPS_MM.includes(d.gap) ? d.gap : 6};
}

const color = (hex) =>
  rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);

/** 1 ページを描く。design に v がなければ前の見た目（テンプレート）で描く。header は上の欄に置く画像（PDFImage） */
export function drawNotePage(page, design, header = null) {
  const v2 = design?.v === 2;
  if (!v2) drawLegacyPage(page, design);
  else drawPaper(page, cleanPaper(design));
  if (header) {
    const W = page.getWidth();
    const H = page.getHeight();
    const h = 4.4 * MM; // 字の高さは 3 mm ほど（9 pt くらい）
    // 左の端：方眼は方眼の左の端にそろえる。前の見た目で余白の縦線（25 mm）があれば線の右。ほかは 12 mm
    const old = v2 ? null : cleanLegacy(design);
    const x =
      v2 && cleanPaper(design).type === 'grid'
        ? gridLeft(W, cleanPaper(design).gap * MM)
        : old?.margin && !['cornell', 'plain'].includes(old.type)
          ? 28 * MM
          : 12 * MM;
    const w = Math.min(W - x - 12 * MM, (h * header.width) / header.height);
    page.drawImage(header, {x, y: H - 13 * MM, width: w, height: (w * header.height) / header.width});
  }
}

/** 方眼の左の端（左右を真ん中にそろえる。左右 8 mm ずつ空けた幅に入るだけのます） */
function gridLeft(W, gap) {
  const cols = Math.floor((W - 16 * MM) / gap);
  return (W - cols * gap) / 2;
}

/** 白い紙に青い罫線。横罫は上の欄の下の線から下へ gap ごと、方眼は横・縦とも gap ごと（左右は真ん中にそろえる） */
function drawPaper(page, d) {
  const [W, H] = [page.getWidth(), page.getHeight()];
  page.drawRectangle({x: 0, y: 0, width: W, height: H, color: color(NOTE_PAPER)});
  const line = color(NOTE_LINE);
  const gap = d.gap * MM;
  const top = H - HEAD_H * MM;
  const bottom = FOOT_H * MM;
  const rows = Math.floor((top - bottom) / gap);
  if (d.type === 'grid') {
    const left = gridLeft(W, gap);
    const cols = Math.round((W - 2 * left) / gap);
    for (let i = 1; i <= rows; i++) {
      const y = top - i * gap;
      page.drawLine({start: {x: left, y}, end: {x: left + cols * gap, y}, thickness: 0.4, color: line});
    }
    for (let j = 0; j <= cols; j++) {
      const x = left + j * gap;
      page.drawLine({start: {x, y: top}, end: {x, y: top - rows * gap}, thickness: 0.4, color: line});
    }
    page.drawLine({
      start: {x: left, y: top},
      end: {x: left + cols * gap, y: top},
      thickness: 0.8,
      color: color(NOTE_HEAD)
    });
  } else {
    page.drawLine({start: {x: 0, y: top}, end: {x: W, y: top}, thickness: 0.9, color: color(NOTE_HEAD)});
    for (let i = 1; i <= rows; i++) {
      const y = top - i * gap;
      page.drawLine({start: {x: 0, y}, end: {x: W, y}, thickness: 0.5, color: line});
    }
  }
}

// ---- 前の見た目（v0.14.0〜0.14.1：テンプレートのノート）。足すページをそろえるためだけに残す ----
const NOTE_GAP_MM = {narrow: 6, normal: 7, wide: 8};
const LEGACY_PAPER = '#fbf8f1';
const LEGACY_LINE = '#cfe0ea';
const MARGIN_LINE = '#e88b8b';
const HEX = /^#[0-9a-f]{6}$/i;

export function cleanLegacy(raw = {}) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    type: NOTE_TYPES.includes(d.type) ? d.type : 'ruled',
    paper: HEX.test(d.paper ?? '') ? d.paper.toLowerCase() : LEGACY_PAPER,
    line: HEX.test(d.line ?? '') ? d.line.toLowerCase() : LEGACY_LINE,
    gap: Object.hasOwn(NOTE_GAPS, d.gap) ? d.gap : 'normal',
    margin: typeof d.margin === 'boolean' ? d.margin : true
  };
}

function drawLegacyPage(page, design) {
  const d = cleanLegacy(design);
  const [W, H] = [page.getWidth(), page.getHeight()];
  page.drawRectangle({x: 0, y: 0, width: W, height: H, color: color(d.paper)});
  const line = color(d.line);
  const gap = NOTE_GAP_MM[d.gap] * MM;
  const top = H - 22 * MM;
  const bottom = 12 * MM;
  const summary = d.type === 'cornell' ? 55 * MM : bottom;
  if (['ruled', 'cornell'].includes(d.type))
    page.drawLine({start: {x: 0, y: top}, end: {x: W, y: top}, thickness: 0.9, color: line});
  if (d.type === 'ruled' || d.type === 'cornell') {
    for (let y = top - gap; y >= summary + gap * 0.5; y -= gap)
      page.drawLine({start: {x: 0, y}, end: {x: W, y}, thickness: 0.5, color: line});
  } else if (d.type === 'grid') {
    for (let y = top; y >= bottom; y -= gap)
      page.drawLine({start: {x: 0, y}, end: {x: W, y}, thickness: 0.4, color: line});
    for (let x = gap; x < W; x += gap)
      page.drawLine({
        start: {x, y: top},
        end: {x, y: top - Math.floor((top - bottom) / gap) * gap},
        thickness: 0.4,
        color: line
      });
  } else if (d.type === 'dot' || d.type === 'ring') {
    for (let y = top; y >= bottom; y -= gap)
      for (let x = gap; x < W - gap * 0.5; x += gap)
        if (d.type === 'dot') page.drawCircle({x, y, size: 0.75, color: line});
        else page.drawCircle({x, y, size: 1.2, borderColor: line, borderWidth: 0.5});
  }
  if (d.type === 'cornell') {
    page.drawLine({start: {x: 62 * MM, y: top}, end: {x: 62 * MM, y: summary}, thickness: 0.9, color: line});
    page.drawLine({start: {x: 0, y: summary}, end: {x: W, y: summary}, thickness: 0.9, color: line});
  }
  if (d.margin && d.type !== 'cornell' && d.type !== 'plain')
    page.drawLine({start: {x: 25 * MM, y: H}, end: {x: 25 * MM, y: 0}, thickness: 0.6, color: color(MARGIN_LINE)});
}

// ---- 作る・足す・消す ----
const embed = async (doc, png) => (png?.length ? doc.embedPng(png) : null);

/**
 * 新しいノート（1 ページ）。title は PDF の題。header は上の欄に印刷する PNG（なくてもよい）。
 * 同じ紙のノートでも中身（ハッシュ）が変わるように、作った時刻と乱数をキーワードに入れる（資料はハッシュで同じものを見分けるため）
 */
export async function createNotePdf(paper, {title = 'ノート', header = null, now = new Date()} = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator('大学ノート');
  doc.setProducer('大学ノート');
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  doc.setKeywords([`daigaku-note:${now.toISOString()}:${Math.random().toString(36).slice(2)}`]);
  drawNotePage(doc.addPage(A4), paper, await embed(doc, header));
  return doc.save();
}

/** ノートの最後にページを 1 枚足す（同じ紙・同じ上の欄）。戻り：{bytes, pages} */
export async function appendNotePage(bytes, design, {header = null} = {}) {
  const doc = await PDFDocument.load(bytes);
  drawNotePage(doc.addPage(A4), design, await embed(doc, header));
  doc.setModificationDate(new Date());
  return {bytes: await doc.save(), pages: doc.getPageCount()};
}

/**
 * ノートを同じページ数のまま描き直す（上の欄の字が変わったとき）。ノートの中身は紙と上の欄だけで、書いたものは注釈として別に持つので、
 * 描き直しても書いたものは消えない。題・キーワード・作った日時は前のものを引き継ぐ。戻り：{bytes, pages}
 */
export async function rebuildNotePdf(bytes, design, {header = null} = {}) {
  const old = await PDFDocument.load(bytes, {updateMetadata: false});
  const n = old.getPageCount();
  const doc = await PDFDocument.create({updateMetadata: false});
  doc.setTitle(old.getTitle() ?? 'ノート');
  doc.setCreator('大学ノート');
  doc.setProducer('大学ノート');
  if (old.getCreationDate()) doc.setCreationDate(old.getCreationDate());
  doc.setModificationDate(new Date());
  doc.setKeywords([old.getKeywords() ?? `daigaku-note:${Math.random().toString(36).slice(2)}`]);
  const img = await embed(doc, header);
  for (let i = 0; i < n; i++) drawNotePage(doc.addPage(A4), design, img);
  return {bytes: await doc.save(), pages: n};
}

/** ノートの最後のページを消す（2 ページ以上のとき）。戻り：{bytes, pages} */
export async function removeLastNotePage(bytes) {
  const doc = await PDFDocument.load(bytes);
  const n = doc.getPageCount();
  if (n < 2) throw new Error('ノートには 1 ページは残します');
  doc.removePage(n - 1);
  doc.setModificationDate(new Date());
  return {bytes: await doc.save(), pages: doc.getPageCount()};
}
