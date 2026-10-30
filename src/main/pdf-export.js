// 注釈付き PDF の書き出し（SPEC §9.7）。元の PDF は読むだけで、注釈を描き込んだ別の PDF を作る。
// - 文字隠しマーカー：水色（赤を含まない色）を「乗算」で重ねる。印刷して本物の赤シートをかぶせると黒く見えて隠れる。
//   「黒く塗る」を選ぶと不透明の黒で塗りつぶす
// - 文字入れ：画面と同じヒラギノ角ゴで描いた画像（レンダラが 288dpi で作る。部分の色・揃えも画面のまま）を貼る。
//   フォントそのものは埋め込まない（ヒラギノは OS のフォントで、埋め込みの可否と .ttc の扱いが確かめられていないため）
// - 付箋（メモ）：PDF の「テキスト注釈」（ほかの PDF アプリでもメモとして開ける）。中の手書きは、アイコンの右に「スタンプ注釈」として
//   貼る（線を塗りつぶした図形で描いた見た目を持つ注釈。ページの中身は変えず、PDF アプリで動かしたり消したりできる）
// - ボールペン：画面と同じ輪郭（shared/ink.js）を、塗りつぶした図形として描く（拡大しても粗くならない）
// - アンダーライン：マーカーの色を乗算で重ねる（文字隠しと同じ。下の文字は読める）
// - 貼りもの（シール・素材の図・メモ帳からちぎった紙）：レンダラが描いた画像を貼る（文字入れと同じ）。いちばん下に置き、
//   上からマーカー・ペンの線・文字を重ねる（画面と同じ重なり）
import {BlendMode, PDFDocument, PDFHexString, PDFString, degrees, drawSvgPath, rgb} from 'pdf-lib';
import {decodePoints, strokePath} from '../shared/ink.js';
import {NOTE_INK_PT_PER_PX, NOTE_INK_SCALE} from '../shared/annotation.js';

export const MARKER_HEX = '#00d2ff'; // レンダラの表示と同じ。赤の成分が 0 なので赤シートの下で黒になる
const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
// 貼りものの上に文字入れ、その上にマーカー・ペンの線（文字の上から線を引ける。画面と同じ）、いちばん上に付箋
const ORDER = {stamp: 0, text: 1, mask: 2, line: 2, ink: 3, note: 4};
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v ?? '');

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

/** 四角を箱（ページ）の中へ寄せる（大きさはそのまま） */
export const insideBox = (r, box) => ({
  ...r,
  x: Math.min(Math.max(r.x, box.x), box.x + box.width - r.w),
  y: Math.min(Math.max(r.y, box.y), box.y + box.height - r.h)
});

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
          color: rgb(...hexToRgb(isHex(a.style?.color) ? a.style.color : MARKER_HEX)),
          blendMode: BlendMode.Multiply
        });
    } else if (a.kind === 'line') {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color: rgb(...hexToRgb(isHex(a.style?.color) ? a.style.color : '#ffe14d')),
        blendMode: BlendMode.Multiply
      });
    } else if (a.kind === 'ink') {
      const points = decodePoints(a.body);
      if (!points) continue;
      // drawSvgPath は y が下向きなので、上下を返したパスを原点に置く（PDF の座標そのままで描かれる）
      const d = strokePath(points, a.style?.width ?? 1.1, {pressure: a.style?.pressure !== false, flipY: true});
      if (d)
        page.drawSvgPath(d, {x: 0, y: 0, color: rgb(...hexToRgb(isHex(a.style?.color) ? a.style.color : '#222222'))});
    } else if (a.kind === 'text' || a.kind === 'stamp') {
      const png = images.get(a.id);
      if (!png) continue;
      const img = await doc.embedPng(png);
      // 付箋（インデックス）は画面ではページの端からはみ出して貼るが、紙の外は描けないので、ページの中へ寄せる
      const rect = a.style?.type === 'index' ? insideBox(a.rect, page.getMediaBox()) : a.rect;
      page.drawImage(img, uprightImage(page.getRotation().angle, rect));
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
      const stamp = noteInkStamp(doc, a, page);
      if (stamp) page.node.addAnnot(doc.context.register(stamp));
    }
  }
  doc.setProducer('大学ノート');
  return doc.save();
}

/**
 * メモの中の手書き（style.ink）を、アイコンの右に置くスタンプ注釈にする。見た目（/AP）は線を塗りつぶした図形。
 * 吹き出しの px を pt にして（NOTE_INK_PT_PER_PX）、線の囲みにそろえた大きさにする。手書きがなければ null
 */
export function noteInkStamp(doc, a, page) {
  const strokes = (Array.isArray(a.style?.ink) ? a.style.ink : [])
    .map((s) => ({
      points: decodePoints(s.p),
      color: isHex(s.c) ? s.c : '#2b2b2b',
      width: (s.w ?? 1.1) * NOTE_INK_SCALE,
      pressure: s.pressure !== false
    }))
    .filter((s) => s.points?.length);
  if (!strokes.length) return null;
  const pad = Math.max(...strokes.map((s) => s.width)) + 2;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of strokes)
    for (const [px, py] of s.points) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  const k = NOTE_INK_PT_PER_PX;
  const W = (maxX - minX + pad * 2) * k;
  const H = (maxY - minY + pad * 2) * k;
  // 見た目：左上を原点にした px の線を、pt に縮めて描く（drawSvgPath は y を下向きに扱うので、上端 H から描く）
  const ops = strokes.flatMap((s) =>
    drawSvgPath(
      strokePath(
        s.points.map(([px, py, pr]) => [px - minX + pad, py - minY + pad, pr]),
        s.width,
        {pressure: s.pressure}
      ),
      {x: 0, y: H, scale: k, color: rgb(...hexToRgb(s.color)), borderColor: undefined, borderWidth: 0}
    )
  );
  const form = doc.context.formXObject(ops, {BBox: doc.context.obj([0, 0, W, H])});
  const {x, y, w, h} = a.rect;
  const pageW = page.getWidth();
  const x0 = Math.max(0, Math.min(x + w + 4, pageW - W));
  const y0 = Math.max(0, y + h - H);
  return doc.context.obj({
    Type: 'Annot',
    Subtype: 'Stamp',
    Rect: [x0, y0, x0 + W, y0 + H],
    F: 4,
    T: PDFHexString.fromText('大学ノート'),
    Contents: PDFHexString.fromText('コメントの手書き'),
    M: PDFString.fromDate(new Date()),
    AP: {N: doc.context.register(form)}
  });
}
