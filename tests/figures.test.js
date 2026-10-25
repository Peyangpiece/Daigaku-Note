import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIGURES,
  activeParams,
  cleanLabels,
  cleanParams,
  defaultLabels,
  figureOf,
  figureSvg,
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
    ['fn', 'a', 'p', 'q', 'dom', 'region']
  );
  assert.deepEqual(
    activeParams(coord, {fn: 'linear', dom: 'on'}).map((s) => s.key),
    ['fn', 'a', 'b', 'dom', 'x1', 'inc1', 'x2', 'inc2', 'range', 'region']
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
