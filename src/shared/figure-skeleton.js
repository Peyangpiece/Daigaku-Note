// 素材の図：人体の骨格（前から見た図。解剖学的正位＝手のひらを前に向けて立つ）。
// 体の真ん中は x = 130（図では左に余白 60 を足す）。右半分（図の右）を描き、左右を写して全身にする。
// 長さの割合は身長（頭のてっぺん y = 12 〜 足の裏 y = 724）に対しておおよそ：あご 0.12・肩 0.17・恥骨 0.5・膝 0.72
import {INK, r1, lead, J} from './figure-parts.js';

const BONE = '#fbf6ea'; // 骨
const BACK = '#eee4cf'; // 奥にある骨（肋骨の背中側・肩甲骨）
const CART = '#d6e6f0'; // 軟骨（肋軟骨）
const HOLE = '#6b6258'; // 穴（眼窩・鼻腔・閉鎖孔）
const PAD = 60; // 左の余白（名前を置く）

/** 長い骨：外の線（INK）と中の色を重ねて、太さ w の骨にする */
const bone = (d, w, fill = BONE, line = INK) =>
  `<path d="${d}" stroke="${line}" stroke-width="${r1(w + 2.2)}"/><path d="${d}" stroke="${fill}" stroke-width="${w}"/>`;
const seg = (x1, y1, x2, y2, w, fill) => bone(`M${r1(x1)} ${r1(y1)}L${r1(x2)} ${r1(y2)}`, w, fill);
/** 骨の端のふくらみ（関節） */
const knob = (cx, cy, rx, ry = rx, rot = 0, fill = BONE) =>
  `<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${rx}" ry="${ry}"${rot ? ` transform="rotate(${rot} ${r1(cx)} ${r1(cy)})"` : ''} fill="${fill}"/>`;
/** 指の骨：付け根 (x, y) から向き (ux, uy) へ、長さの並び lens で節ごとに */
function digits(x, y, ux, uy, lens, w) {
  let out = '';
  let [cx, cy] = [x, y];
  for (const L of lens) {
    const [ex, ey] = [cx + ux * L, cy + uy * L];
    out += seg(cx, cy, ex, ey, w) + knob(ex, ey, w * 0.62);
    [cx, cy] = [ex + ux * 1.6, ey + uy * 1.6];
  }
  return out;
}
const unit = (x1, y1, x2, y2) => {
  const L = Math.hypot(x2 - x1, y2 - y1);
  return [(x2 - x1) / L, (y2 - y1) / L];
};

// ---- 肋骨（右）：外側の点 L、前の端 F（肋軟骨へ）。11・12 番は前に届かない（浮遊肋） ----
const RIB_W = [30, 40, 47, 52, 55, 57, 58, 57, 55, 52, 46, 38];
const RIB_F = [
  [148, 150],
  [154, 164],
  [159, 178],
  [163, 192],
  [167, 205],
  [170, 217],
  [172, 228],
  [176, 238],
  [179, 246],
  [181, 253]
];
// 肋軟骨の行き先：1〜7 番は胸骨へ、8〜10 番は一つ上の肋軟骨へ
const CART_TO = [
  [136, 140],
  [136, 152],
  [136, 166],
  [136, 180],
  [136, 192],
  [136, 202],
  [136, 210],
  [157, 221],
  [166.5, 229.5],
  [172.8, 237.8]
];
const ribLat = (i) => [130 + RIB_W[i], 146 + i * 10];
// 浮遊肋（11・12 番）：背骨から横へ伸び、前に届かない
const floatRib = (i) => {
  const [lx, ly] = ribLat(i);
  const [vx, vy] = [138, 134 + i * 10];
  return bone(`M${vx} ${vy}C${r1(vx + 0.5 * (lx - vx))} ${vy - 4} ${lx - 4} ${ly - 4} ${lx} ${ly + 4}`, 3.6, BACK);
};
const ribFront = (i) => {
  const [lx, ly] = ribLat(i);
  const [fx, fy] = RIB_F[i];
  const [tx, ty] = CART_TO[i];
  // 外側では下へ向かい、前で内側へ回って少し下がる（前から見た肋骨）
  const rib = bone(
    `M${lx} ${ly - 4}C${lx + 1.5} ${r1(ly + 0.55 * (fy - ly) + 3)} ${r1(fx + 0.5 * (lx - fx))} ${fy} ${fx} ${fy}`,
    i ? 4 : 3.4
  );
  const cart = bone(`M${fx} ${fy}Q${r1((fx + tx) / 2)} ${r1(Math.max(fy, ty) + 1)} ${tx} ${ty}`, 2.6, CART, '#8aa4b8');
  return rib + cart;
};

// ---- 右半分（図の右。写して左も） ----
const scapula = () =>
  `<path d="M184 128L208 133L205 150L193 208L177 196L178 150Z" fill="${BACK}" stroke-width="1.1"/><path d="M180 140L204 137" stroke-width="0.8"/>`;
