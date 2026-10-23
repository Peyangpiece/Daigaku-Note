// ボールペンの線（SPEC §9.8）。なぞった点（座標と筆圧）から、線の輪郭（塗りつぶす多角形）を作る。副作用なし。
// 画面（レンダラ）と PDF への書き出し（メイン）で同じ形を使い、見たとおりの線が PDF に残るようにする。
// 書き味：筆圧で太さが少し変わり、書き始めと書き終わりは細くなる（紙のボールペンのように）。
//   筆圧の取れない指・マウスでは、速く動かすほど少し細くする（筆圧の代わり）
// 座標は PDF のユーザー空間（左下原点、pt）。点は [x, y, 筆圧(0〜1)]

export const POINTS_MAX = 5000; // 1 本の線の点の数の上限（それ以上は線を分ける）
export const WIDTH_MIN = 0.2;
export const WIDTH_MAX = 12;

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const round2 = (v) => Math.round(v * 100) / 100;

/** 点の並びを本文（DB の body）に入れる文字列にする。0.01pt・筆圧 0.01 の細かさ */
export function encodePoints(points) {
  return JSON.stringify(points.flatMap(([x, y, p]) => [round2(x), round2(y), round2(p)]));
}

/** 本文から点の並びを取り出す。形が不正なら null */
export function decodePoints(body) {
  let flat;
  try {
    flat = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(flat) || !flat.length || flat.length % 3 || flat.length / 3 > POINTS_MAX) return null;
  if (!flat.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const out = [];
  for (let i = 0; i < flat.length; i += 3) out.push([flat[i], flat[i + 1], Math.min(1, Math.max(0, flat[i + 2]))]);
  return out;
}

/** 点を囲む四角（線の太さの半分だけ広げる） */
export function boundsOf(points, width = 0) {
  const r = width / 2;
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const x = Math.min(...xs) - r,
    y = Math.min(...ys) - r;
  return {x, y, w: Math.max(...xs) + r - x, h: Math.max(...ys) + r - y};
}

/**
 * 線の輪郭。points は間引き・なめらかにしたあとの点（capture の結果）。
 * size は線の太さ（筆圧 0.5 のとき）、thinning は筆圧で太さが変わる強さ（0〜1）。
 * 戻り値は輪郭の点 [[x, y], …]（左側を行き、終わりを丸く回って、右側を戻る）
 */
export function strokeOutline(points, {size = 1, thinning = 0.35, taperStart = 0, taperEnd = 0} = {}) {
  if (!points.length) return [];
  const radius = (p) => Math.max(size * 0.08, (size / 2) * (1 + thinning * (p - 0.5) * 2));
  // 長さ（書き始め・書き終わりを細くするのに使う）
  const along = [0];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + dist(points[i - 1], points[i]));
  const total = along.at(-1);
  // 押しただけ（点）：丸
  if (points.length === 1 || total < size * 0.3) return circle(points[0], radius(points[0][2]));
  const ease = (t) => 1 - (1 - t) * (1 - t);
  const rs = points.map((pt, i) => {
    let r = radius(pt[2]);
    if (taperStart > 0) r *= 0.35 + 0.65 * ease(Math.min(1, along[i] / taperStart));
    if (taperEnd > 0) r *= 0.35 + 0.65 * ease(Math.min(1, (total - along[i]) / taperEnd));
    return r;
  });
  const left = [],
    right = [];
  for (let i = 0; i < points.length; i++) {
    // 向き：前後の点を結ぶ向き（端では隣の点との向き）
    const a = points[Math.max(0, i - 1)],
      b = points[Math.min(points.length - 1, i + 1)];
    let dx = b[0] - a[0],
      dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (!len) continue;
    dx /= len;
    dy /= len;
    const [x, y] = points[i];
    left.push([x - dy * rs[i], y + dx * rs[i]]);
    right.push([x + dy * rs[i], y - dx * rs[i]]);
  }
  if (!left.length) return circle(points[0], rs[0]);
  // 書き終わり・書き始めを丸くする（半円）
  const end = cap(points.at(-1), left.at(-1), rs.at(-1));
  const start = cap(points[0], right[0], rs[0]);
  return [...left, ...end, ...right.reverse(), ...start];
}

