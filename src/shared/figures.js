// 素材（編集画面の左下）：授業でよく使う図。SVG をその場で作る（画像ファイルを持たない）。副作用なし。
// PDF のページに貼ると、注釈の stamp（style.type = 'figure'、style.ref = id）になる。線は黒、塗りは淡い色。
// 文字（x・y・O・θ など）は、画像にしたときに OS のフォントで描かれる
const INK = '#2b2b2b';
const SOFT = '#9aa3ad'; // 補助の線（方眼・点線）
const SERIF = "'Times New Roman',Times,serif";
const GOTHIC = "'Hiragino Kaku Gothic ProN','Hiragino Sans',sans-serif";
const r1 = (v) => Math.round(v * 10) / 10;

/** 文字（数学の文字は斜体の明朝） */
const t = (x, y, s, {size = 15, italic = true, font = SERIF, anchor = 'middle', fill = INK} = {}) =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}"${italic ? ' font-style="italic"' : ''} text-anchor="${anchor}" fill="${fill}" stroke="none">${s}</text>`;
/** 矢印の先（x, y が先端。向きは角度 deg。0 が右） */
const head = (x, y, deg) =>
  `<path d="M0 0L-9 -4.5L-9 4.5Z" transform="translate(${r1(x)} ${r1(y)}) rotate(${deg})" fill="${INK}" stroke="none"/>`;
const arrow = (x1, y1, x2, y2) => {
  const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const k = 8 / Math.hypot(x2 - x1, y2 - y1); // 先の手前で線を止める
  return `<path d="M${r1(x1)} ${r1(y1)}L${r1(x2 - (x2 - x1) * k)} ${r1(y2 - (y2 - y1) * k)}"/>${head(x2, y2, r1(deg))}`;
};
const dash = 'stroke-dasharray="5 4"';
/** 正多角形の頂点（中心 cx, cy、半径 r、上の頂点から時計回り） */
export const polygonPoints = (n, cx, cy, r) =>
  Array.from({length: n}, (_, i) => {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
    return [r1(cx + r * Math.cos(a)), r1(cy + r * Math.sin(a))];
  });
const poly = (pts) => pts.map(([x, y]) => `${x},${y}`).join(' ');
/** 座標軸（原点 ox, oy。幅 w・高さ h の中に） */
const axes = (w, h, ox, oy, {x = 'x', y = 'y'} = {}) =>
  `${arrow(8, oy, w - 6, oy)}${arrow(ox, h - 8, ox, 6)}${t(w - 12, oy + 16, x)}${t(ox + 12, 16, y)}${t(ox - 10, oy + 16, 'O')}`;
const grid = (w, h, step, {from = 0, color = '#d5dae0', width = 1} = {}) => {
  const d = [];
  for (let v = from; v <= w; v += step) d.push(`M${v} 0V${h}`);
  for (let v = from; v <= h; v += step) d.push(`M0 ${v}H${w}`);
  return `<path d="${d.join('')}" stroke="${color}" stroke-width="${width}"/>`;
};
const table = (cols, rows, cw = 56, ch = 28) => {
  const w = cols * cw,
    h = rows * ch;
  const d = [];
  for (let i = 1; i < cols; i++) d.push(`M${i * cw + 2} 2V${h + 2}`);
  for (let j = 1; j < rows; j++) d.push(`M2 ${j * ch + 2}H${w + 2}`);
  return {
    w: w + 4,
    h: h + 4,
    body: `<rect x="2" y="2" width="${w}" height="${ch}" fill="#eef1f5" stroke="none"/><rect x="2" y="2" width="${w}" height="${h}"/><path d="${d.join('')}"/>`
  };
};
/** 正規分布の曲線 */
const bell = () => {
  const pts = [];
  for (let x = 14; x <= 226; x += 4) pts.push([x, r1(126 - 100 * Math.exp(-((x - 120) ** 2) / (2 * 34 ** 2)))]);
  return `M${pts.map(([x, y]) => `${x} ${y}`).join('L')}`;
};

