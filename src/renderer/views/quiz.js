// クイズの画面（SPEC §11.7・§11.10）。単語カードのような 1 問 1 枚。答えるとすぐ正誤・解説・根拠を出し、終わったら結果。
// 経路：#/quizzes（クイズの一覧。上の「クイズ」）／ #/quiz?course=<授業>&quizzes=<id,id>&mode=quiz|exam|retry|card|review ／
//   #/review（今日の復習）／ #/quiz-edit/<quizId>。一覧から開いたクイズは back=quizzes で、戻ると一覧へ
// カテキョにならう：選択肢の並びは解くたびに変わる seed で決める、正解でも解説を出す、半分未満ならカードで覚えるを主に、途中でやめても続きから
import {confirmDialog, esc, toast} from '../ui-kit.js';
import {navigate, refresh, reload, state} from '../store.js';
import {BLANK, TYPE_LABEL, choicesOf} from '../../shared/quiz.js';

const api = window.daigaku;
const MODE_LABEL = {
  quiz: 'クイズ',
  exam: 'まとめて解く',
  retry: 'まちがえた問題',
  card: 'カードで覚える',
  review: '今日の復習'
};
const REPORTS = ['答えがまちがっている', '問題文がおかしい', '資料にない内容', '選択肢がおかしい'];
const SAVE_KEY = 'dn.quiz.session';

let session = null; // {key, mode, title, courseId, questions, i, results: {qid: {ok, answer}}, asks: {qid: [{q, a}]}, revealed, seed, startedAt, loading, error}

const shuffle = (list, seed) => {
  const out = [...list];
  let h = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

function persist() {
  try {
    if (session && !session.done)
      window.localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          key: session.key,
          i: session.i,
          results: session.results,
          order: session.questions.map((q) => q.id),
          seed: session.seed
        })
      );
    else window.localStorage.removeItem(SAVE_KEY);
  } catch {
    /* 保存できなくても解ける */
  }
}
function saved(key) {
  try {
    const s = JSON.parse(window.localStorage.getItem(SAVE_KEY) ?? 'null');
    return s?.key === key ? s : null;
  } catch {
    return null;
  }
}

/** 解き始める（または続きから）。questions を読み込んでから描き直す */
async function start(key, params) {
  // 読み込み中に別のクイズへ移る（session が差し替わる・leaveQuiz で消える）ことがあるので、
  // 自分のセッションを手元に持ち、応答が返ったときにまだ同じものか確かめてから書く
  const mine = {
    key,
    loading: true,
    mode: params.mode,
    courseId: params.course,
    questions: [],
    i: 0,
    results: {},
    asks: {},
    seed: Date.now() % 100000,
    startedAt: Date.now()
  };
  session = mine;
  try {
    let qs;
    let extra = {};
    if (params.mode === 'review') {
      const r = await api['quiz.review']();
      if (r?.error) throw new Error(r.error);
      qs = r.questions;
      extra = {rest: r.rest, next: r.next};
    } else {
      const r = await api['quiz.questions'](params.quizzes ? {quizIds: params.quizzes} : {courseId: params.course});
      if (r?.error) throw new Error(r.error);
      qs = r.filter((q) => !q.report_reason);
      if (params.mode === 'retry') qs = qs.filter((q) => q.last_ok === 0);
      if (params.mode === 'card') qs = qs.filter((q) => (params.only === 'wrong' ? q.last_ok === 0 : true));
      if (params.mode !== 'card' && params.mode !== 'review')
        qs = qs.filter((q) => (params.mode === 'exam' ? q.type !== 'card' : true));
    }
    if (session !== mine) return; // もう別のクイズに移った
    Object.assign(mine, extra);
    const resume = saved(key);
    if (resume && resume.order.every((id) => qs.some((q) => q.id === id))) {
      mine.questions = resume.order.map((id) => qs.find((q) => q.id === id));
      Object.assign(mine, {i: resume.i, results: resume.results, seed: resume.seed, resumed: true});
    } else {
      mine.questions =
        params.mode === 'exam' || params.mode === 'review' || params.order === 'random' ? shuffle(qs, mine.seed) : qs;
    }
    mine.loading = false;
  } catch (e) {
    if (session !== mine) return;
    mine.loading = false;
    mine.error = e.message;
  }
  refresh();
}