const ribsBack = () => floatRib(10) + floatRib(11);
const ribsFront = () => RIB_F.map((_, i) => ribFront(i)).join('');
const clavicle = () => bone('M137 134C156 139 176 122 200 128', 4.6) + knob(201, 128, 4, 3.4);

function arm() {
  // 上腕骨・尺骨（内側）・橈骨（外側＝親指の側）
  let s = seg(210, 152, 216, 272, 8) + knob(208, 144, 9.5) + knob(217, 279, 11.5, 6.5);
  s += seg(212, 288, 220, 358, 4.4) + knob(212, 287, 4.6, 5.2);
  s += seg(223, 290, 232, 358, 5) + knob(223, 290, 4.2, 3.4) + knob(232, 360, 6, 3.6);
  // 手根骨（8 つ。2 列）
  for (const [x, y] of [
    [219, 365],
    [224, 364],
    [229, 364],
    [234, 366],
    [218, 372],
    [223, 372],
    [229, 372],
    [235, 373]
  ])
    s += knob(x, y, 3, 3);
  // 中手骨と指骨（小指 V から親指 I）
  const hands = [
    [217, 378, 213, 400, [12, 7, 6]],
    [222, 379, 220, 404, [14, 9, 7]],
    [227, 379, 227, 406, [15, 10, 7]],
    [232, 379, 234, 404, [14, 9, 7]],
    [237, 375, 245, 391, [11, 8]]
  ];
  for (const [x1, y1, x2, y2, lens] of hands) {
    const [ux, uy] = unit(x1, y1, x2, y2);
    const thumb = lens.length === 2;
    s += seg(x1, y1, x2, y2, thumb ? 3.4 : 3) + knob(x2, y2, 2.2);
    s += digits(x2 + ux * 1.6, y2 + uy * 1.6, ux, uy, lens, thumb ? 3 : 2.6);
  }
  return s;
}

function hip() {
  // 寛骨（腸骨・坐骨・恥骨）：仙腸関節 → 腸骨稜 → 上前腸骨棘 → 寛骨臼 → 坐骨結節 → 恥骨結合 → 分界線
  return `<path d="M141 300C150 284 170 278 182 284C192 290 194 300 190 308C188 314 187 318 186 322C186 330 188 336 186 344C184 356 178 368 170 378C166 382 158 382 154 378C148 374 140 372 134 370L133.5 356C142 354 152 352 160 348C156 338 148 326 142 316Z" fill="${BONE}" stroke-width="1.2"/><path d="M148 300C160 290 176 288 184 296" stroke-width="0.8"/><ellipse cx="154" cy="364" rx="6.5" ry="8.5" transform="rotate(-25 154 364)" fill="${HOLE}" fill-opacity="0.75" stroke="none"/><circle cx="176" cy="344" r="11" fill="${BACK}"/>`;
}

function leg() {
  // 大腿骨（頭・頸・大転子・小転子・骨幹・顆）
  let s =
    knob(195, 363, 7, 10, -12) + knob(182, 380, 3.6, 5) + seg(192, 368, 165, 512, 10) + bone('M178 347L193 360', 9.5);
  s += knob(176, 344, 9) + knob(156, 521, 8, 8) + knob(171, 521, 8.5, 8);
  // 脛骨（内側・太い）と腓骨（外側・細い）
  s += seg(179, 541, 175, 682, 3.6) + knob(179, 540, 4, 5) + knob(175, 688, 4, 6);
  s += knob(162, 534, 16, 6) + seg(162, 538, 158, 676, 9) + knob(154, 684, 5, 5.5);
  // 膝蓋骨（前にあるので後から）
  s += knob(164, 512, 7, 9, 0);
  // 足（前から見るので短く見える）：距骨・足根骨・中足骨・趾骨
  s += knob(165, 692, 10, 5.5);
  for (const [x, y] of [
    [156, 699],
    [163, 700],
    [170, 700],
    [177, 699]
  ])
    s += knob(x, y, 3.6, 3);
  const toes = [
    [157, 703, 153, 713, [5, 4]],
    [162, 704, 160, 714, [4, 3, 3]],
    [167, 704, 167, 714, [4, 3, 3]],
    [172, 704, 174, 713, [4, 3, 2.5]],
    [177, 703, 181, 711, [3.5, 2.5, 2.5]]
  ];
  for (const [x1, y1, x2, y2, lens] of toes) {
    const [ux, uy] = unit(x1, y1, x2, y2);
    s +=
      seg(x1, y1, x2, y2, lens.length === 2 ? 3.6 : 2.8) +
      digits(x2 + ux * 1.4, y2 + uy * 1.4, ux, uy, lens, lens.length === 2 ? 3.2 : 2.4);
  }
  return s;
}

