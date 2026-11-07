// 授業の回のノート（SPEC §8.6）：A4 縦の白紙の PDF を作る・ページを足す・最後の白紙のページを消す。
// 紙は、白い紙に灰色の罫線（v0.17.10。前は青。テンプレートの見た目には合わせない）。横罫（基本）と方眼、行の間は 6 mm（B 罫）と 7 mm（A 罫）。
// 上の欄（日付・題）には、授業・回・題・日付を薄い字で印刷する（レンダラが描いた PNG。日本語のフォントを PDF に入れないため）。
// ノートは PDF なので、PDF の編集画面でできること（ペン・マーカー・文字入れ・貼りもの・しおり・書き出し）がそのまま使える。
// v0.14.0〜0.14.1 で作ったノート（テンプレートの見た目。v のない design）は、足すページも前の見た目で描く（drawLegacyPage）
import {PDFDocument, rgb} from 'pdf-lib';
import {NOTE_GAPS, NOTE_TYPES} from '../shared/skin.js';
import {cleanDesign, pageGeometry, pageSize} from '../shared/notebooks.js';

export const A4 = [595.28, 841.89]; // pt（210 × 297 mm）
const MM = 72 / 25.4;
/** ページの大きさ（pt）。v3 の原稿用紙は A4 横（v0.19.3）、ほかは A4 縦 */
export function pageSizePt(design) {
  if (design?.v !== 3) return A4;
  const {w, h} = pageSize(design);
  return w > h ? [A4[1], A4[0]] : A4;
}

// ---- 紙（v0.14.2〜） ----
export const NOTE_PAPER = '#ffffff';
// 線の色（v0.17.10 から灰色。試し書きの付箋の罫線の見え方に近い、彩度を落とした淡い灰色）。前の版で作ったノートは、足すページも青のまま（design.line がない）
export const NOTE_LINES = {
  gray: {line: '#c9cfd6', head: '#a7afb9'}, // 罫線・題の欄の下の線（少し濃い灰色）。彩度を落とした淡い灰色
  blue: {line: '#9cc0e6', head: '#6f9fd6'} // よくある学習ノートの青（v0.14.2〜0.17.9）
};
export const NOTE_TYPES_V2 = ['ruled', 'grid'];
export const NOTE_GAPS_MM = [6, 7];
const HEAD_H = 20; // 上の欄（日付・題）の高さ mm
const FOOT_H = 10; // 下の余白 mm

/**
 * 紙の選び方を整える。v: 3（v0.19.0〜。持ち物のノート・マイノート。shared/notebooks.js の cleanDesign）はそのまま整える。
 * ほかは v2：{v: 2, type: 'ruled'|'grid', gap: 6|7, line: 'gray'|'blue'}（知らない値は横罫 6 mm・灰色）
 */
export function cleanPaper(raw = {}) {
  const d = raw && typeof raw === 'object' ? raw : {};
  if (d.v === 3) return cleanDesign(d);
  return {
    v: 2,
    type: NOTE_TYPES_V2.includes(d.type) ? d.type : 'ruled',
    gap: NOTE_GAPS_MM.includes(d.gap) ? d.gap : 6,
    line: Object.hasOwn(NOTE_LINES, d.line) ? d.line : 'gray'
  };
}
/** 覚えてある紙（note.design）：線の色のない v2 は前の版（青）のノート */
const storedPaper = (design) => ({...cleanPaper(design), ...(design?.line ? {} : {line: 'blue'})});

const color = (hex) =>
  rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);

