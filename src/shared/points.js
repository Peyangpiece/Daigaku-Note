// アプリ内のポイント（SPEC §9.8）。ショップのポイントの品（前の「無料の品」）はポイントで買う。副作用なし。
// ポイントは「もらい方」（EARN）ごとに増える。いま動くのはログインボーナスとクイズの正解。
// チュートリアルのミッション・友達招待・有料版への加入は、もらい方の種類だけ先に決めておく（available: false で「準備中」）。
//   友達招待と有料版は、本当に起きたかをこのパソコンの中だけでは確かめられない（サーバー・決済の仕組みが要る）。
//   それができたら available を true にし、そこから earn を呼べば同じ台帳に入る。
// 残高と履歴は設定（points）に保存する（main/ipc.js）。日付はこのパソコンの時計の日付（YYYY-MM-DD）で数える

export const HISTORY_MAX = 200; // 履歴は新しい順にこの件数まで残す

/**
 * もらい方。amount はもらえる量（pt）。available: false は準備中（画面では「準備中」と出し、earn は断る）。
 * 準備中の量は目安（仕組みができたときに見直す）
 */
export const EARN = {
  login: {label: 'ログインボーナス', amount: 30, note: '1 日 1 回（アプリを開いた日）', available: true},
  quiz: {label: 'クイズに正解', amount: 5, note: '1 問ごと（同じ問題は 1 日 1 回まで）', available: true},
  tutorial: {label: 'チュートリアルのミッション', amount: 50, note: 'ミッションごと', available: false},
  invite: {label: '友達を招待', amount: 300, note: '招待した人・された人の両方に', available: false},
  plan: {label: '有料版に加入', amount: 1000, note: '加入した月ごと', available: false}
};
/** 使ったときの履歴の種類 */

/** このパソコンの時計での日付（YYYY-MM-DD） */
export function dayOf(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * 設定に保存した値を、使える形に直す。
 * 戻り値：{balance, history: [{at, kind, amount, note}]（新しい順）, lastLogin: 'YYYY-MM-DD' | null, quizDay, quizIds: [問題の id]}
 */
export function pointsState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const int = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const history = (Array.isArray(r.history) ? r.history : [])
    .filter((h) => h && typeof h.kind === 'string' && Number.isInteger(h.amount) && typeof h.at === 'string')
    .slice(0, HISTORY_MAX)
    .map(({at, kind, amount, note}) => ({at, kind, amount, ...(typeof note === 'string' && note ? {note} : {})}));
  const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  return {
    balance: int(r.balance),
    history,
    lastLogin: day(r.lastLogin),
    quizDay: day(r.quizDay),
    quizIds: day(r.quizDay) && Array.isArray(r.quizIds) ? r.quizIds.filter((x) => typeof x === 'string') : []
  };
}

const record = (st, {kind, amount, note = '', now}) => ({
  ...st,
  balance: st.balance + amount,
  history: [{at: now.toISOString(), kind, amount, ...(note ? {note} : {})}, ...st.history].slice(0, HISTORY_MAX)
});

/**
 * ポイントをもらう。kind は EARN の鍵。準備中・知らない種類は Error。
 * 戻り値：{points: 新しい状態, gained: もらった量}
 */
export function earn(raw, kind, {now = new Date(), note = '', times = 1} = {}) {
  const how = EARN[kind];
  if (!how) throw new Error('そのもらい方はありません');
  if (!how.available) throw new Error(`${how.label}のポイントは準備中です`);
  const amount = how.amount * Math.max(1, Math.floor(times));
  return {points: record(pointsState(raw), {kind, amount, note, now}), gained: amount};
}

/** ログインボーナス：その日の最初の 1 回だけもらえる。もらえなければ gained: 0（状態はそのまま） */
export function claimLogin(raw, {now = new Date()} = {}) {
  const st = pointsState(raw);
  const today = dayOf(now);
  if (st.lastLogin === today) return {points: st, gained: 0};
  const {points, gained} = earn(st, 'login', {now});
  return {points: {...points, lastLogin: today}, gained};
}

/**
 * クイズの正解：同じ問題は 1 日 1 回まで（何度も解き直してポイントを増やせないように）。
 * もらえなければ gained: 0
 */
export function claimQuiz(raw, questionId, {now = new Date()} = {}) {
  const st = pointsState(raw);
  const today = dayOf(now);
  const ids = st.quizDay === today ? st.quizIds : [];
  if (!questionId || ids.includes(questionId)) return {points: st, gained: 0};
  const {points, gained} = earn(st, 'quiz', {now});
  return {points: {...points, quizDay: today, quizIds: [...ids, questionId]}, gained};
}

/** ポイントを使う。足りなければ Error（状態は変えない） */
export function spend(raw, amount, {now = new Date(), note = ''} = {}) {
  const st = pointsState(raw);
  if (!Number.isInteger(amount) || amount < 0) throw new Error('ポイントの量が不正です');
  if (amount === 0) return st;
  if (st.balance < amount)
    throw new Error(`ポイントが足りません（あと ${(amount - st.balance).toLocaleString('ja-JP')} pt）`);
  return record(st, {kind: 'shop', amount: -amount, note, now});
}

/** ポイントの表示（1,200 pt） */
export const pt = (n) => `${Number(n).toLocaleString('ja-JP')} pt`;
