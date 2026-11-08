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
 * 紙をまっすぐ・原寸（scale px/mm）に直し、紙の白さで割る（影・色むらを消す）。
 * 戻り {W, H, n: Float32Array（RGB 0〜1。紙の白さで割った色）, dark: Float32Array（緑の暗さ 0〜1）, use: Uint8Array（取り出してよいところ）}。
 * 緑の暗さで線を見分ける（ドロップアウトカラーの水色は緑が明るいので小さく、黒・青・赤のインクと鉛筆は大きい）
 */
function rectify(img, t, scale) {
  const W = Math.round(t.w * scale);
  const Hh = Math.round(t.h * scale);
  const rgb = new Float32Array(W * Hh * 3);
  // 1. まっすぐに直す（双一次で読む）
  const {width: IW, height: IH, data} = img;
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = t.H;
  for (let v = 0; v < Hh; v++)
    for (let u = 0; u < W; u++) {
      const mx = (u + 0.5) / scale,
        my = (v + 0.5) / scale;
      const q = h6 * mx + h7 * my + h8;
      const x = (h0 * mx + h1 * my + h2) / q - 0.5,
        y = (h3 * mx + h4 * my + h5) / q - 0.5;
      const x0 = Math.floor(x),
        y0 = Math.floor(y);
      const fx = x - x0,
        fy = y - y0;
      const xa = Math.min(IW - 1, Math.max(0, x0)),
        xb = Math.min(IW - 1, Math.max(0, x0 + 1));
      const ya = Math.min(IH - 1, Math.max(0, y0)) * IW,
        yb = Math.min(IH - 1, Math.max(0, y0 + 1)) * IW;
      const i00 = (ya + xa) * 4,
        i10 = (ya + xb) * 4,
        i01 = (yb + xa) * 4,
        i11 = (yb + xb) * 4;
      const w00 = (1 - fx) * (1 - fy),
        w10 = fx * (1 - fy),
        w01 = (1 - fx) * fy,
        w11 = fx * fy;
      const o = (v * W + u) * 3;
      for (let c = 0; c < 3; c++)
        rgb[o + c] = data[i00 + c] * w00 + data[i10 + c] * w10 + data[i01 + c] * w01 + data[i11 + c] * w11;
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
  // 3. 紙の白さで割る。目印・コード・紙のふち 2 mm は取り出さない
  const n = new Float32Array(W * Hh * 3);
  const dark = new Float32Array(W * Hh);
  const use = new Uint8Array(W * Hh);
  const hidden = hiddenRects(t.w, t.h).map(([x, y, w, h]) => [x * scale, y * scale, (x + w) * scale, (y + h) * scale]);
  const edge = 2 * scale;
  for (let v = 0; v < Hh; v++)
    for (let u = 0; u < W; u++) {
      const i = v * W + u;
      for (let c = 0; c < 3; c++) n[i * 3 + c] = Math.min(1, rgb[i * 3 + c] / bgAt(u, v, c));
      dark[i] = 1 - n[i * 3 + 1];
      use[i] =
        u >= edge &&
        v >= edge &&
        u < W - edge &&
        v < Hh - edge &&
        !hidden.some(([x0, y0, x1, y1]) => u >= x0 && u < x1 && v >= y0 && v < y1)
          ? 1
          : 0;
    }
  return {W, H: Hh, n, dark, use};
}

/**
 * 書いた線を写真のまま取り出す（形・かすれ・色は描き直さない）。戻り {width, height, scale, idx, rgb, a, d}：
 * 線のあたりの画素だけを持つ（idx：画素の番号、rgb：インクの色、a：濃さ 0〜255、d：線の真ん中からの距離 px×16）。
 * inkImage で、使ったボールペンの太さより外（写真のぼけ・にじみで太って見える分）を切って画像にする
 */
export function extractInk(img, t, {scale = 12, from = 0.3, low = 0.06, maxWidth = 0.8} = {}) {
  const r = rectify(img, t, scale);
  const {W, H} = r;
  const N = W * H;
  // 線（濃いところ）を細線化して、線の真ん中を出す
  const m = new Uint8Array(N);
  for (let i = 0; i < N; i++) m[i] = r.use[i] && r.dark[i] > from ? 1 : 0;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (
        m[i] &&
        !(m[i - 1] | m[i + 1] | m[i - W] | m[i + W] | m[i - W - 1] | m[i - W + 1] | m[i + W - 1] | m[i + W + 1])
      )
        m[i] = 0; // まわりに 1 つもない点は写真のざらつき
    }
  // 小さな抜け（ボールペンのかすれ・写真のざらつき）を埋める：3×3 で広げてから縮める
  const grow = (src, on) => {
    const out = new Uint8Array(N);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const any =
          src[i] |
          src[i - 1] |
          src[i + 1] |
          src[i - W] |
          src[i + W] |
          src[i - W - 1] |
          src[i - W + 1] |
          src[i + W - 1] |
          src[i + W + 1];
        const all =
          src[i] &
          src[i - 1] &
          src[i + 1] &
          src[i - W] &
          src[i + W] &
          src[i - W - 1] &
          src[i - W + 1] &
          src[i + W - 1] &
          src[i + W + 1];
        out[i] = on ? any : all;
      }
    return out;
  };
  const body = grow(grow(m, true), false);
  for (let i = 0; i < N; i++) if (!r.use[i]) body[i] = 0;
  // seed のところからの距離（2 回なめる近似。斜めは √2）。carry の配列は、いちばん近い seed の値を運ぶ
  const S2 = Math.SQRT2;
  const chamfer = (seed, carry = []) => {
    const dist = new Float32Array(N).fill(1e9);
    for (let i = 0; i < N; i++) if (seed[i]) dist[i] = 0;
    const relax = (i, j, w) => {
      if (dist[j] + w < dist[i]) {
        dist[i] = dist[j] + w;
        for (const c of carry) c[i] = c[j];
      }
    };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (x > 0) relax(i, i - 1, 1);
        if (y > 0) {
          relax(i, i - W, 1);
          if (x > 0) relax(i, i - W - 1, S2);
          if (x < W - 1) relax(i, i - W + 1, S2);
        }
      }
    for (let y = H - 1; y >= 0; y--)
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        if (x < W - 1) relax(i, i + 1, 1);
        if (y < H - 1) {
          relax(i, i + W, 1);
          if (x < W - 1) relax(i, i + W + 1, S2);
          if (x > 0) relax(i, i + W - 1, S2);
        }
      }
    return dist;
  };
  // 線の中の、紙からの距離（線の真ん中では線の太さの半分）
  const outside = new Uint8Array(N);
  for (let i = 0; i < N; i++) outside[i] = body[i] ? 0 : 1;
  const inner = chamfer(outside);
  // ひと続きの線ごとのインクの色（濃いところほど重く平均）→ 黒・青・赤・鉛筆
  const label = new Int32Array(N).fill(-1);
  const tones = [];
  const stack = [];
  for (let s0 = 0; s0 < N; s0++) {
    if (!body[s0] || label[s0] >= 0) continue;
    const id = tones.length;
    const sum = [0, 0, 0];
    let wsum = 0;
    label[s0] = id;
    stack.push(s0);
    while (stack.length) {
      const i = stack.pop();
      const wt = r.dark[i] * r.dark[i];
      for (let c = 0; c < 3; c++) sum[c] += r.n[i * 3 + c] * wt;
      wsum += wt;
      const x = i % W;
      for (const [dx, dy] of NB) {
        const u = x + dx;
        const j = i + dy * W + dx;
        if (u < 0 || u >= W || j < 0 || j >= N || !body[j] || label[j] >= 0) continue;
        label[j] = id;
        stack.push(j);
      }
    }
    tones.push(TONE_ORDER.indexOf(inkColor(sum.map((v) => v / (wsum || 1)))));
  }
  // 線の真ん中（細線化）と、真ん中からの距離。いちばん近い真ん中の濃さ・太さの半分・線の番号を運ぶ
  const mid = body.slice();
  thin(mid, W, H);
  const core = new Float32Array(N);
  const half = new Float32Array(N);
  const comp = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++)
    if (mid[i]) {
      core[i] = r.dark[i];
      half[i] = Math.max(0.5, inner[i] - 0.5);
      comp[i] = label[i];
    }
  const dist = chamfer(mid, [core, half, comp]);
  // 線のあたり（いちばん太いボールペンの半分＋ 1 px まで）の、少しでも暗い画素を持つ。
  // 濃さは真ん中の濃さに対する割合、色は白い紙に重ねたとき写真と同じ色になるよう、白との混ざりを戻した色
  const reach = (maxWidth / 2) * scale + 1;
  const keep = [];
  for (let i = 0; i < N; i++)
    if (r.use[i] && dist[i] <= reach && core[i] > 0 && (r.dark[i] > low || body[i])) keep.push(i);
  const n = keep.length;
  const idx = new Uint32Array(n);
  const rgb = new Uint8Array(n * 3);
  const a = new Uint8Array(n);
  const d = new Uint8Array(n);
  const hw = new Uint8Array(n);
  const tone = new Uint8Array(n);
  keep.forEach((i, k) => {
    const al = Math.min(1, Math.max(0, r.dark[i]) / core[i]);
    idx[k] = i;
    a[k] = Math.round(255 * al);
    d[k] = Math.min(255, Math.round(dist[i] * 16));
    hw[k] = Math.min(255, Math.round(half[i] * 16));
    tone[k] = Math.max(0, tones[comp[i]] ?? 0);
    for (let c = 0; c < 3; c++) {
      const v = 1 - (1 - r.n[i * 3 + c]) / Math.max(al, 1e-3);
      rgb[k * 3 + c] = Math.round(255 * Math.min(1, Math.max(0, v)));
    }
  });
  return {width: W, height: H, scale, idx, rgb, a, d, hw, tone};
}

