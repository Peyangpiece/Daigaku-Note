// 注釈付き PDF の書き出し（SPEC §9.7）。元の PDF は読むだけで、注釈を描き込んだ別の PDF を作る。
// - 文字隠しマーカー：水色（赤を含まない色）を「乗算」で重ねる。印刷して本物の赤シートをかぶせると黒く見えて隠れる。
//   「黒く塗る」を選ぶと不透明の黒で塗りつぶす
// - 文字入れ：画面と同じヒラギノ角ゴで描いた画像（レンダラが 288dpi で作る）を貼る。
//   フォントそのものは埋め込まない（ヒラギノは OS のフォントで、埋め込みの可否と .ttc の扱いが確かめられていないため）
// - 付箋：PDF の「テキスト注釈」（ほかの PDF アプリでもメモとして開ける）
import {BlendMode, PDFDocument, PDFHexString, PDFString, degrees, rgb} from 'pdf-lib';

export const MARKER_HEX = '#00d2ff'; // レンダラの表示と同じ。赤の成分が 0 なので赤シートの下で黒になる
const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const ORDER = {mask: 0, text: 1, note: 2}; // マーカーの上に文字、いちばん上に付箋

/**
 * 回転したページ（/Rotate。時計回り）でも、画面で見たとおりの向きで画像を置く位置と角度。
 * 画像は画面の向きで描いてあるので、ページの回転と同じ角度だけ（PDF の座標で反時計回りに）回して、
 * 画面の左下にあたる角を原点にする。rect は PDF の座標の四角（左下と幅・高さ）
 */
export function uprightImage(rotation, {x, y, w, h}) {
  const r = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
  if (r === 90) return {x: x + w, y, width: h, height: w, rotate: degrees(90)};
  if (r === 180) return {x: x + w, y: y + h, width: w, height: h, rotate: degrees(180)};
  if (r === 270) return {x, y: y + h, width: h, height: w, rotate: degrees(270)};
  return {x, y, width: w, height: h};
}

export const isPng = (b) =>
  b instanceof Uint8Array && b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/**
 * @param {Uint8Array} bytes 元の PDF
 * @param {Array<{id, page, kind, rect: {x, y, w, h}, body, style}>} annotations DB の注釈（annotationToClient の形）
 * @param {{images?: Map<string, Uint8Array>, markers?: 'blue'|'black', notes?: boolean}} options
 * @returns {Promise<Uint8Array>}
 */
export async function exportAnnotatedPdf(
  bytes,
  annotations,
  {images = new Map(), markers = 'blue', notes = true} = {}
) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes, {updateMetadata: false});
  } catch (e) {
    throw new Error(
      /encrypt/i.test(e.message) ? '暗号化された PDF は書き出せません' : `PDF を読めませんでした（${e.message}）`
    );
  }
  const pages = doc.getPages();
  const list = [...annotations].sort(
    (a, b) => a.page - b.page || ORDER[a.kind] - ORDER[b.kind] || (a.z ?? 0) - (b.z ?? 0)
  );
  for (const a of list) {
    const page = pages[a.page - 1];
    if (!page) continue;
    const {x, y, w, h} = a.rect;
    if (a.kind === 'mask') {
      if (markers === 'black') page.drawRectangle({x, y, width: w, height: h, color: rgb(0, 0, 0)});
      else
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          color: rgb(...hexToRgb(MARKER_HEX)),
          blendMode: BlendMode.Multiply
        });
    } else if (a.kind === 'text') {
      const png = images.get(a.id);
      if (!png) continue;
      const img = await doc.embedPng(png);
      page.drawImage(img, uprightImage(page.getRotation().angle, a.rect));
    } else if (a.kind === 'note' && notes) {
      const color = /^#[0-9a-f]{6}$/i.test(a.style?.color ?? '') ? hexToRgb(a.style.color) : [0.96, 0.77, 0.27];
      const annot = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [x, y, x + w, y + h],
        Name: 'Comment',
        F: 4,
        C: color,
        T: PDFHexString.fromText('大学ノート'),
        Contents: PDFHexString.fromText(a.body ?? ''),
        M: PDFString.fromDate(new Date())
      });
      page.node.addAnnot(doc.context.register(annot));
    }
  }
  doc.setProducer('大学ノート');
  return doc.save();
}
