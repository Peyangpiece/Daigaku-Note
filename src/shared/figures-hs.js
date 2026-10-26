// 素材の図（高校の教科）。形の決まりは figures.js の DEFS と同じ：{key, name, subject, w, h, draw(p), params?, labels?(p)}。
// 伸びる図は size(p)・fit(w, h)・growLabel(p) を持ち、押したまま広げて貼る図は drawToPlace（広げて決まるもの）を持つ。
// 数・欄の名前など書き換えないものは T で図に描き込み、書き換えたい文字（名前・記号）は labels（M・J）に置く
import {
  INK,
  SOFT,
  WATER,
  r1,
  rad,
  head,
  arrow,
  dash,
  grid,
  pathOf,
  dot,
  lead,
  M,
  J,
  T,
  box,
  range
} from './figure-parts.js';
import {skeletonDef} from './figure-skeleton.js';

const NUM = '#495057'; // 目盛りの数
const RED = '#d6336c';
const BLUE = '#1c7ed6';
const PALE = {
  red: '#ffe3e3',
  orange: '#ffe8cc',
  yellow: '#fff3bf',
  green: '#d3f9d8',
  blue: '#e7f5ff',
  purple: '#f3d9fa',
  gray: '#e9ecef'
};

/** 角の印（頂点 cx, cy から点 1・点 2 へ向かう 2 本の線の間の弧。小さいほうの角） */
const angleArc = (cx, cy, x1, y1, x2, y2, r = 14, color = INK) => {
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  let d = Math.atan2(y2 - cy, x2 - cx) - a1;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  const [sx, sy, ex, ey] = [
    cx + r * Math.cos(a1),
    cy + r * Math.sin(a1),
    cx + r * Math.cos(a1 + d),
    cy + r * Math.sin(a1 + d)
  ];
  return `<path d="M${r1(sx)} ${r1(sy)}A${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${r1(ex)} ${r1(ey)}" stroke="${color}" stroke-width="1.4"/>`;
};
/** 2 点の間に、向きが逆の矢印を 2 本（off だけ離して）。三権分立などの「おたがいに」 */
const twoWay = ([x1, y1], [x2, y2], off = 6, color = INK) => {
  const L = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = (-(y2 - y1) / L) * off,
    ny = ((x2 - x1) / L) * off;
  return `${arrow(x1 + nx, y1 + ny, x2 + nx, y2 + ny, {color})}${arrow(x2 - nx, y2 - ny, x1 - nx, y1 - ny, {color})}`;
};
/** 星（震源など） */
const star = (cx, cy, r = 8, fill = RED) => {
  const pts = range(10).map((i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const k = i % 2 ? r * 0.45 : r;
    return `${r1(cx + k * Math.cos(a))},${r1(cy + k * Math.sin(a))}`;
  });
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="none"/>`;
};
/** 2 次ベジェ曲線の点と向き（前線の記号を並べる） */
const quad = ([x0, y0], [x1, y1], [x2, y2], t) => ({
  x: (1 - t) ** 2 * x0 + 2 * (1 - t) * t * x1 + t ** 2 * x2,
  y: (1 - t) ** 2 * y0 + 2 * (1 - t) * t * y1 + t ** 2 * y2,
  dx: 2 * (1 - t) * (x1 - x0) + 2 * t * (x2 - x1),
  dy: 2 * (1 - t) * (y1 - y0) + 2 * t * (y2 - y1)
});
/** 円の扇形の帯（色相環・円グラフ）。a0・a1 は度（0 が上、時計回り） */
const ring = (cx, cy, r0, r1_, a0, a1) => {
  const p = (r, a) => [r1(cx + r * Math.sin(rad(a))), r1(cy - r * Math.cos(rad(a)))];
  const big = a1 - a0 > 180 ? 1 : 0;
  const [o0, o1] = [p(r1_, a0), p(r1_, a1)];
  if (!r0) return `M${cx} ${cy}L${o0[0]} ${o0[1]}A${r1_} ${r1_} 0 ${big} 1 ${o1[0]} ${o1[1]}Z`;
  const [i0, i1] = [p(r0, a0), p(r0, a1)];
  return `M${o0[0]} ${o0[1]}A${r1_} ${r1_} 0 ${big} 1 ${o1[0]} ${o1[1]}L${i1[0]} ${i1[1]}A${r0} ${r0} 0 ${big} 0 ${i0[0]} ${i0[1]}Z`;
};
/** 決まった並びの「それらしい」高さ（棒グラフ・折れ線グラフの見本。0〜1） */
const PAT = [0.55, 0.8, 0.65, 0.95, 0.7, 0.45, 0.6, 0.85, 0.5, 0.75, 0.9, 0.4, 0.68, 0.58, 0.82];

// ---- グラフの台（棒グラフ・折れ線グラフ・ヒストグラム）：1 つの欄は横 30、1 目盛りは縦 24。横に伸ばすと欄が、縦に伸ばすと目盛りが増える ----
const SLOT = 30,
  TICK = 24;
const chartSize = (p) => ({w: 36 + p.n * SLOT + 24, h: 30 + p.m * TICK + 26});
const chartParams = (n, m, nLabel = '棒の数') => [
  {key: 'n', label: nLabel, type: 'num', min: 2, max: 15, step: 1, def: n},
  {key: 'm', label: '縦の目盛りの数', type: 'num', min: 2, max: 12, step: 1, def: m}
];
const chartBase = (p) => {
  const {w, h} = chartSize(p);
  const oy = h - 26;
  const every = p.m > 8 ? 2 : 1;
  const lines = range(p.m)
    .map((j) => `M36 ${oy - (j + 1) * TICK}H${36 + p.n * SLOT}`)
    .join('');
  const nums = range(p.m + 1)
    .filter((j) => j % every === 0)
    .map((j) => T(31, oy - j * TICK, String(j), {s: 8, a: 'end', c: NUM}))
    .join('');
  return {
    oy,
    svg: `<path d="${lines}" stroke="#e9ecef" stroke-width="1"/>${nums}${arrow(36, oy, w - 6, oy)}${arrow(36, oy, 36, 8)}`
  };
};
const chartDef = (n, m, nLabel, draw) => ({
  w: chartSize({n, m}).w,
  h: chartSize({n, m}).h,
  params: chartParams(n, m, nLabel),
  size: chartSize,
  fit: (w, h) => ({n: Math.round((w - 60) / SLOT), m: Math.round((h - 56) / TICK)}),
  growLabel: (p) => `${nLabel.replace('の数', '')} ${p.n}・目盛り ${p.m}`,
  draw
});

// ---- グラフの式で描く図（ヒストグラムの山の形） ----
const bell = (i, n) => Math.exp(-((i - (n - 1) / 2) ** 2) / (2 * Math.max(1, n / 4) ** 2));

// ---- 地層の模様 ----
const STRATA = [
  ['泥岩', PALE.gray],
  ['砂岩', PALE.yellow],
  ['れき岩', PALE.orange],
  ['凝灰岩', PALE.purple],
  ['石灰岩', PALE.blue]
];
function strataPattern(kind, x, y, w, h) {
  const d = [];
  if (kind === 0)
    for (let yy = y + 7; yy < y + h; yy += 7)
      for (let xx = x + 4 + ((yy / 7) % 2) * 6; xx < x + w - 8; xx += 14) d.push(`M${xx} ${yy}h8`);
  if (kind === 1)
    for (let yy = y + 5; yy < y + h; yy += 6)
      for (let xx = x + 3 + ((yy / 6) % 2) * 4; xx < x + w - 2; xx += 8) d.push(`M${xx} ${yy}h0.1`);
  if (kind === 2) {
    const c = [];
    for (let yy = y + 8; yy < y + h - 4; yy += 11)
      for (let xx = x + 7 + ((yy / 11) % 2) * 8; xx < x + w - 6; xx += 16)
        c.push(`<circle cx="${xx}" cy="${yy}" r="3.4"/>`);
    return `<g stroke="${NUM}" stroke-width="1">${c.join('')}</g>`;
  }
  if (kind === 3)
    for (let yy = y + 9; yy < y + h; yy += 10)
      for (let xx = x + 6 + ((yy / 10) % 2) * 7; xx < x + w - 6; xx += 14) d.push(`M${xx} ${yy - 3}l3 5l3 -5`);
  if (kind === 4) {
    for (let yy = y + 9; yy < y + h; yy += 9) d.push(`M${x} ${yy}H${x + w}`);
    for (let yy = y, k = 0; yy < y + h; yy += 9, k++)
      for (let xx = x + (k % 2 ? 9 : 18); xx < x + w; xx += 18) d.push(`M${xx} ${yy}v${Math.min(9, y + h - yy)}`);
  }
  return `<path d="${d.join('')}" stroke="${NUM}" stroke-width="${kind === 1 ? 2.4 : 1}"/>`;
}

/** 円グラフ・帯グラフの割合（区切りの数ごと。合わせて 100） */
const SHARES = {
  2: [60, 40],
  3: [50, 30, 20],
  4: [40, 30, 20, 10],
  5: [35, 25, 20, 12, 8],
  6: [30, 25, 18, 12, 9, 6],
  7: [28, 22, 16, 12, 10, 7, 5],
  8: [25, 20, 15, 12, 10, 8, 6, 4]
};
const SHARE_COLORS = ['#a5d8ff', '#ffc9c9', '#b2f2bb', '#ffec99', '#d0bfff', '#ffd8a8', '#99e9f2', '#dee2e6'];

/** 散らばりの点（決まった並びの乱数。同じ図はいつも同じ点） */
function scatterPoints(kind) {
  let s = 7;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  return range(24).map(() => {
    const x = 0.05 + 0.9 * rnd();
    const e = (rnd() - 0.5) * 0.35;
    const y = kind === 'pos' ? x + e : kind === 'neg' ? 1 - x + e : 0.1 + 0.8 * rnd();
    return [x, Math.min(0.97, Math.max(0.03, y))];
  });
}

/** 雨温図：東京の平年値（気象庁、1991〜2020 年） */
const TOKYO_T = [5.4, 6.1, 9.4, 14.3, 18.8, 21.9, 25.7, 26.9, 23.3, 18.0, 12.5, 7.7];
const TOKYO_P = [59.7, 56.5, 116.0, 133.7, 139.7, 167.8, 156.2, 154.7, 224.9, 234.8, 96.3, 57.9];

/** 人口ピラミッドの形（年齢の帯 i：0〜19。5 歳ずつ）。横の長さ 0〜90 */
const PYRAMID = {
  fuji: (i) => 90 * (1 - i / 20) ** 1.2,
  bell: (i) => (i < 11 ? 62 - i * 0.6 : 56 * (1 - (i - 10) / 10) ** 1.2),
  pot: (i) => (34 + 46 * Math.exp(-(((i - 10) / 3.6) ** 2))) * (i > 15 ? Math.max(0.1, 1 - (i - 15) / 5) : 1)
};

const ERAS = [
  '縄文',
  '弥生',
  '古墳',
  '飛鳥',
  '奈良',
  '平安',
  '鎌倉',
  '室町',
  '安土桃山',
  '江戸',
  '明治',
  '大正',
  '昭和',
  '平成',
  '令和'
];
const ERA_COLORS = [PALE.orange, PALE.yellow, PALE.green, PALE.blue, PALE.purple, PALE.red];

const HUES = [
  '#ffe600',
  '#f9b200',
  '#f08300',
  '#e95513',
  '#e60012',
  '#e4007f',
  '#920783',
  '#1d2088',
  '#0068b7',
  '#00a0e9',
  '#009944',
  '#8fc31f'
];

/** 中和滴定の pH（0.1 mol/L の酸 10 mL に 0.1 mol/L の NaOH を v mL）。弱酸は酢酸（pKa 4.76） */
function titrationPH(kind, v) {
  const after = () => 14 + Math.log10((0.1 * (v - 10)) / (10 + v));
  if (v > 10.001) return Math.min(13, after());
  if (kind === 'strong') {
    if (v > 9.999) return 7;
    return Math.max(1, -Math.log10((0.1 * (10 - v)) / (10 + v)));
  }
  if (v < 0.01) return 2.88;
  if (v > 9.999) return 8.73;
  return Math.min(8.73, 4.76 + Math.log10(v / (10 - v)));
}

export const HS_DEFS = [
  // ======== 数学 ========
  {
    key: 'boxplot',
    name: '箱ひげ図',
    subject: '数学',
    w: 280,
    h: 104,
    params: [
      {key: 'min', label: '最小値', type: 'range', min: 0, max: 100, step: 1, def: 10},
      {key: 'q1', label: '第 1 四分位数', type: 'range', min: 0, max: 100, step: 1, def: 30},
      {key: 'med', label: '中央値', type: 'range', min: 0, max: 100, step: 1, def: 45},
      {key: 'q3', label: '第 3 四分位数', type: 'range', min: 0, max: 100, step: 1, def: 70},
      {key: 'max', label: '最大値', type: 'range', min: 0, max: 100, step: 1, def: 90}
    ],
    draw: (p) => {
      const [a, b, c, d, e] = [p.min, p.q1, p.med, p.q3, p.max].sort((x, y) => x - y);
      const X = (v) => 20 + v * 2.4;
      const ticks = range(11)
        .map((i) => `M${X(i * 10)} 78V${i % 2 ? 81 : 83}`)
        .join('');
      const nums = range(6)
        .map((i) => T(X(i * 20), 92, String(i * 20), {s: 8, c: NUM}))
        .join('');
      return `<path d="M20 78H260${ticks}"/>${nums}<rect x="${X(b)}" y="22" width="${r1(X(d) - X(b))}" height="36" fill="${PALE.blue}"/><path d="M${X(a)} 40H${X(b)}M${X(d)} 40H${X(e)}M${X(a)} 30V50M${X(e)} 30V50"/><path d="M${X(c)} 22V58" stroke="${RED}" stroke-width="2.4"/>`;
    }
  },
  {
    key: 'histogram',
    name: 'ヒストグラム',
    subject: '数学',
    ...chartDef(6, 5, '階級の数', (p) => {
      const base = chartBase(p);
      const bars = range(p.n)
        .map((i) => {
          const k = Math.max(1, Math.round(p.m * 0.9 * bell(i, p.n)));
          return `<rect x="${36 + i * SLOT}" y="${base.oy - k * TICK}" width="${SLOT}" height="${k * TICK}" fill="#d0ebff"/>`;
        })
        .join('');
      return bars + base.svg;
    }),
    drawToPlace: '階級の数と目盛りの数',
    labels: (p) => {
      const {w, h} = chartSize(p);
      return [J(58, 12, '度数', 10), J(w - 22, h - 12, '階級', 10)];
    }
  },
  {
    key: 'scatter',
    name: '散布図',
    subject: '数学',
    w: 220,
    h: 200,
    params: [
      {
        key: 'kind',
        label: '相関',
        type: 'select',
        options: [
          ['pos', '正の相関'],
          ['neg', '負の相関'],
          ['none', '相関なし']
        ],
        def: 'pos'
      }
    ],
    draw: (p) =>
      `${grid(220, 200, 20, {color: '#f1f3f5'})}${arrow(30, 175, 214, 175)}${arrow(30, 175, 30, 6)}${scatterPoints(
        p.kind
      )
        .map(([x, y]) => dot(30 + x * 170, 175 - y * 155, 3.2, BLUE))
        .join('')}`,
    labels: () => [M(208, 188, 'x'), M(42, 12, 'y'), M(22, 188, 'O')]
  },
  {
    key: 'vector',
    name: 'ベクトル（和）',
    subject: '数学',
    w: 240,
    h: 170,
    draw: () =>
      `<path d="M160 130L210 30M80 40L210 30" ${dash} stroke="${SOFT}"/>${arrow(30, 140, 160, 130)}${arrow(30, 140, 80, 40)}${arrow(30, 140, 210, 30, {color: RED})}${dot(30, 140)}`,
    labels: () => [
      M(22, 152, 'O'),
      M(168, 142, 'A'),
      M(72, 30, 'B'),
      M(220, 22, 'C'),
      M(96, 152, 'a'),
      J(97, 141, '→', 9),
      M(42, 88, 'b'),
      J(43, 76, '→', 9),
      M(128, 76, 'a + b', 13),
      J(129, 65, '→', 18)
    ]
  },
  {
    key: 'xyz',
    name: '空間の座標',
    subject: '数学',
    w: 220,
    h: 210,
    draw: () => {
      const P = [128, 92];
      const e = [
        [56, 164],
        [128, 164],
        [172, 120],
        [56, 116],
        [100, 72],
        [172, 72]
      ];
      const [px, pxy, py, q1, pz, q2] = e;
      const seg = (a, b) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
      return `${arrow(100, 120, 100, 8)}${arrow(100, 120, 212, 120)}${arrow(100, 120, 22, 198)}<path d="${[
        seg(px, pxy),
        seg(pxy, py),
        seg(pxy, P),
        seg(px, q1),
        seg(q1, P),
        seg(q1, pz),
        seg(pz, q2),
        seg(q2, P),
        seg(q2, py)
      ].join('')}" ${dash} stroke="${SOFT}"/>${dot(...P, 3.4, RED)}`;
    },
    labels: () => [M(18, 186, 'x'), M(206, 108, 'y'), M(112, 12, 'z'), M(90, 130, 'O'), M(140, 84, 'P')]
  },
  {
    key: 'inscribed-angle',
    name: '円周角と中心角',
    subject: '数学',
    w: 220,
    h: 200,
    draw: () => {
      const O = [110, 105],
        A = [48.7, 156.4],
        B = [171.3, 156.4],
        P = [96.1, 26.2];
      return `<circle cx="110" cy="105" r="80"/><path d="M${P}L${A}M${P}L${B}"/><path d="M${O}L${A}M${O}L${B}" stroke="${BLUE}"/>${angleArc(...P, ...A, ...B, 18, RED)}${angleArc(...O, ...A, ...B, 14, BLUE)}${dot(...O)}`;
    },
    labels: () => [
      M(96, 12, 'P'),
      M(36, 166, 'A'),
      M(184, 166, 'B'),
      M(122, 98, 'O'),
      M(98, 56, 'θ', 13),
      M(110, 132, '2θ', 13)
    ]
  },
  {
    key: 'tree-diagram',
    name: '樹形図',
    subject: '数学',
    // 横に伸ばすと段（回数）が増える
    w: 180,
    h: 98,
    params: [
      {key: 'n', label: '段の数（回数）', type: 'num', min: 1, max: 4, step: 1, def: 2},
      {
        key: 'kind',
        label: '枝の名前',
        type: 'select',
        options: [
          ['coin', '表・裏'],
          ['ox', '○・×'],
          ['ab', 'A・B']
        ],
        def: 'coin'
      }
    ],
    size: (p) => ({w: 40 + p.n * 70, h: 2 ** p.n * 22 + 10}),
    fit: (w) => ({n: Math.round((w - 40) / 70)}),
    growLabel: (p) => `${p.n} 段（${2 ** p.n} 通り）`,
    draw: (p) => {
      const names = {coin: ['表', '裏'], ox: ['○', '×'], ab: ['A', 'B']}[p.kind];
      const H = 2 ** p.n * 22;
      const Y = (k, j) => (j + 0.5) * (H / 2 ** k) + 5;
      let out = dot(14, Y(0, 0), 3);
      for (let k = 1; k <= p.n; k++)
        for (let j = 0; j < 2 ** k; j++) {
          const x = 14 + k * 70,
            px = x - 70,
            y = Y(k, j),
            py = Y(k - 1, j >> 1);
          out += `<path d="M${px + (k > 1 ? 10 : 3)} ${r1(py)}L${x - 10} ${r1(y)}"/>${T(x, y, names[j % 2], {s: 12})}`;
        }
      return out;
    }
  },
  {
    key: 'parallel-lines',
    name: '平行線と角',
    subject: '数学',
    w: 240,
    h: 160,
    draw: () => {
      const U = [141.4, 50],
        L = [98.6, 110];
      return `<path d="M10 50H230M10 110H230"/><path d="M70 150L170 10"/>${angleArc(...U, 230, 50, 170, 10, 16, RED)}${angleArc(...U, 10, 50, 70, 150, 16, RED)}${angleArc(...L, 230, 110, 170, 10, 16, RED)}`;
    },
    labels: () => [M(232, 38, 'ℓ'), M(232, 98, 'm'), M(166, 38, 'a'), M(118, 64, 'a'), M(124, 98, 'a')]
  },

  // ======== 物理 ========
  {
    key: 'refraction',
    name: '光の屈折',
    subject: '物理',
    w: 220,
    h: 200,
    params: [{key: 'i', label: '入射角', type: 'range', min: 5, max: 80, step: 1, def: 45, unit: '°'}],
    draw: (p) => {
      const r = Math.asin(Math.sin(rad(p.i)) / 1.33);
      const s = [110 - 85 * Math.sin(rad(p.i)), 100 - 85 * Math.cos(rad(p.i))];
      const e = [110 + 85 * Math.sin(r), 100 + 85 * Math.cos(r)];
      const f = [110 + 85 * Math.sin(rad(p.i)), 100 - 85 * Math.cos(rad(p.i))];
      return `<rect x="10" y="100" width="200" height="92" fill="${WATER}" stroke="none"/><path d="M10 100H210"/><path d="M110 12V188" ${dash} stroke="${SOFT}"/><path d="M110 100L${r1(f[0])} ${r1(f[1])}" stroke="${SOFT}"/>${arrow(...s, 110, 100, {color: RED})}${arrow(110, 100, ...e, {color: RED})}${angleArc(110, 100, 110, 12, ...s, 24)}${angleArc(110, 100, 110, 188, ...e, 24)}`;
    },
    labels: (p) => {
      const r = (Math.asin(Math.sin(rad(p.i)) / 1.33) * 180) / Math.PI;
      const ai = rad(-90 - p.i / 2),
        ar = rad(90 - r / 2);
      return [
        J(30, 88, '空気'),
        J(30, 114, '水'),
        M(110 + 36 * Math.cos(ai), 100 + 36 * Math.sin(ai), 'i'),
        M(110 + 36 * Math.cos(ar), 100 + 36 * Math.sin(ar), 'r')
      ];
    }
  },
  {
    key: 'field-lines',
    name: '電気力線（点電荷）',
    subject: '物理',
    w: 200,
    h: 200,
    params: [
      {
        key: 'q',
        label: '電荷',
        type: 'select',
        options: [
          ['plus', '正（＋）'],
          ['minus', '負（−）']
        ],
        def: 'plus'
      }
    ],
    draw: (p) => {
      const out = p.q === 'plus';
      const lines = range(12)
        .map((k) => {
          const a = (k * Math.PI) / 6;
          const [c, s] = [Math.cos(a), Math.sin(a)];
          const deg = (a * 180) / Math.PI + (out ? 0 : 180);
          return `<path d="M${r1(100 + 16 * c)} ${r1(100 + 16 * s)}L${r1(100 + 92 * c)} ${r1(100 + 92 * s)}"/>${head(100 + (out ? 62 : 50) * c, 100 + (out ? 62 : 50) * s, deg)}`;
        })
        .join('');
      return `<circle cx="100" cy="100" r="40" ${dash} stroke="${SOFT}"/><circle cx="100" cy="100" r="72" ${dash} stroke="${SOFT}"/>${lines}<circle cx="100" cy="100" r="12" fill="${out ? PALE.red : PALE.blue}"/>${T(100, 100, out ? '+' : '−', {s: 16, b: true})}`;
    }
  },
  {
    key: 'capacitor',
    name: 'コンデンサー',
    subject: '物理',
    w: 220,
    h: 200,
    draw: () =>
      `<path d="M80 30V130M140 30V130" stroke-width="3.4"/><path d="M80 80H40V170H100M110 170H180V80H140"/><path d="M100 156V184" stroke-width="2"/><path d="M110 163V177" stroke-width="4"/>${[50, 80, 110].map((y) => arrow(86, y, 134, y, {color: BLUE})).join('')}${[38, 62, 98, 122].map((y) => T(70, y, '+', {s: 11, c: RED, b: true}) + T(150, y, '−', {s: 11, c: BLUE, b: true})).join('')}<path d="M80 142H140M80 137V147M140 137V147" stroke="${SOFT}" stroke-width="1.2"/>`,
    labels: () => [J(80, 18, '+Q'), J(140, 18, '−Q'), M(110, 154, 'd'), M(128, 192, 'V'), M(110, 66, 'E')]
  },
  {
    key: 'piston',
    name: '気体とピストン',
    subject: '物理',
    w: 240,
    h: 150,
    draw: () => {
      const dots = [
        [40, 50],
        [62, 88],
        [88, 46],
        [104, 100],
        [126, 64],
        [48, 104],
        [76, 66],
        [118, 40],
        [96, 80],
        [134, 104],
        [58, 70],
        [36, 84]
      ];
      return `<rect x="21" y="31" width="128" height="88" fill="${PALE.blue}" stroke="none"/><path d="M200 30H20V120H200"/><rect x="150" y="32" width="14" height="86" fill="#ced4da"/><path d="M164 75H196" stroke-width="4"/>${arrow(236, 75, 200, 75, {color: RED})}${dots.map(([x, y]) => dot(x, y, 2.6, BLUE)).join('')}`;
    },
    labels: () => [J(84, 136, '気体'), J(157, 136, 'ピストン', 9), M(222, 62, 'F')]
  },
  {
    key: 'young',
    name: 'ヤングの実験',
    subject: '物理',
    w: 300,
    h: 180,
    draw: () => {
      const arcs = (x, y, rs) => rs.map((r) => `M${x} ${y - r}A${r} ${r} 0 0 1 ${x} ${y + r}`).join('');
      const fringes = range(7)
        .map((k) => {
          const y = 80 + (k - 3) * 20;
          return `<rect x="273" y="${y - 5}" width="14" height="10" fill="${RED}" fill-opacity="${r1(1 - Math.abs(k - 3) * 0.22)}" stroke="none"/>`;
        })
        .join('');
      return `<circle cx="20" cy="80" r="8" fill="#ffec99"/><path d="M70 10V76M70 84V150M140 10V56M140 64V96M140 104V150M270 10V150" stroke-width="2.4"/><path d="${arcs(70, 80, [20, 40, 60])}${arcs(140, 60, [24, 48, 72, 96])}${arcs(140, 100, [24, 48, 72, 96])}" stroke="${SOFT}" stroke-width="1"/>${fringes}`;
    },
    labels: () => [
      J(20, 104, '光源', 9),
      J(70, 166, '単スリット', 9),
      J(140, 166, '複スリット', 9),
      J(270, 166, 'スクリーン', 9),
      M(128, 80, 'd')
    ]
  },
  {
    key: 'longitudinal',
    name: '縦波（疎密波）',
    subject: '物理',
    // 1 波長は 80。横に伸ばすと波が増える
    w: 280,
    h: 90,
    params: [{key: 'n', label: '波の数', type: 'num', min: 1, max: 8, step: 1, def: 3}],
    size: (p) => ({w: 40 + p.n * 80, h: 90}),
    fit: (w) => ({n: Math.round((w - 40) / 80)}),
    growLabel: (p) => `波 ${p.n} 個`,
    draw: (p) => {
      const d = [];
      for (let x0 = 0; x0 <= p.n * 80; x0 += 6) {
        const x = 20 + x0 + 5 * Math.sin((2 * Math.PI * x0) / 80);
        d.push(`M${r1(x)} 18V58`);
      }
      return `<path d="${d.join('')}" stroke="${BLUE}" stroke-width="1.4"/><path d="M60 72H140M60 67V77M140 67V77" stroke="${SOFT}"/>`;
    },
    labels: () => [J(60, 8, '密', 10), J(100, 8, '疎', 10), M(100, 84, 'λ')]
  },
  {
    key: 'standing-wave',
    name: '定常波（定在波）',
    subject: '物理',
    // 腹 1 つは 60。横に伸ばすと腹が増える
    w: 220,
    h: 120,
    params: [{key: 'n', label: '腹の数', type: 'num', min: 1, max: 10, step: 1, def: 3}],
    size: (p) => ({w: 40 + p.n * 60, h: 120}),
    fit: (w) => ({n: Math.round((w - 40) / 60)}),
    growLabel: (p) => `腹 ${p.n} 個`,
    draw: (p) => {
      const L = p.n * 60;
      const up = [],
        dn = [];
      for (let x = 0; x <= L; x += 2) {
        const y = 36 * Math.sin((Math.PI * x) / 60);
        up.push([20 + x, 56 - y]);
        dn.push([20 + x, 56 + y]);
      }
      const nodes = range(p.n + 1)
        .map((k) => dot(20 + k * 60, 56, 3))
        .join('');
      return `<path d="M20 20V92M${20 + L} 20V92" stroke-width="3"/><path d="${pathOf(up)}" stroke="${BLUE}" stroke-width="2"/><path d="${pathOf(dn)}" stroke="${BLUE}" stroke-width="1.4" ${dash}/>${nodes}`;
    },
    labels: () => [J(80, 106, '節', 10), J(50, 106, '腹', 10)]
  },
  {
    key: 'friction',
    name: '摩擦力と力のつり合い',
    subject: '物理',
    w: 240,
    h: 170,
    draw: () =>
      `<path d="M10 120H230"/><path d="${range(22)
        .map((i) => `M${16 + i * 10} 120l-6 7`)
        .join(
          ''
        )}" stroke="${SOFT}"/><rect x="80" y="70" width="80" height="50" fill="${PALE.gray}"/>${arrow(120, 70, 120, 18, {color: RED})}${arrow(120, 95, 120, 160, {color: RED})}${arrow(160, 95, 226, 95, {color: RED})}${arrow(80, 116, 30, 116, {color: RED})}`,
    labels: () => [M(134, 24, 'N'), M(140, 158, 'mg'), M(214, 82, 'F'), M(42, 104, 'f')]
  },

  // ======== 化学 ========
  {
    key: 'periodic',
    name: '周期表（1〜20 番）',
    subject: '化学',
    w: 486,
    h: 146,
    draw: () => {
      const E = 'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca'.split(' ');
      const pos = (z) => {
        if (z === 1) return [1, 1];
        if (z === 2) return [18, 1];
        if (z <= 10) return [z <= 4 ? z - 2 : z + 8, 2];
        if (z <= 18) return [z <= 12 ? z - 10 : z, 3];
        return [z - 18, 4];
      };
      const color = (z, g) =>
        g === 18 ? PALE.purple : g === 17 ? PALE.green : g === 1 && z > 1 ? PALE.red : g === 2 ? PALE.orange : '#fff';
      const cells = E.map((s, i) => {
        const z = i + 1;
        const [g, per] = pos(z);
        const x = 14 + (g - 1) * 26,
          y = 18 + (per - 1) * 30;
        return `<rect x="${x}" y="${y}" width="26" height="30" fill="${color(z, g)}" stroke-width="1"/>${T(x + 3, y + 7, String(z), {s: 7, a: 'start', c: NUM})}${T(x + 13, y + 19, s, {s: 12, b: true})}`;
      }).join('');
      const groups = range(18)
        .map((g) => T(27 + g * 26, 9, String(g + 1), {s: 8, c: NUM}))
        .join('');
      const periods = range(4)
        .map((p) => T(7, 33 + p * 30, String(p + 1), {s: 8, c: NUM}))
        .join('');
      return groups + periods + cells;
    }
  },
  {
    key: 'filtration',
    name: 'ろ過',
    subject: '化学',
    w: 180,
    h: 230,
    draw: () =>
      `<rect x="20" y="214" width="140" height="8" fill="#ced4da"/><path d="M40 214V20M40 60H66"/><path d="M95 192H163V212H95Z" fill="${WATER}" stroke="none"/><path d="M94 140V210Q94 214 98 214H160Q164 214 164 210V140"/><path d="M72 70H108L90 97Z" fill="${WATER}" stroke="none"/><path d="M60 55L86 105V152M120 55L94 105V150"/><path d="M64 58L90 100L116 58" stroke="${SOFT}"/><path d="M112 18L96 66" stroke-width="2.6"/>`,
    labels: () => [J(140, 20, 'ガラス棒', 9), J(146, 62, 'ろ紙', 9), J(134, 100, 'ろうと', 9), J(129, 203, 'ろ液', 9)]
  },
  {
    key: 'distillation',
    name: '蒸留',
    subject: '化学',
    w: 300,
    h: 222,
    draw: () => {
      const P = (t, k = 0) => [66 + 189 * t - 0.398 * k, 70 + 82 * t + 0.917 * k];
      const L = (a, b) => `M${r1(a[0])} ${r1(a[1])}L${r1(b[0])} ${r1(b[1])}`;
      return `<path d="M31.7 150A30 30 0 0 0 88.3 150Z" fill="${WATER}" stroke="none"/><circle cx="60" cy="140" r="30"/><path d="M54 113V46M66 113V46"/><rect x="52" y="40" width="16" height="8" fill="#ced4da"/><path d="M60 30V76"/><circle cx="60" cy="78" r="3" fill="${RED}" stroke="none"/><path d="${L(P(0, -2.5), P(1, -2.5))}${L(P(0, 2.5), P(1, 2.5))}"/><path d="${L(P(0.25, 9), P(0.85, 9))}${L(P(0.25, -9), P(0.85, -9))}${L(P(0.25, 9), P(0.25, -9))}${L(P(0.85, 9), P(0.85, -9))}" fill="${PALE.blue}"/><path d="M213.6 143.9V164M126.3 86.3V70"/>${arrow(213.6, 178, 213.6, 160, {color: BLUE})}${arrow(126.3, 72, 126.3, 54, {color: BLUE})}<path d="M237 188H273L276 196H234Z" fill="${WATER}" stroke="none"/><path d="M249 148V158L234 196H276L261 158V148"/><path d="M28 176H92"/><path d="M52 200Q60 180 68 200Z" fill="#ffa94d" stroke="none"/>`;
    },
    labels: () => [
      J(30, 34, '温度計', 9),
      J(212, 98, 'リービッヒ冷却器', 9),
      J(140, 56, '水', 9),
      J(226, 186, '水', 9),
      J(60, 214, '枝付きフラスコ', 9),
      J(255, 210, '留出液', 9)
    ]
  },
  {
    key: 'heating-curve',
    name: '状態変化（加熱曲線）',
    subject: '化学',
    w: 260,
    h: 190,
    draw: () =>
      `${arrow(34, 160, 254, 160)}${arrow(34, 160, 34, 6)}<path d="M34 120H70M34 60H170" ${dash} stroke="${SOFT}"/>${T(29, 120, '0', {s: 8, a: 'end', c: NUM})}${T(29, 60, '100', {s: 8, a: 'end', c: NUM})}<path d="M34 150L70 120H120L170 60H225L245 40" stroke="${RED}" stroke-width="2.4"/>`,
    labels: () => [
      J(60, 12, '温度〔℃〕', 9),
      J(226, 176, '加熱時間', 9),
      J(95, 110, '融解', 10),
      J(198, 50, '沸騰', 10),
      J(50, 146, '固体', 9),
      J(152, 100, '液体', 9),
      J(236, 28, '気体', 9)
    ]
  },
  {
    key: 'daniell',
    name: 'ダニエル電池',
    subject: '化学',
    w: 260,
    h: 214,
    draw: () =>
      `<rect x="31" y="100" width="99" height="89" fill="#f1f3f5" stroke="none"/><rect x="131" y="100" width="98" height="89" fill="#d0ebff" stroke="none"/><path d="M30 80V190H230V80"/><path d="M130 84V190" stroke="${SOFT}" stroke-width="3" stroke-dasharray="3 3"/><rect x="70" y="60" width="12" height="100" fill="#adb5bd"/><rect x="178" y="60" width="12" height="100" fill="#e8a87c"/><path d="M76 60V30H120M140 30H184V60"/><circle cx="130" cy="30" r="10" fill="#fff"/>${T(130, 30, 'A', {s: 11, b: true})}${arrow(88, 18, 118, 18, {color: BLUE})}`,
    labels: () => [
      J(44, 66, 'Zn（−）', 10),
      J(216, 66, 'Cu（＋）', 10),
      J(103, 8, 'e⁻', 10),
      J(130, 72, '素焼き板', 9),
      J(80, 204, 'ZnSO₄ 水溶液', 9),
      J(180, 204, 'CuSO₄ 水溶液', 9)
    ]
  },
  {
    key: 'titration-curve',
    name: '中和滴定曲線',
    subject: '化学',
    w: 240,
    h: 200,
    params: [
      {
        key: 'kind',
        label: '酸',
        type: 'select',
        options: [
          ['strong', '強酸（塩酸）'],
          ['weak', '弱酸（酢酸）']
        ],
        def: 'strong'
      }
    ],
    draw: (p) => {
      const X = (v) => 36 + v * 9,
        Y = (ph) => 176 - ph * 11;
      const pts = [];
      for (let v = 0; v <= 20.0001; v += 0.05) pts.push([X(v), Y(titrationPH(p.kind, v))]);
      return `${arrow(36, 176, 234, 176)}${arrow(36, 176, 36, 6)}<path d="M36 ${Y(7)}H216M${X(10)} 176V${Y(14)}" ${dash} stroke="${SOFT}"/>${[0, 7, 14].map((v) => T(31, Y(v), String(v), {s: 8, a: 'end', c: NUM})).join('')}${[0, 10, 20].map((v) => T(X(v), 186, String(v), {s: 8, c: NUM})).join('')}<path d="${pathOf(pts)}" stroke="${RED}" stroke-width="2.2"/>`;
    },
    labels: () => [J(50, 12, 'pH', 10), J(196, 196, '滴下量〔mL〕', 9), J(150, 30, '中和点', 9)]
  },

  // ======== 生物 ========
  {
    key: 'eco-pyramid',
    name: '生態ピラミッド',
    subject: '生物',
    w: 260,
    h: 180,
    draw: () => {
      const half = (y) => (110 * (y - 10)) / 160;
      const colors = ['#b2f2bb', '#d8f5a2', '#ffec99', '#ffc9c9'];
      return range(4)
        .map((k) => {
          const y0 = 170 - k * 40,
            y1 = y0 - 40;
          return `<path d="M${r1(120 - half(y0))} ${y0}H${r1(120 + half(y0))}L${r1(120 + half(y1))} ${y1}H${r1(120 - half(y1))}Z" fill="${colors[k]}"/>`;
        })
        .join('');
    },
    labels: () => [
      J(120, 150, '生産者'),
      J(120, 110, '一次消費者', 10),
      J(120, 72, '二次消費者', 9),
      J(212, 34, '三次消費者', 9)
    ]
  },
  {
    key: 'punnett',
    name: '遺伝の組み合わせ（交配表）',
    subject: '生物',
    w: 180,
    h: 150,
    draw: () =>
      `<rect x="15" y="15" width="150" height="40" fill="#f1f3f5" stroke="none"/><rect x="15" y="55" width="50" height="80" fill="#f1f3f5" stroke="none"/><path d="M15 15H165V135H15ZM65 15V135M115 15V135M15 55H165M15 95H165M15 15L65 55"/>`,
    labels: () => [
      J(52, 26, '♂', 9),
      J(28, 44, '♀', 9),
      M(90, 35, 'A'),
      M(140, 35, 'a'),
      M(40, 75, 'A'),
      M(40, 115, 'a'),
      M(90, 75, 'AA'),
      M(140, 75, 'Aa'),
      M(90, 115, 'Aa'),
      M(140, 115, 'aa')
    ]
  },
  {
    key: 'phylo-tree',
    name: '系統樹',
    subject: '生物',
    w: 260,
    h: 170,
    draw: () =>
      `<path d="M20 96.3H60M60 62.5V130M60 62.5H120M120 40V85M120 40H160M160 25V55M160 25H180M160 55H180M120 85H180M60 130H150M150 115V145M150 115H180M150 145H180"/>`,
    labels: () =>
      ['ヒト', 'チンパンジー', 'ゴリラ', 'イヌ', 'ネコ'].map((n, i) => J(186 + n.length * 5, 25 + i * 30, n, 10))
  },
  {
    key: 'photosynthesis',
    name: '光の強さと光合成',
    subject: '生物',
    w: 250,
    h: 190,
    draw: () => {
      const pts = [];
      for (let x = 0; x <= 200; x += 2) pts.push([40 + x, 120 - (100 * (1 - Math.exp(-x / 70)) - 30)]);
      return `${arrow(40, 120, 246, 120)}${arrow(40, 184, 40, 6)}<path d="M210 120V58" ${dash} stroke="${SOFT}"/><path d="${pathOf(pts)}" stroke="#2f9e44" stroke-width="2.4"/>${dot(65, 120, 3, RED)}`;
    },
    labels: () => [
      J(96, 12, 'CO₂ 吸収速度', 9),
      J(226, 136, '光の強さ', 9),
      J(98, 134, '光補償点', 9),
      J(210, 50, '光飽和点', 9),
      M(32, 132, 'O')
    ]
  },
  {
    key: 'enzyme',
    name: '酵素と温度',
    subject: '生物',
    w: 230,
    h: 190,
    draw: () => {
      const pts = [];
      for (let t = 0; t <= 70; t += 0.5) {
        const r = t <= 40 ? Math.exp(-(((t - 40) / 14) ** 2)) : Math.exp(-(((t - 40) / 8) ** 2));
        pts.push([36 + t * 2.6, 160 - r * 130]);
      }
      return `${arrow(36, 160, 226, 160)}${arrow(36, 160, 36, 6)}<path d="M140 160V30" ${dash} stroke="${SOFT}"/>${[0, 20, 40, 60].map((t) => T(36 + t * 2.6, 170, String(t), {s: 8, c: NUM})).join('')}<path d="${pathOf(pts)}" stroke="${RED}" stroke-width="2.4"/>`;
    },
    labels: () => [J(66, 12, '反応速度', 9), J(200, 182, '温度〔℃〕', 9), J(170, 22, '最適温度', 9)]
  },
  {
    key: 'mitosis',
    name: '体細胞分裂',
    subject: '生物',
    w: 340,
    h: 110,
    draw: () => {
      const X = (x, y, c = '#9c36b5') =>
        `<path d="M${x - 3} ${y - 5}L${x + 3} ${y + 5}M${x + 3} ${y - 5}L${x - 3} ${y + 5}" stroke="${c}" stroke-width="2.2"/>`;
      const V = (x, y, dir) =>
        `<path d="M${x - 3 * dir} ${y - 4}L${x + 3 * dir} ${y}L${x - 3 * dir} ${y + 4}" stroke="#9c36b5" stroke-width="2.2"/>`;
      const cell = (cx) => `<circle cx="${cx}" cy="50" r="28" fill="${PALE.yellow}"/>`;
      const spindle = (cx) =>
        `<path d="${[-12, 0, 12].map((dy) => `M${cx - 24} 50L${cx} ${50 + dy}M${cx + 24} 50L${cx} ${50 + dy}`).join('')}" stroke="${SOFT}" stroke-width="1"/>`;
      const c = [36, 102, 168, 234, 300];
      return [
        `${cell(c[0])}<circle cx="${c[0]}" cy="50" r="13" fill="${PALE.purple}"/>${dot(c[0] - 4, 47, 1.6, '#9c36b5')}${dot(c[0] + 4, 54, 1.6, '#9c36b5')}`,
        `${cell(c[1])}<circle cx="${c[1]}" cy="50" r="15" ${dash} stroke="${SOFT}"/>${X(c[1] - 6, 44)}${X(c[1] + 6, 48)}${X(c[1] - 1, 58)}`,
        `${cell(c[2])}${spindle(c[2])}${X(c[2], 38)}${X(c[2], 50)}${X(c[2], 62)}`,
        `${cell(c[3])}${spindle(c[3])}${[38, 50, 62].map((y) => V(c[3] - 13, y, 1) + V(c[3] + 13, y, -1)).join('')}`,
        `<path d="M${c[4]} 26C${c[4] - 40} 22 ${c[4] - 40} 78 ${c[4]} 74C${c[4] + 40} 78 ${c[4] + 40} 22 ${c[4]} 26Z" fill="${PALE.yellow}"/><path d="M${c[4]} 26V74" stroke="${SOFT}"/><circle cx="${c[4] - 13}" cy="50" r="8" fill="${PALE.purple}"/><circle cx="${c[4] + 13}" cy="50" r="8" fill="${PALE.purple}"/>`
      ].join('');
    },
    labels: () => ['間期', '前期', '中期', '後期', '終期'].map((t, i) => J(36 + i * 66, 96, t, 10))
  },

  skeletonDef,

  // ======== 地学 ========
  {
    key: 'earth-layers',
    name: '地球の内部構造',
    subject: '地学',
    w: 240,
    h: 140,
    draw: () =>
      `<path d="M10 130A110 110 0 0 1 230 130Z" fill="#ced4da"/><path d="M14 130A106 106 0 0 1 226 130Z" fill="#ffc078" stroke="none"/><path d="M60 130A60 60 0 0 1 180 130Z" fill="#ff922b" stroke="none"/><path d="M99 130A21 21 0 0 1 141 130Z" fill="#f76707" stroke="none"/><path d="M60 130A60 60 0 0 1 180 130M99 130A21 21 0 0 1 141 130M10 130H230" stroke-width="1.2"/>${lead(174, 37, 194, 26)}`,
    labels: () => [J(208, 20, '地殻', 10), J(120, 46, 'マントル', 10), J(120, 90, '外核', 10), J(120, 122, '内核', 9)]
  },
  {
    key: 'strata',
    name: '地層（柱状図）',
    subject: '地学',
    // 1 つの層は高さ 28。縦に伸ばすと層が増える
    w: 200,
    h: 160,
    params: [{key: 'n', label: '層の数', type: 'num', min: 2, max: 12, step: 1, def: 5}],
    size: (p) => ({w: 200, h: 20 + p.n * 28}),
    fit: (w, h) => ({n: Math.round((h - 20) / 28)}),
    growLabel: (p) => `${p.n} 層`,
    draw: (p) =>
      range(p.n)
        .map((i) => {
          const y = 10 + i * 28,
            k = i % STRATA.length;
          return `<rect x="30" y="${y}" width="70" height="28" fill="${STRATA[k][1]}" stroke-width="1.2"/>${strataPattern(k, 30, y, 70, 28)}`;
        })
        .join(''),
    labels: (p) => range(p.n).map((i) => J(140, 24 + i * 28, STRATA[i % STRATA.length][0], 10))
  },
  {
    key: 'hypocenter',
    name: '震源と震央',
    subject: '地学',
    w: 240,
    h: 170,
    draw: () =>
      `<rect x="10" y="40" width="220" height="120" fill="#fff4e6" stroke="none"/><path d="M10 40H230"/><path d="M110 40V130M110 130L200 40" ${dash} stroke="${NUM}"/>${star(110, 130)}${dot(110, 40, 3.4, RED)}<path d="M193 40L200 28L207 40Z" fill="${INK}" stroke="none"/>`,
    labels: () => [
      J(110, 26, '震央'),
      J(110, 152, '震源'),
      J(200, 18, '観測点'),
      J(155, 52, '震央距離', 9),
      J(130, 86, '深さ', 9),
      J(176, 98, '震源距離', 9)
    ]
  },
  {
    key: 'fault',
    name: '断層',
    subject: '地学',
    w: 240,
    h: 190,
    params: [
      {
        key: 'kind',
        label: '断層の種類',
        type: 'select',
        options: [
          ['normal', '正断層（引っ張られる）'],
          ['reverse', '逆断層（押される）']
        ],
        def: 'normal'
      }
    ],
    draw: (p) => {
      const down = p.kind === 'normal';
      const dy = down ? 18.2 : -18.2;
      const xp = (y) => 150 - (60 * (y - 30)) / 130; // 断層面の x
      const top = 30 + dy;
      const fill = '#ffe8cc';
      const foot = `<path d="M150 30H230V160H90Z" fill="${fill}"/>`;
      const hang = `<path d="M10 ${r1(top)}H${r1(xp(top))}L90 160H10Z" fill="${fill}"/>`;
      const layers = [60, 95, 130]
        .map((Y) => {
          const yh = Y + dy;
          return `M${r1(xp(Y))} ${Y}H230${yh > top && yh < 160 ? `M10 ${r1(yh)}H${r1(xp(yh))}` : ''}`;
        })
        .join('');
      const u = [-60 / 143, 130 / 143]; // 断層面を下へ
      const mid = [120, 95];
      const side = (k, s) => [
        mid[0] + k * 10 * (130 / 143) * -1 + s * u[0] * 20,
        mid[1] + k * 10 * (-60 / 143) * -1 + s * u[1] * 20
      ];
      const [a0, a1] = [side(-1, down ? -1 : 1), side(-1, down ? 1 : -1)];
      const [b0, b1] = [side(1, down ? 1 : -1), side(1, down ? -1 : 1)];
      const pull = down
        ? [arrow(60, 178, 20, 178), arrow(180, 178, 220, 178)]
        : [arrow(20, 178, 60, 178), arrow(220, 178, 180, 178)];
      return `${foot}${hang}<path d="${layers}" stroke="${NUM}" stroke-width="1"/><path d="M${r1(xp(10))} 10L90 160" stroke="${RED}" stroke-width="2"/>${arrow(...a0, ...a1, {color: RED})}${arrow(...b0, ...b1, {color: RED})}${pull.join('')}`;
    },
    labels: () => [J(44, 100, '上盤'), J(200, 100, '下盤')]
  },
  {
    key: 'moon-phase',
    name: '月の満ち欠け',
    subject: '地学',
    w: 260,
    h: 240,
    draw: () => {
      const moons = range(8)
        .map((k) => {
          const a = (-k * Math.PI) / 4; // 新月（右）から反時計回り
          const x = 130 + 80 * Math.cos(a),
            y = 120 + 80 * Math.sin(a);
          return `<circle cx="${r1(x)}" cy="${r1(y)}" r="10" fill="#495057"/><path d="M${r1(x)} ${r1(y - 10)}A10 10 0 0 1 ${r1(x)} ${r1(y + 10)}Z" fill="#fff9db" stroke="none"/><circle cx="${r1(x)}" cy="${r1(y)}" r="10"/>`;
        })
        .join('');
      return `<circle cx="130" cy="120" r="80" ${dash} stroke="${SOFT}"/>${moons}<circle cx="130" cy="120" r="14" fill="#74c0fc"/><path d="M130 106A14 14 0 0 0 130 134Z" fill="#1864ab" fill-opacity="0.6" stroke="none"/>${[40, 200].map((y) => arrow(256, y, 230, y, {color: '#f59f00'})).join('')}`;
    },
    labels: () => [
      J(210, 98, '新月', 10),
      J(130, 22, '上弦の月', 10),
      J(50, 98, '満月', 10),
      J(130, 220, '下弦の月', 10),
      J(130, 144, '地球', 9),
      J(236, 228, '太陽の光', 9)
    ]
  },
  {
    key: 'front',
    name: '前線（寒冷前線・温暖前線）',
    subject: '地学',
    w: 260,
    h: 170,
    draw: () => {
      const cold = [
        [120, 70],
        [80, 110],
        [50, 160]
      ];
      const warm = [
        [120, 70],
        [170, 80],
        [225, 120]
      ];
      const tri = [0.2, 0.45, 0.7, 0.92]
        .map((t) => {
          const q = quad(...cold, t);
          const L = Math.hypot(q.dx, q.dy);
          const [tx, ty] = [q.dx / L, q.dy / L];
          const [nx, ny] = [ty, -tx]; // 進む向き（東）
          return `<path d="M${r1(q.x - 6 * tx)} ${r1(q.y - 6 * ty)}L${r1(q.x + 9 * nx)} ${r1(q.y + 9 * ny)}L${r1(q.x + 6 * tx)} ${r1(q.y + 6 * ty)}Z" fill="${BLUE}" stroke="none"/>`;
        })
        .join('');
      const semi = [0.2, 0.45, 0.7, 0.92]
        .map((t) => {
          const q = quad(...warm, t);
          const L = Math.hypot(q.dx, q.dy);
          const [tx, ty] = [q.dx / L, q.dy / L];
          return `<path d="M${r1(q.x - 6 * tx)} ${r1(q.y - 6 * ty)}A6 6 0 0 0 ${r1(q.x + 6 * tx)} ${r1(q.y + 6 * ty)}Z" fill="${RED}" stroke="none"/>`;
        })
        .join('');
      return `<ellipse cx="120" cy="70" rx="40" ry="28" stroke="${SOFT}"/><ellipse cx="120" cy="70" rx="70" ry="48" stroke="${SOFT}"/><ellipse cx="120" cy="70" rx="100" ry="66" stroke="${SOFT}"/><path d="M${cold[0]}Q${cold[1]} ${cold[2]}" stroke="${BLUE}" stroke-width="2.4"/><path d="M${warm[0]}Q${warm[1]} ${warm[2]}" stroke="${RED}" stroke-width="2.4"/>${tri}${semi}${T(120, 60, '低', {s: 16, b: true})}`;
    },
    labels: () => [J(40, 120, '寒冷前線', 9), J(222, 100, '温暖前線', 9)]
  },
  {
    key: 'pressure',
    name: '高気圧と低気圧（風）',
    subject: '地学',
    w: 280,
    h: 160,
    draw: () => {
      const iso = (cx) => [24, 44, 64].map((r) => `<circle cx="${cx}" cy="75" r="${r}" stroke="${SOFT}"/>`).join('');
      const winds = (cx, high) =>
        range(6)
          .map((k) => {
            const f = (k * Math.PI) / 3 + 0.3;
            const [c, s] = [Math.cos(f), Math.sin(f)];
            const px = cx + 40 * c,
              py = 75 + 40 * s;
            const v = high ? [-s + 0.7 * c, c + 0.7 * s] : [s - 0.7 * c, -c - 0.7 * s];
            const L = Math.hypot(...v);
            const [ux, uy] = [(v[0] / L) * 11, (v[1] / L) * 11];
            return arrow(px - ux, py - uy, px + ux, py + uy, {color: BLUE});
          })
          .join('');
      return `${iso(70)}${iso(210)}${winds(70, true)}${winds(210, false)}${T(70, 75, '高', {s: 16, b: true, c: RED})}${T(210, 75, '低', {s: 16, b: true, c: BLUE})}`;
    },
    labels: () => [J(70, 150, '高気圧（時計回りに吹き出す）', 9), J(210, 150, '低気圧（反時計回りに吹き込む）', 9)]
  },
  {
    key: 'plates',
    name: 'プレートの沈み込み',
    subject: '地学',
    w: 280,
    h: 160,
    draw: () =>
      `<rect x="10" y="30" width="260" height="125" fill="#fff4e6" stroke="none"/><path d="M10 30H190L170 50L155 72L140 60H10Z" fill="${WATER}" stroke="none"/><path d="M10 60H140L155 72L245 148L232 158L140 76H10Z" fill="#adb5bd"/><path d="M155 72L170 50L190 30H270V95H205Z" fill="#ffd8a8"/>${arrow(30, 46, 100, 46, {color: RED})}${arrow(190, 112, 226, 142, {color: RED})}${lead(155, 70, 150, 20)}`,
    labels: () => [
      J(150, 12, '海溝', 9),
      J(70, 92, '海洋プレート', 9),
      J(234, 62, '大陸プレート', 9),
      J(80, 130, 'マントル', 9)
    ]
  },

  // ======== 国語 ========
  {
    key: 'tategaki',
    name: '縦の罫線',
    subject: '国語',
    // 行の幅は 24、長さは 40 ごと。横に伸ばすと行が、縦に伸ばすと長さが増える
    w: 248,
    h: 240,
    params: [
      {key: 'cols', label: '行の数', type: 'num', min: 2, max: 40, step: 1, def: 10},
      {key: 'len', label: '行の長さ', type: 'num', min: 2, max: 20, step: 1, def: 6}
    ],
    size: (p) => ({w: p.cols * 24 + 8, h: p.len * 40}),
    fit: (w, h) => ({cols: Math.round((w - 8) / 24), len: Math.round(h / 40)}),
    growLabel: (p) => `${p.cols} 行`,
    drawToPlace: '行の数と長さ',
    draw: (p) => {
      const h = p.len * 40;
      const lines = range(p.cols - 1)
        .map((i) => `M${28 + i * 24} 4V${h - 4}`)
        .join('');
      return `<path d="${lines}" stroke="#9fb3c8"/><rect x="4" y="4" width="${p.cols * 24}" height="${h - 8}" stroke="#7a94ad" stroke-width="1.6"/>`;
    }
  },
  {
    key: 'relation-map',
    name: '人物相関図',
    subject: '国語',
    w: 260,
    h: 190,
    draw: () => {
      const corner = [
        [40, 30],
        [220, 30],
        [40, 160],
        [220, 160]
      ];
      const lines = corner
        .map(([x, y]) => {
          const [sx, sy] = [x < 130 ? 95 : 165, y < 95 ? 82 : 108];
          const [ex, ey] = [x < 130 ? 64 : 196, y < 95 ? 44 : 146];
          return twoWay([sx, sy], [ex, ey], 4, NUM);
        })
        .join('');
      return `${lines}${box(95, 80, 70, 30, {rx: 8, fill: PALE.yellow})}${corner.map(([x, y]) => box(x - 32, y - 14, 64, 28, {rx: 6, fill: '#fff'})).join('')}`;
    },
    labels: () => [
      J(130, 95, '主人公'),
      J(40, 30, '人物 A', 10),
      J(220, 30, '人物 B', 10),
      J(40, 160, '人物 C', 10),
      J(220, 160, '人物 D', 10),
      J(96, 52, '友人', 9),
      J(164, 52, '親', 9),
      J(96, 138, 'ライバル', 9),
      J(164, 138, '先生', 9)
    ]
  },

  // ======== 英語 ========
  {
    key: 'tense-line',
    name: '時制の線',
    subject: '英語',
    w: 300,
    h: 90,
    draw: () =>
      `${arrow(10, 45, 292, 45)}<path d="M70 39V51M230 39V51"/><path d="M150 32V58" stroke="${RED}" stroke-width="2.4"/>`,
    labels: () => [
      J(70, 66, '過去'),
      J(150, 70, '現在'),
      J(230, 66, '未来'),
      J(70, 24, 'past', 10),
      J(150, 20, 'now', 10),
      J(230, 24, 'future', 10)
    ]
  },
  {
    key: 'sentence-pattern',
    name: '文の要素（SVOC）',
    subject: '英語',
    w: 300,
    h: 84,
    draw: () =>
      [
        [12, PALE.red],
        [84, PALE.blue],
        [156, PALE.green],
        [228, PALE.yellow]
      ]
        .map(([x, fill]) => box(x, 14, 60, 36, {rx: 6, fill}))
        .join(''),
    labels: () => [
      J(42, 32, 'S', 18),
      J(114, 32, 'V', 18),
      J(186, 32, 'O', 18),
      J(258, 32, 'C', 18),
      J(42, 68, '主語', 9),
      J(114, 68, '動詞', 9),
      J(186, 68, '目的語', 9),
      J(258, 68, '補語', 9)
    ]
  },

  // ======== 地理 ========
  {
    key: 'climograph',
    name: '雨温図',
    subject: '地理',
    w: 260,
    h: 214,
    draw: () => {
      const X = (i) => 40 + 15 * i + 7.5;
      const YT = (t) => 180 - (t + 10) * 4,
        YP = (p) => 180 - (p * 160) / 400;
      const bars = TOKYO_P.map(
        (p, i) =>
          `<rect x="${X(i) - 4.5}" y="${r1(YP(p))}" width="9" height="${r1(180 - YP(p))}" fill="#74c0fc" stroke="none"/>`
      ).join('');
      const line = pathOf(TOKYO_T.map((t, i) => [X(i), YT(t)]));
      const gridY = range(5)
        .map((k) => `M40 ${20 + k * 40}H220`)
        .join('');
      const nums =
        [-10, 0, 10, 20, 30].map((t) => T(36, YT(t), String(t), {s: 8, a: 'end', c: NUM})).join('') +
        [0, 100, 200, 300, 400].map((p) => T(224, YP(p), String(p), {s: 8, a: 'start', c: NUM})).join('') +
        range(12)
          .map((i) => T(X(i), 190, String(i + 1), {s: 8, c: NUM}))
          .join('');
      return `<path d="${gridY}" stroke="#e9ecef" stroke-width="1"/>${bars}<path d="M40 20V180H220V20"/><path d="${line}" stroke="${RED}" stroke-width="2"/>${TOKYO_T.map((t, i) => dot(X(i), YT(t), 2.4, RED)).join('')}${nums}`;
    },
    labels: () => [
      J(30, 10, '気温〔℃〕', 8),
      J(232, 10, '降水量〔mm〕', 8),
      J(130, 206, '東京（1991〜2020 年の平年値）', 8)
    ]
  },
  {
    key: 'population-pyramid',
    name: '人口ピラミッド',
    subject: '地理',
    w: 240,
    h: 200,
    params: [
      {
        key: 'kind',
        label: '形',
        type: 'select',
        options: [
          ['fuji', '富士山型（発展途上国に多い）'],
          ['bell', 'つりがね型'],
          ['pot', 'つぼ型（少子高齢化）']
        ],
        def: 'fuji'
      }
    ],
    draw: (p) => {
      const bars = range(20)
        .map((i) => {
          const m = Math.max(2, PYRAMID[p.kind](i));
          const f = m * (1 + (0.15 * i) / 19);
          const y = 180 - (i + 1) * 8;
          return `<rect x="${r1(108 - m)}" y="${y}" width="${r1(m)}" height="7.4" fill="#74c0fc" stroke="none"/><rect x="132" y="${y}" width="${r1(Math.min(100, f))}" height="7.4" fill="#ffa8a8" stroke="none"/>`;
        })
        .join('');
      const ages = [0, 20, 40, 60, 80, 100].map((a) => T(120, 180 - (a / 5) * 8, String(a), {s: 7, c: NUM})).join('');
      return `${bars}${ages}<path d="M8 181H232" stroke-width="1.2"/>`;
    },
    labels: () => [J(60, 10, '男', 10), J(180, 10, '女', 10), J(120, 192, '年齢（歳）', 8)]
  },
  {
    key: 'latlong',
    name: '緯線と経線',
    subject: '地理',
    w: 260,
    h: 220,
    draw: () => {
      const lat = [-60, -30, 30, 60]
        .map((f) => {
          const y = 110 - 90 * Math.sin(rad(f)),
            hw = 90 * Math.cos(rad(f));
          return `M${r1(110 - hw)} ${r1(y)}A${r1(hw)} ${r1(8 * Math.cos(rad(f)))} 0 0 0 ${r1(110 + hw)} ${r1(y)}`;
        })
        .join('');
      const lon = [30, 60]
        .map((l) => {
          const rx = r1(90 * Math.sin(rad(l)));
          return `<ellipse cx="110" cy="110" rx="${rx}" ry="90" stroke="${SOFT}"/>`;
        })
        .join('');
      return `<circle cx="110" cy="110" r="90" fill="${PALE.blue}"/>${lon}<path d="M110 20V200" stroke="${SOFT}"/><path d="${lat}" stroke="${SOFT}"/><path d="M20 110A90 8 0 0 0 200 110" stroke="${RED}" stroke-width="2"/>${dot(110, 20, 3)}${dot(110, 200, 3)}${lead(188, 65, 220, 65)}${lead(180, 150, 220, 150)}${lead(200, 112, 220, 112)}`;
    },
    labels: () => [
      J(110, 8, '北極', 9),
      J(110, 212, '南極', 9),
      J(238, 112, '赤道', 9),
      J(238, 65, '緯線', 9),
      J(238, 150, '経線', 9)
    ]
  },
  {
    key: 'contour',
    name: '等高線と断面図',
    subject: '地理',
    w: 240,
    h: 220,
    draw: () => {
      const E = [
        [126, 92, 46],
        [122, 70, 35],
        [118, 48, 24],
        [115, 26, 13]
      ];
      const ells = E.map(
        ([cx, rx, ry], i) =>
          `<ellipse cx="${cx}" cy="60" rx="${rx}" ry="${ry}"/>${T(cx + rx - 2, 60 - 6, String((i + 1) * 100), {s: 7, c: NUM, a: 'end'})}`
      ).join('');
      const Y = (h) => 210 - h * 0.2;
      const pts = [[20, Y(50)]];
      const xs = []; // 断面の線と等高線の交わり：[x, 高さ]
      E.forEach(([cx, rx], i) => {
        xs.push([cx - rx, (i + 1) * 100], [cx + rx, (i + 1) * 100]);
      });
      xs.sort((a, b) => a[0] - b[0]);
      const left = xs.slice(0, 4),
        right = xs.slice(4);
      pts.push(...left.map(([x, h]) => [x, Y(h)]), [113, Y(450)], ...right.map(([x, h]) => [x, Y(h)]), [220, Y(50)]);
      const drops = xs.map(([x, h]) => `M${x} 60V${r1(Y(h))}`).join('');
      return `${ells}<path d="M20 60H220" stroke="${RED}" stroke-width="1.6" ${dash}/><path d="${drops}" stroke="${SOFT}" stroke-width="1" stroke-dasharray="2 3"/><path d="M20 210H220"/><path d="${pathOf(pts)}Z" fill="#e6f4d7"/>`;
    },
    labels: () => [M(14, 60, 'A'), M(228, 60, 'B'), J(40, 128, '断面図', 9)]
  },
  {
    key: 'map-symbols',
    name: '地図記号',
    subject: '地理',
    w: 300,
    h: 130,
    draw: () => {
      const at = (i) => [38 + (i % 4) * 75, i < 4 ? 34 : 94];
      const sym = [
        (x, y) => `<circle cx="${x}" cy="${y}" r="10"/><circle cx="${x}" cy="${y}" r="5"/>`,
        (x, y) => T(x, y, '文', {s: 20}),
        (x, y) => `<circle cx="${x}" cy="${y}" r="10"/>${T(x, y + 1, '〒', {s: 13})}`,
        (x, y) =>
          `<path d="M${x - 11} ${y - 8}H${x + 11}M${x - 9} ${y - 3}H${x + 9}M${x - 6} ${y - 8}V${y + 10}M${x + 6} ${y - 8}V${y + 10}" stroke-width="2"/>`,
        (x, y) => T(x, y, '卍', {s: 20}),
        (x, y) => `<path d="M${x - 4} ${y - 8}V${y + 8}M${x + 4} ${y - 8}V${y + 8}" stroke-width="2"/>`,
        (x, y) => `<path d="M${x - 8} ${y - 6}L${x} ${y + 7}L${x + 8} ${y - 6}" stroke-width="2"/>`,
        (x, y) =>
          `<path d="M${x - 8} ${y - 8}L${x + 8} ${y + 8}M${x + 8} ${y - 8}L${x - 8} ${y + 8}" stroke-width="2"/>`
      ];
      return sym.map((f, i) => f(...at(i))).join('');
    },
    labels: () =>
      ['市役所', '小・中学校', '郵便局', '神社', '寺院', '田', '畑', '交番'].map((t, i) =>
        J(38 + (i % 4) * 75, (i < 4 ? 34 : 94) + 24, t, 9)
      )
  },

  // ======== 歴史 ========
  {
    key: 'eras',
    name: '時代の流れ（日本）',
    subject: '歴史',
    w: 330,
    h: 90,
    draw: () =>
      ERAS.map((e, i) => {
        const row = i < 8 ? 0 : 1;
        const x = 5 + (row ? i - 8 : i) * 40,
          y = 10 + row * 40;
        return `<rect x="${x}" y="${y}" width="40" height="30" fill="${ERA_COLORS[i % ERA_COLORS.length]}" stroke-width="1"/>${T(x + 20, y + 15, e, {s: e.length > 2 ? 9 : 11})}`;
      }).join('') + arrow(290, 65, 322, 65)
  },
  {
    key: 'family-tree',
    name: '系図',
    subject: '歴史',
    w: 240,
    h: 150,
    draw: () =>
      `<path d="M88 27H152M88 33H152"/><path d="M120 30V80M40 80H200M40 80V98M120 80V98M200 80V98"/>${[
        [60, 30],
        [180, 30],
        [40, 110],
        [120, 110],
        [200, 110]
      ]
        .map(([x, y]) => box(x - 28, y - 12, 56, 24, {rx: 4, fill: '#fff'}))
        .join('')}`,
    labels: () => [J(60, 30, '父'), J(180, 30, '母'), J(40, 110, '長男'), J(120, 110, '長女'), J(200, 110, '次男')]
  },

  // ======== 公民 ========
  {
    key: 'separation-powers',
    name: '三権分立',
    subject: '公民',
    w: 360,
    h: 246,
    draw: () =>
      `${twoWay([148, 58], [76, 192], 7)}${twoWay([212, 58], [284, 192], 7)}${twoWay([110, 215], [250, 215], 7)}${arrow(180, 118, 180, 58, {color: BLUE})}${arrow(163, 155, 112, 192, {color: BLUE})}${arrow(197, 155, 248, 192, {color: BLUE})}${box(132, 14, 96, 42, {rx: 8, fill: PALE.yellow})}${box(12, 194, 96, 42, {rx: 8, fill: PALE.green})}${box(252, 194, 96, 42, {rx: 8, fill: PALE.purple})}<circle cx="180" cy="140" r="22" fill="${PALE.blue}"/>`,
    labels: () => [
      J(180, 29, '国会'),
      J(180, 45, '（立法）', 9),
      J(60, 209, '内閣'),
      J(60, 225, '（行政）', 9),
      J(300, 209, '裁判所'),
      J(300, 225, '（司法）', 9),
      J(180, 140, '国民'),
      J(82, 108, '内閣不信任決議', 8),
      J(133, 136, '解散', 8),
      J(227, 136, '弾劾裁判', 8),
      J(276, 108, '違憲立法審査', 8),
      J(180, 198, '違憲・違法審査', 8),
      J(180, 233, '裁判官の任命', 8),
      J(192, 86, '選挙', 8),
      J(126, 164, '世論', 8),
      J(236, 164, '国民審査', 8)
    ]
  },
  {
    key: 'business-cycle',
    name: '景気循環',
    subject: '公民',
    w: 280,
    h: 150,
    draw: () => {
      const pts = [];
      for (let x = 20; x <= 260; x += 2) pts.push([x, 75 - 40 * Math.sin((2 * Math.PI * (x - 20)) / 160)]);
      return `${arrow(10, 140, 272, 140)}<path d="M20 75H260" ${dash} stroke="${SOFT}"/><path d="${pathOf(pts)}" stroke="${BLUE}" stroke-width="2.4"/>`;
    },
    labels: () => [
      J(60, 22, '好況'),
      J(116, 62, '後退'),
      J(140, 128, '不況'),
      J(166, 62, '回復'),
      J(258, 128, '時間', 9)
    ]
  },

  // ======== 情報 ========
  {
    key: 'flowchart',
    name: 'フローチャート',
    subject: '情報',
    w: 200,
    h: 290,
    draw: () =>
      `${box(55, 9, 90, 26, {rx: 13, fill: PALE.gray})}${box(55, 61, 90, 26, {fill: '#fff'})}<path d="M100 114L150 140L100 166L50 140Z" fill="${PALE.yellow}"/>${box(55, 197, 90, 26, {fill: '#fff'})}${box(55, 257, 90, 26, {rx: 13, fill: PALE.gray})}${arrow(100, 35, 100, 61)}${arrow(100, 87, 100, 114)}${arrow(100, 166, 100, 197)}${arrow(100, 223, 100, 257)}<path d="M150 140H178V74"/>${arrow(178, 74, 145, 74)}`,
    labels: () => [
      J(100, 22, '開始'),
      J(100, 74, '処理 1'),
      J(100, 140, '条件'),
      J(100, 210, '処理 2'),
      J(100, 270, '終了'),
      J(114, 182, 'はい', 9),
      J(166, 130, 'いいえ', 9)
    ]
  },
  {
    key: 'logic-gates',
    name: '論理回路',
    subject: '情報',
    w: 300,
    h: 130,
    params: [
      {
        key: 'gate',
        label: '回路',
        type: 'select',
        options: [
          ['and', 'AND（論理積）'],
          ['or', 'OR（論理和）'],
          ['not', 'NOT（否定）']
        ],
        def: 'and'
      }
    ],
    draw: (p) => {
      const shape = {
        and: `<path d="M20 45H60M20 75H60M115 60H150"/><path d="M60 30H85A30 30 0 0 1 85 90H60Z" fill="${PALE.blue}"/>`,
        or: `<path d="M20 45H66M20 75H66M120 60H150"/><path d="M58 30Q95 30 120 60Q95 90 58 90Q72 60 58 30Z" fill="${PALE.blue}"/>`,
        not: `<path d="M20 60H60M115 60H150"/><path d="M60 35L105 60L60 85Z" fill="${PALE.blue}"/><circle cx="110" cy="60" r="5" fill="#fff"/>`
      }[p.gate];
      const rows =
        p.gate === 'not'
          ? [
              ['A', 'Y'],
              ['0', '1'],
              ['1', '0']
            ]
          : [
              ['A', 'B', 'Y'],
              ['0', '0', '0'],
              ['0', '1', p.gate === 'or' ? '1' : '0'],
              ['1', '0', p.gate === 'or' ? '1' : '0'],
              ['1', '1', '1']
            ];
      const cols = rows[0].length;
      const xs = cols === 2 ? [205, 245] : [190, 225, 260];
      const table = rows
        .map((r, j) => r.map((v, k) => T(xs[k], 24 + j * 20, v, {s: 11, b: j === 0, m: j === 0})).join(''))
        .join('');
      const lines = `<path d="M${xs[0] - 18} 34H${xs.at(-1) + 18}M${(xs.at(-1) + xs.at(-2)) / 2} 14V${24 + (rows.length - 1) * 20 + 10}" stroke-width="1.2"/>`;
      return (
        shape +
        table +
        lines +
        T(85, 112, {and: 'AND（論理積）', or: 'OR（論理和）', not: 'NOT（否定）'}[p.gate], {s: 10})
      );
    },
    labels: (p) =>
      p.gate === 'not' ? [M(12, 60, 'A'), M(160, 60, 'Y')] : [M(12, 45, 'A'), M(12, 75, 'B'), M(160, 60, 'Y')]
  },
  {
    key: 'network',
    name: 'ネットワーク（LAN）',
    subject: '情報',
    w: 300,
    h: 184,
    draw: () => {
      const pc = (x) =>
        `${box(x - 18, 132, 36, 22, {rx: 2, fill: PALE.blue})}<path d="M${x} 154V160M${x - 8} 160H${x + 8}"/>`;
      return `<path d="M98 46Q90 30 108 26Q112 8 136 12Q150 0 168 10Q192 6 196 26Q214 30 204 46Z" fill="#fff"/><path d="M150 46V78M150 102V114M60 114H240M60 114V132M150 114V132M240 114V132"/>${box(120, 78, 60, 24, {rx: 4, fill: PALE.yellow})}${pc(60)}${pc(150)}${pc(240)}`;
    },
    labels: () => [
      J(150, 30, 'インターネット', 9),
      J(150, 90, 'ルーター', 9),
      J(60, 174, 'PC', 9),
      J(150, 174, 'PC', 9),
      J(240, 174, 'PC', 9),
      J(262, 104, 'LAN', 10)
    ]
  },
  {
    key: 'binary',
    name: '2 進数の位',
    subject: '情報',
    // 1 けたは 36。横に伸ばすとけたが増える
    w: 296,
    h: 86,
    params: [{key: 'n', label: 'けたの数', type: 'num', min: 2, max: 16, step: 1, def: 8}],
    size: (p) => ({w: p.n * 36 + 8, h: 86}),
    fit: (w) => ({n: Math.round((w - 8) / 36)}),
    growLabel: (p) => `${p.n} けた（${p.n} ビット）`,
    draw: (p) => {
      const sup = (k) => [...String(k)].map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c]).join('');
      return range(p.n)
        .map((i) => {
          const k = p.n - 1 - i,
            x = 4 + i * 36;
          return `${box(x, 10, 36, 36, {fill: '#fff'})}${T(x + 18, 58, String(2 ** k), {s: k > 9 ? 7 : 9, c: NUM})}${T(x + 18, 74, `2${sup(k)}`, {s: 9, c: NUM, m: true})}`;
        })
        .join('');
    }
  },

  // ======== 保健体育 ========
  {
    key: 'basketball',
    name: 'バスケットボールのコート',
    subject: '保健体育',
    w: 300,
    h: 170,
    draw: () => {
      const side = (m) => {
        const X = (x) => (m ? 300 - x : x);
        return `<path d="M10 19H39.9A67.5 67.5 0 0 1 39.9 151H10" transform="${m ? 'translate(300 0) scale(-1 1)' : ''}"/><rect x="${m ? 232 : 10}" y="60.5" width="58" height="49" fill="#ffd8a8"/><circle cx="${X(68)}" cy="85" r="18"/><path d="M${X(22)} 76V94" stroke-width="2.4"/><circle cx="${X(25.75)}" cy="85" r="2.3" stroke="${RED}"/>`;
      };
      return `<rect x="10" y="10" width="280" height="150" fill="#ffe8cc"/>${side(false)}${side(true)}<path d="M150 10V160"/><circle cx="150" cy="85" r="18"/>`;
    }
  },
  {
    key: 'volleyball',
    name: 'バレーボールのコート',
    subject: '保健体育',
    w: 300,
    h: 170,
    draw: () =>
      `<rect x="24" y="22" width="252" height="126" fill="#ffe8cc"/><path d="M108 22V148M192 22V148"/><path d="M150 14V156" stroke="${RED}" stroke-width="3"/>`,
    labels: () => [J(150, 6, 'ネット', 9), J(108, 160, 'アタックライン', 8), J(192, 160, 'アタックライン', 8)]
  },
  {
    key: 'soccer',
    name: 'サッカーのフィールド',
    subject: '保健体育',
    w: 293,
    h: 197,
    draw: () => {
      const cy = 98.4;
      const half = (m) => {
        const t = m ? 'transform="translate(293 0) scale(-1 1)"' : '';
        return `<g ${t}><path d="M10 ${r1(cy - 52.4)}H52.9V${r1(cy + 52.4)}H10M10 ${r1(cy - 23.8)}H24.3V${r1(cy + 23.8)}H10"/><path d="M52.9 ${r1(cy - 19)}A23.8 23.8 0 0 1 52.9 ${r1(cy + 19)}"/>${dot(38.6, cy, 1.8, '#fff')}<rect x="4" y="${r1(cy - 9.5)}" width="6" height="19" fill="#fff"/></g>`;
      };
      return `<rect x="10" y="10" width="273" height="176.8" fill="#b2f2bb" stroke="#fff" stroke-width="2"/><g stroke="#fff" stroke-width="2">${half(false)}${half(true)}<path d="M146.5 10V186.8"/><circle cx="146.5" cy="${cy}" r="23.8"/>${dot(146.5, cy, 2, '#fff')}</g>`;
    }
  },
  {
    key: 'track',
    name: '陸上のトラック',
    subject: '保健体育',
    w: 300,
    h: 180,
    draw: () => {
      const lane = (r) => `M90 ${90 - r}H210A${r} ${r} 0 0 1 210 ${90 + r}H90A${r} ${r} 0 0 1 90 ${90 - r}Z`;
      return `<path d="${lane(80)}" fill="#ffc9c9"/><path d="${lane(52)}" fill="#b2f2bb"/>${[59, 66, 73].map((r) => `<path d="${lane(r)}" stroke="#fff" stroke-width="1.2"/>`).join('')}<path d="M210 142V170" stroke="#fff" stroke-width="2"/>`;
    },
    labels: () => [J(150, 90, 'フィールド', 10)]
  },

  // ======== 家庭 ========
  {
    key: 'food-groups',
    name: '6 つの基礎食品群',
    subject: '家庭',
    w: 300,
    h: 150,
    draw: () => {
      const G = [
        ['1 群', '主にたんぱく質', '魚・肉・卵・大豆製品', PALE.red],
        ['2 群', '主に無機質（カルシウム）', '牛乳・乳製品・小魚・海藻', PALE.red],
        ['3 群', '主にカロテン', '緑黄色野菜', PALE.green],
        ['4 群', '主にビタミン C', 'その他の野菜・果物', PALE.green],
        ['5 群', '主に炭水化物', '穀類・いも類・砂糖', PALE.yellow],
        ['6 群', '主に脂質', '油脂', PALE.yellow]
      ];
      return G.map(([g, n, f, c], i) => {
        const x = 6 + (i % 3) * 97,
          y = 6 + Math.floor(i / 3) * 70;
        return `${box(x, y, 94, 66, {rx: 6, fill: c})}${T(x + 47, y + 14, g, {s: 11, b: true})}${T(x + 47, y + 34, n, {s: 7.5})}${T(x + 47, y + 52, f, {s: 7.5, c: NUM})}`;
      }).join('');
    }
  },
  {
    key: 'three-colors',
    name: '3 色の食品群',
    subject: '家庭',
    w: 300,
    h: 130,
    draw: () =>
      [
        ['#ffc9c9', '赤', '体をつくる', '肉・魚・卵・牛乳・豆'],
        ['#ffec99', '黄', '力や熱になる', 'ご飯・パン・いも・油'],
        ['#b2f2bb', '緑', '体の調子を整える', '野菜・果物・きのこ']
      ]
        .map(([c, n, a, f], i) => {
          const x = 52 + i * 98;
          return `<circle cx="${x}" cy="56" r="44" fill="${c}"/>${T(x, 34, n, {s: 16, b: true})}${T(x, 58, a, {s: 8.5})}${T(x, 116, f, {s: 7.5, c: NUM})}`;
        })
        .join('')
  },
  {
    key: 'sewing',
    name: '手ぬいの縫い方',
    subject: '家庭',
    w: 280,
    h: 140,
    draw: () => {
      const run = range(15)
        .map((i) => `M${90 + i * 12} 30h7`)
        .join('');
      const back = range(22)
        .map((i) => `M${90 + i * 8} 72h7.4`)
        .join('');
      const blind = range(15)
        .map((i) => `M${92 + i * 12} 114l5 -8`)
        .join('');
      return `<path d="${run}${back}" stroke="${RED}" stroke-width="2"/><path d="M84 30H268M84 72H268" stroke="${SOFT}" stroke-width="0.8" stroke-dasharray="1 3"/><path d="M84 114H268" stroke="${SOFT}"/><path d="${blind}" stroke="${RED}" stroke-width="1.6"/>`;
    },
    labels: () => [J(40, 30, 'なみ縫い', 10), J(40, 72, '本返し縫い', 10), J(40, 110, 'まつり縫い', 10)]
  },

  // ======== 芸術 ========
  {
    key: 'keyboard',
    name: '鍵盤',
    subject: '芸術',
    // 1 オクターブは 140。横に伸ばすとオクターブが増える
    w: 310,
    h: 110,
    params: [{key: 'n', label: 'オクターブの数', type: 'num', min: 1, max: 5, step: 1, def: 2}],
    size: (p) => ({w: p.n * 140 + 30, h: 110}),
    fit: (w) => ({n: Math.round((w - 30) / 140)}),
    growLabel: (p) => `${p.n} オクターブ`,
    draw: (p) => {
      const whites = p.n * 7 + 1;
      const w = range(whites)
        .map(
          (k) =>
            `<rect x="${5 + k * 20}" y="4" width="20" height="100" fill="#fff" stroke-width="1.2"/>${k % 7 === 0 ? T(15 + k * 20, 92, 'ド', {s: 9, c: NUM}) : ''}`
        )
        .join('');
      const b = range(whites - 1)
        .filter((k) => [0, 1, 3, 4, 5].includes(k % 7))
        .map((k) => `<rect x="${5 + (k + 1) * 20 - 6}" y="4" width="12" height="62" fill="${INK}" stroke="none"/>`)
        .join('');
      return w + b;
    }
  },
  {
    key: 'color-wheel',
    name: '色相環',
    subject: '芸術',
    w: 220,
    h: 220,
    draw: () =>
      HUES.map(
        (c, i) =>
          `<path d="${ring(110, 110, 50, 95, i * 30 - 15, i * 30 + 15)}" fill="${c}" stroke="#fff" stroke-width="1.4"/>`
      ).join(''),
    labels: () => [J(110, 104, '色相環', 10), J(110, 120, '向かい合う色は補色', 8)]
  },
  {
    key: 'perspective',
    name: '一点透視図法',
    subject: '芸術',
    w: 260,
    h: 180,
    draw: () => {
      const VP = [130, 60];
      const back = (x, y) => [r1(x + 0.35 * (VP[0] - x)), r1(y + 0.35 * (VP[1] - y))];
      const c = [
        [60, 100],
        [140, 100],
        [140, 160],
        [60, 160]
      ];
      const b = c.map(([x, y]) => back(x, y));
      const guides = c.map(([x, y]) => `M${x} ${y}L${VP[0]} ${VP[1]}`).join('');
      return `<path d="M10 60H250"/><path d="${guides}" ${dash} stroke="${SOFT}"/><path d="M${c[0]}L${b[0]}L${b[1]}L${c[1]}Z" fill="${PALE.blue}"/><path d="M${c[1]}L${b[1]}L${b[2]}L${c[2]}Z" fill="#d0ebff"/>${box(60, 100, 80, 60, {fill: '#fff'})}${dot(...VP, 3.4, RED)}`;
    },
    labels: () => [J(230, 50, '地平線', 9), J(130, 46, '消失点', 9)]
  },
  {
    key: 'note-values',
    name: '音符の長さ',
    subject: '芸術',
    w: 300,
    h: 100,
    draw: () =>
      range(5)
        .map((i) => {
          const x = 30 + i * 60,
            open = i < 2;
          const headSvg = `<ellipse cx="${x}" cy="60" rx="6.5" ry="4.6" transform="rotate(-20 ${x} 60)" fill="${open ? '#fff' : INK}" stroke-width="${open ? 1.8 : 0}"/>`;
          const stem = i > 0 ? `<path d="M${x + 6} 58V22"/>` : '';
          const flags = range(Math.max(0, i - 2))
            .map((k) => `<path d="M${x + 6} ${22 + k * 9}q10 8 6 22"/>`)
            .join('');
          return headSvg + stem + flags;
        })
        .join(''),
    labels: () => ['全音符', '2 分音符', '4 分音符', '8 分音符', '16 分音符'].map((t, i) => J(32 + i * 60, 86, t, 9))
  },

  // ======== 表・グラフ ========
  {
    key: 'bar-chart',
    name: '棒グラフ',
    subject: '表・グラフ',
    ...chartDef(5, 5, '棒の数', (p) => {
      const base = chartBase(p);
      const bars = range(p.n)
        .map((i) => {
          const k = Math.max(1, Math.round(PAT[i % PAT.length] * p.m));
          return `<rect x="${42 + i * SLOT}" y="${base.oy - k * TICK}" width="18" height="${k * TICK}" fill="#a5d8ff"/>`;
        })
        .join('');
      return base.svg + bars;
    }),
    drawToPlace: '棒の数と目盛りの数'
  },
  {
    key: 'line-chart',
    name: '折れ線グラフ',
    subject: '表・グラフ',
    ...chartDef(6, 5, '点の数', (p) => {
      const base = chartBase(p);
      const pts = range(p.n).map((i) => [51 + i * SLOT, base.oy - PAT[i % PAT.length] * p.m * TICK]);
      return `${base.svg}<path d="${pathOf(pts)}" stroke="${RED}" stroke-width="2"/>${pts.map(([x, y]) => dot(x, y, 3, RED)).join('')}`;
    }),
    drawToPlace: '点の数と目盛りの数'
  },
  {
    key: 'pie-chart',
    name: '円グラフ',
    subject: '表・グラフ',
    w: 180,
    h: 180,
    params: [{key: 'n', label: '区切りの数', type: 'num', min: 2, max: 8, step: 1, def: 4}],
    draw: (p) => {
      let a = 0;
      return SHARES[p.n]
        .map((v, i) => {
          const a1 = a + v * 3.6;
          const mid = rad((a + a1) / 2);
          const out = `<path d="${ring(90, 90, 0, 78, a, a1)}" fill="${SHARE_COLORS[i]}" stroke="#fff" stroke-width="1.4"/>${T(90 + 52 * Math.sin(mid), 90 - 52 * Math.cos(mid), `${v}%`, {s: v < 8 ? 7 : 9})}`;
          a = a1;
          return out;
        })
        .join('');
    }
  },
  {
    key: 'band-chart',
    name: '帯グラフ',
    subject: '表・グラフ',
    w: 280,
    h: 60,
    params: [{key: 'n', label: '区切りの数', type: 'num', min: 2, max: 8, step: 1, def: 4}],
    draw: (p) => {
      let x = 10;
      return (
        SHARES[p.n]
          .map((v, i) => {
            const w = v * 2.6;
            const out = `<rect x="${r1(x)}" y="16" width="${r1(w)}" height="28" fill="${SHARE_COLORS[i]}" stroke="#fff" stroke-width="1.4"/>${T(x + w / 2, 30, `${v}%`, {s: v < 8 ? 7 : 9})}`;
            x += w;
            return out;
          })
          .join('') + `<rect x="10" y="16" width="260" height="28" stroke-width="1.2"/>`
      );
    }
  }
];
