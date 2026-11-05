import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundsOf,
  createCapture,
  decodePoints,
  drawMode,
  inkMode,
  modeStyle,
  encodePoints,
  outlinePath,
  speedPressure,
  strokeOptions,
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
  const strong = strokeOutline(
    line().map(([x, y]) => [x, y, 1]),
    {size: 2, thinning: 0.5}
  );
  const weak = strokeOutline(
    line().map(([x, y]) => [x, y, 0]),
    {size: 2, thinning: 0.5}
  );
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

test('筆圧なしのペン：どこも同じ太さ（筆圧・書き始め・書き終わりで細くならない）', () => {
  assert.deepEqual(strokeOptions(2, {pressure: 'even'}), {size: 2, thinning: 0, taperStart: 0, taperEnd: 0});
  const pts = Array.from({length: 30}, (_, i) => [i * 2, 0, i % 2 ? 0.1 : 1]);
  const out = strokeOutline(pts, strokeOptions(2, {pressure: 'even'}));
  // 途中の輪郭の点は、線（y = 0）からどれも半分の太さ（1）だけ離れる
  const mids = out.filter(([x]) => x > 4 && x < 54);
  assert.ok(mids.length > 10);
  for (const [, y] of mids) assert.ok(Math.abs(Math.abs(y) - 1) < 1e-9, `太さが一定でない: ${y}`);
  // 筆圧のあるペンは太さが変わる
  const varied = strokeOutline(pts, strokeOptions(2)).filter(([x]) => x > 4 && x < 54);
  assert.ok(varied.some(([, y]) => Math.abs(Math.abs(y) - 1) > 0.1));
});

test('書き味の受け渡し：保存した style → 描き方、ペン → 書き味 → style', () => {
  assert.equal(inkMode({}), true);
  assert.equal(inkMode({pressure: false}), false);
  assert.equal(inkMode({pressure: 'even'}), 'even');
  assert.equal(inkMode(undefined), true);
  assert.equal(drawMode({even: true}, 'pen'), 'even');
  assert.equal(drawMode({}, 'pen'), true);
  assert.equal(drawMode({}, 'mouse'), false);
  assert.deepEqual(modeStyle(true), {});
  assert.deepEqual(modeStyle(false), {pressure: false});
  assert.deepEqual(modeStyle('even'), {pressure: 'even'});
});

test('書き味（feel）：前の版の線は同じ形。書き味を変えると線の形が変わり、保存できる値に収める', async () => {
  const {FEEL_DEFAULT, cleanFeel, feelOf, feelStyle, strokePath, streamlineOf} = await import('../src/shared/ink.js');
  const pts = Array.from({length: 30}, (_, i) => [i * 2, Math.sin(i / 3) * 5, 0.3 + (i % 5) / 10]);
  assert.equal(strokePath(pts, 1.1), strokePath(pts, 1.1, {feel: FEEL_DEFAULT}), 'feel なしは前の版と同じ');
  assert.equal(
    strokePath(pts, 1.1, {pressure: false}),
    strokePath(pts, 1.1, {pressure: false, feel: FEEL_DEFAULT}),
    '指・マウスも前の版と同じ'
  );
  assert.notEqual(strokePath(pts, 1.1), strokePath(pts, 1.1, {feel: {th: 0.6, ts: 0.5, te: 2}}), '書き味で形が変わる');
  assert.equal(
    strokePath(pts, 1.1, {pressure: 'even'}),
    strokePath(pts, 1.1, {pressure: 'even', feel: {th: 0.6, ts: 0.5, te: 2}}),
    '筆圧なしは書き味によらず同じ太さ'
  );
  assert.deepEqual(
    cleanFeel({th: 2, ts: -1, te: '1.234', st: 0.5}),
    {th: 0.9, ts: 0, te: 1.23},
    '範囲に収め、st は保存しない'
  );
  assert.equal(cleanFeel({th: 'x', ts: 1, te: 1}), null);
  assert.deepEqual(feelOf({feel: {th: 0.3, ts: 1, te: 1}}), {th: 0.3, ts: 1, te: 1});
  assert.deepEqual(feelOf({f: {th: 0.3, ts: 1, te: 1}}), {th: 0.3, ts: 1, te: 1}, 'メモの線は f');
  assert.deepEqual(feelStyle({th: 0.3, ts: 1, te: 1}, 'even'), {}, '筆圧なしの線には入れない');
  assert.ok(streamlineOf({st: 0.3}, 'mouse') > streamlineOf({st: 0.3}, 'pen'), '指・マウスは手ぶれ補正が強め');
});