// ---- 真ん中（1 つだけ） ----
function spine() {
  let s = '';
  for (let i = 0; i < 7; i++)
    s += `<rect x="124.5" y="${100 + i * 4.4}" width="11" height="3.6" rx="1.2" fill="${BONE}"/>`; // 頸椎
  for (let i = 0; i < 12; i++) {
    const w = 13 + i * 0.6;
    s += `<rect x="${r1(130 - w / 2)}" y="${131 + i * 10}" width="${r1(w)}" height="8.4" rx="2" fill="${BONE}"/>`; // 胸椎
  }
  for (let i = 0; i < 5; i++) {
    const y = 252 + i * 11.2,
      w = 21 + i;
    s +=
      seg(130 - w / 2 - 7, y + 5, 130 + w / 2 + 7, y + 5, 2.6) +
      `<rect x="${r1(130 - w / 2)}" y="${r1(y)}" width="${w}" height="10" rx="2.4" fill="${BONE}"/>`; // 腰椎と横突起
  }
  return s;
}
const sternum = () =>
  `<path d="M122 134Q130 139 138 134L136.5 149H123.5Z" fill="${BONE}"/><path d="M124.5 151H135.5L137 207L130 214L123 207Z" fill="${BONE}"/><path d="M127 215H133L130 226Z" fill="${BONE}"/>`;
const sacrum = () =>
  `<path d="M119 304H141L137 338L130 352L123 338Z" fill="${BONE}"/>${[312, 321, 330, 339]
    .map(
      (y, i) =>
        `<circle cx="${125 + i * 0.9}" cy="${y}" r="1.6" fill="${HOLE}" stroke="none"/><circle cx="${135 - i * 0.9}" cy="${y}" r="1.6" fill="${HOLE}" stroke="none"/>`
    )
    .join('')}<path d="M128 354H132L130 362Z" fill="${BONE}"/>`;
function skull() {
  const teeth = Array.from({length: 9}, (_, i) => `M${119 + i * 2.75} 77V84`).join('');
  return `<path d="M130 12C150 12 162 28 162 50C162 60 158 66 156 70L154 82C150 92 140 97 130 97C120 97 110 92 106 82L104 70C102 66 98 60 98 50C98 28 110 12 130 12Z" fill="${BONE}" stroke-width="1.3"/><path d="M104 38C114 30 146 30 156 38" stroke-width="0.7" stroke-dasharray="2 1.6"/><ellipse cx="118" cy="52" rx="9" ry="8" fill="${HOLE}" stroke="none"/><ellipse cx="142" cy="52" rx="9" ry="8" fill="${HOLE}" stroke="none"/><path d="M130 58C126 64 125 70 127 73H133C135 70 134 64 130 58Z" fill="${HOLE}" stroke="none"/><path d="M104 62C108 60 112 62 114 64M156 62C152 60 148 62 146 64" stroke-width="0.9"/><path d="M110 76Q130 80 150 76M112 85Q130 89 148 85" stroke-width="0.9"/><path d="${teeth}" stroke-width="0.7"/><path d="M106 72L110 86M154 72L150 86" stroke-width="0.8"/>`;
}

const mirror = (s) => `${s}<g transform="translate(260 0) scale(-1 1)">${s}</g>`;

/** 名前：[文字, 図の左右（-1 左 / 1 右）, 名前の y, 骨の点（体の座標）] */
const NAMES = [
  ['頭蓋骨', 1, 34, [158, 40]],
  ['下顎骨', -1, 90, [109, 88]],
  ['鎖骨', 1, 116, [178, 128]],
  ['肩甲骨', 1, 160, [200, 168]],
  ['胸骨', -1, 172, [127, 178]],
  ['肋骨', -1, 206, [84, 200]],
  ['上腕骨', 1, 220, [214, 220]],
  ['脊柱（背骨）', -1, 274, [124, 276]],
  ['寛骨', 1, 306, [186, 306]],
  ['尺骨', -1, 322, [44, 322]],
  ['橈骨', 1, 334, [229, 334]],
  ['仙骨', -1, 344, [126, 330]],
  ['手根骨', 1, 368, [236, 369]],
  ['指骨', -1, 424, [33, 424]],
  ['大腿骨', 1, 440, [180, 440]],
  ['膝蓋骨', -1, 512, [96, 512]],
  ['脛骨', -1, 600, [101, 600]],
  ['腓骨', 1, 610, [177, 610]],
  ['足の骨', 1, 704, [182, 704]]
];

export const skeletonDef = {
  key: 'skeleton',
  name: '人体の骨格',
  subject: '生物',
  w: 380,
  h: 734,
  draw: () => {
    const body =
      spine() +
      mirror(scapula() + ribsBack() + ribsFront()) +
      sternum() +
      mirror(clavicle()) +
      mirror(arm() + hip()) +
      sacrum() +
      mirror(leg()) +
      skull();
    const leads = NAMES.map(([, side, y, [x0, y0]]) => lead(x0 + PAD, y0, side < 0 ? 60 : 320, y)).join('');
    return `${leads}<g transform="translate(${PAD} 0)" stroke-width="1.1">${body}</g>`;
  },
  labels: () => NAMES.map(([t, side, y]) => J(side < 0 ? 30 : 350, y, t, 9))
};
