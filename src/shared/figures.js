import {esc} from './html.js';
// 素材（左下の隅）：授業でよく使う図。SVG をその場で作る（画像ファイルを持たない）。副作用なし。
// ページに貼ると注釈の stamp（style.type = 'figure'、style.ref = id）になる。線は黒、塗りは淡い色。
// - 決め事（params）：図ごとに変えられる値（ビーカーの水の量・振り子の角度・グラフの式など）。schema は params の並び
// - 文字（labels）：x・y・O・θ・部分の名前など。図の上に別に置き、書き換え・足す・消すができる（辺の長さ・角度などを書き込む）。
//   位置は図の幅・高さに対する割合（大きさを変えても付いてくる）。書き換えていなければ、決め事に合わせた既定の文字を出す
// - 座標平面・放物線・一次関数のグラフ（graph）は、式の種類（なし・一次・二次・三次）と係数で曲線を描く
const INK = '#2b2b2b';
const SOFT = '#9aa3ad'; // 補助の線（方眼・点線）
const WATER = '#d6ebff';
export const LABEL_SERIF = "'Times New Roman',Times,serif";
export const LABEL_GOTHIC = "'Hiragino Kaku Gothic ProN','Hiragino Sans',sans-serif";
const r1 = (v) => Math.round(v * 10) / 10;
const rad = (deg) => (deg * Math.PI) / 180;

/** 矢印の先（x, y が先端。向きは角度 deg。0 が右） */
const head = (x, y, deg, fill = INK) =>
  `<path d="M0 0L-9 -4.5L-9 4.5Z" transform="translate(${r1(x)} ${r1(y)}) rotate(${r1(deg)})" fill="${fill}" stroke="none"/>`;
const arrow = (x1, y1, x2, y2, {color = INK, width} = {}) => {
  const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const k = 8 / (Math.hypot(x2 - x1, y2 - y1) || 1); // 先の手前で線を止める
  return `<path d="M${r1(x1)} ${r1(y1)}L${r1(x2 - (x2 - x1) * k)} ${r1(y2 - (y2 - y1) * k)}"${color !== INK ? ` stroke="${color}"` : ''}${width ? ` stroke-width="${width}"` : ''}/>${head(x2, y2, deg, color)}`;
};
const dash = 'stroke-dasharray="5 4"';
/** 正多角形の頂点（中心 cx, cy、半径 r、上の頂点から時計回り） */
export const polygonPoints = (n, cx, cy, r) =>
  Array.from({length: n}, (_, i) => {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
    return [r1(cx + r * Math.cos(a)), r1(cy + r * Math.sin(a))];
  });
