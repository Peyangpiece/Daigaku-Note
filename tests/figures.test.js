import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIGURES,
  activeParams,
  cleanLabels,
  cleanParams,
  defaultLabels,
  figureOf,
  figureSize,
  figureSvg,
  fitFigure,
  drawToPlace,
  growLabel,
  growsWithSize,
  moveLabels,
  formulaOf,
  graphY
} from '../src/shared/figures.js';

test('素材：どの図も SVG になり、既定の文字は図の中（割合 0〜1 の近く）にある', () => {
  assert.ok(FIGURES.length >= 70);
  assert.equal(new Set(FIGURES.map((f) => f.id)).size, FIGURES.length, 'id が重ならない');
  for (const f of FIGURES) {
    const svg = figureSvg(f.id);
    assert.match(svg, /^<svg [^>]*viewBox="0 0 \d+ \d+"/, f.id);
    assert.doesNotMatch(svg, /NaN|undefined/, f.id);
    for (const l of defaultLabels(f.id)) {
      assert.ok(l.x >= -0.05 && l.x <= 1.05 && l.y >= -0.05 && l.y <= 1.05, `${f.id} の「${l.t}」が図の外`);
    }
  }
});

test('素材：グラフの式（一次は傾きと切片、二次は頂点と a、三次は係数）', () => {
  assert.equal(formulaOf({fn: 'linear', a: 2, b: 1}), 'y = 2x + 1');
  assert.equal(formulaOf({fn: 'linear', a: -1, b: -3}), 'y = −x − 3');
  assert.equal(formulaOf({fn: 'linear', a: 0, b: 0}), 'y = 0');
  assert.equal(formulaOf({fn: 'linear', a: 0.5, b: 0}), 'y = 0.5x');
  assert.equal(formulaOf({fn: 'quad', a: 2, p: 1, q: 3}), 'y = 2(x − 1)² + 3');
  assert.equal(formulaOf({fn: 'quad', a: -1, p: -2, q: -0.5}), 'y = −(x + 2)² − 0.5');
  assert.equal(formulaOf({fn: 'quad', a: 1, p: 0, q: 0}), 'y = x²');
  assert.equal(formulaOf({fn: 'cubic', a: 1, b: 0, c: -3, d: 2}), 'y = x³ − 3x + 2');
  assert.equal(formulaOf({fn: 'none'}), '');
  assert.equal(graphY({fn: 'quad', a: 2, p: 1, q: 3}, 1), 3, '頂点');
  assert.equal(graphY({fn: 'quad', a: 2, p: 1, q: 3}, 2), 5);
  assert.equal(graphY({fn: 'linear', a: 2, b: 1}, 3), 7);
  assert.equal(graphY({fn: 'cubic', a: 1, b: 0, c: -3, d: 2}, 2), 4);
  const svg = figureSvg('fig-coord', {fn: 'quad', a: 1, p: 1, q: -2});
  assert.match(svg, /data-curve/, '曲線を描く（押すと式を入れられる）');
  assert.match(svg, /y = \(x − 1\)² − 2/);
  assert.doesNotMatch(figureSvg('fig-coord'), /data-curve/, '式なしなら曲線なし');
});

test('素材：決め事を整える（範囲・候補・使う項目）。前の版の正多角形の id も読める', () => {
  assert.deepEqual(cleanParams('fig-beaker', {level: 150, x: 1, cap: '1000'}), {level: 100, cap: '100'});
  assert.deepEqual(cleanParams('fig-beaker', null), {level: 45, cap: '100'});
  assert.match(figureSvg('fig-beaker', {cap: '200'}), />200</, '目盛りの数字（容量 200 mL）');
  assert.doesNotMatch(figureSvg('fig-beaker', {cap: '0'}), />mL</);
  assert.equal(cleanParams('fig-coord', {fn: 'sin'}).fn, 'none');
  assert.equal(cleanParams('fig-parabola', {}).fn, 'quad', '放物線の既定は二次関数');
  assert.equal(cleanParams('fig-coord', {fn: 'quad', a: 0.25}).a, 0.3, '0.1 刻み');
  const coord = figureOf('fig-coord');
  assert.deepEqual(
    activeParams(coord, {fn: 'quad'}).map((s) => s.key),
    ['fn', 'xr', 'yr', 'a', 'p', 'q', 'dom', 'region']
  );
  assert.deepEqual(
    activeParams(coord, {fn: 'linear', dom: 'on'}).map((s) => s.key),
    ['fn', 'xr', 'yr', 'a', 'b', 'dom', 'x1', 'inc1', 'x2', 'inc2', 'range', 'region']
  );
  assert.equal(figureOf('fig-pentagon').id, 'fig-polygon');
  assert.equal(cleanParams('fig-pentagon', {}).n, 5);
  assert.match(figureSvg('fig-atom', {z: 11}), />Na</, '原子番号 11 はナトリウム');
});

