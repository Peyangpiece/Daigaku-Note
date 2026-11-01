// 授業の回のノート（SPEC §8.6）：A4 縦の白紙の PDF を作る・ページを足す。紙と罫線は着せ替えのテンプレートのノートの見た目
// （shared/skin.js の note：ruled 横罫・grid 方眼・dot ドット・ring 丸ドット・plain 無地・cornell コーネル、紙の色・線の色・行の間・余白の縦線）。
// ノートは PDF なので、PDF の編集画面でできること（ペン・マーカー・文字入れ・貼りもの・しおり・書き出し）がそのまま使える
import {PDFDocument, rgb} from 'pdf-lib';
import {NOTE_GAPS, NOTE_TYPES} from '../shared/skin.js';

export const A4 = [595.28, 841.89]; // pt（210 × 297 mm）
const MM = 72 / 25.4;
// 行の間（テンプレートの narrow・normal・wide）→ 紙の上の mm（B 罫 6 mm・A 罫 7 mm・広め 8 mm）
export const NOTE_GAP_MM = {narrow: 6, normal: 7, wide: 8};
// テンプレートで「はじめの色」（default）のときの色（明るい表示のクラシックの紙と罫線。tokens.css と同じ）
export const DEFAULT_PAPER = '#fbf8f1';
export const DEFAULT_LINE = '#cfe0ea';
export const MARGIN_LINE = '#e88b8b';

const HEX = /^#[0-9a-f]{6}$/i;

/** レンダラから受け取ったノートの見た目を整える（知らない値ははじめの値） */
export function cleanDesign(raw = {}) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    type: NOTE_TYPES.includes(d.type) ? d.type : 'ruled',
    paper: HEX.test(d.paper ?? '') ? d.paper.toLowerCase() : DEFAULT_PAPER,
    line: HEX.test(d.line ?? '') ? d.line.toLowerCase() : DEFAULT_LINE,
    gap: Object.hasOwn(NOTE_GAPS, d.gap) ? d.gap : 'normal',
    margin: typeof d.margin === 'boolean' ? d.margin : true
  };
}

const color = (hex) =>
  rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);

/**
 * 1 ページを描く：紙の色で塗り、上 22 mm（日付・題の欄）と下 12 mm を空けて模様を描く。
 * 余白の縦線（左 25 mm）は margin のときだけ。コーネルは左 62 mm の見出し欄の線と、下 55 mm の要約欄の線
 */
export function drawNotePage(page, design) {
  const d = cleanDesign(design);
  const [W, H] = [page.getWidth(), page.getHeight()];
  page.drawRectangle({x: 0, y: 0, width: W, height: H, color: color(d.paper)});
  const line = color(d.line);
  const gap = NOTE_GAP_MM[d.gap] * MM;
  const top = H - 22 * MM;
  const bottom = 12 * MM;
  const left = 0;
  const right = W;
  const summary = d.type === 'cornell' ? 55 * MM : bottom;
  // 題の欄の下の線（横罫・コーネル・方眼のとき。少し濃く）
  if (['ruled', 'cornell'].includes(d.type))
    page.drawLine({start: {x: left, y: top}, end: {x: right, y: top}, thickness: 0.9, color: line});
  if (d.type === 'ruled' || d.type === 'cornell') {
    for (let y = top - gap; y >= summary + gap * 0.5; y -= gap)
      page.drawLine({start: {x: left, y}, end: {x: right, y}, thickness: 0.5, color: line});
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

/**
 * 新しいノート（1 ページ）。tag は PDF の題・キーワードに入れる文字（授業名と回。同じ見た目のノートでも中身の
 * ハッシュが変わるように、作った時刻も入れる：資料はハッシュで同じものを見分けるため）
 */
export async function createNotePdf(design, {title = 'ノート', now = new Date()} = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator('大学ノート');
  doc.setProducer('大学ノート');
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  doc.setKeywords([`daigaku-note:${now.toISOString()}:${Math.random().toString(36).slice(2)}`]);
  drawNotePage(doc.addPage(A4), design);
  return doc.save();
}

/** ノートの最後にページを 1 枚足す（同じ見た目）。戻り：{bytes, pages} */
export async function appendNotePage(bytes, design) {
  const doc = await PDFDocument.load(bytes);
  drawNotePage(doc.addPage(A4), design);
  doc.setModificationDate(new Date());
  return {bytes: await doc.save(), pages: doc.getPageCount()};
}