/** 1 ページを描く。design に v がなければ前の見た目（テンプレート）で描く。header は上の欄に置く画像（PDFImage） */
export function drawNotePage(page, design, header = null) {
  if (design?.v === 3) return drawV3(page, cleanDesign(design), header);
  const v2 = design?.v === 2;
  if (!v2) drawLegacyPage(page, design);
  else drawPaper(page, storedPaper(design));
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

/**
 * v3 の紙（持ち物のノート・マイノート）：shared/notebooks.js の pageGeometry（mm・上から）を PDF の座標（pt・下から）にして描く。
 * 画面の見本（pageSvg）と同じ計算なので、見本どおりの紙になる。上の欄の字は、線の左の端（12 mm より左にはしない）にそろえる
 */
function drawV3(page, d, header) {
  const [W, H] = [page.getWidth(), page.getHeight()];
  const geo = pageGeometry(d);
  const sx = W / geo.w;
  const sy = H / geo.h;
  page.drawRectangle({x: 0, y: 0, width: W, height: H, color: color(geo.paper)});
  for (const l of geo.lines)
    page.drawLine({
      start: {x: l.x1 * sx, y: H - l.y1 * sy},
      end: {x: l.x2 * sx, y: H - l.y2 * sy},
      thickness: l.w * MM,
      color: color(l.c),
      ...(l.dash ? {dashArray: l.dash.map((v) => v * MM)} : {})
    });
  for (const p of geo.dots) page.drawCircle({x: p.x * sx, y: H - p.y * sy, size: p.r * MM, color: color(p.c)});
  // 塗る形（原稿用紙の魚尾）。drawSvgPath は左上を原点に y を下へ取る
  for (const p of geo.polys)
    page.drawSvgPath(`M${p.pts.map(([x, y]) => `${x * sx} ${y * sy}`).join('L')}Z`, {
      x: 0,
      y: H,
      color: color(p.c),
      borderWidth: 0
    });
  if (header) {
    const h = 4.4 * MM;
    const x = Math.max(12, geo.headLeft) * MM;
    const w = Math.min(W - x - 12 * MM, (h * header.width) / header.height);
    page.drawImage(header, {x, y: H - 13 * MM, width: w, height: (w * header.height) / header.width});
  }
}

/** 方眼の左の端（左右を真ん中にそろえる。左右 8 mm ずつ空けた幅に入るだけのます） */
function gridLeft(W, gap) {
  const cols = Math.floor((W - 16 * MM) / gap);
  return (W - cols * gap) / 2;
}

/** 白い紙に灰色（前の版は青）の罫線。横罫は上の欄の下の線から下へ gap ごと、方眼は横・縦とも gap ごと（左右は真ん中にそろえる） */
function drawPaper(page, d) {
  const [W, H] = [page.getWidth(), page.getHeight()];
  page.drawRectangle({x: 0, y: 0, width: W, height: H, color: color(NOTE_PAPER)});
  const ink = NOTE_LINES[d.line] ?? NOTE_LINES.gray;
  const line = color(ink.line);
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
      color: color(ink.head)
    });
  } else {
    page.drawLine({start: {x: 0, y: top}, end: {x: W, y: top}, thickness: 0.9, color: color(ink.head)});
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
  doc.setCreator('パレットノート');
  doc.setProducer('パレットノート');
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  doc.setKeywords([`daigaku-note:${now.toISOString()}:${Math.random().toString(36).slice(2)}`]);
  drawNotePage(doc.addPage(pageSizePt(paper)), paper, await embed(doc, header));
  return doc.save();
}

/** ノートの最後にページを 1 枚足す（同じ紙・同じ上の欄）。戻り：{bytes, pages} */
export async function appendNotePage(bytes, design, {header = null} = {}) {
  const doc = await PDFDocument.load(bytes);
  drawNotePage(doc.addPage(pageSizePt(design)), design, await embed(doc, header));
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
  doc.setCreator('パレットノート');
  doc.setProducer('パレットノート');
  if (old.getCreationDate()) doc.setCreationDate(old.getCreationDate());
  doc.setModificationDate(new Date());
  doc.setKeywords([old.getKeywords() ?? `daigaku-note:${Math.random().toString(36).slice(2)}`]);
  const img = await embed(doc, header);
  for (let i = 0; i < n; i++) drawNotePage(doc.addPage(pageSizePt(design)), design, img);
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
