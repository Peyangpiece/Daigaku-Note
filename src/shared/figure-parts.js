import {esc} from './html.js';
// 素材の図（figures.js・figures-hs.js）を描く部品。線は INK、補助の線は SOFT。x・y は viewBox の点。副作用なし
export const INK = '#2b2b2b';
export const SOFT = '#9aa3ad'; // 補助の線（方眼・点線）
export const WATER = '#d6ebff';
export const LABEL_SERIF = "'Times New Roman',Times,serif";
export const LABEL_GOTHIC = "'Hiragino Kaku Gothic ProN','Hiragino Sans',sans-serif";
export const r1 = (v) => Math.round(v * 10) / 10;
export const rad = (deg) => (deg * Math.PI) / 180;

/** 矢印の先（x, y が先端。向きは角度 deg。0 が右） */
export const head = (x, y, deg, fill = INK) =>
  `<path d="M0 0L-9 -4.5L-9 4.5Z" transform="translate(${r1(x)} ${r1(y)}) rotate(${r1(deg)})" fill="${fill}" stroke="none"/>`;
export const arrow = (x1, y1, x2, y2, {color = INK, width} = {}) => {
  const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const k = 8 / (Math.hypot(x2 - x1, y2 - y1) || 1); // 先の手前で線を止める
  return `<path d="M${r1(x1)} ${r1(y1)}L${r1(x2 - (x2 - x1) * k)} ${r1(y2 - (y2 - y1) * k)}"${color !== INK ? ` stroke="${color}"` : ''}${width ? ` stroke-width="${width}"` : ''}/>${head(x2, y2, deg, color)}`;
};
export const dash = 'stroke-dasharray="5 4"';
/** 正多角形の頂点（中心 cx, cy、半径 r、上の頂点から時計回り） */
export const polygonPoints = (n, cx, cy, r) =>
  Array.from({length: n}, (_, i) => {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
    return [r1(cx + r * Math.cos(a)), r1(cy + r * Math.sin(a))];
  });
export const poly = (pts) => pts.map(([x, y]) => `${x},${y}`).join(' ');
export const grid = (w, h, step, {from = 0, fromY = from, color = '#d5dae0', width = 1} = {}) => {
  const d = [];
  for (let v = from; v <= w; v += step) d.push(`M${v} 0V${h}`);
  for (let v = fromY; v <= h; v += step) d.push(`M0 ${v}H${w}`);
  return `<path d="${d.join('')}" stroke="${color}" stroke-width="${width}"/>`;
};
export const axesPath = (w, h, ox, oy) => `${arrow(8, oy, w - 6, oy)}${arrow(ox, h - 8, ox, 6)}`;
/** 曲線の点の並びを path に（null の点で切る） */
export const pathOf = (pts) => {
  let d = '',
    pen = false;
  for (const p of pts) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${r1(p[0])} ${r1(p[1])}`;
    pen = true;
  }
  return d;
};
/** ばね（ジグザグ）：x1 から x2 まで、高さ y、山の数 n */
export const spring = (x1, x2, y, n = 10, amp = 9) => {
  const pts = [[x1, y]];
  const lead = 8;
  const seg = (x2 - x1 - lead * 2) / n;
  pts.push([x1 + lead, y]);
  for (let i = 0; i < n; i++) pts.push([x1 + lead + seg * (i + 0.5), y + (i % 2 ? amp : -amp)]);
  pts.push([x2 - lead, y], [x2, y]);
  return `<path d="${pathOf(pts)}"/>`;
};
/** 天井・壁の斜線（x1〜x2 の横線の上に） */
export const ceiling = (x1, x2, y) => {
  const d = [`M${x1} ${y}H${x2}`];
  for (let x = x1 + 4; x <= x2; x += 8) d.push(`M${x} ${y}l-6 -7`);
  return `<path d="${d.join('')}"/>`;
};
export const wallLeft = (x, y1, y2) => {
  const d = [`M${x} ${y1}V${y2}`];
  for (let y = y1 + 4; y <= y2; y += 8) d.push(`M${x} ${y}l-7 -6`);
  return `<path d="${d.join('')}"/>`;
};
export const ground = (x1, x2, y) => {
  const d = [`M${x1} ${y}H${x2}`];
  for (let x = x1 + 6; x <= x2; x += 10) d.push(`M${x} ${y}l-6 7`);
  return `<path d="${d.join('')}" stroke="${SOFT}"/><path d="M${x1} ${y}H${x2}"/>`;
};
export const dot = (x, y, r = 2.5, fill = INK) =>
  `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="${fill}" stroke="none"/>`;
/** 引き出し線（部分の名前へ） */
export const lead = (x1, y1, x2, y2) =>
  `<path d="M${r1(x1)} ${r1(y1)}L${r1(x2)} ${r1(y2)}" stroke="${SOFT}" stroke-width="1"/>`;

// ---- 文字（既定）：[x, y, 文字, {m: 数学の文字（斜体の明朝）, s: 大きさ}]。x・y は viewBox の点（文字の真ん中） ----
export const M = (x, y, t, s) => [x, y, t, {m: true, s}];
export const J = (x, y, t, s = 11) => [x, y, t, {s}];

/** 図の中に描き込む文字（書き換えない数・目盛り・欄の名前など。書き換える文字は labels の M・J）。a は text-anchor */
export const T = (x, y, t, {s = 10, a = 'middle', c = INK, b = false, m = false} = {}) =>
  `<text x="${r1(x)}" y="${r1(y)}" font-family="${m ? LABEL_SERIF : LABEL_GOTHIC}" font-size="${s}" text-anchor="${a}" dominant-baseline="central" fill="${c}" stroke="none"${b ? ' font-weight="700"' : ''}${m ? ' font-style="italic"' : ''}>${esc(t)}</text>`;
/** 四角（角の丸み rx、塗り fill） */
export const box = (x, y, w, h, {rx = 0, fill = 'none', color} = {}) =>
  `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}"${rx ? ` rx="${rx}"` : ''}${fill !== 'none' ? ` fill="${fill}"` : ''}${color ? ` stroke="${color}"` : ''}/>`;
/** 決め事が決まった数（整数）の図で使う、0〜n−1 の並び */
export const range = (n) => Array.from({length: Math.max(0, Math.round(n))}, (_, i) => i);
