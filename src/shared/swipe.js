// トラックパッドの 2 本指の横スワイプで「戻る・進む」を見分ける（renderer/swipe.js が使う）。副作用なし。
// Chromium は 2 本指の横の動きを wheel（deltaX）として送る。指を右へ動かすと deltaX は負、左へ動かすと正
// （ブラウザと同じく、右へ払うと戻る・左へ払うと進む）。
// 1 回のスワイプ（wheel が idleMs より長く途切れるまで）で動かした横の量が threshold に届いたら 1 回だけ決める。
// 指を離したあとの慣性の wheel も同じスワイプに数えるので、続けて何ページも戻ってしまうことはない。
// 縦の動きが大きいスワイプ（ふつうのスクロール）は、途中で横に振れても数えない（最初の向きで決める）

export const SWIPE_THRESHOLD = 160; // 決めるのに要る横の量（px。wheel の deltaX の合計）
export const SWIPE_IDLE = 300; // これより長く wheel が来なければ、次のスワイプ（ms）
const SLOPE = 1.5; // 横の量が縦の量のこれ倍より大きいときだけ横のスワイプとみる

/**
 * スワイプの見分け。feed(deltaX, deltaY, 時刻ms) に wheel を順に渡すと {go: 'back' | 'forward' | null, progress}
 * を返す。progress は -1〜1（負は戻る向き。画面の目印の動きに使う）。go は決まったときの 1 回だけ
 */
export function createSwipe({threshold = SWIPE_THRESHOLD, idle = SWIPE_IDLE} = {}) {
  let sum = 0;
  let last = -Infinity;
  let axis = null; // 'x' | 'y' | null（まだ決めていない）
  let done = false;
  const none = {go: null, progress: 0};
  return {
    feed(dx, dy, t) {
      if (t - last > idle) {
        sum = 0;
        axis = null;
        done = false;
      }
      last = t;
      if (done) return none;
      if (!axis) {
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return none;
        axis = Math.abs(dx) > Math.abs(dy) * SLOPE ? 'x' : 'y';
      }
      if (axis !== 'x') return none;
      sum += dx;
      if (Math.abs(sum) >= threshold) {
        done = true;
        return {go: sum < 0 ? 'back' : 'forward', progress: Math.sign(sum)};
      }
      return {go: null, progress: sum / threshold};
    },
    /** いまのスワイプをやめる（横に動かせる所の上で動かしたときなど） */
    cancel() {
      sum = 0;
      done = true;
    }
  };
}
