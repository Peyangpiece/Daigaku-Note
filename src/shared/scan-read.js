// スキャン用の Palette ノート紙の取り込み（docs/SPEC-SCAN.md §3）。副作用なし（画面にもメインにも触らない）。
// 画像は {width, height, data}（RGBA の Uint8ClampedArray。canvas の ImageData と同じ形）で受け取る。
//   1. findMarkers：四隅の目印を見つける（右下は中が白い四角で、向きが分かる）
//   2. pageTransform：紙（mm）→ 画像（px）の射影変換を作る（B5 縦か横かは目印の並びから決める）
//   3. readCode：下の端の形式のコードを読む
//   4. extractInk：紙をまっすぐ・原寸に直し、書いた線だけを取り出す（ドロップアウトカラーの罫・紙・影は透明に）
import {SCAN_MARK, decodeScanCode} from './scan-code.js';
import {SIZES} from './notebooks.js';

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** 小さくした灰色の画像（長い辺 max px）。戻り {w, h, g: Float32Array, k}（k：元の画像の何分の一か） */
function grayDown(img, max = 1000) {
  const k = Math.max(1, Math.max(img.width, img.height) / max);
  const w = Math.max(1, Math.round(img.width / k));
  const h = Math.max(1, Math.round(img.height / k));
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x + 0.5) * k));
      const sy = Math.min(img.height - 1, Math.floor((y + 0.5) * k));
      g[y * w + x] = lum(img.data, (sy * img.width + sx) * 4);
    }
  return {w, h, g, k};
}

/** 局所の明るさ（積分画像で窓 r の平均） */
function localMean(g, w, h, r) {
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x];
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row;
    }
  }
  const m = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r),
        y0 = Math.max(0, y - r),
        x1 = Math.min(w, x + r + 1),
        y1 = Math.min(h, y + r + 1);
      const s = S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0];
      m[y * w + x] = s / ((x1 - x0) * (y1 - y0));
    }
  return m;
}

/** 暗いところのかたまり（4 近傍）。戻り [{area, x0, y0, x1, y1, cx, cy}] */
function blobs(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    let area = 0,
      sx = 0,
      sy = 0,
      x0 = w,
      y0 = h,
      x1 = 0,
      y1 = 0;
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop();
      const x = j % w,
        y = (j - x) / w;
      area++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const n of [j - 1, j + 1, j - w, j + w]) {
        if (n < 0 || n >= w * h || seen[n] || !mask[n]) continue;
        if ((n === j - 1 && x === 0) || (n === j + 1 && x === w - 1)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    out.push({area, x0, y0, x1, y1, cx: sx / area, cy: sy / area});
  }
  return out;
}

/**
 * 四隅の目印を見つける。戻り {tl, tr, br, bl}（元の画像の px の [x, y]。右下は中が白い目印）か null。
 * 紙が写真の大部分に写っていること（目印がいちばん外側の暗い四角であること）を前提にする
 */
export function findMarkers(img) {
  const {w, h, g, k} = grayDown(img);
  const mean = localMean(g, w, h, Math.max(8, Math.round(Math.max(w, h) / 24)));
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = g[i] < Math.min(mean[i] * 0.62, 140) ? 1 : 0;
  const minSide = Math.max(4, Math.max(w, h) / 160);
  const maxArea = w * h * 0.01;
  const cands = blobs(mask, w, h).filter((b) => {
    const bw = b.x1 - b.x0 + 1,
      bh = b.y1 - b.y0 + 1;
    if (bw < minSide || bh < minSide || b.area > maxArea) return false;
    if (b.x0 === 0 || b.y0 === 0 || b.x1 === w - 1 || b.y1 === h - 1) return false; // 写真の端にかかる（机など）
    const aspect = bw / bh;
    return aspect > 0.5 && aspect < 2 && b.area / (bw * bh) > 0.45;
  });
  if (cands.length < 4) return null;
  // いちばん外側の 4 つ：左上（x+y が最小）・右下（最大）・右上（x−y が最大）・左下（最小）
  const pick = (f) => cands.reduce((a, b) => (f(b) > f(a) ? b : a));
  const four = [
    pick((b) => -(b.cx + b.cy)),
    pick((b) => b.cx - b.cy),
    pick((b) => b.cx + b.cy),
    pick((b) => -(b.cx - b.cy))
  ];
  if (new Set(four).size < 4) return null;
  // 大きさがそろっていること（書いた字のかたまりを目印とまちがえない）
  const sizes = four.map((b) => Math.sqrt(b.area));
  if (Math.max(...sizes) > Math.min(...sizes) * 2.2) return null;
  // 中が白いもの（右下の目印）：かたまりの真ん中が明るい
  const hollow = four.map((b) => {
    const i = Math.round(b.cy) * w + Math.round(b.cx);
    return g[i] > mean[i] * 0.75 || !mask[i];
  });
  if (hollow.filter(Boolean).length !== 1) return null;
  // 白い目印が右下に来るように回す（写真が逆さ・横向きでもよい）
  let order = [0, 1, 2, 3]; // 左上・右上・右下・左下（写真の上で）
  while (!hollow[order[2]]) order = [order[1], order[2], order[3], order[0]];
  const pt = (b) => [(b.cx + 0.5) * k, (b.cy + 0.5) * k];
  const [tl, tr, br, bl] = order.map((n) => pt(four[n]));
  return {tl, tr, br, bl};
}

