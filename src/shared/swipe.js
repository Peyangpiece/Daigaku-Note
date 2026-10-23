// トラックパッドの 2 本指の横スワイプで「戻る・進む」を見分ける（renderer/swipe.js が使う）。副作用なし。
// Chromium は 2 本指の動きを wheel（deltaX・deltaY）として送る。指を右へ動かすと deltaX は負、左へ動かすと正
// （ブラウザと同じく、右へ払うと戻る・左へ払うと進む）。指を置いた・離したという知らせは来ないので、
// wheel が idle より長く途切れたら「指を離した」とみる。
// ・動かし始めの向き：動いた量の合計が START に届くまで決めない（置いた瞬間の縦のぶれで縦と決めつけない）。
//   縦と決めたあとでも、直近の動きがはっきり横なら横に切り替える（縦のスクロールの慣性が残っていても払える）
// ・横と決めたら、指の動いた量に合わせて progress（-1.2〜1.2。負は戻る向き）を返す。画面はそれに合わせてページを動かす
// ・指を離したとき（end）：progress が COMMIT 以上なら戻る・進むに決める。足りなければ元に戻す
// ・決めたあとは、慣性の wheel が途切れるまで（cooldown）何もしない（1 回の払いで 1 画面だけ）

export const SWIPE_DISTANCE = 360; // progress 1 に当たる横の量（px。wheel の deltaX の合計）
export const SWIPE_COMMIT = 0.3; // 指を離したとき、これ以上動かしていれば切り替える
export const SWIPE_IDLE = 140; // これより長く wheel が来なければ、指を離したとみる（ms）
export const SWIPE_COOLDOWN = 250; // 切り替えたあと、慣性の wheel をこれだけ途切れるまで無視する（ms）
const START = 6; // 向きを決めるのに要る動きの量（px）
const RECENT = 6; // 縦から横へ切り替えるか見る直近の wheel の数

export function createSwipe({
  distance = SWIPE_DISTANCE,
  commit = SWIPE_COMMIT,
  idle = SWIPE_IDLE,
  cooldown = SWIPE_COOLDOWN
} = {}) {
  let phase = 'idle'; // idle | track | cool
  let last = -Infinity;
  let sx = 0;
  let sy = 0;
  let axis = null; // 'x' | 'y' | null
  let recent = [];
  const reset = () => {
    phase = 'idle';
    sx = 0;
    sy = 0;
    axis = null;
    recent = [];
  };
  const progress = () => Math.max(-1.2, Math.min(1.2, sx / distance));
  return {
    /** wheel を 1 つ渡す。戻りは {progress}（横のスワイプ中）か null（スワイプではない・決めたあとの慣性） */
    feed(dx, dy, t) {
      const gap = t - last;
      last = t;
      if (phase === 'cool') {
        if (gap <= cooldown) return null;
        reset();
      }
      if (gap > idle) reset();
      phase = 'track';
      recent = [...recent, [dx, dy]].slice(-RECENT);
      if (axis === 'x') {
        sx += dx;
        return {progress: progress()};
      }
      sx += dx;
      sy += dy;
      if (!axis) {
        if (Math.abs(sx) + Math.abs(sy) < START) return null;
        axis = Math.abs(sx) > Math.abs(sy) ? 'x' : 'y';
      } else {
        // 縦と決めたあと：直近の動きがはっきり横なら横へ（ここから数え直す）
        const rx = recent.reduce((a, [x]) => a + x, 0);
        const ry = recent.reduce((a, [, y]) => a + Math.abs(y), 0);
        if (Math.abs(rx) >= START * 2 && Math.abs(rx) > ry * 3) {
          axis = 'x';
          sx = rx;
        }
      }
      return axis === 'x' ? {progress: progress()} : null;
    },
    /**
     * 指を離した（wheel が idle より長く途切れた）。戻りは 'back' | 'forward'（切り替える）か null（元に戻す・スワイプではない）
     */
    end() {
      const p = axis === 'x' ? progress() : 0;
      const go = Math.abs(p) >= commit ? (p < 0 ? 'back' : 'forward') : null;
      reset();
      if (go) phase = 'cool';
      return go;
    },
    /** いまのスワイプをやめる（横に動かせる所の上・戻る先がないとき）。慣性が途切れるまで何もしない */
    cancel() {
      reset();
      phase = 'cool';
    }
  };
}
