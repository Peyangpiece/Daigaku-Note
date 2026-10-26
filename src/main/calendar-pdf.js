// 学年暦のファイルの文字（SPEC §6.14）。PDF は、日付の数字の後ろの塗りが灰色なら「▦」を付ける（灰色のます目＝休講。shared/calendar.js が読む）。
// 塗りは描いた順に重なるので、数字の位置を含むいちばん後の塗り（長方形・多角形。偶奇／非ゼロの規則）の色を見る。曲線は端の点で近似する
import {readFile} from 'node:fs/promises';
import {extOf, extractPages} from './quiz/extract.js';

export const GRAY_MARK = '▦';

/** 学年暦のファイルの文字（ページをつなげたもの） */
export async function calendarText(file) {
  if (extOf(file) !== 'pdf') return (await extractPages(file)).pages.map((p) => p.text).join('\n');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(await readFile(file)),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0
  });
  const doc = await task.promise;
  const out = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const fills = pageFills(pdfjs.OPS, await page.getOperatorList());
      const content = await page.getTextContent();
      out.push(
        content.items
          .map((it) => {
            let s = it.str ?? '';
            if (/^\s*\d{1,2}\s*$/.test(s) && isGray(fillAt(fills, it.transform[4] + 1, it.transform[5] + 1)))
              s = s.trimEnd() + GRAY_MARK;
            return s + (it.hasEOL ? '\n' : '');
          })
          .join('')
          .replace(/[ \t]+\n/g, '\n')
      );
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return out.join('\n');
}

/** 灰色：赤・緑・青がほぼ同じで、白と濃い灰色（月の欄など）を除く */
export const isGray = (rgb) => !!rgb && Math.max(...rgb) - Math.min(...rgb) <= 8 && rgb[0] >= 150 && rgb[0] <= 245;

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5]
];

/** ページの塗り：[{rings: [[x, y, …]]（ページの座標）, evenOdd, rgb}]。描いた順 */
export function pageFills(OPS, {fnArray, argsArray}) {
  const fillOps = new Map([
    [OPS.fill, false],
    [OPS.fillStroke, false],
    [OPS.eoFill, true],
    [OPS.eoFillStroke, true]
  ]);
  let ctm = [1, 0, 0, 1, 0, 0];
  let rgb = [0, 0, 0];
  const stack = [];
  const fills = [];
  for (let i = 0; i < fnArray.length; i++) {
    const f = fnArray[i],
      a = argsArray[i];
    if (f === OPS.save) stack.push([ctm, rgb]);
    else if (f === OPS.restore) [ctm, rgb] = stack.pop() ?? [ctm, rgb];
    else if (f === OPS.transform) ctm = mul(ctm, a);
    else if (f === OPS.setFillRGBColor)
      rgb =
        typeof a[0] === 'string'
          ? [1, 3, 5].map((k) => parseInt(a[0].slice(k, k + 2), 16))
          : [...a].map((v) => v * 255);
    else if (f === OPS.setFillGray) rgb = [a[0] * 255, a[0] * 255, a[0] * 255];
    else if (f === OPS.constructPath && fillOps.has(a[0]) && a[1]?.[0]) {
      const rings = pathRings(a[1][0], ctm);
      if (rings.length) fills.push({rings, evenOdd: fillOps.get(a[0]), rgb});
    }
  }
  return fills;
}

// pdf.js の道の形：0 moveTo(x,y)・1 lineTo(x,y)・2 curveTo(6)・3 quadraticCurveTo(4)・4 closePath
function pathRings(d, m) {
  const pt = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const rings = [];
  let ring = null;
  for (let i = 0; i < d.length; ) {
    const op = d[i];
    if (op === 0) {
      ring = [...pt(d[i + 1], d[i + 2])];
      rings.push(ring);
      i += 3;
    } else if (op === 1) {
      ring?.push(...pt(d[i + 1], d[i + 2]));
      i += 3;
    } else if (op === 2) {
      ring?.push(...pt(d[i + 5], d[i + 6]));
      i += 7;
    } else if (op === 3) {
      ring?.push(...pt(d[i + 3], d[i + 4]));
      i += 5;
    } else i += 1; // closePath（輪は閉じたものとして数える）
  }
  return rings.filter((r) => r.length >= 6);
}

/** 点 (x, y) にいちばん後に塗った色（なければ null） */
export function fillAt(fills, x, y) {
  for (let k = fills.length - 1; k >= 0; k--) {
    const {rings, evenOdd, rgb} = fills[k];
    let winding = 0,
      crossings = 0;
    for (const r of rings)
      for (let i = 0, n = r.length; i < n; i += 2) {
        const x1 = r[i],
          y1 = r[i + 1],
          x2 = r[(i + 2) % n],
          y2 = r[(i + 3) % n];
        if (y1 <= y !== y2 <= y) {
          const xc = x1 + ((y - y1) * (x2 - x1)) / (y2 - y1);
          if (xc > x) {
            crossings++;
            winding += y2 > y1 ? 1 : -1;
          }
        }
      }
    if (evenOdd ? crossings % 2 : winding) return rgb;
  }
  return null;
}
