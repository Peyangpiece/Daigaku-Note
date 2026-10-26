// クイズの画面（SPEC §11.7・§11.10）。単語カードのような 1 問 1 枚。答えるとすぐ正誤・解説・根拠を出し、終わったら結果。
// 経路：#/quiz?course=<授業>&quizzes=<id,id>&mode=quiz|exam|retry|card|review ／ #/review（今日の復習）／ #/quiz-edit/<quizId>
// カテキョにならう：選択肢の並びは解くたびに変わる seed で決める、正解でも解説を出す、半分未満ならカードで覚えるを主に、途中でやめても続きから
import {confirmDialog, esc, toast} from '../ui-kit.js';
import {navigate, refresh, reload, state} from '../store.js';
import {BLANK, TYPE_LABEL, choicesOf} from '../../shared/quiz.js';

const api = window.daigaku;
const MODE_LABEL = {
  quiz: 'クイズ',
  exam: '試験前',
  retry: 'まちがえた問題',
  card: 'カードで覚える',
  review: '今日の復習'
};
const REPORTS = ['答えがまちがっている', '問題文がおかしい', '資料にない内容', '選択肢がおかしい'];
const SAVE_KEY = 'dn.quiz.session';

let session = null; // {key, mode, title, courseId, questions, i, results: {qid: {ok, answer}}, revealed, seed, startedAt, loading, error}

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
  const back = course
    ? `<button class="btn" data-action="quiz-quit" data-route="/course/${esc(course.id)}">← ${esc(course.name)}</button>`
    : `<button class="btn" data-action="quiz-quit" data-route="/">← ホーム</button>`;
  const head = `<nav class="page-nav">${back}<h2>${esc(MODE_LABEL[s.mode] ?? 'クイズ')}</h2></nav>`;
  if (s.loading) return head + `<p class="muted">問題を読み込んでいます…</p>`;
  if (s.error) return head + `<div class="card"><p>${esc(s.error)}</p></div>`;
  if (!s.questions.length) {
    const msg =
      s.mode === 'review'
        ? `今日の復習はありません。${s.next ? `次は ${new Date(s.next.due).toLocaleDateString('ja-JP', {month: 'numeric', day: 'numeric'})} に ${s.next.count} 問です。` : ''}`
        : s.mode === 'retry'
          ? 'まちがえた問題はありません。'
          : 'まだ問題がありません。授業やフォルダの画面にある「資料からクイズを作る」で作れます（先に 設定 → クイズ で Claude API キーを入れます）。';
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
    ${s.resumed && s.i > 0 && !res ? '<p class="muted">前回の続きから解いています。</p>' : ''}
    ${progress}
    <article class="qcard${res ? (res.ok ? ' qcard--ok' : ' qcard--ng') : ''}" aria-live="polite">
      <span class="qcard__hole" aria-hidden="true"></span>
      <header class="qcard__head"><span>${s.i + 1} / ${s.questions.length}</span><span class="qcard__type">${esc(TYPE_LABEL[q.type] ?? q.type)}</span>${q.review === 'mismatch' ? '<span class="qcard__flag" title="AI がもう一度解いた答えと合わなかった問題です。答えを確かめてください">要確認</span>' : ''}</header>
      <p class="qcard__q">${questionHtml(q)}</p>
      ${res ? feedbackHtml(q, res, data) : answerHtml(q, s)}
    </article>
    ${res ? '' : `<p class="muted quiz-keys">${q.type === 'num' ? 'Enter で答える' : q.type === 'card' ? 'Space で答えを見る' : '数字キー 1〜4 で選べます'}</p>`}`;
}

const questionHtml = (q) => esc(q.q).replace(esc(BLANK), '<span class="qcard__blank">（　　）</span>');

function answerHtml(q, s) {
  if (q.type === 'num')
    return `<form class="qcard__num" data-quiz-num><label class="sr-only" for="quiz-num">答え（数値）</label><input class="input" id="quiz-num" inputmode="decimal" autocomplete="off" data-keep="off" placeholder="数値">${q.unit ? `<span>${esc(q.unit)}</span>` : ''}<button class="btn btn--primary" type="submit">答える</button></form>`;
  if (q.type === 'card') {
    if (!s.revealed)
      return `<div class="qcard__actions"><button class="btn btn--primary" data-action="quiz-reveal">答えを見る</button></div>`;
    return `<div class="qcard__answer"><strong>模範解答</strong><p>${esc(q.a)}</p></div>
      <p class="muted">思い出せましたか？</p>
      <div class="qcard__actions"><button class="btn" data-action="quiz-self" data-ok="0">まだ</button><button class="btn btn--primary" data-action="quiz-self" data-ok="1">できた</button></div>`;
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
  return `<div class="qcard__feedback" role="status">
      <p class="qcard__verdict">${q.type === 'card' ? (res.ok ? 'できた' : 'まだ（今度また）') : res.ok ? `正解！${res.points ? `<span class="qcard__points">+${res.points} pt</span>` : ''}` : `ざんねん。正解は「${esc(answer)}」`}</p>
      ${!res.ok && q.type !== 'card' && res.answer !== undefined ? `<p class="muted">あなたの答え：${esc(String(res.answer))}</p>` : ''}
      <p class="qcard__note">${esc(q.n)}</p>
      ${q.src_quote ? `<blockquote class="qcard__src">「${esc(q.src_quote)}」<cite>${mat ? esc(mat.name) : '資料'}${q.src_page ? ` p.${q.src_page}` : ''}</cite></blockquote>` : ''}
    </div>
    <div class="qcard__actions">
      ${mat ? `<button class="btn btn--quiet" data-action="open-material" data-id="${esc(mat.id)}">資料を開く</button>` : ''}
      <details class="qcard__report"><summary class="muted">おかしい問題を報告</summary>${REPORTS.map((r) => `<button class="btn btn--small" data-action="quiz-report" data-reason="${esc(r)}">${esc(r)}</button>`).join(' ')}<p class="muted">報告した問題は復習に出しません（外部には送りません）。</p></details>
      <span style="margin-left:auto"></span>
      <button class="btn btn--primary" data-action="quiz-next" id="quiz-next">${session.i + 1 >= session.questions.length ? '結果を見る' : '次へ'}</button>
    </div>`;
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
    s.mode === 'review' ? '/review' : `/quiz?course=${s.courseId}&quizzes=${ids}&mode=retry&r=${Date.now()}`;
  const cardRoute = `/quiz?course=${s.courseId}&quizzes=${ids}&mode=card&only=wrong&r=${Date.now()}`;
  return `<section class="card quiz-result">
      <div class="ring" style="--pct:${pct}"><span>${scored.length ? `${pct}%` : '—'}</span></div>
      <div>
        <h3>${scored.length ? `${scored.length} 問中 ${ok} 問 正解` : 'カードで覚えました'}</h3>
        ${cards.length ? `<p class="muted">記述カード：できた ${cards.filter((q) => s.results[q.id]?.ok).length} ／ ${cards.length}（自己採点。点数には入れません）</p>` : ''}
        ${s.mode === 'review' && s.rest ? `<p class="muted">今日の復習はあと ${s.rest} 問あります。</p>` : ''}
        <div class="actions">
          ${wrong.length && s.mode !== 'review' ? `<button class="btn ${low ? '' : 'btn--primary'}" data-action="nav" data-route="${esc(retryRoute)}">まちがえた ${wrong.length} 問だけ解き直す</button>` : ''}
          ${wrong.length && s.mode !== 'review' && s.courseId ? `<button class="btn ${low ? 'btn--primary' : ''}" data-action="nav" data-route="${esc(cardRoute)}">まちがえた ${wrong.length} 問をカードで覚える</button>` : ''}
          ${s.mode === 'review' && s.rest ? `<button class="btn btn--primary" data-action="nav" data-route="/review?r=${Date.now()}">続けて復習する</button>` : ''}
          <button class="btn" data-action="nav" data-route="${esc(course ? `/course/${course.id}` : '/')}">${course ? '授業へ戻る' : 'ホームへ'}</button>
        </div>
      </div>
    </section>
    ${wrong.length ? `<section class="card"><h3>まちがえた問題</h3><ol class="wrong-list">${wrong.map((q) => `<li><p>${questionHtml(q)}</p><p class="muted">正解：${esc(q.a)}${q.unit ? ` ${esc(q.unit)}` : ''}${s.results[q.id].answer !== undefined && q.type !== 'card' ? `／あなた：${esc(String(s.results[q.id].answer))}` : ''}</p></li>`).join('')}</ol></section>` : ''}`;
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
    answer: value === true ? 'できた' : value === false ? 'まだ' : value,
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
    toast('報告しました。この問題は復習に出しません（授業画面の「編集」で直せます）');
  } else if (action === 'quiz-quit') {
    const left = session.questions.length - session.i;
    if (!session.done && session.i > 0 && left > 0)
      toast(`ここまでの答えは記録しました。あと ${left} 問は、同じクイズを開くと続きから解けます`);
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

/** 数値の答え（フォームの送信） */
export function quizSubmitNum(form) {
  const v = form.querySelector('input').value.trim();
  if (!v) return toast('数値を入れてください', {error: true});
  submit(v);
}

/** 経路が変わったら（クイズ画面を離れたら）片付ける */
export const leaveQuiz = () => (session = null);

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