test('素材：書き換えた文字を整える（空は捨て、長さ・数・位置を収める）', () => {
  assert.equal(cleanLabels('x'), null);
  assert.deepEqual(
    cleanLabels([
      {x: 0.5, y: 2, t: '5 cm', m: false, s: 99},
      {x: 0.1, y: 0.1, t: '  '},
      {x: 'a', y: 0, t: 'A'}
    ]),
    [{x: 0.5, y: 1.2, t: '5 cm'}]
  );
  assert.deepEqual(cleanLabels([{x: 0.2, y: 0.3, t: 'θ', m: true, s: 18}]), [{x: 0.2, y: 0.3, t: 'θ', m: true, s: 18}]);
  assert.equal(cleanLabels(Array.from({length: 60}, () => ({x: 0, y: 0, t: 'a'}))).length, 40);
  assert.equal(cleanLabels([{x: 0, y: 0, t: 'あ'.repeat(50)}])[0].t.length, 40);
  const svg = figureSvg('fig-circle', null, [{x: 0.5, y: 0.5, t: '<5cm>'}]);
  assert.match(svg, /&lt;5cm&gt;/, '文字は SVG の中で符号にする');
});

test('素材：定義域・値域・領域（不等式）', async () => {
  const {domainText, rangeText, valueRange} = await import('../src/shared/figures.js');
  const p = cleanParams('fig-coord', {fn: 'quad', a: 1, p: 0, q: 0, dom: 'on', x1: -1, x2: 2, inc1: '1', inc2: '0'});
  assert.equal(domainText(p), '−1 ≦ x < 2');
  assert.deepEqual(valueRange(p), {min: 0, max: 4, minIn: true, maxIn: false}, '最小は頂点で取り、最大は含まない端');
  assert.equal(rangeText(p), '0 ≦ y < 4');
  assert.equal(formulaOf({...p, region: 'ge'}), 'y ≧ x²（−1 ≦ x < 2）');
  const lin = cleanParams('fig-coord', {fn: 'linear', a: -2, b: 1, dom: 'on', x1: 0, x2: 3, inc1: '0', inc2: '1'});
  assert.equal(rangeText(lin), '−5 ≦ y < 1', '減る関数：右の端が最小');
  assert.equal(
    valueRange(cleanParams('fig-coord', {fn: 'linear', a: 1, b: 0})),
    null,
    '定義域を決めなければ値域は出さない'
  );
  assert.equal(formulaOf(cleanParams('fig-coord', {fn: 'linear', a: 1, b: 1, region: 'lt'})), 'y < x + 1');
  const svg = figureSvg('fig-coord', {...p, region: 'gt', range: '1'});
  assert.match(svg, /fill-opacity="0.13"/, '領域を塗る');
  assert.match(svg, /stroke-dasharray="6 4"/, '境界を含まない領域は点線');
  assert.match(svg, /fill="#fff" stroke="#d6336c"/, '含まない端は白い丸');
  assert.match(svg, /値域：0 ≦ y &lt; 4/);
});

