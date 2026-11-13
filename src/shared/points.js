// アプリ内のポイント（SPEC §9.8）。ショップのポイントの品（前の「無料の品」）はポイントで買う。副作用なし。
// ポイントは「もらい方」（EARN）ごとに増える。開いた・書いた・読んだ・確かめた・クイズの正解・週に 4 日書いた（v0.26.1）。
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
  login: {label: 'アプリを開いた', amount: 10, note: '1 日 1 回', available: true},
  write: {label: 'その日に初めて書き込んだ', amount: 20, note: '1 日 1 回', available: true},
  page: {label: '書き込んだページ', amount: 5, note: '1 ページごと（1 日 6 ページまで）', available: true},
  read: {label: '資料を初めて開いた', amount: 3, note: '1 件ごと（1 日 5 件まで）', available: true},
  recall: {label: '暗記モードで確かめた', amount: 2, note: '1 か所ごと（1 日 10 か所まで）', available: true},
  quiz: {label: 'クイズに正解', amount: 5, note: '1 問ごと（同じ問題は 1 日 1 回まで）', available: true},
  week: {label: '週に 4 日書いた', amount: 50, note: '週に 1 回（月曜から日曜）', available: true},
  tutorial: {label: 'チュートリアルのミッション', amount: 50, note: 'ミッションごと', available: false},
  invite: {label: '友達を招待', amount: 300, note: '招待した人・された人の両方に', available: false},
  plan: {label: '有料版に加入', amount: 1000, note: '加入した月ごと', available: false}
};
/**
 * ノートを使ったときのもらい方（v0.26.1）：1 日に数える上限。同じもの（同じページ・同じ資料・同じマーカー）は 1 日 1 回だけ数える。
 * 開いたことより、書く・読む・確かめることに付ける。上限は、稼ぐための作業にならないように置く。切れても失うものはない
 */
export const DAILY = {write: 1, page: 6, read: 5, recall: 10};
/** 週のボーナス：その週（月曜から日曜）に書いた日がこの数になったら 1 回 */
export const WEEK_DAYS = 4;

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
  const keys = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 100) : []);
  const used = r.used && typeof r.used === 'object' ? r.used : {};
  return {
    balance: int(r.balance),
    history,
    lastLogin: day(r.lastLogin),
    quizDay: day(r.quizDay),
    quizIds: day(r.quizDay) && Array.isArray(r.quizIds) ? r.quizIds.filter((x) => typeof x === 'string') : [],
    // その日に数えたもの（DAILY）：{もらい方: [鍵]}。日が変わったら空から数える
    usedDay: day(r.usedDay),
    used: day(r.usedDay) ? Object.fromEntries(Object.keys(DAILY).map((k) => [k, keys(used[k])])) : {},
    // 週のボーナス：その週に書いた日（YYYY-MM-DD）と、もらった週（その週の月曜の日付）
    writeDays: keys(r.writeDays).filter((d) => day(d)),
    weekPaid: day(r.weekPaid)
  };
}

/**
 * 残高に足して、履歴に残す。merge：同じ日の同じもらい方がいちばん上にあれば、その行に足す
 * （ページ・資料・マーカーごとの小さなポイントで、履歴が埋まらないように）
 */
const record = (st, {kind, amount, note = '', now, merge = false}) => {
  const top = st.history[0];
  const same = merge && top && top.kind === kind && !top.note && dayOf(new Date(top.at)) === dayOf(now);
  const history = same
    ? [{...top, at: now.toISOString(), amount: top.amount + amount}, ...st.history.slice(1)]
    : [{at: now.toISOString(), kind, amount, ...(note ? {note} : {})}, ...st.history].slice(0, HISTORY_MAX);
  return {...st, balance: st.balance + amount, history};
};

/**
 * ポイントをもらう。kind は EARN の鍵。準備中・知らない種類は Error。
 * 戻り値：{points: 新しい状態, gained: もらった量}
 */
export function earn(raw, kind, {now = new Date(), note = '', times = 1, merge = false} = {}) {
  const how = EARN[kind];
  if (!how) throw new Error('そのもらい方はありません');
  if (!how.available) throw new Error(`${how.label}のポイントは準備中です`);
  const amount = how.amount * Math.max(1, Math.floor(times));
  return {points: record(pointsState(raw), {kind, amount, note, now, merge}), gained: amount};
}

/** その日付（YYYY-MM-DD）の週の月曜の日付。週のボーナスの「週」の名前に使う */
export function weekOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return dayOf(t);
}

/**
 * ノートを使ったときのポイント（DAILY の種類）：同じ鍵は 1 日 1 回、種類ごとに 1 日の上限まで。もらえなければ gained: 0。
 * 'write'（その日に初めて書き込んだ）をもらったときは、その週に書いた日を数え、WEEK_DAYS 日になったら週のボーナスも足す。
 * 戻り値：{points, gained}（gained は週のボーナスを含む）
 */
export function claimDaily(raw, kind, key, {now = new Date()} = {}) {
  let st = pointsState(raw);
  const limit = DAILY[kind];
  const k = typeof key === 'string' && key ? key.slice(0, 120) : '';
  if (!limit || !k) return {points: st, gained: 0};
  const today = dayOf(now);
  const used = st.usedDay === today ? st.used : {};
  const list = used[kind] ?? [];
  if (list.includes(k) || list.length >= limit) return {points: st, gained: 0};
  const first = earn(st, kind, {now, merge: true});
  let gained = first.gained;
  st = {...first.points, usedDay: today, used: {...used, [kind]: [...list, k]}};
  if (kind === 'write') {
    const week = weekOf(today);
    const days = [...new Set([...st.writeDays.filter((d) => weekOf(d) === week), today])];
    st = {...st, writeDays: days};
    if (days.length >= WEEK_DAYS && st.weekPaid !== week) {
      const bonus = earn(st, 'week', {now});
      st = {...bonus.points, weekPaid: week};
      gained += bonus.gained;
    }
  }
  return {points: st, gained};
}

/** アプリを開いた：その日の最初の 1 回だけもらえる。もらえなければ gained: 0（状態はそのまま） */
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
