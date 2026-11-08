import test from 'node:test';
import assert from 'node:assert/strict';
import {pageGeometry, scanDesign} from '../src/shared/notebooks.js';
import {findMarkers, homography, pageTransform, project, readCode, readScan} from '../src/shared/scan-read.js';

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** スキャン用の紙を k px/mm で描く（罫・目印・コードと、書いた線 strokes：[[x1, y1, x2, y2, 色]] mm） */
function paper(format, k, strokes) {
  const g = pageGeometry(scanDesign(format));
  const W = Math.round(g.w * k),
    H = Math.round(g.h * k);
  const d = new Uint8ClampedArray(W * H * 4).fill(255);
  const dot = (x, y, r, rgb) => {
    for (let v = Math.floor((y - r) * k); v <= Math.ceil((y + r) * k); v++)
      for (let u = Math.floor((x - r) * k); u <= Math.ceil((x + r) * k); u++) {
        if (u < 0 || v < 0 || u >= W || v >= H) continue;
        if ((u / k - x) ** 2 + (v / k - y) ** 2 > r * r) continue;
        d.set([...rgb, 255], (v * W + u) * 4);
      }
  };
  const line = (x1, y1, x2, y2, r, rgb) => {
    const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * k * 2) + 1;
    for (let i = 0; i <= n; i++) dot(x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, r, rgb);
  };
  for (const l of g.lines) line(l.x1, l.y1, l.x2, l.y2, Math.max(l.w / 2, 0.5 / k), hexRgb(l.c));
  for (const p of g.polys) {
    const xs = p.pts.map((q) => q[0]),
      ys = p.pts.map((q) => q[1]);
    for (let v = Math.floor(Math.min(...ys) * k); v < Math.ceil(Math.max(...ys) * k); v++)
      for (let u = Math.floor(Math.min(...xs) * k); u < Math.ceil(Math.max(...xs) * k); u++)
        if (u >= 0 && v >= 0 && u < W && v < H) d.set([...hexRgb(p.c), 255], (v * W + u) * 4);
  }
  for (const [x1, y1, x2, y2, c] of strokes) line(x1, y1, x2, y2, 0.35, hexRgb(c));
  return {g, img: {width: W, height: H, data: d}};
}

/** 紙を斜めから撮った写真にする（四隅を corners px へ。まわりは灰色の机、右下ほど暗い影） */
function photo(src, g, corners, PW, PH) {
  const Hm = homography(corners, [
    [0, 0],
    [g.w, 0],
    [g.w, g.h],
    [0, g.h]
  ]); // 写真 px → 紙 mm
  const k = src.width / g.w;
  const d = new Uint8ClampedArray(PW * PH * 4);
  for (let y = 0; y < PH; y++)
    for (let x = 0; x < PW; x++) {
      const [mx, my] = project(Hm, x + 0.5, y + 0.5);
      const shade = 1 - 0.35 * ((x / PW + y / PH) / 2); // 影
      let rgb = [150, 145, 140]; // 机
      if (mx >= 0 && my >= 0 && mx < g.w && my < g.h) {
        const u = Math.min(src.width - 1, Math.floor(mx * k)),
          v = Math.min(src.height - 1, Math.floor(my * k));
        const i = (v * src.width + u) * 4;
        rgb = [src.data[i], src.data[i + 1], src.data[i + 2]];
      }
      d.set([...rgb.map((c) => c * shade), 255], (y * PW + x) * 4);
    }
  return {width: PW, height: PH, data: d};
}

test('取り込み：斜めに撮った紙から目印・向き・形式を読み、書いた線だけを取り出す（罫と影は消える）', () => {
  const strokes = [
    [40, 60, 120, 60, '#1a1a1a'], // 黒
    [40, 100, 120, 130, '#1f3fbf'], // 青
    [40, 160, 100, 160, '#c8322d'] // 赤
  ];
  const {g, img} = paper('a7', 6, strokes);
  const shot = photo(
    img,
    g,
    [
      [140, 90],
      [1020, 140],
      [1080, 1420],
      [90, 1380]
    ],
    1200,
    1500
  );
  const marks = findMarkers(shot);
  assert.ok(marks, '目印を見つける');
  assert.ok(marks.tl[0] < marks.tr[0] && marks.tl[1] < marks.bl[1], '向き');
  const t = pageTransform(marks);
  assert.deepEqual([t.w, t.h], [182, 257], 'B5 縦');
  assert.deepEqual(readCode(shot, t), {format: 'a7', version: 1});

  const r = readScan(shot, {scale: 4});
  assert.equal(r.format, 'a7');
  const alphaAt = (mx, my) => r.ink.data[(Math.round(my * 4) * r.ink.width + Math.round(mx * 4)) * 4 + 3];
  assert.ok(alphaAt(80, 60) > 128, '黒の線が残る');
  assert.ok(alphaAt(80, 115) > 128, '青の線が残る');
  assert.ok(alphaAt(70, 160) > 128, '赤の線が残る');
  // 罫（水色）・紙・目印は透明
  const ruled = pageGeometry(scanDesign('a7')).lines.find((l) => l.y1 > 180 && l.x1 === 0);
  assert.ok(alphaAt(150, ruled.y1) < 60, '罫は消える');
  assert.ok(alphaAt(150, 200.5 + 3) < 60, '紙は透明');
  assert.equal(alphaAt(8.5, 8.5), 0, '目印は取り出さない');
  // 線の色を保つ（赤い線は赤く）
  const p = (Math.round(160 * 4) * r.ink.width + Math.round(70 * 4)) * 4;
  assert.ok(r.ink.data[p] > r.ink.data[p + 2] + 40, '赤は赤のまま');
});

test('取り込み：逆さに撮った紙・横の原稿用紙も読める。目印がなければ理由を返す', () => {
  const {g, img} = paper('genkou', 5, [[60, 60, 90, 60, '#1a1a1a']]);
  // 横の紙を 180° 回して撮る（四隅の並びを入れ替える）
  const shot = photo(
    img,
    g,
    [
      [1160, 820],
      [80, 860],
      [60, 70],
      [1140, 40]
    ],
    1240,
    900
  );
  const r = readScan(shot, {scale: 3});
  assert.equal(r.format, 'genkou');
  assert.deepEqual([r.w, r.h], [257, 182], 'B5 横');
  const blank = {width: 400, height: 500, data: new Uint8ClampedArray(400 * 500 * 4).fill(255)};
  assert.match(readScan(blank).error, /目印/);
});