const parseParams = (route) => {
  const q = new URLSearchParams(route.split('?')[1] ?? '');
  return {
    course: q.get('course'),
    quizzes: q.get('quizzes')?.split(',').filter(Boolean) ?? null,
    mode: q.get('mode') ?? 'quiz',
    order: q.get('order'),
    only: q.get('only'),
    back: q.get('back')
  };
};

/** 画面：クイズを解く */
export function renderQuiz({data}, route) {
  const params = route.startsWith('/review') ? {mode: 'review'} : parseParams(route);
  const key = route;
  if (!session || session.key !== key) {
    start(key, params);
    return `<p class="muted">問題を読み込んでいます…</p>`;
  }
  const s = session;
  const course = data.courses.find((c) => c.id === s.courseId);
  // 戻る先：クイズの一覧から開いたら一覧、授業から開いたら授業、今日の復習は一覧
  s.backTo =
    params.back === 'quizzes' || params.mode === 'review'
      ? {route: '/quizzes', label: 'クイズ'}
      : course
        ? {route: `/course/${course.id}`, label: course.name}
        : {route: '/', label: 'ホーム'};
  const back = `<button class="btn" data-action="quiz-quit" data-route="${esc(s.backTo.route)}">← ${esc(s.backTo.label)}</button>`;
  const head = `<nav class="page-nav">${back}<h2>${esc(MODE_LABEL[s.mode] ?? 'クイズ')}</h2></nav>`;
  if (s.loading) return head + `<p class="muted">問題を読み込んでいます…</p>`;
  if (s.error) return head + `<div class="card"><p>${esc(s.error)}</p></div>`;
  if (!s.questions.length) {
    const msg =
      s.mode === 'review'
        ? `今日の復習はありません。${s.next ? `次は ${new Date(s.next.due).toLocaleDateString('ja-JP', {month: 'numeric', day: 'numeric'})} に ${s.next.count} 問です。` : ''}`
        : s.mode === 'retry'
          ? 'まちがえた問題はありません。'
          : '問題がまだありません。授業の画面の「問題を作る」で作れます。';
    // 次の一手：授業画面へ（授業が分からなければホームへ）
    const go = course
      ? `<button class="btn btn--primary" data-action="quiz-quit" data-route="/course/${esc(course.id)}">${esc(course.name)}の授業画面へ</button>`
      : '<button class="btn btn--primary" data-action="quiz-quit" data-route="/">ホームへ</button>';
    return head + `<div class="empty"><p>${esc(msg)}</p>${go}</div>`;
  }
  if (s.i >= s.questions.length) return head + renderResult(s, course);
  const q = s.questions[s.i];
  const res = s.results[q.id];
  const progress = `<div class="quiz-progress" aria-label="${s.i + 1} 問目／全 ${s.questions.length} 問"><span style="width:${(s.i / s.questions.length) * 100}%"></span></div>`;
  return `${head}
    ${progress}
    <article class="qcard${res ? (res.ok ? ' qcard--ok' : ' qcard--ng') : ''}" aria-live="polite">
      <span class="qcard__hole" aria-hidden="true"></span>
      <header class="qcard__head"><span>${s.i + 1} / ${s.questions.length}</span><span class="qcard__type">${esc(TYPE_LABEL[q.type] ?? q.type)}</span>${q.review === 'mismatch' ? '<span class="qcard__flag" title="AI の検算と答えが合いませんでした">要確認</span>' : ''}</header>
      <p class="qcard__q">${questionHtml(q)}</p>
      ${res ? feedbackHtml(q, res, data) : answerHtml(q, s)}
    </article>
    ${res ? '' : `<p class="muted quiz-keys">${q.type === 'num' ? 'Enter で答える' : q.type === 'card' ? 'Space で答えを見る' : '1〜4 キーでも選べます'}</p>`}`;
}

const questionHtml = (q) => esc(q.q).replace(esc(BLANK), '<span class="qcard__blank">（　　）</span>');