const poly = (pts) => pts.map(([x, y]) => `${x},${y}`).join(' ');
const grid = (w, h, step, {from = 0, color = '#d5dae0', width = 1} = {}) => {
  const d = [];
  for (let v = from; v <= w; v += step) d.push(`M${v} 0V${h}`);
  for (let v = from; v <= h; v += step) d.push(`M0 ${v}H${w}`);
  return `<path d="${d.join('')}" stroke="${color}" stroke-width="${width}"/>`;
};
const axesPath = (w, h, ox, oy) => `${arrow(8, oy, w - 6, oy)}${arrow(ox, h - 8, ox, 6)}`;
const table = (cols, rows, cw = 56, ch = 28) => {
  const w = cols * cw,
    h = rows * ch;
  const d = [];
  for (let i = 1; i < cols; i++) d.push(`M${i * cw + 2} 2V${h + 2}`);
  for (let j = 1; j < rows; j++) d.push(`M2 ${j * ch + 2}H${w + 2}`);
  return {
    w: w + 4,
    h: h + 4,
    draw: () =>
      `<rect x="2" y="2" width="${w}" height="${ch}" fill="#eef1f5" stroke="none"/><rect x="2" y="2" width="${w}" height="${h}"/><path d="${d.join('')}"/>`
  };
};
/** 曲線の点の並びを path に（null の点で切る） */
const pathOf = (pts) => {
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
const spring = (x1, x2, y, n = 10, amp = 9) => {
  const pts = [[x1, y]];
  const lead = 8;
  const seg = (x2 - x1 - lead * 2) / n;
  pts.push([x1 + lead, y]);
  for (let i = 0; i < n; i++) pts.push([x1 + lead + seg * (i + 0.5), y + (i % 2 ? amp : -amp)]);
  pts.push([x2 - lead, y], [x2, y]);
  return `<path d="${pathOf(pts)}"/>`;
};
/** 天井・壁の斜線（x1〜x2 の横線の上に） */
const ceiling = (x1, x2, y) => {
  const d = [`M${x1} ${y}H${x2}`];
  for (let x = x1 + 4; x <= x2; x += 8) d.push(`M${x} ${y}l-6 -7`);
  return `<path d="${d.join('')}"/>`;
};
const wallLeft = (x, y1, y2) => {
  const d = [`M${x} ${y1}V${y2}`];
  for (let y = y1 + 4; y <= y2; y += 8) d.push(`M${x} ${y}l-7 -6`);
  return `<path d="${d.join('')}"/>`;
};
const ground = (x1, x2, y) => {
  const d = [`M${x1} ${y}H${x2}`];
  for (let x = x1 + 6; x <= x2; x += 10) d.push(`M${x} ${y}l-6 7`);
  return `<path d="${d.join('')}" stroke="${SOFT}"/><path d="M${x1} ${y}H${x2}"/>`;
};
const dot = (x, y, r = 2.5, fill = INK) =>
  `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="${fill}" stroke="none"/>`;
/** 引き出し線（部分の名前へ） */
const lead = (x1, y1, x2, y2) =>
  `<path d="M${r1(x1)} ${r1(y1)}L${r1(x2)} ${r1(y2)}" stroke="${SOFT}" stroke-width="1"/>`;

// ---- 文字（既定）：[x, y, 文字, {m: 数学の文字（斜体の明朝）, s: 大きさ}]。x・y は viewBox の点（文字の真ん中） ----
const M = (x, y, t, s) => [x, y, t, {m: true, s}];
const J = (x, y, t, s = 11) => [x, y, t, {s}];

// ---- グラフ（座標平面）：1 目盛り 10、原点は真ん中。x・y は −11〜11。目盛りの数は 5 ずつ（−10・−5・5・10） ----
export const GRAPH_FNS = [
  ['none', '式なし'],
  ['linear', '一次関数'],
  ['quad', '二次関数'],
  ['cubic', '三次関数']
];
const GU = 10; // 1 目盛り（viewBox）
const GS = 240; // グラフの大きさ（viewBox）
const GO = GS / 2; // 原点
const num = (v) => {
  const n = Number(Number(v).toFixed(3));
  return Object.is(n, -0) ? '0' : String(Math.abs(n));
};
/** 多項式の項を「y = …」の右辺に並べる。terms は [係数, 文字]（文字が '' なら定数） */
const polyText = (terms) => {
  let s = '';
  for (const [c, v] of terms) {
    if (!c) continue;
    const abs = Math.abs(c);
    const body = v && abs === 1 ? v : `${num(abs)}${v}`;
    s += s ? ` ${c < 0 ? '−' : '+'} ${body}` : `${c < 0 ? '−' : ''}${body}`;
  }
  return s || '0';
};
const REL = {none: '=', gt: '>', ge: '≧', lt: '<', le: '≦'};
/** 定義域の書き方（例：−1 ≦ x < 2）。決めていなければ '' */
export function domainText(p) {
  if (p.dom !== 'on') return '';
  const [lo, hi] = [Math.min(p.x1, p.x2), Math.max(p.x1, p.x2)];
  const s = (v) => (v < 0 ? `−${num(v)}` : num(v));
  return `${s(lo)} ${p.inc1 === '0' ? '<' : '≦'} x ${p.inc2 === '0' ? '<' : '≦'} ${s(hi)}`;
}
/** 値域（定義域のときに決まる y の範囲）。細かく調べて、最小・最大と、それを取るか（端を含まなければ取らない） */
export function valueRange(p) {
  if (p.fn === 'none' || p.dom !== 'on') return null;
  const lo = Math.min(p.x1, p.x2),
    hi = Math.max(p.x1, p.x2);
  const N = 2000;
  let min = Infinity,
    max = -Infinity,
    minIn = false,
    maxIn = false;
  const tol = 1e-9;
  for (let i = 0; i <= N; i++) {
    const x = lo + ((hi - lo) * i) / N;
    const y = graphY(p, x);
    const end = i === 0 ? p.inc1 !== '0' : i === N ? p.inc2 !== '0' : true; // 端の点は含むときだけ「取る」
    if (y < min - tol) {
      min = y;
      minIn = end;
    } else if (Math.abs(y - min) <= tol) minIn ||= end;
    if (y > max + tol) {
      max = y;
      maxIn = end;
    } else if (Math.abs(y - max) <= tol) maxIn ||= end;
  }
  const r = (v) => Number(v.toFixed(3));
  return {min: r(min), max: r(max), minIn, maxIn};
}
/** 値域の書き方（例：−1 ≦ y < 3） */
export function rangeText(p) {
  const v = valueRange(p);
  if (!v) return '';
  const s = (n) => (n < 0 ? `−${num(n)}` : num(n));
  if (v.min === v.max) return `y = ${s(v.min)}`;
  return `${s(v.min)} ${v.minIn ? '≦' : '<'} y ${v.maxIn ? '≦' : '<'} ${s(v.max)}`;
}
/** グラフの式（例：y = 2(x − 1)² + 3）。不等式の領域なら y > …、定義域があれば（…）を付ける。式なしは '' */
export function formulaOf(p) {
  const f = baseFormula(p);
  if (!f) return '';
  const rel = REL[p.region] ?? '=';
  const d = domainText(p);
  return `${f.replace(/^y = /, `y ${rel} `)}${d ? `（${d}）` : ''}`;
}
function baseFormula(p) {
  if (p.fn === 'linear')
    return `y = ${polyText([
      [p.a, 'x'],
      [p.b, '']
    ])}`;
  if (p.fn === 'quad') {
    if (!p.a) return `y = ${polyText([[p.q, '']])}`;
    const inner = p.p ? `(x ${p.p > 0 ? '−' : '+'} ${num(p.p)})²` : 'x²';
    const lead = Math.abs(p.a) === 1 ? (p.a < 0 ? '−' : '') : `${p.a < 0 ? '−' : ''}${num(p.a)}`;
    return `y = ${lead}${inner}${p.q ? ` ${p.q < 0 ? '−' : '+'} ${num(p.q)}` : ''}`;
  }
  if (p.fn === 'cubic')
    return `y = ${polyText([
      [p.a, 'x³'],
      [p.b, 'x²'],
      [p.c, 'x'],
      [p.d, '']
    ])}`;
  return '';
}
/** グラフの y（式なしは null） */
export function graphY(p, x) {
  if (p.fn === 'linear') return p.a * x + p.b;
  if (p.fn === 'quad') return p.a * (x - p.p) ** 2 + p.q;
  if (p.fn === 'cubic') return p.a * x ** 3 + p.b * x ** 2 + p.c * x + p.d;
  return null;
}
const coef = (key, label, def, when) => ({key, label, type: 'num', min: -99, max: 99, step: 0.1, def, when});
const GRAPH_PARAMS = [
  {key: 'fn', label: '描く式', type: 'select', options: GRAPH_FNS, def: 'none'},
  coef('a', '傾き a', 1, (p) => p.fn === 'linear'),
  coef('b', '切片 b', 0, (p) => p.fn === 'linear'),
  coef('a', 'a（開き方。負なら下に開く）', 1, (p) => p.fn === 'quad'),
  coef('p', '頂点の x 座標 p', 0, (p) => p.fn === 'quad'),
  coef('q', '頂点の y 座標 q', 0, (p) => p.fn === 'quad'),
  coef('a', 'x³ の係数 a', 1, (p) => p.fn === 'cubic'),
  coef('b', 'x² の係数 b', 0, (p) => p.fn === 'cubic'),
  coef('c', 'x の係数 c', -3, (p) => p.fn === 'cubic'),
  coef('d', '定数 d', 0, (p) => p.fn === 'cubic'),
  // 定義域・値域・領域（不等式）
  {
    key: 'dom',
    label: '定義域',
    type: 'select',
    options: [
      ['all', 'すべての x'],
      ['on', '範囲を決める']
    ],
    def: 'all',
    when: (p) => p.fn !== 'none'
  },
  {...coef('x1', 'x の左の端', -2, (p) => p.fn !== 'none' && p.dom === 'on'), min: -12, max: 12},
  {
    key: 'inc1',
    label: '左の端を',
    type: 'select',
    options: [
      ['1', '含む（≦・●）'],
      ['0', '含まない（<・○）']
    ],
    def: '1',
    when: (p) => p.fn !== 'none' && p.dom === 'on'
  },
  {...coef('x2', 'x の右の端', 2, (p) => p.fn !== 'none' && p.dom === 'on'), min: -12, max: 12},
  {
    key: 'inc2',
    label: '右の端を',
    type: 'select',
    options: [
      ['1', '含む（≦・●）'],
      ['0', '含まない（<・○）']
    ],
    def: '1',
    when: (p) => p.fn !== 'none' && p.dom === 'on'
  },
  {
    key: 'range',
    label: '値域',
    type: 'select',
    options: [
      ['0', '出さない'],
      ['1', '出す（点線と式）']
    ],
    def: '0',
    when: (p) => p.fn !== 'none' && p.dom === 'on'
  },
  {
    key: 'region',
    label: '領域（不等式）',
    type: 'select',
    options: [
      ['none', 'なし（y = 式）'],
      ['gt', 'y > 式（上側・境界を含まない）'],
      ['ge', 'y ≧ 式（上側・境界を含む）'],
      ['lt', 'y < 式（下側・境界を含まない）'],
      ['le', 'y ≦ 式（下側・境界を含む）']
    ],
    def: 'none',
    when: (p) => p.fn !== 'none'
  }
];
const graphDraw = (p) => {
  const X = (x) => GO + x * GU,
    Y = (y) => GO - y * GU;
  // 方眼は 1 ずつ（薄く）と 5 ずつ（少し濃く）。数は 5 ずつ
  const ticks = [-10, -5, 5, 10];
  const nums = ticks
    .map(
      (v) =>
        `<text x="${X(v)}" y="${GO + 14}" text-anchor="middle">${v < 0 ? `−${-v}` : v}</text><text x="${GO - 5}" y="${Y(v) + 3.5}" text-anchor="end">${v < 0 ? `−${-v}` : v}</text>`
    )
    .join('');
  const marks = ticks.map((v) => `M${X(v)} ${GO - 3}V${GO + 3}M${GO - 3} ${Y(v)}H${GO + 3}`).join('');
  let body = `<rect width="${GS}" height="${GS}" fill="#fff" stroke="none"/>${grid(GS, GS, GU, {color: '#e9ecef'})}${grid(GS, GS, GU * 5, {from: GO % (GU * 5), color: '#ced4da'})}${axesPath(GS, GS, GO, GO)}<path d="${marks}"/><g font-family="${LABEL_GOTHIC}" font-size="9" fill="#495057" stroke="none">${nums}</g>`;
  if (p.fn !== 'none') {
    const dom = p.dom === 'on';
    const lo = dom ? Math.min(p.x1, p.x2) : -12.2,
      hi = dom ? Math.max(p.x1, p.x2) : 12.2;
    const xs = [];
    for (let x = lo; x < hi; x += 0.04) xs.push(x);
    xs.push(hi);
    const LIM = 13;
    // 領域：曲線と、上（y > ・≧）か下（y < ・≦）の端で囲んだ所を塗る（定義域があればその幅だけ）
    if (p.region && p.region !== 'none') {
      const up = p.region === 'gt' || p.region === 'ge';
      const edge = Y(up ? LIM : -LIM);
      const pts = xs.map((x) => [X(x), Y(Math.max(-LIM, Math.min(LIM, graphY(p, x))))]);
      body += `<path d="M${r1(X(lo))} ${edge}${pts.map(([x, y]) => `L${r1(x)} ${r1(y)}`).join('')}L${r1(X(hi))} ${edge}Z" fill="#d6336c" fill-opacity="0.13" stroke="none"/>`;
    }
    const pts = xs.map((x) => {
      const y = graphY(p, x);
      return Math.abs(y) <= LIM ? [X(x), Y(y)] : null;
    });
    const d = pathOf(pts);
    const strict = p.region === 'gt' || p.region === 'lt'; // 境界を含まない領域は、境界を点線に
    body += `<path d="${d}" stroke="#d6336c" stroke-width="2.4"${strict ? ' stroke-dasharray="6 4"' : ''}/><path d="${d}" stroke="transparent" stroke-width="14" data-curve="1" pointer-events="stroke"/>`;
    if (p.fn === 'quad') body += dot(X(p.p), Y(p.q), 3, '#d6336c');
    // 定義域の端：含むなら ●、含まないなら ○
    if (dom)
      for (const [x, inc] of [
        [lo, p.inc1],
        [hi, p.inc2]
      ]) {
        const y = graphY(p, x);
        if (Math.abs(y) <= LIM)
          body += `<circle cx="${r1(X(x))}" cy="${r1(Y(y))}" r="3.6" fill="${inc === '0' ? '#fff' : '#d6336c'}" stroke="#d6336c" stroke-width="1.6"/>`;
      }
    // 値域：最小・最大の高さに点線
    const v = p.range === '1' ? valueRange(p) : null;
    if (v)
      body += `<path d="${[v.min, v.max]
        .filter((y) => Math.abs(y) <= LIM)
        .map((y) => `M${GO} ${r1(Y(y))}H${GS}`)
        .join('')}" stroke="#1c7ed6" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    const lines = [formulaOf(p), v ? `値域：${rangeText(p)}` : ''].filter(Boolean);
    lines.forEach((f, i) => {
      const color = i ? '#1c7ed6' : '#d6336c';
      const width = [...f].reduce((w, ch) => w + (/[\u3000-\uffff]/.test(ch) ? 13 : 6.6), 0); // 全角は広く
      body += `<rect x="4" y="${4 + i * 20}" width="${r1(width + 10)}" height="18" rx="3" fill="#fff" fill-opacity="0.9" stroke="none"/><text x="9" y="${17 + i * 20}" font-family="${LABEL_SERIF}" font-size="13" font-style="italic" fill="${color}" stroke="none">${esc(f)}</text>`;
    });
  }
  return body;
};
const graph = (def) => ({
  w: GS,
  h: GS,
  params: GRAPH_PARAMS,
  defaults: def,
  draw: graphDraw,
  labels: () => [M(GS - 12, GO - 10, 'x'), M(GO + 12, 10, 'y'), M(GO - 9, GO + 13, 'O')]
});

// ---- 目盛りの数字（ビーカー・メスシリンダー・ビュレット・温度計）----
const scaleText = (x, y, v, anchor = 'start') =>
  `<text x="${r1(x)}" y="${r1(y + 3)}" text-anchor="${anchor}" font-family="${LABEL_GOTHIC}" font-size="8" fill="#495057" stroke="none">${v}</text>`;
/** 目盛りの数字を出すか・いくつまでか（容量）。'0' は出さない */
const capParam = (caps, def) => ({
  key: 'cap',
  label: '目盛りの数字',
  type: 'select',
  options: [['0', '数字なし'], ...caps.map((c) => [String(c), `${c} mL まで`])],
  def: String(def)
});

// ---- 液体の量（ビーカー・フラスコ・試験管）----
const levelParam = (def = 45) => [
  {key: 'level', label: '液体の量', type: 'range', min: 0, max: 100, step: 1, def, unit: '%'}
];

/** 原子番号 1〜20 の元素記号 */
const ELEMENTS = 'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca'.split(' ');

// ---- 図の一覧 ----
// {key, name, subject, w, h, draw(p), params?, defaults?, labels?(p)}。w・h は viewBox（貼るときの大きさは pt で 0.75 倍）
const DEFS = [
  // ======== 数学 ========
  {key: 'coord', name: '座標平面', subject: '数学', ...graph({fn: 'none'})},
  {key: 'linear', name: '一次関数のグラフ', subject: '数学', ...graph({fn: 'linear', a: 1, b: 1})},
  {key: 'parabola', name: '放物線（二次関数）', subject: '数学', ...graph({fn: 'quad', a: 0.5, p: 0, q: -5})},
  {key: 'cubic', name: '三次関数のグラフ', subject: '数学', ...graph({fn: 'cubic', a: 0.1, b: 0, c: -3, d: 0})},
  {
    key: 'numline',
    name: '数直線',
    subject: '数学',
    w: 260,
    h: 64,
    draw: () =>
      `${arrow(8, 28, 254, 28)}<path d="${[0, 1, 2, 3, 4, 5].map((i) => `M${30 + i * 40} 22V34`).join('')}"/>`,
    labels: () => [-2, -1, 0, 1, 2, 3].map((v, i) => J(30 + i * 40, 48, v < 0 ? `−${-v}` : String(v), 13))
  },
  {
    key: 'circle',
    name: '円',
    subject: '数学',
    w: 160,
    h: 160,
    draw: () => `<circle cx="80" cy="80" r="64"/>${dot(80, 80)}<path d="M80 80H144"/>`,
    labels: () => [M(72, 92, 'O'), M(112, 70, 'r')]
  },
  {
    key: 'sector',
    name: '扇形',
    subject: '数学',
    w: 180,
    h: 150,
    params: [{key: 'angle', label: '中心角', type: 'range', min: 10, max: 300, step: 5, def: 60, unit: '°'}],
    draw: (p) => {
      const R = 64,
        cx = 90,
        cy = p.angle > 180 ? 80 : 120;
      const a1 = -90 - p.angle / 2,
        a2 = -90 + p.angle / 2;
      const P = (a, r = R) => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
      const [x1, y1] = P(a1),
        [x2, y2] = P(a2);
      const [s1, t1] = P(a1, 18),
        [s2, t2] = P(a2, 18);
      const big = p.angle > 180 ? 1 : 0;
      return `<path d="M${cx} ${cy}L${r1(x1)} ${r1(y1)}A${R} ${R} 0 ${big} 1 ${r1(x2)} ${r1(y2)}Z"/><path d="M${r1(s1)} ${r1(t1)}A18 18 0 ${big} 1 ${r1(s2)} ${r1(t2)}"/>`;
    },
    labels: (p) => {
      const cy = p.angle > 180 ? 80 : 120;
      const [lx, ly] = [
        90 + 30 * Math.cos(rad(-90 - p.angle / 2 - 12)),
        cy + 30 * Math.sin(rad(-90 - p.angle / 2 - 12))
      ];
      return [M(90, cy - 28, 'θ'), M(lx - 6, ly, 'r')];
    }
  },
  {
    key: 'tri',
    name: '三角形',
    subject: '数学',
    w: 180,
    h: 150,
    draw: () => `<polygon points="30,125 160,125 70,25"/>`,
    labels: () => [M(22, 132, 'A'), M(168, 132, 'B'), M(70, 15, 'C')]
  },
  {
    key: 'right-triangle',
    name: '直角三角形',
    subject: '数学',
    w: 180,
    h: 140,
    draw: () => `<polygon points="20,120 160,120 20,20"/><path d="M20 106H34V120"/>`,
    labels: () => [M(12, 128, 'A'), M(168, 128, 'B'), M(12, 14, 'C')]
  },
  {
    key: 'polygon',
    name: '正多角形',
    subject: '数学',
    w: 160,
    h: 160,
    params: [{key: 'n', label: '角の数', type: 'num', min: 3, max: 12, step: 1, def: 6}],
    draw: (p) => `<polygon points="${poly(polygonPoints(p.n, 80, p.n === 3 ? 92 : 82, 68))}"/>`
  },
  {
    key: 'square',
    name: '正方形',
    subject: '数学',
    w: 160,
    h: 160,
    draw: () => `<rect x="24" y="24" width="112" height="112"/>`
  },
  {
    key: 'tetra',
    name: '三角錐',
    subject: '数学',
    w: 180,
    h: 170,
    draw: () => `<path d="M85 15L20 140L120 158L165 118Z M85 15L120 158"/><path d="M20 140L165 118" ${dash}/>`,
    labels: () => [M(85, 6, 'O'), M(12, 146, 'A'), M(122, 167, 'B'), M(173, 118, 'C')]
  },
  {
    key: 'pyramid',
    name: '四角錐',
    subject: '数学',
    w: 180,
    h: 160,
    draw: () =>
      `<path d="M90 15L20 135H120L160 105Z M90 15L120 135"/><path d="M20 135L60 105H160 M60 105L90 15" ${dash}/>`
  },
  {
    key: 'cone',
    name: '円錐',
    subject: '数学',
    w: 160,
    h: 170,
    draw: () =>
      `<path d="M80 15L20 140A60 16 0 0 0 140 140Z"/><path d="M20 140A60 16 0 0 1 140 140 M80 15V140H140" ${dash}/>${dot(80, 140, 2)}`,
    labels: () => [M(88, 80, 'h'), M(110, 132, 'r')]
  },
  {
    key: 'cylinder',
    name: '円柱',
    subject: '数学',
    w: 160,
    h: 180,
    draw: () =>
      `<ellipse cx="80" cy="30" rx="60" ry="16"/><path d="M20 30V150A60 16 0 0 0 140 150V30"/><path d="M20 150A60 16 0 0 1 140 150" ${dash}/>`
  },
  {
    key: 'cube',
    name: '立方体',
    subject: '数学',
    w: 170,
    h: 170,
    draw: () =>
      `<path d="M20 50H120V150H20Z M20 50L60 15H160L120 50 M160 15V115L120 150"/><path d="M60 15V115H160 M60 115L20 150" ${dash}/>`
  },
  {
    key: 'cuboid',
    name: '直方体',
    subject: '数学',
    w: 220,
    h: 150,
    draw: () =>
      `<path d="M20 50H150V130H20Z M20 50L70 15H200L150 50 M200 15V95L150 130"/><path d="M70 15V95H200 M70 95L20 130" ${dash}/>`
  },
  {
    key: 'sphere',
    name: '球',
    subject: '数学',
    w: 160,
    h: 160,
    draw: () =>
      `<circle cx="80" cy="80" r="64"/><path d="M16 80A64 18 0 0 0 144 80"/><path d="M16 80A64 18 0 0 1 144 80" ${dash}/>${dot(80, 80)}<path d="M80 80L144 80" ${dash}/>`,
    labels: () => [M(112, 72, 'r')]
  },
  {
    key: 'hemisphere',
    name: '半球',
    subject: '数学',
    w: 160,
    h: 120,
    draw: () => `<path d="M16 90A64 64 0 0 1 144 90A64 18 0 0 1 16 90Z"/><path d="M16 90A64 18 0 0 1 144 90" ${dash}/>`
  },
  {
    key: 'unit-circle',
    name: '単位円',
    subject: '数学',
    w: 200,
    h: 200,
    params: [{key: 'angle', label: '角 θ', type: 'range', min: 0, max: 360, step: 5, def: 40, unit: '°'}],
    draw: (p) => {
      const x = 100 + 70 * Math.cos(rad(p.angle)),
        y = 100 - 70 * Math.sin(rad(p.angle));
      const ax = 100 + 18 * Math.cos(rad(p.angle)),
        ay = 100 - 18 * Math.sin(rad(p.angle));
      return `${axesPath(200, 200, 100, 100)}<circle cx="100" cy="100" r="70"/><path d="M100 100L${r1(x)} ${r1(y)}"/><path d="M${r1(x)} ${r1(y)}V100" ${dash}/><path d="M118 100A18 18 0 ${p.angle > 180 ? 1 : 0} 0 ${r1(ax)} ${r1(ay)}"/>${dot(x, y)}`;
    },
    labels: (p) => [
      M(190, 112, 'x'),
      M(112, 10, 'y'),
      M(90, 112, 'O'),
      M(100 + 32 * Math.cos(rad(p.angle / 2)), 100 - 32 * Math.sin(rad(p.angle / 2)), 'θ'),
      M(100 + 82 * Math.cos(rad(p.angle)), 100 - 82 * Math.sin(rad(p.angle)), 'P'),
      J(176, 112, '1', 13)
    ]
  },
  {
    key: 'venn',
    name: 'ベン図',
    subject: '数学',
    w: 220,
    h: 150,
    draw: () =>
      `<rect x="6" y="6" width="208" height="138"/><circle cx="88" cy="78" r="48"/><circle cx="132" cy="78" r="48"/>`,
    labels: () => [M(58, 40, 'A'), M(162, 40, 'B'), M(200, 20, 'U')]
  },
  {
    key: 'normal',
    name: '正規分布',
    subject: '数学',
    w: 240,
    h: 150,
    draw: () => {
      const pts = [];
      for (let x = 14; x <= 226; x += 4) pts.push([x, 126 - 100 * Math.exp(-((x - 120) ** 2) / (2 * 34 ** 2))]);
      return `${arrow(8, 126, 236, 126)}<path d="${pathOf(pts)}" fill="#eef1f5" stroke-width="2"/><path d="M120 26V126" ${dash} stroke="${SOFT}"/>`;
    },
    labels: () => [M(120, 140, 'μ')]
  },

  // ======== 物理 ========
  {
    key: 'pendulum',
    name: '振り子',
    subject: '物理',
    w: 250,
    h: 180,
    params: [{key: 'angle', label: '振れの角', type: 'range', min: 0, max: 60, step: 1, def: 30, unit: '°'}],
    draw: (p) => {
      const L = 120,
        a = rad(p.angle);
      const bx = 125 + L * Math.sin(a),
        by = 20 + L * Math.cos(a);
      const lx = 125 - L * Math.sin(a);
      const ax = 125 + 32 * Math.sin(a),
        ay = 20 + 32 * Math.cos(a);
      return `${ceiling(85, 165, 20)}<path d="M125 20V${20 + L + 14}" ${dash} stroke="${SOFT}"/>${p.angle ? `<path d="M${r1(lx)} ${r1(by)}A${L} ${L} 0 0 0 ${r1(bx)} ${r1(by)}" ${dash} stroke="${SOFT}"/>` : ''}<path d="M125 20L${r1(bx)} ${r1(by)}"/>${p.angle ? `<path d="M125 52A32 32 0 0 0 ${r1(ax)} ${r1(ay)}"/>` : ''}<circle cx="${r1(bx)}" cy="${r1(by)}" r="11" fill="#cfd8e3"/>${dot(125, 20)}`;
    },
    labels: (p) => {
      const a = rad(p.angle);
      return [
        M(125 + 44 * Math.sin(a / 2), 20 + 44 * Math.cos(a / 2), 'θ'),
        M(125 + 66 * Math.sin(a) + 12, 20 + 66 * Math.cos(a), 'L'),
        M(125 + 120 * Math.sin(a) + 20, 20 + 120 * Math.cos(a), 'm')
      ];
    }
  },
  {
    key: 'free-fall',
    name: '自由落下',
    subject: '物理',
    w: 170,
    h: 230,
    params: [{key: 'n', label: '写す回数（一定時間ごと）', type: 'num', min: 3, max: 8, step: 1, def: 5}],
    draw: (p) => {
      const k = 180 / (p.n - 1) ** 2;
      const balls = Array.from({length: p.n}, (_, i) => {
        const y = 20 + k * i * i;
        return `<circle cx="60" cy="${r1(y)}" r="7" fill="${i === p.n - 1 ? '#cfd8e3' : '#fff'}"${i === p.n - 1 ? '' : ` stroke="${SOFT}"`}/>`;
      });
      return `${balls.join('')}${ground(10, 160, 212)}${arrow(110, 20, 110, 200)}`;
    },
    labels: () => [M(124, 110, 'h'), M(130, 28, 'v₀ = 0', 12), M(130, 196, 'g', 13)]
  },
  {
    key: 'projectile',
    name: '斜方投射',
    subject: '物理',
    w: 260,
    h: 170,
    params: [{key: 'angle', label: '投げる角', type: 'range', min: 10, max: 80, step: 1, def: 45, unit: '°'}],
    draw: (p) => {
      const a = rad(p.angle);
      let R = 220 * Math.sin(2 * a),
        H = (R * Math.tan(a)) / 4;
      const s = Math.min(1, 125 / H);
      R *= s;
      H *= s;
      const vx = 20 + 56 * Math.cos(a),
        vy = 150 - 56 * Math.sin(a);
      return `${ground(10, 250, 150)}<path d="M20 150Q${r1(20 + R / 2)} ${r1(150 - 2 * H)} ${r1(20 + R)} 150" ${dash}/>${arrow(20, 150, vx, vy, {color: '#d6336c'})}<path d="M20 150H${r1(vx)}M20 150V${r1(vy)}" stroke="${SOFT}" ${dash}/><path d="M42 150A22 22 0 0 0 ${r1(20 + 22 * Math.cos(a))} ${r1(150 - 22 * Math.sin(a))}"/>${dot(20 + R / 2, 150 - H, 3)}`;
    },
    labels: (p) => {
      const a = rad(p.angle);
      return [M(50, 142 - 10 * Math.sin(a / 2), 'θ'), M(20 + 64 * Math.cos(a), 150 - 64 * Math.sin(a) - 6, 'v₀')];
    }
  },
  {
    key: 'horizontal-throw',
    name: '水平投射',
    subject: '物理',
    w: 240,
    h: 180,
    draw: () =>
      `<rect x="10" y="40" width="50" height="128" fill="#f1f3f5"/>${ground(10, 232, 168)}<path d="M60 40Q140 40 210 168" ${dash}/>${arrow(60, 40, 110, 40, {color: '#d6336c'})}<circle cx="60" cy="40" r="7" fill="#cfd8e3"/>${arrow(222, 40, 222, 160)}`,
    labels: () => [M(98, 28, 'v₀'), M(232, 100, 'h')]
  },
  {
    key: 'incline',
    name: '斜面と力',
    subject: '物理',
    w: 220,
    h: 150,
    draw: () =>
      `<path d="M10 140H210V40Z" fill="#f1f3f5"/><rect x="100" y="59" width="40" height="26" transform="rotate(-26.57 120 85)" fill="#fff"/>${arrow(114.2, 73.4, 114.2, 130)}${arrow(114.2, 73.4, 94, 33)}<path d="M50 140A40 40 0 0 0 45.8 122.1"/>`,
    labels: () => [M(62, 132, 'θ'), M(130, 124, 'mg'), M(84, 26, 'N')]
  },
  {
    key: 'spring',
    name: 'ばねと物体',
    subject: '物理',
    w: 260,
    h: 120,
    params: [{key: 'x', label: 'ばねの伸び（負は縮み）', type: 'range', min: -40, max: 60, step: 1, def: 30}],
    draw: (p) => {
      const nat = 130,
        end = nat + p.x;
      return `${wallLeft(20, 40, 100)}${ground(20, 250, 100)}${spring(20, end, 78)}<rect x="${end}" y="56" width="40" height="44" fill="#e8eef5"/><path d="M${nat} 40V108" ${dash} stroke="${SOFT}"/>${p.x ? arrow(nat, 30, end, 30, {color: '#d6336c'}) : ''}`;
    },
    labels: (p) => [M(75, 64, 'k'), M(130 + p.x + 20, 78, 'm'), M(130 + p.x / 2, 18, 'x')]
  },
  {
    key: 'pulley',
    name: '滑車',
    subject: '物理',
    w: 170,
    h: 210,
    draw: () =>
      `${ceiling(50, 120, 12)}<path d="M85 12V40"/><circle cx="85" cy="40" r="24" fill="#f1f3f5"/>${dot(85, 40)}<path d="M61 40V150M109 40V120"/><rect x="43" y="150" width="36" height="34" fill="#e8eef5"/>${arrow(109, 120, 109, 170, {color: '#d6336c'})}${arrow(61, 184, 61, 205)}`,
    labels: () => [M(61, 167, 'm'), M(124, 160, 'F'), M(48, 100, 'T'), M(80, 200, 'mg')]
  },
  {
    key: 'lever',
    name: 'てこ',
    subject: '物理',
    w: 260,
    h: 130,
    params: [{key: 'f', label: '支点の位置', type: 'range', min: 15, max: 85, step: 1, def: 35, unit: '%'}],
    draw: (p) => {
      const fx = 20 + 220 * (p.f / 100);
      return `<rect x="16" y="54" width="228" height="8" rx="2" fill="#f4e6cf"/><polygon points="${r1(fx)},62 ${r1(fx - 14)},90 ${r1(fx + 14)},90" fill="#cfd8e3"/>${ground(10, 250, 90)}${arrow(26, 30, 26, 54)}${arrow(234, 30, 234, 54, {color: '#d6336c'})}<path d="M20 108H${r1(fx)}M${r1(fx)} 108H240" ${dash} stroke="${SOFT}"/><path d="M20 102V114M${r1(fx)} 102V114M240 102V114" stroke="${SOFT}"/>`;
    },
    labels: (p) => {
      const fx = 20 + 220 * (p.f / 100);
      return [
        M(26, 20, 'W'),
        M(234, 20, 'F'),
        M((20 + fx) / 2, 122, 'a'),
        M((fx + 240) / 2, 122, 'b'),
        J(fx + 26, 80, '支点', 9)
      ];
    }
  },
  {
    key: 'circular',
    name: '等速円運動',
    subject: '物理',
    w: 200,
    h: 200,
    draw: () => {
      const a = rad(-35),
        x = 100 + 70 * Math.cos(a),
        y = 100 + 70 * Math.sin(a);
      // 反時計回りに回る：速さの向きは接線（画面の座標で (sin a, −cos a)）
      return `<circle cx="100" cy="100" r="70" ${dash}/>${dot(100, 100)}<path d="M100 100L${r1(x)} ${r1(y)}" stroke="${SOFT}"/>${arrow(x, y, x + 50 * Math.sin(a), y - 50 * Math.cos(a), {color: '#d6336c'})}${arrow(x, y, x + (100 - x) * 0.55, y + (100 - y) * 0.55)}<circle cx="${r1(x)}" cy="${r1(y)}" r="8" fill="#cfd8e3"/>`;
    },
    labels: () => [M(92, 112, 'O'), M(132, 26, 'v'), M(146, 86, 'F'), M(118, 70, 'r')]
  },
  {
    key: 'wave',
    name: '波（横波）',
    subject: '物理',
    w: 280,
    h: 140,
    params: [
      {key: 'n', label: '波の数', type: 'num', min: 1, max: 5, step: 0.5, def: 2},
      {key: 'amp', label: '振幅', type: 'range', min: 10, max: 50, step: 1, def: 36}
    ],
    draw: (p) => {
      const pts = [];
      for (let x = 0; x <= 240; x += 2) pts.push([20 + x, 70 - p.amp * Math.sin((2 * Math.PI * p.n * x) / 240)]);
      const lam = 240 / p.n;
      const cx = 20 + lam / 4;
      return `${arrow(14, 70, 274, 70)}<path d="${pathOf(pts)}" stroke="#1c7ed6" stroke-width="2.2"/><path d="M${r1(cx)} 70V${70 - p.amp}" ${dash} stroke="${SOFT}"/><path d="M${r1(cx)} ${126}H${r1(cx + lam)}" stroke="${SOFT}"/><path d="M${r1(cx)} 120V132M${r1(cx + lam)} 120V132" stroke="${SOFT}"/>`;
    },
    labels: (p) => {
      const lam = 240 / p.n;
      const cx = 20 + lam / 4;
      return [M(cx - 10, 70 - p.amp / 2, 'A'), M(cx + lam / 2, 118, 'λ'), M(268, 82, 'x')];
    }
  },
  {
    key: 'lens',
    name: '凸レンズと像',
    subject: '物理',
    w: 360,
    h: 200,
    params: [{key: 'a', label: '物体の位置（焦点距離の何倍）', type: 'num', min: 1.3, max: 3.5, step: 0.1, def: 2.5}],
    draw: (p) => {
      const F = 40,
        O = 180,
        Ay = 100;
      const b = (p.a * 1) / (p.a - 1); // 像の位置（焦点距離の何倍）：1/a + 1/b = 1
      const ox = O - p.a * F,
        ix = O + b * F;
      const oh = 36,
        ih = (oh * b) / p.a;
      const iy = Ay + ih;
      return `<path d="M8 ${Ay}H352" stroke="${SOFT}"/><ellipse cx="${O}" cy="${Ay}" rx="7" ry="74" fill="#e7f5ff"/>${[O - F, O + F, O - 2 * F, O + 2 * F].map((x) => dot(x, Ay, 2.5)).join('')}${arrow(ox, Ay, ox, Ay - oh, {width: 2.4})}${ix < 352 ? arrow(ix, Ay, ix, Math.min(iy, 196), {color: '#d6336c', width: 2.4}) : ''}<path d="M${r1(ox)} ${Ay - oh}H${O}L${r1(ix)} ${r1(iy)}M${r1(ox)} ${Ay - oh}L${r1(ix)} ${r1(iy)}" stroke="#f08c00" stroke-width="1.4"/>`;
    },
    labels: (p) => {
      const b = p.a / (p.a - 1);
      return [
        M(140, 112, 'F'),
        M(220, 112, 'F'),
        J(180 - p.a * 40, 54, '物体'),
        J(Math.min(180 + b * 40, 340), Math.min(100 + (36 * b) / p.a + 12, 192), '像'),
        J(180, 186, '凸レンズ', 10)
      ];
    }
  },
  {
    key: 'circuit',
    name: '電気回路',
    subject: '物理',
    w: 220,
    h: 150,
    draw: () =>
      `<path d="M20 20H80M140 20H200V55M200 95V130H116M104 130H20V20"/><rect x="80" y="12" width="60" height="16"/><circle cx="200" cy="75" r="20"/><path d="M186 61L214 89M214 61L186 89"/><path d="M104 114V146" stroke-width="2.4"/><path d="M116 121V139" stroke-width="5"/>`,
    labels: () => [J(98, 108, '+', 13), M(110, 40, 'R'), M(110, 116, 'E', 12)]
  },
  {
    key: 'series',
    name: '直列回路',
    subject: '物理',
    w: 240,
    h: 150,
    draw: () =>
      `<path d="M20 20H50M100 20H140M190 20H220V130H126M114 130H20V20"/><rect x="50" y="12" width="50" height="16"/><rect x="140" y="12" width="50" height="16"/><path d="M114 114V146" stroke-width="2.4"/><path d="M126 121V139" stroke-width="5"/>`,
    labels: () => [M(75, 42, 'R₁'), M(165, 42, 'R₂'), J(108, 108, '+', 13), M(120, 92, 'I')]
  },
  {
    key: 'parallel',
    name: '並列回路',
    subject: '物理',
    w: 240,
    h: 180,
    draw: () =>
      `<path d="M20 30H60M60 30V20H95M145 20H180V30M60 30V60H95M145 60H180V30M180 30H220V160H126M114 160H20V30"/><rect x="95" y="12" width="50" height="16"/><rect x="95" y="52" width="50" height="16"/><path d="M114 144V176" stroke-width="2.4"/><path d="M126 151V169" stroke-width="5"/>`,
    labels: () => [M(120, 40, 'R₁'), M(120, 82, 'R₂'), J(108, 138, '+', 13)]
  },
  {
    key: 'magnet',
    name: '棒磁石と磁力線',
    subject: '物理',
    w: 260,
    h: 170,
    draw: () => {
      const lines = [26, 46, 68]
        .map(
          (h) =>
            `<path d="M72 85C${72 - h} ${85 - h * 1.6} ${188 + h} ${85 - h * 1.6} 188 85"/><path d="M72 85C${72 - h} ${85 + h * 1.6} ${188 + h} ${85 + h * 1.6} 188 85"/>`
        )
        .join('');
      return `<g stroke="${SOFT}" stroke-width="1.3">${lines}</g><rect x="70" y="72" width="60" height="26" fill="#ffc9c9"/><rect x="130" y="72" width="60" height="26" fill="#a5d8ff"/>${head(134, 85 - 46 * 1.2, 0, SOFT)}${head(134, 85 + 46 * 1.2, 0, SOFT)}`; // 磁石の外では N から S へ
    },
    labels: () => [J(100, 85, 'N', 14), J(160, 85, 'S', 14)]
  },
  {
    key: 'buoyancy',
    name: '浮力',
    subject: '物理',
    w: 180,
    h: 210,
    draw: () =>
      `<rect x="30" y="70" width="120" height="120" fill="${WATER}" stroke="none"/><path d="M30 30V190H150V30"/><path d="M30 70H150" stroke="#74c0fc"/><rect x="66" y="100" width="48" height="48" fill="#e8eef5"/>${arrow(90, 124, 90, 74, {color: '#1c7ed6'})}${arrow(90, 124, 90, 178)}`,
    labels: () => [J(124, 82, '浮力', 10), J(124, 172, '重力', 10)]
  },
  {
    key: 'collision',
    name: '衝突',
    subject: '物理',
    w: 280,
    h: 110,
    draw: () =>
      `${ground(10, 270, 82)}<circle cx="70" cy="58" r="24" fill="#cfd8e3"/><circle cx="200" cy="64" r="18" fill="#ffd8a8"/>${arrow(70, 58, 130, 58, {color: '#d6336c'})}${arrow(200, 64, 160, 64, {color: '#d6336c'})}`,
    labels: () => [M(70, 98, 'm₁'), M(200, 98, 'm₂'), M(118, 46, 'v₁'), M(168, 50, 'v₂')]
  },
  {
    key: 'vt-graph',
    name: 'v-t グラフ',
    subject: '物理',
    w: 220,
    h: 180,
    draw: () =>
      `${axesPath(220, 180, 30, 150)}<path d="M30 150L190 50V150Z" fill="#e7f5ff" stroke="none"/><path d="M30 150L190 50" stroke="#1c7ed6" stroke-width="2.2"/><path d="M190 50V150" ${dash} stroke="${SOFT}"/>`,
    labels: () => [M(42, 12, 'v'), M(208, 162, 't'), M(22, 162, 'O'), J(140, 128, '移動距離', 10)]
  },

  // ======== 化学 ========
  {
    key: 'beaker',
    name: 'ビーカー',
    subject: '化学',
    w: 140,
    h: 170,
    params: [...levelParam(45), capParam([50, 100, 200, 300, 500], 100)],
    draw: (p) => {
      // 目盛り：底（156）から上へ 5 本（いちばん上が容量）。間に短い目盛り
      const top = 156 - (116 * p.level) / 100;
      const step = 116 / 5;
      let marks = '',
        nums = '';
      for (let k = 1; k <= 5; k++) {
        const y = 156 - k * step;
        marks += `M30 ${r1(y)}H44M30 ${r1(y + step / 2)}H38`;
        if (p.cap !== '0') nums += scaleText(47, y, (Number(p.cap) * k) / 5);
      }
      return `${p.level ? `<path d="M32 ${r1(top)}H108V148A8 8 0 0 1 100 156H40A8 8 0 0 1 32 148Z" fill="${WATER}" stroke="none"/><path d="M32 ${r1(top)}H108" stroke="#74c0fc"/>` : ''}<path d="M20 18L30 26V150A10 10 0 0 0 40 160H100A10 10 0 0 0 110 150V22H124"/><path d="${marks}" stroke-width="1.4"/>${nums}${p.cap !== '0' ? scaleText(78, 30, 'mL') : ''}`;
    }
  },
  {
    key: 'flask',
    name: '三角フラスコ',
    subject: '化学',
    w: 140,
    h: 170,
    params: levelParam(35),
    draw: (p) => {
      const y = 158 - (96 * p.level) / 100; // 液面（158 が底、62 が首の付け根）
      const half = 36 * ((y - 60) / 90) + 14; // その高さのフラスコの半分の幅
      return `${p.level ? `<path d="M${r1(70 - half)} ${r1(y)}H${r1(70 + half)}L120 150A8 8 0 0 1 112 160H28A8 8 0 0 1 20 150Z" fill="${WATER}" stroke="none"/>` : ''}<path d="M50 14H90M56 14V60L20 150A8 8 0 0 0 28 160H112A8 8 0 0 0 120 150L84 60V14"/>`;
    }
  },
  {
    key: 'test-tube',
    name: '試験管',
    subject: '化学',
    w: 80,
    h: 180,
    params: levelParam(30),
    draw: (p) => {
      const y = 164 - (140 * p.level) / 100;
      return `${p.level ? `<path d="M28 ${r1(Math.min(y, 152))}H52V152A12 12 0 0 1 28 152Z" fill="${WATER}" stroke="none"/>` : ''}<path d="M22 12H58M28 12V152A12 12 0 0 0 52 152V12"/>`;
    }
  },
  {
    key: 'burner',
    name: 'ガスバーナー',
    subject: '化学',
    w: 180,
    h: 210,
    draw: () =>
      `<path d="M60 20C44 44 48 62 60 76C72 62 76 44 60 20Z" fill="#d0ebff" stroke="#4dabf7"/><path d="M60 40C54 52 55 62 60 70C65 62 66 52 60 40Z" fill="#a5d8ff" stroke="none"/><rect x="50" y="76" width="20" height="96" fill="#e9ecef"/><rect x="46" y="120" width="28" height="10" rx="2" fill="#ced4da"/><rect x="46" y="96" width="28" height="8" rx="2" fill="#ced4da"/><path d="M20 172H100L94 196H26Z" fill="#dee2e6"/><path d="M70 150H104"/>${lead(74, 100, 96, 98)}${lead(74, 125, 96, 126)}`,
    labels: () => [J(132, 98, '空気調節ねじ', 9), J(132, 126, 'ガス調節ねじ', 9)]
  },
  {
    key: 'water-displacement',
    name: '水上置換法',
    subject: '化学',
    w: 290,
    h: 190,
    draw: () =>
      `<path d="M40 30V120A10 10 0 0 0 60 120V30" fill="#fff9db"/><path d="M34 30H66"/><path d="M50 30V18H180V110" stroke-width="2"/><rect x="140" y="100" width="130" height="80" fill="${WATER}" stroke="none"/><path d="M140 70V180H270V70"/><path d="M140 100H270" stroke="#74c0fc"/><path d="M170 160V40A10 10 0 0 1 190 40V160" fill="#fff"/>${[
        [178, 118],
        [182, 132],
        [176, 146]
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#fff" stroke="#74c0fc"/>`)
        .join('')}`,
    labels: () => [J(50, 140, '試験管', 10), J(232, 84, '水そう', 10), J(214, 46, '気体', 10)]
  },
  {
    key: 'electrolysis',
    name: '電気分解',
    subject: '化学',
    w: 220,
    h: 210,
    draw: () =>
      `<path d="M96 9V19" stroke-width="5"/><path d="M106 4V24" stroke-width="2.4"/><path d="M96 14H70M106 14H150"/><path d="M70 14V110M150 14V110" stroke-width="2"/><rect x="40" y="90" width="140" height="100" fill="${WATER}" stroke="none"/><path d="M40 60V190H180V60"/><rect x="64" y="110" width="12" height="60" fill="#868e96"/><rect x="144" y="110" width="12" height="60" fill="#868e96"/>${[
        [62, 150],
        [80, 132],
        [140, 140],
        [160, 124],
        [70, 120],
        [152, 156]
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="#fff" stroke="#74c0fc"/>`)
        .join('')}`,
    labels: () => [J(70, 202, '陰極', 10), J(150, 202, '陽極', 10), J(118, 36, '電源（長い方が＋）', 8)]
  },
  {
    key: 'atom',
    name: '原子の構造',
    subject: '化学',
    w: 200,
    h: 200,
    params: [{key: 'z', label: '原子番号', type: 'num', min: 1, max: 20, step: 1, def: 6}],
    draw: (p) => {
      const caps = [2, 8, 8, 2];
      let left = p.z;
      const shells = [];
      for (const c of caps) {
        if (left <= 0) break;
        shells.push(Math.min(c, left));
        left -= c;
      }
      const R = [34, 56, 76, 94];
      let out = `<circle cx="100" cy="100" r="18" fill="#ffc9c9"/><text x="100" y="105" font-family="${LABEL_GOTHIC}" font-size="14" font-weight="700" text-anchor="middle" fill="${INK}" stroke="none">${ELEMENTS[p.z - 1]}</text>`;
      shells.forEach((n, i) => {
        out += `<circle cx="100" cy="100" r="${R[i]}" stroke="${SOFT}"/>`;
        for (let k = 0; k < n; k++) {
          const a = (Math.PI * 2 * k) / n - Math.PI / 2 + i * 0.3;
          out += `<circle cx="${r1(100 + R[i] * Math.cos(a))}" cy="${r1(100 + R[i] * Math.sin(a))}" r="4.5" fill="#4dabf7" stroke="none"/>`;
        }
      });
      return out;
    },
    labels: () => [J(100, 192, '原子核のまわりの電子', 9)]
  },
  {
    key: 'burette',
    name: 'ビュレット（滴定）',
    subject: '化学',
    w: 160,
    h: 250,
    params: [
      {
        key: 'nums',
        label: '目盛りの数字',
        type: 'select',
        options: [
          ['1', '出す（0〜50 mL）'],
          ['0', '出さない']
        ],
        def: '1'
      },
      {key: 'level', label: '液面（読み）', type: 'range', min: 0, max: 50, step: 0.5, def: 8, unit: ' mL'}
    ],
    draw: (p) => {
      // ビュレットは上が 0。下へ向かって 10 mL ずつ（22 ずつ）
      const y0 = 32,
        k = 22 / 10;
      let marks = '',
        nums = '';
      for (let v = 0; v <= 50; v += 2) marks += `M70 ${r1(y0 + v * k)}h${v % 10 ? 4 : 8}`;
      if (p.nums === '1') for (let v = 0; v <= 50; v += 10) nums += scaleText(88, y0 + v * k, v);
      const lv = y0 + p.level * k;
      return `<path d="M20 240H140" stroke-width="3"/><path d="M30 240V10" stroke-width="3"/><path d="M30 60H70"/><rect x="70" y="10" width="14" height="150" fill="#fff"/><rect x="71" y="${r1(lv)}" width="12" height="${r1(159 - lv)}" fill="${WATER}" stroke="none"/><path d="${marks}" stroke-width="1"/>${nums}<path d="M77 160V176" stroke-width="2"/><path d="M68 166H86"/><path d="M60 196V206L46 236H108L94 206V196" fill="#fff0f6"/>`;
    },
    labels: () => [J(128, 60, 'ビュレット', 10), J(122, 222, 'コニカルビーカー', 9)]
  },
  {
    key: 'graduated-cylinder',
    name: 'メスシリンダー',
    subject: '化学',
    w: 110,
    h: 250,
    params: [
      {key: 'level', label: '液面（読み）', type: 'range', min: 0, max: 100, step: 1, def: 62, unit: '%'},
      capParam([10, 50, 100, 200], 100)
    ],
    draw: (p) => {
      // 目盛り：底（210）から上（30）まで 10 等分
      const bottom = 210,
        topY = 30,
        step = (bottom - topY) / 10;
      let marks = '',
        nums = '';
      for (let k = 1; k <= 10; k++) {
        const y = bottom - k * step;
        marks += `M38 ${r1(y)}H${k % 2 ? 46 : 52}`;
        if (p.cap !== '0' && k % 2 === 0) nums += scaleText(55, y, (Number(p.cap) * k) / 10);
      }
      const lv = bottom - ((bottom - topY) * p.level) / 100;
      return `${p.level ? `<path d="M37 ${r1(lv)}C48 ${r1(lv + 4)} 62 ${r1(lv + 4)} 73 ${r1(lv)}V${bottom}H37Z" fill="${WATER}" stroke="none"/>` : ''}<path d="M30 14L36 20V${bottom}H74V20L80 14"/><path d="M20 ${bottom}H90V${bottom + 12}H20Z" fill="#e9ecef"/><path d="${marks}" stroke-width="1"/>${nums}${p.cap !== '0' ? scaleText(56, 22, 'mL') : ''}`;
    }
  },
  {
    key: 'thermometer',
    name: '温度計',
    subject: '化学',
    w: 100,
    h: 260,
    params: [
      {key: 't', label: '温度', type: 'range', min: -20, max: 100, step: 1, def: 25, unit: ' ℃'},
      {
        key: 'nums',
        label: '目盛りの数字',
        type: 'select',
        options: [
          ['1', '出す（10 ℃ ごと）'],
          ['0', '出さない']
        ],
        def: '1'
      }
    ],
    draw: (p) => {
      // −20 ℃（y=220）から 100 ℃（y=24）まで
      const Y = (t) => 220 - ((t + 20) * 196) / 120;
      let marks = '',
        nums = '';
      for (let t = -20; t <= 100; t += 2) marks += `M54 ${r1(Y(t))}h${t % 10 ? 4 : 8}`;
      if (p.nums === '1') for (let t = -20; t <= 100; t += 10) nums += scaleText(66, Y(t), t < 0 ? `−${-t}` : t);
      return `<rect x="38" y="14" width="14" height="216" rx="7" fill="#fff"/><rect x="42" y="${r1(Y(p.t))}" width="6" height="${r1(232 - Y(p.t))}" fill="#fa5252" stroke="none"/><circle cx="45" cy="238" r="12" fill="#fa5252"/><path d="${marks}" stroke-width="1"/>${nums}`;
    },
    labels: () => [J(70, 252, '℃', 10)]
  },
  {
    key: 'water-molecule',
    name: '水分子',
    subject: '化学',
    w: 180,
    h: 130,
    draw: () => {
      const a = rad(104.5 / 2);
      const hx = 52 * Math.sin(a),
        hy = 52 * Math.cos(a);
      return `<path d="M90 50L${r1(90 - hx)} ${r1(50 + hy)}M90 50L${r1(90 + hx)} ${r1(50 + hy)}" stroke-width="5" stroke="#adb5bd"/><circle cx="90" cy="50" r="24" fill="#ff8787"/><circle cx="${r1(90 - hx)}" cy="${r1(50 + hy)}" r="15" fill="#e9ecef"/><circle cx="${r1(90 + hx)}" cy="${r1(50 + hy)}" r="15" fill="#e9ecef"/>`;
    },
    labels: () => [J(90, 50, 'O', 15), J(49, 82, 'H', 13), J(131, 82, 'H', 13), J(90, 120, '104.5°', 10)]
  },
  {
    key: 'benzene',
    name: 'ベンゼン環',
    subject: '化学',
    w: 160,
    h: 160,
    draw: () => `<polygon points="${poly(polygonPoints(6, 80, 80, 62))}"/><circle cx="80" cy="80" r="38"/>`
  },

  // ======== 生物 ========
  {
    key: 'animal-cell',
    name: '動物細胞',
    subject: '生物',
    w: 262,
    h: 160,
    draw: () =>
      `<ellipse cx="100" cy="80" rx="90" ry="64" fill="#fff6e8"/><circle cx="108" cy="75" r="24" fill="#e7e1f7"/>${dot(114, 71, 6, '#b9acd9')}<ellipse cx="54" cy="101" rx="14" ry="7" fill="#ffd9c7" transform="rotate(-20 54 101)"/><ellipse cx="150" cy="109" rx="13" ry="6" fill="#ffd9c7" transform="rotate(15 150 109)"/>${lead(190, 80, 204, 80)}${lead(132, 75, 204, 52)}${lead(163, 110, 204, 112)}${lead(60, 60, 30, 30)}`,
    labels: () => [
      J(222, 80, '細胞膜', 10),
      J(214, 50, '核', 10),
      J(232, 114, 'ミトコンドリア', 9),
      J(28, 22, '細胞質', 10)
    ]
  },
  {
    key: 'plant-cell',
    name: '植物細胞',
    subject: '生物',
    w: 250,
    h: 160,
    draw: () =>
      `<rect x="8" y="8" width="184" height="144" rx="10" fill="#eef8e8" stroke-width="3"/><rect x="16" y="16" width="168" height="128" rx="8"/><rect x="60" y="34" width="70" height="66" rx="18" fill="#e6f2fb"/><circle cx="152" cy="108" r="16" fill="#e7e1f7"/>${[
        [36, 118],
        [64, 128],
        [40, 40],
        [166, 138]
      ]
        .map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="11" ry="6" fill="#9bd28a"/>`)
        .join(
          ''
        )}${lead(192, 20, 206, 20)}${lead(184, 56, 206, 56)}${lead(130, 74, 206, 90)}${lead(168, 112, 206, 124)}${lead(177, 140, 206, 152)}`,
    labels: () => [
      J(228, 20, '細胞壁', 10),
      J(228, 56, '細胞膜', 10),
      J(224, 90, '液胞', 10),
      J(216, 124, '核', 10),
      J(228, 152, '葉緑体', 10)
    ]
  },
  {
    key: 'red-blood-cell',
    name: '赤血球',
    subject: '生物',
    w: 230,
    h: 130,
    draw: () =>
      `<circle cx="60" cy="60" r="44" fill="#ff8787"/><circle cx="60" cy="60" r="20" fill="#ffc9c9" stroke="none"/><path d="M140 40C150 30 200 30 210 40C214 52 196 60 175 60C154 60 136 52 140 40Z M140 80C136 68 154 60 175 60C196 60 214 68 210 80C200 90 150 90 140 80Z" fill="#ff8787"/>`,
    labels: () => [J(60, 118, '上から見た形', 10), J(175, 110, '横から見た形（中央がくぼむ）', 9)]
  },
  {
    key: 'white-blood-cell',
    name: '白血球',
    subject: '生物',
    w: 160,
    h: 160,
    draw: () =>
      `<circle cx="80" cy="76" r="60" fill="#f3f0ff"/>${[
        [52, 40],
        [106, 46],
        [48, 104],
        [112, 106],
        [80, 116],
        [36, 72],
        [124, 78]
      ]
        .map(([x, y]) => dot(x, y, 2.2, '#b197fc'))
        .join(
          ''
        )}<path d="M58 66C50 52 70 46 74 58C80 46 98 50 92 64C104 64 104 84 90 84C92 98 72 98 72 86C60 92 50 78 58 66Z" fill="#9775fa"/>`,
    labels: () => [J(80, 148, '核（くびれた形）', 10)]
  },
  {
    key: 'platelet',
    name: '血小板',
    subject: '生物',
    w: 160,
    h: 110,
    draw: () =>
      `${[
        [40, 40, 16, 10, 20],
        [96, 34, 12, 8, -15],
        [70, 72, 14, 9, 40],
        [124, 70, 11, 7, 0]
      ]
        .map(
          ([x, y, rx, ry, a]) =>
            `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#ffe8cc" transform="rotate(${a} ${x} ${y})"/>${dot(x, y, 2, '#f08c00')}`
        )
        .join('')}`,
    labels: () => [J(80, 102, '血小板（小さなかけら）', 10)]
  },
  {
    key: 'blood',
    name: '血液の成分',
    subject: '生物',
    w: 280,
    h: 160,
    draw: () =>
      `<rect x="4" y="4" width="272" height="122" rx="10" fill="#fff9db" stroke="#ffe066"/>${[
        [40, 40],
        [86, 70],
        [56, 96],
        [130, 36],
        [176, 92],
        [236, 54]
      ]
        .map(
          ([x, y]) =>
            `<circle cx="${x}" cy="${y}" r="17" fill="#ff8787"/><circle cx="${x}" cy="${y}" r="7" fill="#ffc9c9" stroke="none"/>`
        )
        .join(
          ''
        )}<circle cx="190" cy="40" r="22" fill="#f3f0ff"/><path d="M182 36C178 28 190 26 192 34C198 28 206 36 198 42C202 50 188 52 188 44C180 48 176 40 182 36Z" fill="#9775fa"/>${[
        [124, 96],
        [140, 104],
        [230, 104]
      ]
        .map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="6" ry="4" fill="#ffe8cc"/>`)
        .join(
          ''
        )}${lead(56, 113, 56, 138)}${lead(190, 62, 190, 138)}${lead(140, 108, 126, 138)}${lead(250, 20, 262, 138)}`,
    labels: () => [
      J(56, 148, '赤血球', 10),
      J(190, 148, '白血球', 10),
      J(122, 148, '血小板', 10),
      J(256, 148, '血しょう', 10)
    ]
  },
  {
    key: 'paramecium',
    name: 'ゾウリムシ',
    subject: '生物',
    w: 260,
    h: 130,
    draw: () => {
      const cilia = Array.from({length: 34}, (_, i) => {
        const a = (Math.PI * 2 * i) / 34;
        const x = 120 + 100 * Math.cos(a),
          y = 60 + 38 * Math.sin(a);
        return `M${r1(x)} ${r1(y)}l${r1(7 * Math.cos(a))} ${r1(7 * Math.sin(a))}`;
      });
      return `<path d="${cilia.join('')}" stroke="${SOFT}" stroke-width="1"/><path d="M20 60C24 26 90 18 140 26C190 30 222 44 220 62C218 84 186 96 140 96C100 98 60 94 40 86C28 80 20 72 20 60Z" fill="#f4fce3"/><path d="M110 40C126 52 128 70 116 80" stroke="#94d82d"/><ellipse cx="146" cy="60" rx="16" ry="11" fill="#d0bfff"/>${dot(166, 64, 4, '#9775fa')}<circle cx="60" cy="60" r="8" fill="#e7f5ff" stroke="#74c0fc"/><circle cx="196" cy="60" r="8" fill="#e7f5ff" stroke="#74c0fc"/>${lead(60, 52, 60, 14)}${lead(146, 71, 146, 112)}${lead(116, 80, 96, 112)}`;
    },
    labels: () => [J(60, 8, '収縮胞', 9), J(150, 120, '核', 9), J(92, 120, '口', 9), J(244, 30, 'せん毛', 9)]
  },
  {
    key: 'euglena',
    name: 'ミドリムシ',
    subject: '生物',
    w: 260,
    h: 120,
    draw: () =>
      `<path d="M40 60C40 40 120 32 180 46C200 52 206 58 206 62C206 66 196 72 180 76C120 90 40 80 40 60Z" fill="#ebfbee"/><path d="M206 60C226 50 236 70 254 54" stroke-width="1.6"/>${[
        [90, 56],
        [110, 66],
        [130, 54],
        [150, 66],
        [72, 64]
      ]
        .map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="8" ry="4" fill="#8ce99a"/>`)
        .join(
          ''
        )}${dot(190, 56, 4, '#fa5252')}<circle cx="120" cy="60" r="10" fill="#e5dbff"/>${lead(236, 60, 236, 100)}${lead(190, 52, 196, 18)}${lead(110, 66, 100, 104)}`,
    labels: () => [J(236, 108, 'べん毛', 9), J(196, 10, '眼点', 9), J(100, 112, '葉緑体', 9)]
  },
  {
    key: 'amoeba',
    name: 'アメーバ',
    subject: '生物',
    w: 220,
    h: 160,
    draw: () =>
      `<path d="M40 80C20 60 50 40 70 50C70 20 110 16 120 40C140 20 180 30 170 60C200 66 196 100 170 104C176 130 140 140 124 120C110 146 70 140 74 116C44 124 30 100 40 80Z" fill="#fff4e6"/><circle cx="110" cy="80" r="16" fill="#e5dbff"/><circle cx="148" cy="96" r="8" fill="#d3f9d8" stroke="#69db7c"/>${lead(110, 64, 110, 14)}${lead(156, 96, 200, 120)}${lead(40, 80, 14, 60)}`,
    labels: () => [J(110, 8, '核', 9), J(200, 130, '食胞', 9), J(18, 52, '仮足', 9)]
  },
  {
    key: 'bacteria',
    name: '細菌（桿菌・球菌）',
    subject: '生物',
    w: 260,
    h: 120,
    draw: () =>
      `<rect x="20" y="40" width="100" height="34" rx="17" fill="#fff3bf"/><path d="M40 52C60 60 80 50 100 60" stroke="${SOFT}" stroke-width="1.2"/><path d="M120 57C134 46 140 70 156 58M20 57C6 46 0 70 -4 58" stroke-width="1.4"/>${[
        [188, 40],
        [210, 40],
        [199, 60],
        [221, 60],
        [232, 40],
        [177, 60]
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="10" fill="#fff3bf"/>`)
        .join('')}`,
    labels: () => [J(70, 96, '桿菌（べん毛つき）', 9), J(205, 92, '球菌', 9)]
  },
  {
    key: 'virus',
    name: 'ウイルス',
    subject: '生物',
    w: 170,
    h: 170,
    draw: () => {
      const spikes = Array.from({length: 16}, (_, i) => {
        const a = (Math.PI * 2 * i) / 16;
        const x1 = 85 + 50 * Math.cos(a),
          y1 = 80 + 50 * Math.sin(a);
        const x2 = 85 + 64 * Math.cos(a),
          y2 = 80 + 64 * Math.sin(a);
        return `<path d="M${r1(x1)} ${r1(y1)}L${r1(x2)} ${r1(y2)}"/>${dot(x2, y2, 4, '#ffa8a8')}`;
      });
      return `${spikes.join('')}<circle cx="85" cy="80" r="50" fill="#fff0f6"/><path d="M60 70C70 90 90 60 100 84C106 96 90 104 80 96" stroke="#e64980" stroke-width="1.6"/>`;
    },
    labels: () => [J(85, 160, '遺伝物質を殻が包む', 9)]
  },
  {
    key: 'yeast',
    name: '酵母',
    subject: '生物',
    w: 200,
    h: 130,
    draw: () =>
      `<ellipse cx="70" cy="62" rx="40" ry="32" fill="#fff9db"/><ellipse cx="124" cy="46" rx="18" ry="14" fill="#fff9db"/><circle cx="66" cy="62" r="10" fill="#e5dbff"/><ellipse cx="160" cy="88" rx="26" ry="20" fill="#fff9db"/>`,
    labels: () => [J(130, 20, '出芽', 9), J(70, 112, '酵母（菌類）', 9)]
  },
  {
    key: 'neuron',
    name: '神経細胞',
    subject: '生物',
    w: 300,
    h: 140,
    draw: () =>
      `<path d="M40 70L14 40M40 70L10 76M40 70L20 104M46 56L40 20M50 86L46 120M58 60L70 26" stroke-width="2.2"/><circle cx="56" cy="72" r="20" fill="#e7f5ff"/>${dot(56, 72, 6, '#9775fa')}<path d="M76 72H250" stroke-width="2.2"/>${[
        96, 136, 176, 216
      ]
        .map((x) => `<rect x="${x}" y="64" width="30" height="16" rx="8" fill="#fff3bf"/>`)
        .join(
          ''
        )}<path d="M250 72L276 52M250 72L282 72M250 72L276 92" stroke-width="2.2"/>${lead(56, 92, 56, 128)}${lead(20, 104, 12, 128)}${lead(160, 80, 160, 116)}`,
    labels: () => [
      J(60, 134, '細胞体', 9),
      J(14, 134, '樹状突起', 8),
      J(160, 124, '軸索（髄鞘）', 9),
      J(282, 106, '神経終末', 8)
    ]
  },
  {
    key: 'heart',
    name: '心臓（4 つの部屋）',
    subject: '生物',
    w: 220,
    h: 220,
    draw: () =>
      `<path d="M110 196C60 170 24 130 26 90C28 56 56 40 80 48C92 52 104 60 110 70C116 60 128 52 140 48C164 40 192 56 194 90C196 130 160 170 110 196Z" fill="#ffe3e3"/><path d="M110 70V190M30 104H190" stroke-width="2"/><path d="M84 48C84 24 90 14 100 10M136 48C136 30 146 20 160 16" stroke="#e03131" stroke-width="5"/>`,
    labels: () => [
      J(68, 80, '右心房', 10),
      J(152, 80, '左心房', 10),
      J(70, 136, '右心室', 10),
      J(150, 136, '左心室', 10)
    ]
  },
  {
    key: 'dna',
    name: 'DNA（二重らせん）',
    subject: '生物',
    w: 140,
    h: 260,
    draw: () => {
      const a = [],
        b = [],
        rungs = [];
      for (let y = 10; y <= 250; y += 3) {
        const s = Math.sin((y - 10) / 26);
        a.push([70 + 40 * s, y]);
        b.push([70 - 40 * s, y]);
      }
      for (let y = 22; y <= 244; y += 14) {
        const s = Math.sin((y - 10) / 26);
        rungs.push(
          `<path d="M${r1(70 + 40 * s)} ${y}L${r1(70 - 40 * s)} ${y}" stroke="${['#ff8787', '#74c0fc', '#69db7c', '#ffd43b'][(y / 14) % 4 | 0]}" stroke-width="3"/>`
        );
      }
      return `${rungs.join('')}<path d="${pathOf(a)}" stroke="#495057" stroke-width="3"/><path d="${pathOf(b)}" stroke="#868e96" stroke-width="3"/>`;
    },
    labels: () => [J(70, 256, 'A–T・G–C の塩基対', 8)]
  },
  {
    key: 'chromosome',
    name: '染色体',
    subject: '生物',
    w: 130,
    h: 160,
    draw: () =>
      `<path d="M30 20C36 14 46 18 48 26L64 76L50 130C48 140 36 146 30 138C24 132 26 124 28 120L44 76L28 30C26 26 26 22 30 20Z" fill="#d0bfff"/><path d="M100 20C94 14 84 18 82 26L66 76L80 130C82 140 94 146 100 138C106 132 104 124 102 120L86 76L102 30C104 26 104 22 100 20Z" fill="#d0bfff"/><circle cx="65" cy="76" r="7" fill="#9775fa"/>`,
    labels: () => [J(65, 154, '動原体', 9)]
  },
  {
    key: 'mitochondria',
    name: 'ミトコンドリア',
    subject: '生物',
    w: 220,
    h: 120,
    draw: () =>
      `<ellipse cx="110" cy="56" rx="96" ry="44" fill="#ffe8cc"/><ellipse cx="110" cy="56" rx="86" ry="35" fill="#fff4e6"/><path d="M40 56C46 30 54 82 62 56C70 30 78 82 86 56C94 30 102 82 110 56C118 30 126 82 134 56C142 30 150 82 158 56C166 30 174 82 180 56" stroke="#f08c00"/>`,
    labels: () => [J(110, 112, '内膜のひだ（クリステ）', 9)]
  },
  {
    key: 'chloroplast',
    name: '葉緑体',
    subject: '生物',
    w: 220,
    h: 120,
    draw: () =>
      `<ellipse cx="110" cy="56" rx="96" ry="44" fill="#d3f9d8"/>${[50, 84, 118, 152]
        .map((x) =>
          [0, 1, 2, 3]
            .map((k) => `<rect x="${x}" y="${38 + k * 9}" width="22" height="7" rx="3" fill="#51cf66" stroke="none"/>`)
            .join('')
        )
        .join('')}<path d="M72 50H84M106 56H118M140 50H152" stroke="#2f9e44"/>`,
    labels: () => [J(110, 112, 'チラコイドが重なったグラナ', 9)]
  },
  {
    key: 'leaf',
    name: '葉の断面',
    subject: '生物',
    w: 280,
    h: 170,
    draw: () =>
      `<rect x="10" y="10" width="200" height="12" fill="#f8f9fa"/>${Array.from({length: 10}, (_, i) => `<rect x="${12 + i * 20}" y="24" width="16" height="44" rx="5" fill="#8ce99a"/>`).join('')}${[
        [24, 86],
        [56, 92],
        [92, 84],
        [128, 94],
        [166, 86],
        [196, 94],
        [40, 112],
        [110, 112],
        [180, 112]
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="11" fill="#b2f2bb"/>`)
        .join(
          ''
        )}<rect x="10" y="126" width="200" height="12" fill="#f8f9fa"/><path d="M100 138V126M116 138V126" stroke="${INK}"/><path d="M100 126C104 132 112 132 116 126" fill="#fff"/>${lead(210, 16, 226, 16)}${lead(210, 46, 226, 46)}${lead(206, 100, 226, 96)}${lead(112, 138, 226, 150)}`,
    labels: () => [
      J(250, 16, '表皮', 10),
      J(254, 46, 'さく状組織', 9),
      J(254, 96, '海綿状組織', 9),
      J(246, 150, '気孔', 10)
    ]
  },
  {
    key: 'flower',
    name: '花のつくり',
    subject: '生物',
    w: 272,
    h: 220,
    draw: () =>
      `<path d="M120 210V160"/><path d="M120 160C96 160 84 150 80 140M120 160C144 160 156 150 160 140" fill="#b2f2bb"/><path d="M84 140C40 120 40 70 70 60C80 90 96 120 110 140Z M156 140C200 120 200 70 170 60C160 90 144 120 130 140Z" fill="#fcc2d7"/><path d="M108 150C104 130 108 112 114 96H126C132 112 136 130 132 150Z" fill="#c0eb75"/><path d="M114 96V60H126V96" fill="#d8f5a2"/><ellipse cx="120" cy="56" rx="10" ry="6" fill="#c0eb75"/><path d="M98 140L90 70M142 140L150 70" stroke-width="1.4"/><ellipse cx="90" cy="66" rx="6" ry="9" fill="#ffd43b"/><ellipse cx="150" cy="66" rx="6" ry="9" fill="#ffd43b"/>${lead(126, 56, 200, 30)}${lead(150, 66, 214, 64)}${lead(170, 90, 214, 104)}${lead(130, 130, 214, 140)}${lead(156, 152, 214, 172)}`,
    labels: () => [
      J(234, 24, '柱頭（めしべ）', 9),
      J(234, 62, 'おしべ', 9),
      J(230, 104, '花弁', 9),
      J(230, 140, '子房', 9),
      J(230, 176, 'がく', 9)
    ]
  },
  {
    key: 'alveoli',
    name: '肺胞',
    subject: '生物',
    w: 220,
    h: 180,
    draw: () =>
      `<path d="M30 20V70L70 100M30 70L60 120" stroke-width="5" stroke="#ced4da"/>${[
        [84, 100],
        [104, 88],
        [100, 114],
        [72, 132],
        [92, 142],
        [70, 112]
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="13" fill="#ffe3e3" stroke="#fa5252"/>`)
        .join(
          ''
        )}<path d="M120 80C140 100 110 130 130 150" stroke="#e03131" stroke-width="2"/><path d="M128 76C150 100 120 130 140 154" stroke="#1971c2" stroke-width="2"/>${lead(116, 100, 170, 90)}${lead(134, 148, 170, 150)}${lead(30, 30, 60, 26)}`,
    labels: () => [J(192, 90, '肺胞', 10), J(194, 150, '毛細血管', 9), J(80, 26, '気管支', 9)]
  },
  {
    key: 'eye',
    name: '目のつくり',
    subject: '生物',
    w: 260,
    h: 170,
    draw: () =>
      `<circle cx="140" cy="85" r="66" fill="#fff"/><path d="M200 50A66 66 0 0 1 200 120" stroke="#e03131" stroke-width="4"/><path d="M76 60C66 74 66 96 76 110" stroke-width="2.4" fill="#e7f5ff"/><ellipse cx="92" cy="85" rx="9" ry="22" fill="#d0ebff"/><path d="M82 58V72M82 98V112" stroke="#845ef7" stroke-width="5"/><path d="M204 85H250" stroke="#f08c00" stroke-width="6"/>${lead(70, 85, 30, 40)}${lead(92, 100, 50, 140)}${lead(82, 106, 20, 108)}${lead(204, 110, 226, 150)}${lead(240, 85, 240, 40)}`,
    labels: () => [
      J(28, 32, '角膜', 9),
      J(46, 150, '水晶体', 9),
      J(18, 98, '虹彩', 9),
      J(230, 160, '網膜', 9),
      J(240, 30, '視神経', 9)
    ]
  },

  // ======== 社会 ========
  {
    key: 'compass',
    name: '方位記号',
    subject: '社会',
    w: 100,
    h: 150,
    draw: () => `<path d="M50 34L66 140L50 126Z"/><path d="M50 34L34 140L50 126Z" fill="${INK}"/>`,
    labels: () => [J(50, 18, 'N', 18)]
  },
  {
    key: 'timeline',
    name: '年表',
    subject: '社会',
    w: 280,
    h: 70,
    draw: () =>
      `${arrow(8, 34, 274, 34)}<path d="${[0, 1, 2, 3, 4, 5].map((i) => `M${28 + i * 46} 26V42`).join('')}"/>${[0, 1, 2, 3, 4, 5].map((i) => dot(28 + i * 46, 34, 3)).join('')}`
  },
  {
    key: 'supply-demand',
    name: '需要と供給',
    subject: '社会',
    w: 220,
    h: 200,
    draw: () =>
      `${arrow(30, 180, 214, 180)}${arrow(30, 180, 30, 8)}<path d="M50 30L190 160M50 160L190 30"/><path d="M120 95H30M120 95V180" ${dash} stroke="${SOFT}"/>`,
    labels: () => [J(196, 192, '数量', 10), J(52, 10, '価格', 10), M(198, 156, 'D'), M(198, 30, 'S'), M(22, 192, 'O')]
  },

  // ======== 国語・英語・音楽 ========
  {
    key: 'genko',
    name: '原稿用紙',
    subject: '国語・英語・音楽',
    w: 200,
    h: 200,
    draw: () =>
      `${grid(200, 200, 20, {color: '#e07a6f'})}<rect x="0.5" y="0.5" width="199" height="199" stroke="#e07a6f" stroke-width="2"/>`
  },
  {
    key: 'four-lines',
    name: '英語の 4 線',
    subject: '国語・英語・音楽',
    w: 280,
    h: 56,
    draw: () => `<path d="M4 10H276M4 22H276M4 46H276" stroke="${SOFT}"/><path d="M4 34H276" stroke="#e5484d"/>`
  },
  {
    key: 'staff',
    name: '五線譜',
    subject: '国語・英語・音楽',
    w: 280,
    h: 60,
    draw: () =>
      `<path d="${[0, 1, 2, 3, 4].map((i) => `M4 ${10 + i * 10}H276`).join('')}"/><path d="M4 10V50M276 10V50"/>`
  },

  // ======== 表・方眼 ========
  {key: 'table-3x3', name: '表（3×3）', subject: '表・方眼', ...table(3, 3)},
  {key: 'table-4x5', name: '表（4×5）', subject: '表・方眼', ...table(4, 5)},
  {
    key: 'graph-paper',
    name: '方眼',
    subject: '表・方眼',
    w: 200,
    h: 200,
    draw: () => `${grid(200, 200, 10, {color: '#e1e6ea'})}${grid(200, 200, 50, {color: '#aab6c2'})}`
  }
];

// 前の版で貼った図の id（正三角形・正五角形などは「正多角形」の角の数に）
const OLD = {
  'fig-triangle': ['fig-polygon', {n: 3}],
  'fig-pentagon': ['fig-polygon', {n: 5}],
  'fig-hexagon': ['fig-polygon', {n: 6}],
  'fig-octagon': ['fig-polygon', {n: 8}]
};

export const FIGURE_SUBJECTS = [...new Set(DEFS.map((d) => d.subject))];
export const FIGURES = DEFS.map((d) => ({...d, id: `fig-${d.key}`, params: d.params ?? []}));
const BY_ID = new Map(FIGURES.map((f) => [f.id, f]));
/** 図の定義（前の版の id も今の図に読み替える）。なければ null */
export const figureOf = (id) => BY_ID.get(OLD[id]?.[0] ?? id) ?? null;
export const isFigure = (id) => !!figureOf(id);
export const FIGURE_PT_PER_UNIT = 0.75; // 貼るときの大きさ：viewBox の 1 を 0.75pt に
export const LABEL_MAX = 40; // 1 つの図に置ける文字の数
export const LABEL_TEXT_MAX = 40; // 1 つの文字の長さ

/** 決め事の項目のうち、今の値で使うもの（グラフは式の種類で変わる） */
export const activeParams = (f, p) => f.params.filter((s) => !s.when || s.when(p));

/** 決め事を整える（図にない項目は捨て、数は範囲に収め、選ぶものは候補の中だけ）。足りない項目は既定 */
export function cleanParams(id, raw) {
  const f = figureOf(id);
  if (!f) return {};
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {...(OLD[id]?.[1] ?? {})};
  const base = {...(f.defaults ?? {})};
  for (const s of f.params) {
    if (!(s.key in base)) base[s.key] = s.def;
  }
  for (const s of f.params) {
    const v = src[s.key];
    if (s.type === 'select') out[s.key] = s.options.some(([o]) => o === v) ? v : (out[s.key] ?? base[s.key]);
    else {
      const n = typeof v === 'number' && Number.isFinite(v) ? v : (out[s.key] ?? base[s.key]);
      const stepped = Math.round(n / (s.step ?? 1)) * (s.step ?? 1);
      out[s.key] = Number(Math.min(s.max, Math.max(s.min, stepped)).toFixed(3));
    }
  }
  return out;
}

/** 既定の文字（決め事に合わせた位置）。位置は図の幅・高さに対する割合 */
export function defaultLabels(id, params) {
  const f = figureOf(id);
  if (!f?.labels) return [];
  return f.labels(cleanParams(id, params)).map(([x, y, t, o = {}]) => ({
    x: Number((x / f.w).toFixed(4)),
    y: Number((y / f.h).toFixed(4)),
    t,
    ...(o.m ? {m: true} : {}),
    ...(o.s ? {s: o.s} : {})
  }));
}

/** 書き換えた文字を整える：[{x, y, t, m?, s?}]（x・y は割合）。空の文字・形の悪いものは捨てる */
export function cleanLabels(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const l of raw.slice(0, LABEL_MAX)) {
    const x = Number(l?.x),
      y = Number(l?.y);
    const t = typeof l?.t === 'string' ? l.t.replace(/[\r\n]+/g, ' ').slice(0, LABEL_TEXT_MAX) : '';
    if (!t.trim() || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const lab = {
      x: Number(Math.min(1.2, Math.max(-0.2, x)).toFixed(4)),
      y: Number(Math.min(1.2, Math.max(-0.2, y)).toFixed(4)),
      t
    };
    if (l.m === true) lab.m = true;
    const s = Number(l.s);
    if (Number.isFinite(s) && s >= 6 && s <= 40) lab.s = Math.round(s);
    out.push(lab);
  }
  return out;
}

/** 文字の大きさ（viewBox の単位）。数学の文字は 15、ほかは 11 */
export const labelSize = (l) => l.s ?? (l.m ? 15 : 11);
const labelText = (f, l) =>
  `<text x="${r1(l.x * f.w)}" y="${r1(l.y * f.h)}" font-family="${l.m ? LABEL_SERIF : LABEL_GOTHIC}" font-size="${labelSize(l)}"${l.m ? ' font-style="italic"' : ''} text-anchor="middle" dominant-baseline="central" fill="${INK}" stroke="none">${esc(l.t)}</text>`;

/**
 * 図の SVG。labels を渡すと文字も描き込む（書き出し・一覧の見本）。null なら既定の文字、false なら文字を描かない（画面では別に置く）
 */
export function figureSvg(id, params, labels = null) {
  const f = figureOf(id);
  if (!f) return '';
  const p = cleanParams(id, params);
  const labs = labels === false ? [] : (labels ?? defaultLabels(id, p));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f.w} ${f.h}" width="${f.w}" height="${f.h}"><g fill="none" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${f.draw(p)}</g>${labs.map((l) => labelText(f, l)).join('')}</svg>`;
}
/** 図の画像（data: URL）。文字も描き込む */
export const figureUrl = (id, params = null, labels = null) => {
  const svg = figureSvg(id, params, labels);
  return svg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
    : '';
};