/** 4 点の対応から射影変換（3×3。h33 = 1）。src・dst は [[x, y] × 4] */
export function homography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // ガウスの消去法（部分ピボット）
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return [...x, 1];
}

/** 射影変換で点を移す */
export function project(H, x, y) {
  const d = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
}

/**
 * 紙（mm）→ 画像（px）の射影変換。目印の並び（上の辺と左の辺の長さ）から B5 の縦か横かを決める。
 * 戻り {H, w, h}（w・h：紙の大きさ mm）
 */
export function pageTransform(marks) {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const across = (dist(marks.tl, marks.tr) + dist(marks.bl, marks.br)) / 2;
  const down = (dist(marks.tl, marks.bl) + dist(marks.tr, marks.br)) / 2;
  const {w: bw, h: bh} = SIZES.b5;
  const [w, h] = across > down ? [bh, bw] : [bw, bh];
  const c = SCAN_MARK.inset + SCAN_MARK.size / 2; // 目印の真ん中（紙の端から）
  const H = homography(
    [
      [c, c],
      [w - c, c],
      [w - c, h - c],
      [c, h - c]
    ],
    [marks.tl, marks.tr, marks.br, marks.bl]
  );
  return H ? {H, w, h} : null;
}

/** 画像の点（px）のまわり 3×3 の明るさ */
function sampleLum(img, x, y) {
  let s = 0,
    n = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const sx = Math.round(x) + dx,
        sy = Math.round(y) + dy;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      s += lum(img.data, (sy * img.width + sx) * 4);
      n++;
    }
  return n ? s / n : 255;
}

/** 下の端の形式のコードを読む。戻り {format, version} か null */
export function readCode(img, t) {
  const {module, codeH, codeFromBottom, inset, size} = SCAN_MARK;
  const n = 23;
  const x0 = (t.w - n * module) / 2;
  const y = t.h - codeFromBottom + codeH / 2;
  const at = (mx, my) => sampleLum(img, ...project(t.H, mx, my));
  // 黒（右下の目印の帯）と白（コードのすぐ上の紙）の間で分ける
  const black = at(t.w - inset - size / 2, t.h - inset - 0.5);
  const white = at(t.w / 2, y - codeH);
  const cut = (black + white) / 2;
  const bits = Array.from({length: n}, (_, i) => (at(x0 + (i + 0.5) * module, y) < cut ? 1 : 0));
  return decodeScanCode(bits);
}

/** ページの中で、書いた線として取り出さないところ（目印・コード。mm の四角） */
function hiddenRects(w, h) {
  const {inset: m, size: s, module, codeH, codeFromBottom} = SCAN_MARK;
  const pad = 1.2;
  const sq = (x, y) => [x - pad, y - pad, s + 2 * pad, s + 2 * pad];
  const cw = 23 * module;
  return [
    sq(m, m),
    sq(w - m - s, m),
    sq(m, h - m - s),
    sq(w - m - s, h - m - s),
    [(w - cw) / 2 - pad, h - codeFromBottom - pad, cw + 2 * pad, codeH + 2 * pad]
  ];
}

/**
 * 紙をまっすぐ・原寸（scale px/mm）に直し、書いた線だけを取り出す。戻り {width, height, data}（RGBA。線のないところは透明）。
 * 紙の白さは場所ごとに測って（影・色むらを消す）、緑の明るさで線を見分ける（ドロップアウトカラーの水色は緑が明るいので消え、
 * 黒・青・赤のインクと鉛筆は残る）
 */