/** 中心 c のまわりを、from から反対側まで（線の進む向きの側を通って）半円で回る点 */
function cap(c, from, r) {
  const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
  const out = [];
  const steps = 8;
  for (let k = 1; k < steps; k++) {
    const a = a0 - (Math.PI * k) / steps;
    out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
  }
  return out;
}

function circle(c, r) {
  const out = [];
  for (let k = 0; k < 16; k++) {
    const a = (Math.PI * 2 * k) / 16;
    out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
  }
  return out;
}

/**
 * 輪郭を SVG のパスにする（点の中点を通る 2 次曲線で、角を立てない）。
 * flipY：PDF へ書き出すとき（pdf-lib の drawSvgPath は y が下向きなので、上下を返す）
 */
export function outlinePath(outline, {flipY = false} = {}) {
  if (outline.length < 3) return '';
  const f = (v) => String(Math.round(v * 100) / 100);
  const y = (v) => (flipY ? -v : v);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const first = mid(outline[0], outline[1]);
  let d = `M${f(first[0])},${f(y(first[1]))}`;
  for (let i = 1; i <= outline.length; i++) {
    const p = outline[i % outline.length];
    const m = mid(p, outline[(i + 1) % outline.length]);
    d += `Q${f(p[0])},${f(y(p[1]))} ${f(m[0])},${f(y(m[1]))}`;
  }
  return `${d}Z`;
}

/** 書き味の設定（ペンの種類ごとの太さの変わり方）。筆圧の取れる道具（ペンタブ・スタイラス）とそれ以外で変える */
export function strokeOptions(width, {pressure = true} = {}) {
  return pressure
    ? {size: width, thinning: 0.35, taperStart: width * 1.2, taperEnd: width * 1.5}
    : {size: width, thinning: 0.25, taperStart: width * 2, taperEnd: width * 3};
}

/** 線のパス（SVG）。points・幅・筆圧が取れたかから一度に作る */
export function strokePath(points, width, {pressure = true, flipY = false} = {}) {
  return outlinePath(strokeOutline(points, strokeOptions(width, {pressure})), {flipY});
}

/**
 * なぞる点を受け取り、間引きとなめらかにする（手ぶれを抑える）。
 * 画面の点を PDF の点に直してから渡す。minGap より近い点は捨て、streamline の割合だけ前の点に寄せる
 */
export function createCapture({minGap = 0.2, streamline = 0.35} = {}) {
  const points = [];
  let last = null;
  return {
    points,
    add(x, y, p) {
      if (!last) {
        last = [x, y, p];
        points.push(last);
        return true;
      }
      const t = 1 - streamline;
      const next = [last[0] + (x - last[0]) * t, last[1] + (y - last[1]) * t, last[2] + (p - last[2]) * t];
      if (dist(last, next) < minGap) return false;
      last = next;
      points.push(next);
      return points.length < POINTS_MAX;
    },
    /** 離したところ：なめらかにして遅れた分、最後の点を指の位置まで届かせる */
    finish(x, y, p) {
      if (last && dist(last, [x, y]) >= minGap * 0.5 && points.length < POINTS_MAX)
        points.push([x, y, last[2] * 0.5 + p * 0.5]);
      return points;
    }
  };
}

/**
 * 筆圧の取れない道具（マウス・指）で、動く速さから筆圧の代わりを作る。速いほど細く（0.3〜0.6）。
 * speed は 1 ミリ秒あたりの pt。prev は直前の値（急に変わらないよう寄せる）
 */
export function speedPressure(prev, speed) {
  const target = 0.6 - 0.3 * Math.min(1, speed / 1.2);
  return prev + (target - prev) * 0.25;
}

/** 点 (x, y) から線分 a-b までの距離 */
export function segmentDistance(x, y, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/** 消しゴム：点 (x, y) を中心に半径 r の円が線に触れるか（線の太さの半分も含める） */
export function touchesStroke(points, width, x, y, r) {
  const reach = r + width / 2;
  if (points.length === 1) return Math.hypot(x - points[0][0], y - points[0][1]) <= reach;
  for (let i = 1; i < points.length; i++) if (segmentDistance(x, y, points[i - 1], points[i]) <= reach) return true;
  return false;
}
