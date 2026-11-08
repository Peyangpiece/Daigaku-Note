// アナログノートのその場の読み取り（docs/SPEC-SCAN.md §3）：カメラの映像を見続け、Palette スキャンノートが
// 写って止まったら、1 回だけ取り込む。副作用なし（何を見たかを渡すと、どうするかを返す）。
//   - 四隅の目印と形式のコードが読め、目印が STABLE 回続けてほとんど動かなければ「取り込む」
//   - 取り込んだ紙は、カメラから外れる（目印が LOST 回続けて見えない）まで、もう取り込まない（同じページを 2 回取らない）
//   - 読めなかったときは retry で、その紙をもう一度読めるようにする

export const LIVE = {
  stable: 4, // 止まっているとみなす回数（200 ms ごとに見るので約 0.8 秒）
  move: 0.012, // 止まっている：四隅の動きが、紙の対角線のこの割合より小さい
  lost: 3 // 外れた：目印が見えない回数（約 0.6 秒）
};

/** 四隅のいちばん大きな動き（対角線に対する割合） */
export function cornerMove(a, b) {
  const diag = Math.hypot(a.br[0] - a.tl[0], a.br[1] - a.tl[1]) || 1;
  let far = 0;
  for (const k of ['tl', 'tr', 'br', 'bl']) far = Math.max(far, Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1]));
  return far / diag;
}

/**
 * @param {Partial<typeof LIVE>} [opt]
 * step(det)：det は null（目印が見えない）か {marks, format}（format は読めなければ null）。
 * 戻り {phase, progress}：phase は
 *   'none'（紙が見えない）・'nocode'（目印は見えるがコードが読めない）・'steady'（止まるのを待っている。progress 0〜1）・
 *   'capture'（いま取り込む）・'done'（取り込んだ紙が、まだ写っている）
 */
export function createLiveScan(opt = {}) {
  const o = {...LIVE, ...opt};
  let armed = true;
  let stable = 0;
  let prev = null;
  let lost = 0;
  return {
    step(det) {
      if (!det) {
        stable = 0;
        prev = null;
        if (++lost >= o.lost) armed = true;
        return {phase: 'none', progress: 0};
      }
      lost = 0;
      const moved = prev ? cornerMove(det.marks, prev) : Infinity;
      prev = det.marks;
      if (!armed) return {phase: 'done', progress: 1};
      if (!det.format) {
        stable = 0;
        return {phase: 'nocode', progress: 0};
      }
      stable = moved < o.move ? stable + 1 : 1;
      if (stable >= o.stable) {
        armed = false;
        stable = 0;
        return {phase: 'capture', progress: 1};
      }
      return {phase: 'steady', progress: stable / o.stable};
    },
    /** 取り込みに失敗した：同じ紙をもう一度読めるようにする */
    retry() {
      armed = true;
      stable = 0;
    },
    get armed() {
      return armed;
    }
  };
}
