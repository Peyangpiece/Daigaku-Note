// 文字入れの部分の色（style.runs）と揃え（style.align）。副作用なし。
// runs は [[始め, 終わり, 色], …]：本文（body）の何文字目から何文字目まで（UTF-16 の位置。終わりは含まない）を何色にするか。
// 始めの順に並べ、重ならない。箱の色（style.color）と同じ色の所は持たない（箱の色を変えたらその色になる所）
export const RUNS_MAX = 200;
export const ALIGNS = ['left', 'center', 'right'];

const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** runs を整える：範囲の外・形の悪いものは捨て、重なりは先の色を残し、隣り合う同じ色はつなぐ。箱の色と同じ所は持たない */
export function cleanRuns(runs, length, base) {
  if (!Array.isArray(runs)) return [];
  const list = [];
  for (const r of runs.slice(0, RUNS_MAX)) {
    if (!Array.isArray(r)) continue;
    const [s, e, c] = r;
    if (!Number.isInteger(s) || !Number.isInteger(e) || !isHex(c)) continue;
    const a = Math.max(0, s),
      b = Math.min(length, e);
    if (b > a) list.push([a, b, c.toLowerCase()]);
  }
  list.sort((x, y) => x[0] - y[0]);
  const out = [];
  let end = 0;
  for (const [s, b, c] of list) {
    const a = Math.max(s, end);
    if (b <= a) continue;
    end = b;
    if (c === base) continue;
    const last = out.at(-1);
    if (last && last[1] === a && last[2] === c) last[1] = b;
    else out.push([a, b, c]);
  }
  return out;
}

/** [s, e) を color に塗った新しい runs */
export function paintRuns(runs, s, e, color, base, length) {
  const out = [];
  for (const [a, b, c] of runs ?? []) {
    if (b <= s || a >= e) out.push([a, b, c]);
    else {
      if (a < s) out.push([a, s, c]);
      if (b > e) out.push([e, b, c]);
    }
  }
  out.push([s, e, color]);
  return cleanRuns(out, length, base);
}

/** 本文を色の切れ目で分ける：[{t, c}]（c は色。箱の色のままの所は null） */
export function textSegments(body, runs) {
  const segs = [];
  let i = 0;
  for (const [a, b, c] of runs ?? []) {
    if (a > i) segs.push({t: body.slice(i, a), c: null});
    segs.push({t: body.slice(a, b), c});
    i = b;
  }
  if (i < body.length || !segs.length) segs.push({t: body.slice(i), c: null});
  return segs;
}

/** 色ごとの切れ目（[{t, c}]）から本文と runs を作る */
export function fromSegments(segs, base) {
  let body = '';
  const runs = [];
  for (const {t, c} of segs) {
    if (c && c !== base && t) runs.push([body.length, body.length + t.length, c]);
    body += t;
  }
  return {body, runs: cleanRuns(runs, body.length, base)};
}

/** 揃え：左（既定）・中央・右。左は持たない */
export const cleanAlign = (v) => (v === 'center' || v === 'right' ? v : null);