test('書き味のクセ：スイートスポット（向きで細くなる）と紙をとらえる手ごたえ（ゆらぎ）。上下を返しても同じ太さ', async () => {
  const {cleanFeel, strokeOutline, strokeOptions} = await import('../src/shared/ink.js');
  const line = (dx, dy) => Array.from({length: 20}, (_, i) => [i * dx, i * dy, 0.5]);
  const widthAt = (pts, opts) => {
    const o = strokeOutline(pts, opts);
    const n = (o.length - 16) / 2; // 左・終わりの半円（7 点）・右・始まりの半円（7 点）
    const i = Math.floor(n / 2);
    const l = o[i],
      r = o[o.length - 8 - i];
    return Math.hypot(l[0] - r[0], l[1] - r[1]);
  };
  const base = {size: 2, thinning: 0, taperStart: 0, taperEnd: 0};
  const v = widthAt(line(0, 3), {...base, sweet: 0.3});
  const h = widthAt(line(3, 0), {...base, sweet: 0.3});
  assert.ok(Math.abs(v - 2) < 0.05, '縦の線は太さのまま');
  assert.ok(Math.abs(h - 2 * 0.7) < 0.05, '横の線は sweet の割合だけ細い');
  assert.ok(Math.abs(widthAt(line(0, -3), {...base, sweet: 0.3}) - v) < 1e-9, '上下を返しても同じ');
  const g = strokeOutline(line(3, 0), {...base, grain: 0.1});
  const plain = strokeOutline(line(3, 0), base);
  assert.notDeepEqual(g, plain, 'ゆらぎで太さが少し変わる');
  assert.deepEqual(strokeOutline(line(3, 0), {...base, grain: 0.1}), g, 'ゆらぎは毎回同じ');
  assert.deepEqual(
    cleanFeel({th: 0.3, ts: 1, te: 1, sw: 0.9, gr: 0}),
    {th: 0.3, ts: 1, te: 1, sw: 0.5},
    'sw は 0.5 まで、0 は持たない'
  );
  assert.equal(
    strokeOptions(1, {pressure: 'even', feel: {th: 0.3, ts: 1, te: 1, sw: 0.3}}).sweet,
    undefined,
    '筆圧なしはクセもなし'
  );
});

test('書いている間の下書き（createDraft）：前の区切りは固め、描き直すのは先だけ。長い線でも 1 回の手間が増えない（v0.16.27）', async () => {
  const {createDraft, strokeOutline} = await import('../src/shared/ink.js');
  const pts = Array.from({length: 3000}, (_, i) => [i * 0.3, Math.sin(i / 20) * 20, 0.5 + 0.3 * Math.sin(i / 7)]);
  const opts = {size: 1.1, thinning: 0.35, taperStart: 1.3, taperEnd: 1.6};
  assert.deepEqual(
    strokeOutline(pts.slice(0, 50), opts),
    strokeOutline(pts.slice(0, 50), {...opts, from: 0, tail: true}),
    '前の版と同じ形'
  );
  const draft = createDraft(1.1, {feel: {th: 0.35, ts: 1.2, te: 1.5}});
  let frozen = 0;
  let maxLive = 0;
  for (let n = 1; n <= pts.length; n += 3) {
    const r = draft.update(pts.slice(0, n), [[pts[n - 1][0] + 1, pts[n - 1][1], 0.5]]);
    frozen += r.frozen.length;
    maxLive = Math.max(maxLive, r.live.length);
    assert.ok(r.live.startsWith('M'), '先のパス');
  }
  assert.ok(frozen > 30, `区切りを固める（${frozen}）`);
  assert.ok(maxLive < 12000, `先のパスは短いまま（${maxLive} 文字）`);
});