test('伸びる図：表・数直線・座標平面は、伸ばした大きさに合わせてます・目盛りの数が増える', () => {
  // 表：ます 1 つは 56×28。前の版の 3×3・4×5 は「表」の決め事に読み替える
  assert.deepEqual(figureSize('fig-table', null), {w: 172, h: 88});
  assert.deepEqual(figureSize('fig-table-4x5', null), {w: 228, h: 144});
  assert.deepEqual(fitFigure('fig-table', {cols: 3, rows: 3}, 290, 120), {cols: 5, rows: 4});
  assert.deepEqual(fitFigure('fig-table', {}, 5, 5), {cols: 1, rows: 1}, '小さくても 1 ます');
  assert.equal(growLabel('fig-table', {cols: 4, rows: 2}), '横 4 × 縦 2');
  // 数直線：右へ伸ばすと目盛りが増える（左の端の数はそのまま）
  assert.deepEqual(figureSize('fig-numline', null), {w: 260, h: 64}, 'はじめは前の版と同じ大きさ');
  const nl = fitFigure('fig-numline', {lo: -2}, 500, 64);
  assert.equal(nl.n, 12);
  assert.equal(defaultLabels('fig-numline', nl).at(-1).t, '9');
  // 座標平面：横に伸ばすと x の、縦に伸ばすと y の目盛りが増える（原点は真ん中）
  assert.deepEqual(figureSize('fig-coord', null), {w: 240, h: 240}, 'はじめは前の版と同じ大きさ');
  const c = fitFigure('fig-coord', {fn: 'none'}, 400, 200);
  assert.deepEqual([c.xr, c.yr], [20, 10]);
  assert.deepEqual(figureSize('fig-coord', c), {w: 400, h: 200});
  assert.match(figureSvg('fig-coord', c), /viewBox="0 0 400 200"/);
  assert.match(figureSvg('fig-coord', c), />15</, '横に伸ばすと 15 の目盛りの数も出る');
  assert.ok(growsWithSize('fig-table') && growsWithSize('fig-coord') && !growsWithSize('fig-circle'));
  // 書き換えた文字は、図の中の同じ所に残す（座標平面は真ん中から）
  assert.deepEqual(moveLabels('fig-table', [{x: 0.5, y: 0.5, t: 'a'}], {w: 100, h: 100}, {w: 200, h: 50}), [
    {x: 0.25, y: 1, t: 'a'}
  ]);
  assert.deepEqual(moveLabels('fig-coord', [{x: 0.5, y: 0.5, t: 'O'}], {w: 240, h: 240}, {w: 400, h: 200}), [
    {x: 0.5, y: 0.5, t: 'O'}
  ]);
});

test('伸びる図（ほかの教科）：方眼・原稿用紙・4 線・五線譜・年表も、伸ばすとます・段・目盛りが増える', () => {
  // はじめは前の版と同じ大きさ（決め事のない、前に貼った図もそのまま）
  for (const [id, w, h] of [
    ['fig-graph-paper', 200, 200],
    ['fig-genko', 200, 200],
    ['fig-four-lines', 280, 56],
    ['fig-staff', 280, 60],
    ['fig-timeline', 280, 70]
  ]) {
    assert.deepEqual(figureSize(id, null), {w, h}, id);
    assert.ok(growsWithSize(id), id);
  }
  assert.deepEqual(fitFigure('fig-graph-paper', null, 305, 120), {cols: 31, rows: 12});
  assert.deepEqual(fitFigure('fig-genko', null, 400, 100), {cols: 20, rows: 5});
  // 4 線・五線譜：横は線の長さ、縦は段の数
  const fl = fitFigure('fig-four-lines', null, 400, 170);
  assert.deepEqual(fl, {len: 10, rows: 3});
  assert.equal((figureSvg('fig-four-lines', fl).match(/H396/g) ?? []).length, 12, '3 段 × 4 本');
  assert.deepEqual(fitFigure('fig-staff', null, 280, 125), {len: 7, rows: 2});
  // 年表：右へ伸ばすと目盛りが増える。縦は変わらない
  const tl = fitFigure('fig-timeline', null, 500, 300);
  assert.equal(tl.n, 11);
  assert.deepEqual(figureSize('fig-timeline', tl), {w: 510, h: 70});
  // 押したまま広げて貼るのは、ます・段の数を決める図
  assert.equal(drawToPlace('fig-table'), '縦・横のますの数');
  assert.equal(drawToPlace('fig-staff'), '線の長さと段の数');
  assert.equal(drawToPlace('fig-timeline'), '');
  assert.equal(drawToPlace('fig-circle'), '');
});
