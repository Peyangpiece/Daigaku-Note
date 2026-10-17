// 間隔をあけた復習（SPEC §11.7）。副作用なし。時刻はミリ秒。
// entry = {s, due, at, c?, lapses?}
//   まちがえた → s:0（すぐ出る）。復習で正解 → s:1(1日)→2(3日)→3(1週)→4(2週)→5(1か月)→6(3か月)→ 正解で s:-1（おぼえた）
//   初めて正解した問題 → s:3（1 週間後に 1 回だけ確かめる）
//   まだ日が来ていない問題を正解しても段階は進めない。おぼえた問題をまちがえたら s:0 から
//   two（○× などの 2 択）は 2 回続けて正解したときだけ段階を進める

export const GAPS = [1, 3, 7, 14, 30, 90];
export const FIRST_STAGE = 3;
export const LEARNED = -1;
const DAY = 864e5;

export function schedule(entry, ok, now, {two = false} = {}) {
  if (!ok) return {s: 0, due: now, at: now, lapses: (entry?.lapses ?? 0) + 1};
  if (entry?.s === LEARNED) return entry;
  if (entry && entry.s >= 0 && entry.due > now) return entry;
  if (!entry) return {s: FIRST_STAGE, due: now + GAPS[FIRST_STAGE - 1] * DAY, at: now, lapses: 0};
  if (two && !(entry.c >= 1)) return {...entry, c: 1, at: now};
  const s = (entry.s ?? 0) + 1;
  if (s > GAPS.length) return {s: LEARNED, due: 0, at: now, lapses: entry.lapses ?? 0};
  return {s, due: now + GAPS[s - 1] * DAY, at: now, c: 0, lapses: entry.lapses ?? 0};
}

/** 今日の復習に出す順：期限を過ぎて長いもの・まちがえた回数が多いものを先に。max を超えた分は rest */
export function reviewQueue(items, now, max = 30) {
  const due = items
    .filter((x) => x.entry && x.entry.s >= 0 && x.entry.due <= now)
    .sort((a, b) => a.entry.due - b.entry.due || (b.entry.lapses ?? 0) - (a.entry.lapses ?? 0));
  return {items: due.slice(0, max), rest: Math.max(0, due.length - max)};
}

/** 次に復習が出る日（今日の分がないときの表示用）。なければ null */
export function nextDue(items, now) {
  const future = items.map((x) => x.entry).filter((e) => e && e.s >= 0 && e.due > now);
  if (!future.length) return null;
  const due = Math.min(...future.map((e) => e.due));
  return {due, count: future.filter((e) => e.due - due < DAY).length};
}