/** 書いた線の色（紙の白さで割った色の平均）→ ペンの色 */
export const SCAN_INK_COLORS = {black: '#262626', blue: '#1d4fa8', red: '#cf2e2e', pencil: '#5a5e63'};
const TONE_ORDER = Object.values(SCAN_INK_COLORS);
const TONE_RGB = TONE_ORDER.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
function inkColor([r, g, b]) {
  if (b - r > 0.12 && b > g) return SCAN_INK_COLORS.blue;
  if (r - g > 0.18 && r - b > 0.1) return SCAN_INK_COLORS.red;
  return (r + g + b) / 3 > 0.42 ? SCAN_INK_COLORS.pencil : SCAN_INK_COLORS.black;
}

/**
 * 取り出した線を画像（RGBA。線のないところは透明）にする。width（mm）：使ったボールペンの線の太さ。
 * 線の真ん中から太さの半分より外は消す（写真のぼけで太って見える分）。細い線は細いまま（太くはしない）。
 * tidy：かすれと色を整える（字の形と太さはそのまま）。線ごとに黒・青・赤・鉛筆の 1 色にし、
 * 線の真ん中からその線の太さ（ボールペンの太さまで）の中を、むらなく塗る
 */
export function inkImage(ink, width, {tidy = false} = {}) {
  const out = new Uint8ClampedArray(ink.width * ink.height * 4);
  const R = (width / 2) * ink.scale;
  for (let k = 0; k < ink.idx.length; k++) {
    const dk = ink.d[k] / 16;
    const cut = Math.min(1, Math.max(0, R + 0.5 - dk));
    if (!cut) continue;
    const o = ink.idx[k] * 4;
    let al = ink.a[k] / 255;
    if (tidy) {
      const fill = Math.min(1, Math.max(0, Math.min(R, ink.hw[k] / 16) + 0.5 - dk));
      al = Math.max(al, fill);
      const c = TONE_RGB[ink.tone[k]];
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
    } else {
      out[o] = ink.rgb[k * 3];
      out[o + 1] = ink.rgb[k * 3 + 1];
      out[o + 2] = ink.rgb[k * 3 + 2];
    }
    out[o + 3] = Math.round(255 * al * cut);
  }
  return {width: ink.width, height: ink.height, data: out};
}