function answerHtml(q, s) {
  if (q.type === 'num')
    return `<form class="qcard__num" data-quiz-num><label class="sr-only" for="quiz-num">答え（数値）</label><input class="input" id="quiz-num" inputmode="decimal" autocomplete="off" data-keep="off" placeholder="数値">${q.unit ? `<span>${esc(q.unit)}</span>` : ''}<button class="btn btn--primary" type="submit">答える</button></form>`;
  if (q.type === 'card') {
    if (!s.revealed)
      return `<div class="qcard__actions"><button class="btn btn--primary" data-action="quiz-reveal">答えを見る</button></div>`;
    return `<div class="qcard__answer"><strong>模範解答</strong><p>${esc(q.a)}</p></div>
      <div class="qcard__actions"><button class="btn" data-action="quiz-self" data-ok="0">言えなかった</button><button class="btn btn--primary" data-action="quiz-self" data-ok="1">言えた</button></div>`;
  }
  const opts = choicesOf(q, (s.seed + s.i * 7919) >>> 0);
  return `<ol class="qcard__choices">${opts.map((o, k) => `<li><button class="choice" data-action="quiz-choose" data-value="${esc(o)}"><span class="choice__key">${k + 1}</span>${esc(o)}</button></li>`).join('')}</ol>`;
}