// [id, 名前, 教科, 幅, 高さ, 中身]（幅・高さは viewBox。貼るときの大きさは pt で 0.75 倍）
const DEFS = [
  // ---- 数学 ----
  ['coord', '座標平面', '数学', 200, 200, `${grid(200, 200, 20, {from: 20})}${axes(200, 200, 100, 100)}`],
  [
    'numline',
    '数直線',
    '数学',
    260,
    64,
    `${arrow(8, 28, 254, 28)}<path d="${[0, 1, 2, 3, 4, 5].map((i) => `M${30 + i * 40} 22V34`).join('')}"/>${[-2, -1, 0, 1, 2, 3].map((v, i) => t(30 + i * 40, 54, v < 0 ? `−${-v}` : String(v), {italic: false, size: 14})).join('')}`
  ],
  [
    'circle',
    '円',
    '数学',
    160,
    160,
    `<circle cx="80" cy="80" r="64"/><circle cx="80" cy="80" r="2.5" fill="${INK}"/><path d="M80 80H144"/>${t(72, 96, 'O')}${t(112, 74, 'r')}`
  ],
  [
    'sector',
    '扇形',
    '数学',
    160,
    150,
    `<path d="M80 130L30 43.4A100 100 0 0 1 130 43.4Z"/><path d="M70 112.7A20 20 0 0 1 90 112.7"/>${t(80, 104, 'θ', {size: 14})}${t(44, 92, 'r')}`
  ],
  ['triangle', '正三角形', '数学', 160, 150, `<polygon points="${poly(polygonPoints(3, 80, 92, 76))}"/>`],
  ['square', '正方形', '数学', 160, 160, `<rect x="24" y="24" width="112" height="112"/>`],
  ['pentagon', '正五角形', '数学', 160, 160, `<polygon points="${poly(polygonPoints(5, 80, 86, 70))}"/>`],
  ['hexagon', '正六角形', '数学', 160, 160, `<polygon points="${poly(polygonPoints(6, 80, 80, 70))}"/>`],
  ['octagon', '正八角形', '数学', 160, 160, `<polygon points="${poly(polygonPoints(8, 80, 80, 72))}"/>`],
  [
    'right-triangle',
    '直角三角形',
    '数学',
    180,
    140,
    `<polygon points="20,120 160,120 20,20"/><path d="M20 106H34V120"/>`
  ],
  [
    'tetra',
    '三角錐',
    '数学',
    180,
    170,
    `<path d="M85 15L20 140L120 158L165 118Z M85 15L120 158"/><path d="M20 140L165 118" ${dash}/>`
  ],
  [
    'pyramid',
    '四角錐',
    '数学',
    180,
    160,
    `<path d="M90 15L20 135H120L160 105Z M90 15L120 135"/><path d="M20 135L60 105H160 M60 105L90 15" ${dash}/>`
  ],
  [
    'cone',
    '円錐',
    '数学',
    160,
    170,
    `<path d="M80 15L20 140A60 16 0 0 0 140 140Z"/><path d="M20 140A60 16 0 0 1 140 140 M80 15V140H140" ${dash}/><circle cx="80" cy="140" r="2" fill="${INK}"/>`
  ],
  [
    'cylinder',
    '円柱',
    '数学',
    160,
    180,
    `<ellipse cx="80" cy="30" rx="60" ry="16"/><path d="M20 30V150A60 16 0 0 0 140 150V30"/><path d="M20 150A60 16 0 0 1 140 150" ${dash}/>`
  ],
  [
    'cube',
    '立方体',
    '数学',
    170,
    170,
    `<path d="M20 50H120V150H20Z M20 50L60 15H160L120 50 M160 15V115L120 150"/><path d="M60 15V115H160 M60 115L20 150" ${dash}/>`
  ],
  [
    'cuboid',
    '直方体',
    '数学',
    220,
    150,
    `<path d="M20 50H150V130H20Z M20 50L70 15H200L150 50 M200 15V95L150 130"/><path d="M70 15V95H200 M70 95L20 130" ${dash}/>`
  ],
  [
    'sphere',
    '球',
    '数学',
    160,
    160,
    `<circle cx="80" cy="80" r="64"/><path d="M16 80A64 18 0 0 0 144 80"/><path d="M16 80A64 18 0 0 1 144 80" ${dash}/><circle cx="80" cy="80" r="2.5" fill="${INK}"/>`
  ],
  [
    'hemisphere',
    '半球',
    '数学',
    160,
    120,
    `<path d="M16 90A64 64 0 0 1 144 90A64 18 0 0 1 16 90Z"/><path d="M16 90A64 18 0 0 1 144 90" ${dash}/>`
  ],
  [
    'parabola',
    '放物線',
    '数学',
    200,
    200,
    `${axes(200, 200, 100, 150)}<path d="M40 30Q100 270 160 30" stroke-width="2.4"/>`
  ],
  [
    'unit-circle',
    '単位円',
    '数学',
    200,
    200,
    `${axes(200, 200, 100, 100)}<circle cx="100" cy="100" r="70"/><path d="M100 100L153.6 55"/><path d="M153.6 55V100" ${dash}/><path d="M118 100A18 18 0 0 0 113.8 88.4"/>${t(126, 94, 'θ', {size: 13})}${t(162, 50, 'P')}${t(176, 116, '1', {italic: false, size: 13})}`
  ],
  [
    'venn',
    'ベン図',
    '数学',
    220,
    150,
    `<rect x="6" y="6" width="208" height="138"/><circle cx="88" cy="78" r="48"/><circle cx="132" cy="78" r="48"/>${t(58, 44, 'A')}${t(162, 44, 'B')}${t(200, 26, 'U')}`
  ],
  // ---- 理科 ----
  [
    'beaker',
    'ビーカー',
    '理科',
    140,
    170,
    `<path d="M32 90H108V148A8 8 0 0 1 100 156H40A8 8 0 0 1 32 148Z" fill="#d6ebff" stroke="none"/><path d="M20 18L30 26V150A10 10 0 0 0 40 160H100A10 10 0 0 0 110 150V22H124"/><path d="M30 60H44M30 80H40M30 100H44M30 120H40M30 140H44" stroke-width="1.4"/>`
  ],
  [
    'flask',
    '三角フラスコ',
    '理科',
    140,
    170,
    `<path d="M36 110H104L120 150A8 8 0 0 1 112 160H28A8 8 0 0 1 20 150Z" fill="#d6ebff" stroke="none"/><path d="M50 14H90M56 14V60L20 150A8 8 0 0 0 28 160H112A8 8 0 0 0 120 150L84 60V14"/>`
  ],
  [
    'test-tube',
    '試験管',
    '理科',
    80,
    180,
    `<path d="M28 110H52V152A12 12 0 0 1 28 152Z" fill="#d6ebff" stroke="none"/><path d="M22 12H58M28 12V152A12 12 0 0 0 52 152V12"/>`
  ],
  [
    'circuit',
    '電気回路',
    '理科',
    220,
    150,
    `<path d="M20 20H80M140 20H200V55M200 95V130H116M104 130H20V20"/><rect x="80" y="12" width="60" height="16"/><circle cx="200" cy="75" r="20"/><path d="M186 61L214 89M214 61L186 89"/><path d="M104 114V146" stroke-width="2.4"/><path d="M116 121V139" stroke-width="5"/>${t(98, 110, '+', {italic: false, size: 14})}`
  ],
  [
    'incline',
    '斜面と力',
    '理科',
    220,
    150,
    `<path d="M10 140H210V40Z" fill="#f1f3f5"/><rect x="100" y="59" width="40" height="26" transform="rotate(-26.57 120 85)" fill="#fff"/>${arrow(114.2, 73.4, 114.2, 130)}${arrow(114.2, 73.4, 94, 33)}<path d="M50 140A40 40 0 0 0 45.8 122.1"/>${t(62, 134, 'θ', {size: 13})}${t(128, 128, 'mg', {size: 14})}${t(86, 30, 'N', {size: 14})}`
  ],
  [
    'benzene',
    'ベンゼン環',
    '理科',
    160,
    160,
    `<polygon points="${poly(polygonPoints(6, 80, 80, 62))}"/><circle cx="80" cy="80" r="38"/>`
  ],
  [
    'animal-cell',
    '動物細胞',
    '理科',
    200,
    150,
    `<ellipse cx="100" cy="75" rx="90" ry="64" fill="#fff6e8"/><circle cx="108" cy="70" r="24" fill="#e7e1f7"/><circle cx="114" cy="66" r="6" fill="#b9acd9" stroke="none"/><ellipse cx="54" cy="96" rx="14" ry="7" fill="#ffd9c7" transform="rotate(-20 54 96)"/><ellipse cx="150" cy="104" rx="13" ry="6" fill="#ffd9c7" transform="rotate(15 150 104)"/>`
  ],
  [
    'plant-cell',
    '植物細胞',
    '理科',
    200,
    150,
    `<rect x="8" y="8" width="184" height="134" rx="10" fill="#eef8e8" stroke-width="3"/><rect x="16" y="16" width="168" height="118" rx="8"/><rect x="70" y="40" width="70" height="60" rx="18" fill="#e6f2fb"/><circle cx="44" cy="44" r="18" fill="#e7e1f7"/>${[
      [36, 112],
      [64, 120],
      [160, 40],
      [162, 116]
    ]
      .map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="11" ry="6" fill="#9bd28a"/>`)
      .join('')}`
  ],
  // ---- 社会 ----
  [
    'compass',
    '方位記号',
    '社会',
    100,
    150,
    `<path d="M50 34L66 140L50 126Z"/><path d="M50 34L34 140L50 126Z" fill="${INK}"/>${t(50, 24, 'N', {italic: false, size: 18, font: GOTHIC})}`
  ],
  [
    'timeline',
    '年表',
    '社会',
    280,
    70,
    `${arrow(8, 34, 274, 34)}<path d="${[0, 1, 2, 3, 4, 5].map((i) => `M${28 + i * 46} 26V42`).join('')}"/>${[0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${28 + i * 46}" cy="34" r="3" fill="${INK}"/>`).join('')}`
  ],
  [
    'supply-demand',
    '需要と供給',
    '社会',
    220,
    200,
    `${arrow(30, 180, 214, 180)}${arrow(30, 180, 30, 8)}<path d="M50 30L190 160M50 160L190 30"/><path d="M120 95H30M120 95V180" ${dash} stroke="${SOFT}"/>${t(206, 196, '数量', {italic: false, size: 12, font: GOTHIC, anchor: 'end'})}${t(36, 14, '価格', {italic: false, size: 12, font: GOTHIC, anchor: 'start'})}${t(198, 160, 'D', {italic: false})}${t(198, 34, 'S', {italic: false})}${t(22, 196, 'O')}`
  ],
  [
    'normal',
    '正規分布',
    '数学',
    240,
    150,
    `${arrow(8, 126, 236, 126)}<path d="${bell()}" fill="#eef1f5" stroke-width="2"/><path d="M120 26V126" ${dash} stroke="${SOFT}"/>${t(120, 144, 'μ', {size: 14})}`
  ],
  // ---- 国語・英語・音楽 ----
  [
    'genko',
    '原稿用紙',
    '国語・英語・音楽',
    200,
    200,
    `${grid(200, 200, 20, {color: '#e07a6f'})}<rect x="0.5" y="0.5" width="199" height="199" stroke="#e07a6f" stroke-width="2"/>`
  ],
  [
    'four-lines',
    '英語の 4 線',
    '国語・英語・音楽',
    280,
    56,
    `<path d="M4 10H276M4 22H276M4 46H276" stroke="${SOFT}"/><path d="M4 34H276" stroke="#e5484d"/>`
  ],
  [
    'staff',
    '五線譜',
    '国語・英語・音楽',
    280,
    60,
    `<path d="${[0, 1, 2, 3, 4].map((i) => `M4 ${10 + i * 10}H276`).join('')}"/><path d="M4 10V50M276 10V50"/>`
  ],
  // ---- 表・方眼 ----
  ['table-3x3', '表（3×3）', '表・方眼', ...Object.values(table(3, 3))],
  ['table-4x5', '表（4×5）', '表・方眼', ...Object.values(table(4, 5))],
  [
    'graph-paper',
    '方眼',
    '表・方眼',
    200,
    200,
    `${grid(200, 200, 10, {color: '#e1e6ea'})}${grid(200, 200, 50, {color: '#aab6c2'})}`
  ]
];

export const FIGURE_SUBJECTS = [...new Set(DEFS.map((d) => d[2]))];
export const FIGURES = DEFS.map(([key, name, subject, w, h, body]) => ({
  id: `fig-${key}`,
  name,
  subject,
  w,
  h,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><g fill="none" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`
}));
const BY_ID = new Map(FIGURES.map((f) => [f.id, f]));
export const figureOf = (id) => BY_ID.get(id) ?? null;
export const isFigure = (id) => BY_ID.has(id);
/** 図の画像（data: URL） */
export const figureUrl = (id) => {
  const f = BY_ID.get(id);
  return f
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.svg).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
    : '';
};
export const FIGURE_PT_PER_UNIT = 0.75; // 貼るときの大きさ：viewBox の 1 を 0.75pt に
