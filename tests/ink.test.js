import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundsOf,
  createCapture,
  decodePoints,
  encodePoints,
  outlinePath,
  speedPressure,
  strokeOutline,
  strokePath,
  touchesStroke
} from '../src/shared/ink.js';

const line = (n = 20) => Array.from({length: n}, (_, i) => [100 + i * 2, 200, 0.5]);

test('点の並びは 0.01 の細かさで本文に入れ、取り出せる。形が不正なら null', () => {
  const pts = [
    [10.123, 20.456, 0.5],
    [11, 21, 1]
  ];
  assert.deepEqual(decodePoints(encodePoints(pts)), [
    [10.12, 20.46, 0.5],
    [11, 21, 1]
  ]);
  assert.equal(decodePoints('[1,2]'), null);
  assert.equal(decodePoints('[1,2,"x"]'), null);
  assert.equal(decodePoints('not json'), null);
  assert.equal(decodePoints('[]'), null);
  assert.deepEqual(decodePoints('[1,2,5]'), [[1, 2, 1]], '筆圧は 0〜1 に収める');
});

test('輪郭：線の両側を通って閉じる。太さは筆圧で変わり、端は細くなる', () => {
  const o = strokeOutline(line(), {size: 2, thinning: 0.5});
  assert.ok(o.length > 40);
  const ys = o.map((p) => p[1]);
  assert.ok(Math.max(...ys) <= 201.01 && Math.min(...ys) >= 198.99, '太さ 2 の線の上下に収まる');
  const strong = strokeOutline(line().map(([x, y]) => [x, y, 1]), {size: 2, thinning: 0.5});
  const weak = strokeOutline(line().map(([x, y]) => [x, y, 0]), {size: 2, thinning: 0.5});
  const spread = (o2) => Math.max(...o2.map((p) => p[1])) - Math.min(...o2.map((p) => p[1]));
  assert.ok(spread(strong) > spread(weak), '強く押すほど太い');
  const tapered = strokeOutline(line(), {size: 2, taperStart: 10, taperEnd: 10});
  const first = tapered[0][1] - 200;
  const mid = tapered[10][1] - 200;
  assert.ok(Math.abs(first) < Math.abs(mid), '書き始めは細い');
});

test('押しただけの点は丸。パスは閉じた 2 次曲線で、PDF 用は上下を返す', () => {
  const dot = strokeOutline([[5, 5, 0.5]], {size: 2});
  assert.equal(dot.length, 16);
  const d = outlinePath(dot);
  assert.match(d, /^M[\d.]+,[\d.]+Q/);
  assert.match(d, /Z$/);
  assert.match(outlinePath(dot, {flipY: true}), /^M[\d.]+,-[\d.]+Q/);
  assert.equal(outlinePath([[0, 0]]), '');
  assert.ok(strokePath(line(), 1.1).length > 50);
});

test('なぞる点：近すぎる点は捨て、なめらかにし、離したところまで届かせる', () => {
  const cap = createCapture({minGap: 1, streamline: 0.5});
  assert.equal(cap.add(0, 0, 0.5), true);
  assert.equal(cap.add(0.5, 0, 0.5), false, '0.25 しか動かない点は捨てる');
  assert.equal(cap.add(10, 0, 0.5), true);
  assert.equal(cap.points.at(-1)[0], 5, '半分だけ寄せる');
  const pts = cap.finish(10, 0, 0.5);
  assert.equal(pts.at(-1)[0], 10);
});

test('筆圧の代わり：速いほど細く（0.3〜0.6 に寄っていく）', () => {
  let p = 0.5;
  for (let i = 0; i < 30; i++) p = speedPressure(p, 5);
  assert.ok(p < 0.32);
  for (let i = 0; i < 30; i++) p = speedPressure(p, 0);
  assert.ok(p > 0.58);
});

test('消しゴム：線に触れたか（太さの半分も含める）・囲む四角', () => {
  const pts = line();
  assert.ok(touchesStroke(pts, 1, 110, 203, 2.6));
  assert.ok(!touchesStroke(pts, 1, 110, 205, 2));
  assert.ok(touchesStroke([[0, 0, 0.5]], 2, 2, 0, 1.1));
  assert.deepEqual(boundsOf(pts, 2), {x: 99, y: 199, w: 40, h: 2});
});