function feedbackHtml(q, res, data) {
  const mat = q.src_sha256
    ? Object.values(data.materials)
        .flat()
        .find((m) => m.sha256 === q.src_sha256 && m.status === 'ok')
    : null;
  const answer = q.type === 'num' ? `${q.a}${q.unit ? ` ${q.unit}` : ''}` : q.a;
  const mine = res.answer !== undefined && q.type !== 'card' ? String(res.answer) : null;
  const verdict =
    q.type === 'card'
      ? res.ok
        ? '言えた'
        : '言えなかった（あとでまた出します）'
      : res.ok
        ? `正解${res.points ? `<span class="qcard__points">+${res.points} pt</span>` : ''}`
        : '不正解';
  // 誤答ごとの「なぜ違うか」（作ったときの AI の解説。前の版の問題にはない）
  const why = (q.o ?? []).map((o, i) => [o, q.why?.[i]]).filter(([, w]) => w);
  return `<div class="qcard__feedback" role="status">
      <p class="qcard__verdict">${verdict}</p>
      ${
        q.type === 'card'
          ? ''
          : `<dl class="qcard__answers"><dt>正解</dt><dd>${esc(answer)}</dd>${!res.ok && mine !== null ? `<dt>あなた</dt><dd>${esc(mine)}</dd>` : ''}</dl>`
      }
      <section class="qcard__explain" aria-label="解説">
        <h4>解説</h4>
        <p>${esc(q.n)}</p>
        ${why.length ? `<ul class="qcard__why">${why.map(([o, w]) => `<li${o === mine ? ' class="qcard__why--mine"' : ''}><strong>${esc(o)}</strong>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${q.src_quote ? `<blockquote class="qcard__src">「${esc(q.src_quote)}」<cite>${mat ? `<button type="button" class="link" data-action="open-material" data-id="${esc(mat.id)}">${esc(mat.name)}${q.src_page ? ` p.${q.src_page}` : ''}</button>` : `資料${q.src_page ? ` p.${q.src_page}` : ''}`}</cite></blockquote>` : ''}
      </section>
      ${askHtml(q, data)}
    </div>
    <div class="qcard__actions">
      <details class="qcard__report"><summary class="muted">問題を報告</summary>${REPORTS.map((r) => `<button class="btn btn--small" data-action="quiz-report" data-reason="${esc(r)}">${esc(r)}</button>`).join(' ')}</details>
      <span style="margin-left:auto"></span>
      <button class="btn btn--primary" data-action="quiz-next" id="quiz-next">${session.i + 1 >= session.questions.length ? '結果を見る' : '次へ'}</button>
    </div>`;
}

/** 答えの画面：この問題について AI に質問する。AI を選んでいなければ設定へ */
function askHtml(q, data) {
  if (!data.quiz?.key?.set)
    return `<p class="qcard__ask-off"><button type="button" class="link" data-action="nav" data-route="/settings?focus=quiz">AI を設定</button>すると、この問題について質問できます</p>`;
  const thread = session.asks[q.id] ?? [];
  const busy = session.asking === q.id;
  return `<section class="qcard__ask" aria-label="この問題について質問">
      ${thread.map((t) => `<p class="qcard__ask-q">${esc(t.q)}</p><p class="qcard__ask-a">${esc(t.a)}</p>`).join('')}
      ${busy ? `<p class="qcard__ask-q">${esc(session.askingText ?? '')}</p><p class="qcard__ask-a muted"><span class="spinner" aria-hidden="true"></span> 考えています…</p>` : ''}
      <form class="qcard__ask-form" data-quiz-ask>
        <label class="sr-only" for="quiz-ask">この問題について質問</label>
        <input class="input" id="quiz-ask" maxlength="500" autocomplete="off" placeholder="${thread.length ? '続けて質問' : 'この問題について質問（例：なぜ ○○ ではないの？）'}"${busy ? ' disabled' : ''}>
        <button class="btn" type="submit"${busy ? ' disabled' : ''}>質問</button>
      </form>
    </section>`;
}

function renderResult(s, course) {
  s.done = true;
  persist();
  // 授業画面の正答率・ホームの今日の復習を新しい記録で数え直す（1 回だけ）
  if (!s.reloaded) {
    s.reloaded = true;
    queueMicrotask(() => reload().catch(() => {}));
  }
  const scored = s.questions.filter((q) => q.type !== 'card');
  const cards = s.questions.filter((q) => q.type === 'card');
  const ok = scored.filter((q) => s.results[q.id]?.ok).length;
  const pct = scored.length ? Math.round((ok / scored.length) * 100) : 0;
  const wrong = s.questions.filter((q) => s.results[q.id] && !s.results[q.id].ok);
  const low = scored.length && pct < 50;
  const ids = [...new Set(s.questions.map((q) => q.quiz_id))].join(',');
  const retryRoute =
    s.mode === 'review'
      ? '/review'
      : `/quiz?course=${s.courseId}&quizzes=${ids}&mode=retry${s.backTo?.route === '/quizzes' ? '&back=quizzes' : ''}&r=${Date.now()}`;
  const cardRoute = `/quiz?course=${s.courseId}&quizzes=${ids}&mode=card&only=wrong${s.backTo?.route === '/quizzes' ? '&back=quizzes' : ''}&r=${Date.now()}`;
  return `<section class="card quiz-result">
      <div class="ring" style="--pct:${pct}"><span>${scored.length ? `${pct}%` : '—'}</span></div>
      <div>
        <h3>${scored.length ? `${scored.length} 問中 ${ok} 問 正解` : 'カードを見終わりました'}</h3>
        ${cards.length ? `<p class="muted">記述：言えた ${cards.filter((q) => s.results[q.id]?.ok).length} ／ ${cards.length}</p>` : ''}
        ${s.mode === 'review' && s.rest ? `<p class="muted">今日の復習はあと ${s.rest} 問</p>` : ''}
        <div class="actions">
          ${wrong.length && s.mode !== 'review' ? `<button class="btn ${low ? '' : 'btn--primary'}" data-action="nav" data-route="${esc(retryRoute)}">まちがえた ${wrong.length} 問を解き直す</button>` : ''}
          ${wrong.length && s.mode !== 'review' && s.courseId ? `<button class="btn ${low ? 'btn--primary' : ''}" data-action="nav" data-route="${esc(cardRoute)}">カードで覚える</button>` : ''}
          ${s.mode === 'review' && s.rest ? `<button class="btn btn--primary" data-action="nav" data-route="/review?r=${Date.now()}">続ける</button>` : ''}
          <button class="btn" data-action="nav" data-route="${esc(s.backTo?.route ?? (course ? `/course/${course.id}` : '/'))}">${esc(s.backTo ? `${s.backTo.label}に戻る` : course ? '授業に戻る' : 'ホームへ')}</button>
        </div>
      </div>
    </section>
    ${wrong.length ? `<section class="card"><h3>まちがえた問題</h3><ol class="wrong-list">${wrong.map((q) => `<li><p>${questionHtml(q)}</p><p class="muted">正解：${esc(q.a)}${q.unit ? ` ${esc(q.unit)}` : ''}${s.results[q.id].answer !== undefined && q.type !== 'card' ? `　あなた：${esc(String(s.results[q.id].answer))}` : ''}</p></li>`).join('')}</ol></section>` : ''}`;
}

async function submit(value) {
  const s = session;
  const q = s.questions[s.i];
  if (!q || s.results[q.id] || s.busy) return;
  s.busy = true;
  const seconds = (Date.now() - (s.qStarted ?? s.startedAt)) / 1000;
  const r = await api['quiz.answer']({questionId: q.id, answer: value, mode: s.mode, seconds});
  s.busy = false;
  if (r?.error) return toast(r.error, {error: true});
  s.results[q.id] = {
    ok: r.ok,
    answer: value === true ? '言えた' : value === false ? '言えなかった' : value,
    points: r.points ?? 0
  };
  if (r.points && state.data.points) state.data.points = {...state.data.points, balance: r.balance}; // 正解のポイント（shared/points.js）
  persist();
  refresh();
  document.getElementById('quiz-next')?.focus({preventScroll: true});
}

function next() {
  session.i++;
  session.revealed = false;
  session.qStarted = Date.now();
  persist();
  refresh();
  window.scrollTo(0, 0);
}

/** 画面のボタン（app.js の委譲から呼ぶ）。扱ったら true */
export async function quizAction(action, el) {
  if (!session) return false;
  if (action === 'quiz-choose') await submit(el.dataset.value);
  else if (action === 'quiz-reveal') ((session.revealed = true), refresh());
  else if (action === 'quiz-self') await submit(el.dataset.ok === '1');
  else if (action === 'quiz-next') next();
  else if (action === 'quiz-report') {
    const q = session.questions[session.i];
    const r = await api['question.update']({questionId: q.id, patch: {report: el.dataset.reason}});
    if (r?.error) return (toast(r.error, {error: true}), true);
    toast('報告しました。この問題は復習に出しません');
  } else if (action === 'quiz-quit') {
    const left = session.questions.length - session.i;
    if (!session.done && session.i > 0 && left > 0) toast(`続きの ${left} 問は、もう一度開くとそこから解けます`);
    session = null;
    navigate(el.dataset.route);
    reload().catch(() => {});
  } else return false;
  return true;
}

/** キーボード：1〜4 で選ぶ、Enter で次へ、Space で答えを見る */
export function quizKey(e) {
  if (!session || session.loading || !session.questions.length || session.i >= session.questions.length) return;
  if (e.isComposing || e.target.closest('input, textarea, select, details, [contenteditable]')) return;
  const q = session.questions[session.i];
  const res = session.results[q.id];
  if (res && e.key === 'Enter') return (e.preventDefault(), next());
  if (!res && /^[1-4]$/.test(e.key)) document.querySelectorAll('.qcard__choices .choice')[Number(e.key) - 1]?.click();
  if (!res && q.type === 'card' && e.key === ' ' && !session.revealed)
    return (e.preventDefault(), quizAction('quiz-reveal'));
}

/** この問題について質問する（答えの画面のフォーム）。答えが来たら、その問題のやりとりに足す */
export async function quizSubmitAsk(form) {
  const s = session;
  const q = s?.questions[s.i];
  const text = form.querySelector('input').value.trim();
  if (!q || !text || s.asking) return;
  form.querySelector('input').value = ''; // 描き直しで打った文が戻らないように、先に空にする
  s.asking = q.id;
  s.askingText = text;
  refresh();
  const thread = s.asks[q.id] ?? [];
  const r = await api['quiz.ask']({questionId: q.id, text, mine: s.results[q.id]?.answer ?? null, history: thread});
  s.asking = null;
  if (r?.error) {
    toast(r.error, {error: true});
    refresh();
    const input = document.getElementById('quiz-ask');
    if (input) input.value = text; // 送れなかった質問は欄に戻す
    return;
  }
  s.asks[q.id] = [...thread, {q: text, a: r.answer}];
  refresh();
  document.getElementById('quiz-ask')?.focus({preventScroll: true});
}

/** 数値の答え（フォームの送信） */
export function quizSubmitNum(form) {
  const v = form.querySelector('input').value.trim();
  if (!v) return toast('数値を入れてください', {error: true});
  submit(v);
}

/** 経路が変わったら（クイズ画面を離れたら）片付ける */
export const leaveQuiz = () => (session = null);

// ---- クイズの一覧（#/quizzes。上の「クイズ」）：今日の復習と、授業ごとに作ったテストと成績 ----
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
/** 最後に解いた日（今日・昨日・n 日前・日付） */
function lastDay(iso) {
  if (!iso) return '未回答';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1 && new Date().toDateString() === d.toDateString()) return '今日';
  if (days < 2) return '昨日';
  if (days < 7) return `${days} 日前`;
  return d.toLocaleDateString('ja-JP', {month: 'numeric', day: 'numeric'});
}
/** 正答率の帯（色は 80% 以上・50% 以上・それ未満で変える） */
function rateBar(rate) {
  if (rate === null) return '<span class="qz-rate qz-rate--none">—</span>';
  const tone = rate >= 80 ? 'good' : rate >= 50 ? 'mid' : 'low';
  return `<span class="qz-rate qz-rate--${tone}"><span class="qz-rate__bar"><span style="width:${rate}%"></span></span><b>${rate}%</b></span>`;
}
const quizName = (z) =>
  z.round_number === 0
    ? z.round_title_user || 'その他'
    : z.round_user_made
      ? z.round_title_user || '名前のない付箋'
      : `第${z.round_number}回${z.round_title_user || z.round_title ? `　${z.round_title_user || z.round_title}` : ''}`;

/** 画面：クイズの一覧 */
export function renderQuizzes({data}) {
  const due = data.quiz?.reviewDue ?? 0;
  const next = data.quiz?.reviewNext;
  const review = due
    ? `<button type="button" class="home-review" data-action="nav" data-route="/review"><span class="home-review__mark" aria-hidden="true">✓</span><span class="home-review__text"><strong>今日の復習 ${due} 問</strong></span><span class="home-review__go">始める →</span></button>`
    : `<p class="muted qz-hub__none">今日の復習はありません。${next ? `次は ${new Date(next.due).toLocaleDateString('ja-JP', {month: 'numeric', day: 'numeric'})} に ${next.count} 問。` : ''}</p>`;
  const courses = data.courses
    .filter((c) => !c.hidden)
    .map((c) => ({c, list: (data.quizzes?.[c.id] ?? []).filter((z) => z.count > 0)}))
    .filter((x) => x.list.length);
  if (!courses.length)
    return `<nav class="page-nav"><h2>クイズ</h2></nav>${review}
      <div class="empty"><p>まだテストがありません。授業の画面の「問題を作る」で作れます。</p></div>`;
  // 全体のまとめ
  const all = courses.flatMap((x) => x.list);
  const sum = (k) => all.reduce((n, z) => n + (z[k] ?? 0), 0);
  const total = {count: sum('count'), tries: sum('tries'), correct: sum('correct'), wrong: sum('wrong')};
  const summary = `<div class="qz-hub__sum">
      <div><b>${courses.length}</b><span>授業</span></div>
      <div><b>${all.length}</b><span>テスト</span></div>
      <div><b>${total.count}</b><span>問題</span></div>
      <div><b>${pct(total.correct, total.tries) ?? '—'}${total.tries ? '%' : ''}</b><span>正答率</span></div>
      <div><b>${total.wrong}</b><span>苦手</span></div>
    </div>`;
  const sections = courses
    .map(({c, list}) => {
      const t = {
        count: list.reduce((n, z) => n + z.count, 0),
        tries: list.reduce((n, z) => n + (z.tries ?? 0), 0),
        correct: list.reduce((n, z) => n + (z.correct ?? 0), 0),
        wrong: list.reduce((n, z) => n + (z.wrong ?? 0), 0),
        last: list
          .map((z) => z.last_at)
          .filter(Boolean)
          .sort()
          .at(-1)
      };
      const ids = list.map((z) => z.id).join(',');
      const q = (mode) => `/quiz?course=${esc(c.id)}&quizzes=${esc(ids)}&mode=${mode}&back=quizzes`;
      const rows = list
        .map((z) => {
          const rate = pct(z.correct ?? 0, z.tries ?? 0);
          return `<tr>
            <th scope="row">${esc(quizName(z))}</th>
            <td>${z.count} 問</td>
            <td>${rateBar(rate)}</td>
            <td>${z.answered ?? 0} / ${z.count}</td>
            <td>${z.wrong ? `<b class="qz-hub__wrong">${z.wrong}</b>` : '0'}</td>
            <td>${lastDay(z.last_at)}</td>
            <td class="qz-hub__acts"><button class="btn btn--small btn--primary" data-action="nav" data-route="/quiz?course=${esc(c.id)}&quizzes=${esc(z.id)}&mode=quiz&back=quizzes">解く</button>${z.wrong ? `<button class="btn btn--small" data-action="nav" data-route="/quiz?course=${esc(c.id)}&quizzes=${esc(z.id)}&mode=retry&back=quizzes">まちがえた問題</button>` : ''}<button class="btn btn--small btn--quiet" data-action="nav" data-route="/quiz-edit/${esc(z.id)}">編集</button>${z.flagged ? `<span class="qcard__flag" title="AI の検算と答えが合わなかった問題">要確認 ${z.flagged}</span>` : ''}</td>
          </tr>`;
        })
        .join('');
      return `<section class="card qz-hub__course">
        <header class="qz-hub__head">
          <h3><button type="button" class="link" data-action="nav" data-route="/course/${esc(c.id)}">${esc(c.name)}</button></h3>
          <span class="muted">${list.length} テスト・${t.count} 問・正答率 ${pct(t.correct, t.tries) ?? '—'}${t.tries ? '%' : ''}${t.wrong ? `・苦手 ${t.wrong} 問` : ''}・最後に解いた日 ${lastDay(t.last)}</span>
          <span class="qz-hub__acts">${list.length > 1 ? `<button class="btn btn--small btn--primary" data-action="nav" data-route="${q('exam')}">全部の回から解く</button>` : ''}${t.wrong ? `<button class="btn btn--small" data-action="nav" data-route="${q('retry')}">苦手な ${t.wrong} 問</button>` : ''}</span>
        </header>
        <div class="qz-hub__scroll"><table class="qz-hub__table">
          <thead><tr><th scope="col">テスト</th><th scope="col">問題</th><th scope="col">正答率</th><th scope="col">解いた問題</th><th scope="col">苦手</th><th scope="col">最後に解いた日</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section>`;
    })
    .join('');
  return `<nav class="page-nav"><h2>クイズ</h2></nav>
    ${review}
    ${summary}
    <p class="muted qz-hub__note">正答率はこれまでに解いた答えのうち正解の割合、苦手は最後に解いたときまちがえた問題の数です。</p>
    ${sections}`;
}

// ---- 問題の編集（SPEC §11.10） ----
let editing = null; // {quizId, questions, loading}

export function renderQuizEdit({data}, quizId) {
  if (!editing || editing.quizId !== quizId) {
    editing = {quizId, loading: true, questions: []};
    api['quiz.questions']({quizIds: [quizId]}).then((r) => {
      editing.questions = r?.error ? [] : r;
      editing.error = r?.error;
      editing.loading = false;
      refresh();
    });
  }
  const quiz = Object.values(data.quizzes ?? {})
    .flat()
    .find((z) => z.id === quizId);
  const back = quiz
    ? `<button class="btn" data-action="nav" data-route="/course/${esc(Object.entries(data.quizzes).find(([, l]) => l.some((z) => z.id === quizId))[0])}">← 授業へ</button>`
    : `<button class="btn" data-action="nav" data-route="/">← ホーム</button>`;
  const head = `<nav class="page-nav">${back}<h2>問題の編集 <span class="muted">${esc(quiz?.title ?? '')}</span></h2></nav>`;
  if (editing.loading) return head + '<p class="muted">読み込んでいます…</p>';
  const items = editing.questions
    .map((q, i) => {
      const rate = q.tries
        ? `正答率 ${Math.round(((q.correct ?? 0) / q.tries) * 100)}%（${q.tries} 回）`
        : 'まだ解いていません';
      const opts =
        q.type === 'choice' || q.type === 'cloze'
          ? q.o
              .map(
                (o, k) =>
                  `<label>誤答 ${k + 1}<input class="input" id="qe-o${k}-${esc(q.id)}" value="${esc(o)}"></label>`
              )
              .join('')
          : '';
      return `<section class="card qedit" data-form="${esc(q.id)}">
        <header class="qedit__head"><strong>${i + 1}. ${esc(TYPE_LABEL[q.type] ?? q.type)}</strong>
          ${q.review === 'mismatch' ? '<span class="qcard__flag">要確認</span>' : ''}${q.report_reason ? `<span class="qcard__flag">報告：${esc(q.report_reason)}</span>` : ''}
          <span class="muted">${rate}${q.src_page ? `・根拠 p.${q.src_page}` : ''}</span></header>
        <label>問題文<textarea class="input" rows="2" id="qe-q-${esc(q.id)}">${esc(q.q)}</textarea></label>
        <label>正解${q.type === 'tf' ? '（○ か ×）' : q.type === 'num' ? `（数値${q.unit ? `・単位 ${esc(q.unit)}` : ''}）` : ''}<input class="input" id="qe-a-${esc(q.id)}" value="${esc(q.a)}"></label>
        ${opts}
        <label>解説<textarea class="input" rows="2" id="qe-n-${esc(q.id)}">${esc(q.n)}</textarea></label>
        ${q.src_quote ? `<blockquote class="qcard__src">「${esc(q.src_quote)}」</blockquote>` : ''}
        <div class="actions">
          <button class="btn btn--primary btn--small" data-action="qe-save" data-id="${esc(q.id)}" data-type="${esc(q.type)}">保存</button>
          ${q.review ? `<button class="btn btn--small" data-action="qe-ok" data-id="${esc(q.id)}">確かめた（要確認を外す）</button>` : ''}
          ${q.report_reason ? `<button class="btn btn--small" data-action="qe-unreport" data-id="${esc(q.id)}">報告を取り消す</button>` : ''}
          <button class="btn btn--small btn--quiet" data-action="qe-delete" data-id="${esc(q.id)}">削除</button>
        </div>
      </section>`;
    })
    .join('');
  return `${head}<div class="qedit-list">${items || '<p class="muted">問題がありません。</p>'}</div>`;
}

export async function quizEditAction(action, el) {
  if (!editing) return false;
  const id = el.dataset.id;
  const $ = (k) => document.getElementById(`qe-${k}-${id}`);
  let patch;
  if (action === 'qe-save') {
    patch = {q: $('q').value, a: $('a').value, n: $('n').value};
    if (el.dataset.type === 'choice' || el.dataset.type === 'cloze')
      patch.o = [0, 1, 2].map((k) => document.getElementById(`qe-o${k}-${id}`).value);
  } else if (action === 'qe-ok') patch = {reviewed: true};
  else if (action === 'qe-unreport') patch = {report: null};
  else if (action === 'qe-delete') {
    if (!(await confirmDialog('この問題を削除しますか？（記録は残ります）', {ok: '削除する', danger: true})))
      return true;
    patch = {deleted: true};
  } else return false;
  const r = await api['question.update']({questionId: id, patch});
  if (r?.error) return (toast(r.error, {error: true}), true);
  editing.questions = patch.deleted
    ? editing.questions.filter((q) => q.id !== id)
    : editing.questions.map((q) => (q.id === id ? {...q, ...r} : q));
  toast(patch.deleted ? '削除しました' : '保存しました');
  refresh();
  return true;
}

export const leaveQuizEdit = () => (editing = null);
