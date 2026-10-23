// タイマー（編集画面のポーチ）の時間の計算。副作用なし。時刻（now。ms）は呼ぶ側が渡す。
// 残りは「終わる時刻」から数える（setInterval が遅れたり止まったりしても、残りの時間はずれない）
export const TIMER_PRESETS = [1, 3, 5, 10, 15, 25]; // 分
export const TIMER_MAX_MIN = 180;

/** 入力された分を 1〜180 の整数にする。数でなければ null */
export function clampMinutes(v) {
  const n = Math.round(Number(String(v ?? '').trim()));
  if (!Number.isFinite(n) || String(v ?? '').trim() === '') return null;
  return Math.min(TIMER_MAX_MIN, Math.max(1, n));
}

/** 残り（ms）を「分:秒」に（1 時間以上は「時:分:秒」）。秒は切り上げ（0.2 秒残りは 0:01。0 になったら 0:00） */
export function formatClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** 新しいタイマー（止まっている）。total は ms */
export const newTimer = (total) => ({total, left: total, endAt: null});
/** 動かす（止めていたら続きから）。もう 0 なら最初から */
export const startTimer = (t, now) =>
  t.endAt != null ? t : {...t, left: t.left > 0 ? t.left : t.total, endAt: now + (t.left > 0 ? t.left : t.total)};
/** 一時停止 */
export const pauseTimer = (t, now) => (t.endAt == null ? t : {...t, left: Math.max(0, t.endAt - now), endAt: null});
/** 残り（ms） */
export const timerLeft = (t, now) => (t.endAt == null ? t.left : Math.max(0, t.endAt - now));
export const isRunning = (t) => t.endAt != null;
/** 動いていて、残りが 0 になったか */
export const isDone = (t, now) => t.endAt != null && now >= t.endAt;