export function extractInk(img, t, {scale = 6, from = 0.3, to = 0.48} = {}) {
  const W = Math.round(t.w * scale);
  const Hh = Math.round(t.h * scale);
  const rgb = new Float32Array(W * Hh * 3);
  // 1. まっすぐに直す（双一次で読む）
  for (let v = 0; v < Hh; v++)
    for (let u = 0; u < W; u++) {
      const [x, y] = project(t.H, (u + 0.5) / scale, (v + 0.5) / scale);
      const x0 = Math.floor(x - 0.5),
        y0 = Math.floor(y - 0.5);
      const fx = x - 0.5 - x0,
        fy = y - 0.5 - y0;
      const o = (v * W + u) * 3;
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (const [dx, dy, wt] of [
          [0, 0, (1 - fx) * (1 - fy)],
          [1, 0, fx * (1 - fy)],
          [0, 1, (1 - fx) * fy],
          [1, 1, fx * fy]
        ]) {
          const sx = Math.min(img.width - 1, Math.max(0, x0 + dx));
          const sy = Math.min(img.height - 1, Math.max(0, y0 + dy));
          s += img.data[(sy * img.width + sx) * 4 + c] * wt;
        }
        rgb[o + c] = s;
      }
    }
  // 2. 紙の白さ：区切りごとの明るいほう（上位）を、なめらかにつなぐ
  const B = Math.max(8, Math.round(scale * 4)); // 4 mm の区切り
  const bw = Math.ceil(W / B),
    bh = Math.ceil(Hh / B);
  const bg = new Float32Array(bw * bh * 3);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++)
      for (let c = 0; c < 3; c++) {
        const vals = [];
        for (let v = by * B; v < Math.min(Hh, (by + 1) * B); v += 2)
          for (let u = bx * B; u < Math.min(W, (bx + 1) * B); u += 2) vals.push(rgb[(v * W + u) * 3 + c]);
        vals.sort((a, b) => a - b);
        bg[(by * bw + bx) * 3 + c] = Math.max(40, vals[Math.floor(vals.length * 0.9)] ?? 255);
      }
  const bgAt = (u, v, c) => {
    const gx = Math.min(bw - 1, Math.max(0, (u + 0.5) / B - 0.5)),
      gy = Math.min(bh - 1, Math.max(0, (v + 0.5) / B - 0.5));
    const x0 = Math.floor(gx),
      y0 = Math.floor(gy);
    const x1 = Math.min(bw - 1, x0 + 1),
      y1 = Math.min(bh - 1, y0 + 1);
    const fx = gx - x0,
      fy = gy - y0;
    const at = (x, y) => bg[(y * bw + x) * 3 + c];
    return (
      at(x0, y0) * (1 - fx) * (1 - fy) + at(x1, y0) * fx * (1 - fy) + at(x0, y1) * (1 - fx) * fy + at(x1, y1) * fx * fy
    );
  };
  // 3. 線を見分けて、色と透けぐあいを決める
  const out = new Uint8ClampedArray(W * Hh * 4);
  const hidden = hiddenRects(t.w, t.h).map(([x, y, w, h]) => [x * scale, y * scale, (x + w) * scale, (y + h) * scale]);
  const edge = 2 * scale; // 紙のふち 2 mm は使わない（写真の背景が入りやすい）
  for (let v = 0; v < Hh; v++)
    for (let u = 0; u < W; u++) {
      if (u < edge || v < edge || u >= W - edge || v >= Hh - edge) continue;
      if (hidden.some(([x0, y0, x1, y1]) => u >= x0 && u < x1 && v >= y0 && v < y1)) continue;
      const o = (v * W + u) * 3;
      const n = [0, 1, 2].map((c) => Math.min(1, rgb[o + c] / bgAt(u, v, c)));
      const dark = 1 - n[1]; // 緑の暗さ（水色の罫は緑が明るいので小さい）
      if (dark <= from) continue;
      const a = Math.min(1, (dark - from) / (to - from));
      const p = (v * W + u) * 4;
      // 色は紙の白さで割った色を少し濃くする（インクの色を保つ）
      for (let c = 0; c < 3; c++) out[p + c] = Math.round(255 * Math.pow(n[c], 1.6));
      out[p + 3] = Math.round(255 * a);
    }
  return {width: W, height: Hh, data: out};
}

/** まとめて読む。戻り {format, w, h, ink} か {error}（日本語の理由） */
export function readScan(img, opts) {
  const marks = findMarkers(img);
  if (!marks) return {error: '四隅の目印が見つかりませんでした。紙全体が写るように撮ってください'};
  const t = pageTransform(marks);
  if (!t) return {error: '紙の形を読めませんでした。もう一度撮ってください'};
  const code = readCode(img, t);
  if (!code) return {error: '紙の下のコードを読めませんでした。明るいところで、ぶれないように撮ってください'};
  return {format: code.format, w: t.w, h: t.h, ink: extractInk(img, t, opts)};
}