// 8 近傍
const NB = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1]
];

/** 細線化（Zhang–Suen）。m は 0/1 の Uint8Array（書き換える） */
function thin(m, W, H) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? m[y * W + x] : 0);
  let changed = true;
  const del = [];
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      del.length = 0;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          if (!m[y * W + x]) continue;
          const p = [
            at(x, y - 1),
            at(x + 1, y - 1),
            at(x + 1, y),
            at(x + 1, y + 1),
            at(x, y + 1),
            at(x - 1, y + 1),
            at(x - 1, y),
            at(x - 1, y - 1)
          ];
          const b = p.reduce((a, c) => a + c, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) a++;
          if (a !== 1) continue;
          if (step === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6])
            continue;
          del.push(y * W + x);
        }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
  }
}

/** まとめて読む。戻り {format, w, h, ink}（ink は extractInk。inkImage で画像にする）か {error}（日本語の理由） */
export function readScan(img, opts) {
  const marks = findMarkers(img);
  if (!marks) return {error: '四隅の目印が見つかりませんでした。紙全体が写るように撮ってください'};
  const t = pageTransform(marks);
  if (!t) return {error: '紙の形を読めませんでした。もう一度撮ってください'};
  const code = readCode(img, t);
  if (!code) return {error: '紙の下のコードを読めませんでした。明るいところで、ぶれないように撮ってください'};
  return {format: code.format, w: t.w, h: t.h, ink: extractInk(img, t, opts)};
}
