// クイズの画面（SPEC §11.7・§11.10）。単語カードのような 1 問 1 枚。答えるとすぐ正誤・解説・根拠を出し、終わったら結果。
// 経路：#/quizzes（クイズの一覧。上の「クイズ」）／ #/quiz?course=<授業>&quizzes=<id,id>&mode=quiz|exam|retry|card|review ／
//   #/review（今日の復習）／ #/quiz-edit/<quizId>。一覧から開いたクイズは back=quizzes で、戻ると一覧へ
// カテキョにならう：選択肢の並びは解くたびに変わる seed で決める、正解でも解説を出す、半分未満ならカードで覚えるを主に、途中でやめても続きから
import {confirmDialog, esc, toast} from '../ui-kit.js';
import {navigate, refresh, reload, state} from '../store.js';
import {BLANK, TYPE_LABEL, choicesOf, norm} from '../../shared/quiz.js';

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
  // 見出し：どの授業の何回か（v0.17.5）。今日の復習・まちがえた問題などは、その印を添える
  const title = quizTitle(s, data, course);
  const head = `<nav class="page-nav">${back}<h2>${esc(title.main)}${title.sub ? ` <span class="quiz-mode">${esc(title.sub)}</span>` : ''}</h2></nav>`;
  const stage = (html) => `<div class="quiz-stage">${html}</div>`;
  if (s.loading) return stage(head + `<p class="muted">問題を読み込んでいます…</p>`);
  if (s.error) return stage(head + `<div class="card"><p>${esc(s.error)}</p></div>`);
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
    return stage(head + `<div class="empty"><p>${esc(msg)}</p>${go}</div>`);
  }
  if (s.i >= s.questions.length) return stage(head + renderResult(s, course, data));
  const q = s.questions[s.i];
  const res = s.results[q.id];
  const n = s.questions.length;
  // 進み具合：帯と「2 / 5」（答えたら、その問題までを進んだことにする）
  const done = s.i + (res ? 1 : 0);
  const progress = `<div class="quiz-progress-row"><div class="quiz-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${done}" aria-label="${s.i + 1} 問目／全 ${n} 問"><span style="width:${(done / n) * 100}%"></span></div><span class="quiz-progress__n">${s.i + 1} / ${n}</span></div>`;
  // 今日の復習は授業が混ざるので、問題ごとに授業名を出す
  const from =
    s.mode === 'review' ? data.courses.find((c) => (data.quizzes?.[c.id] ?? []).some((z) => z.id === q.quiz_id)) : null;
  const keys = keyHint(q, s, res);
  return stage(`${head}
    ${progress}
    <article class="qcard${res ? (res.ok ? ' qcard--ok' : ' qcard--ng') : ''}" aria-live="polite">
      <span class="qcard__hole" aria-hidden="true"></span>
      <header class="qcard__head"><span class="qcard__type">${esc(TYPE_LABEL[q.type] ?? q.type)}</span>${from ? `<span>${esc(from.name)}</span>` : ''}</header>
      <p class="qcard__q">${questionHtml(q, res)}</p>
      ${res ? feedbackHtml(q, res, data) : answerHtml(q, s)}
    </article>
    ${keys ? `<p class="muted quiz-keys">${keys}</p>` : ''}`);
}

/** 見出し：授業名と回（1 回分のとき）。モードの名前は添え書き。今日の復習は「今日の復習」 */
function quizTitle(s, data, course) {
  if (s.mode === 'review') return {main: MODE_LABEL.review, sub: ''};
  const ids = [...new Set((s.questions ?? []).map((q) => q.quiz_id))];
  const z = ids.length === 1 ? (data.quizzes?.[s.courseId] ?? []).find((x) => x.id === ids[0]) : null;
  const main = [course?.name, z ? quizName(z) : ids.length > 1 ? '全部の回' : ''].filter(Boolean).join('　');
  return {main: main || MODE_LABEL[s.mode] || 'クイズ', sub: s.mode === 'quiz' || !main ? '' : MODE_LABEL[s.mode]};
}

/** キー操作の案内（選択肢の数に合わせる。答えたあと・カードを開いたあとは Enter で次へ） */
function keyHint(q, s, res) {
  if (res) return 'Enter で次へ';
  if (q.type === 'num') return 'Enter で答える';
  if (q.type === 'card') return s.revealed ? '' : 'Space で答えを見る';
  if (q.type === 'tf') return '1（○）・2（×）キーでも選べます';
  return `1〜${choicesOf(q).length} キーでも選べます`;
}

/** 問題文。穴埋めは答えたら空欄に正解を入れて見せる */
const questionHtml = (q, res = null) =>
  esc(q.q).replace(
    esc(BLANK),
    res && q.type === 'cloze'
      ? `<span class="qcard__blank qcard__blank--filled">${esc(q.a)}</span>`
      : '<span class="qcard__blank">（　　）</span>'
  );

function answerHtml(q, s) {
  if (q.type === 'num')
    return `<form class="qcard__num" data-quiz-num><label class="sr-only" for="quiz-num">答え（数値）</label><input class="input" id="quiz-num" inputmode="decimal" autocomplete="off" data-keep="off" placeholder="数値">${q.unit ? `<span>${esc(q.unit)}</span>` : ''}<button class="btn btn--primary" type="submit">答える</button></form>`;
  if (q.type === 'card') {
    if (!s.revealed)
      return `<div class="qcard__actions"><button class="btn btn--primary" data-action="quiz-reveal">答えを見る</button></div>`;
    return `<div class="qcard__answer"><strong>模範解答</strong><p>${esc(q.a)}</p></div>
      <div class="qcard__actions"><button class="btn" data-action="quiz-self" data-ok="0">言えなかった</button><button class="btn btn--primary" data-action="quiz-self" data-ok="1">言えた</button></div>`;
  }
  const opts = choicesOf(q, seedOf(s));
  // 正誤は ○・× の大きな 2 つのボタンを左右に
  if (q.type === 'tf')
    return `<ol class="qcard__choices qcard__choices--tf">${opts.map((o, k) => `<li><button class="choice choice--tf" data-action="quiz-choose" data-value="${esc(o)}" aria-label="${o === '○' ? '正しい（○）' : 'まちがい（×）'}"><span class="choice__key">${k + 1}</span><span class="choice__mark">${esc(o)}</span></button></li>`).join('')}</ol>`;
  return `<ol class="qcard__choices">${opts.map((o, k) => `<li><button class="choice" data-action="quiz-choose" data-value="${esc(o)}"><span class="choice__key">${k + 1}</span>${esc(o)}</button></li>`).join('')}</ol>`;
}

const seedOf = (s) => (s.seed + s.i * 7919) >>> 0;

/**
 * 答えたあとの選択肢：並びはそのままで、正解に ✓、選んだ誤答に ✕。誤答ごとの「なぜ違うか」はその選択肢の下に（v0.17.5）
 */
function choicesDoneHtml(q, res, s) {
  const opts = choicesOf(q, seedOf(s));
  const mine = res.answer !== undefined ? norm(res.answer) : null;
  const whyOf = (o) => q.why?.[(q.o ?? []).indexOf(o)] ?? '';
  return `<ol class="qcard__choices qcard__choices--done${q.type === 'tf' ? ' qcard__choices--tf' : ''}">${opts
    .map((o) => {
      const ok = norm(o) === norm(q.a);
      const picked = norm(o) === mine;
      const cls = ok ? ' choice--ok' : picked ? ' choice--ng' : '';
      const tag = ok ? (picked ? 'あなたの答え・正解' : '正解') : picked ? 'あなたの答え' : '';
      const why = !ok ? whyOf(o) : '';
      return `<li><div class="choice choice--done${q.type === 'tf' ? ' choice--tf' : ''}${cls}"><span class="choice__key" aria-hidden="true">${ok ? '✓' : picked ? '✕' : ''}</span><span class="choice__body">${q.type === 'tf' ? `<span class="choice__mark">${esc(o)}</span>` : esc(o)}${tag ? `<em class="choice__tag">${tag}</em>` : ''}${why ? `<small class="choice__why">${esc(why)}</small>` : ''}</span></div></li>`;
    })
    .join('')}</ol>`;
}

function feedbackHtml(q, res, data, s = session) {
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
  // 選ぶ問題は選択肢に正解・自分の答えを印で示す。数値は「正解／あなた」、記述カードは模範解答
  const choose = ['choice', 'cloze', 'tf'].includes(q.type);
  return `<div class="qcard__feedback" role="status">
      <p class="qcard__verdict">${verdict}</p>
      ${
        choose
          ? choicesDoneHtml(q, res, s)
          : q.type === 'card'
            ? `<div class="qcard__answer"><strong>模範解答</strong><p>${esc(q.a)}</p></div>`
            : `<dl class="qcard__answers"><dt>正解</dt><dd>${esc(answer)}</dd>${!res.ok && mine !== null ? `<dt>あなた</dt><dd>${esc(mine)}</dd>` : ''}</dl>`
      }
      ${q.review === 'mismatch' ? '<p class="qcard__caution">この問題の答えは、確かめきれていません。おかしいときは「問題を報告」から知らせてください。</p>' : ''}
      <section class="qcard__explain" aria-label="解説">
        <h4>解説</h4>
        <p>${esc(q.n)}</p>
        ${q.src_quote ? `<blockquote class="qcard__src">「${esc(q.src_quote)}」<cite>${mat ? `<button type="button" class="link" data-action="open-material" data-id="${esc(mat.id)}">${esc(mat.name)}${q.src_page ? ` p.${q.src_page}` : ''}</button>` : `資料${q.src_page ? ` p.${q.src_page}` : ''}`}</cite></blockquote>` : ''}
      </section>
      ${askHtml(q, data)}
    </div>
    <div class="qcard__actions qcard__actions--next">
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

function renderResult(s, course, data) {
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
  const tone = !scored.length ? 'none' : pct >= 80 ? 'good' : pct >= 50 ? 'mid' : 'low';
  const wrong = s.questions.filter((q) => s.results[q.id] && !s.results[q.id].ok);
  const ids = [...new Set(s.questions.map((q) => q.quiz_id))].join(',');
  const fromList = s.backTo?.route === '/quizzes' ? '&back=quizzes' : '';
  const retryRoute =
    s.mode === 'review' ? '/review' : `/quiz?course=${s.courseId}&quizzes=${ids}&mode=retry${fromList}&r=${Date.now()}`;
  const cardRoute = `/quiz?course=${s.courseId}&quizzes=${ids}&mode=card&only=wrong${fromList}&r=${Date.now()}`;
  // 主のボタンは 1 つだけ：復習の続き → まちがえた問題を解き直す → 戻る
  const retry = wrong.length && s.mode !== 'review';
  const more = s.mode === 'review' && s.rest;
  const backBtn = `<button class="btn${retry || more ? '' : ' btn--primary'}" data-action="nav" data-route="${esc(s.backTo?.route ?? (course ? `/course/${course.id}` : '/'))}">${esc(s.backTo ? `${s.backTo.label}に戻る` : course ? '授業に戻る' : 'ホームへ')}</button>`;
  const matOf = (q) =>
    q.src_sha256
      ? Object.values(data?.materials ?? {})
          .flat()
          .find((m) => m.sha256 === q.src_sha256 && m.status === 'ok')
      : null;
  const wrongItem = (q) => {
    const mine = s.results[q.id].answer !== undefined && q.type !== 'card' ? String(s.results[q.id].answer) : null;
    const mat = matOf(q);
    return `<li>
        <p class="wrong-list__q">${questionHtml(q)}</p>
        <dl class="qcard__answers"><dt>正解</dt><dd>${esc(q.a)}${q.unit ? ` ${esc(q.unit)}` : ''}</dd>${mine !== null ? `<dt>あなた</dt><dd class="wrong-list__mine">${esc(mine)}</dd>` : ''}</dl>
        ${q.n ? `<p class="wrong-list__n">${esc(q.n)}</p>` : ''}
        ${mat ? `<p class="wrong-list__src"><button type="button" class="link" data-action="open-material" data-id="${esc(mat.id)}">${esc(mat.name)}${q.src_page ? ` p.${q.src_page}` : ''}</button></p>` : ''}
      </li>`;
  };
  return `<section class="card quiz-result">
      <div class="ring ring--${tone}" style="--pct:${pct}"><span>${scored.length ? `${pct}%` : '—'}</span></div>
      <div>
        <h3>${scored.length ? `${scored.length} 問中 ${ok} 問 正解` : 'カードを見終わりました'}</h3>
        ${cards.length ? `<p class="muted">記述：言えた ${cards.filter((q) => s.results[q.id]?.ok).length} ／ ${cards.length}</p>` : ''}
        ${more ? `<p class="muted">今日の復習はあと ${s.rest} 問</p>` : ''}
        <div class="actions">
          ${retry ? `<button class="btn btn--primary" data-action="nav" data-route="${esc(retryRoute)}">まちがえた ${wrong.length} 問を解き直す</button>` : ''}
          ${retry && s.courseId ? `<button class="btn" data-action="nav" data-route="${esc(cardRoute)}">カードで覚える</button>` : ''}
          ${more ? `<button class="btn btn--primary" data-action="nav" data-route="/review?r=${Date.now()}">続ける</button>` : ''}
          ${backBtn}
        </div>
      </div>
    </section>
    ${wrong.length ? `<section class="card"><h3>まちがえた問題</h3><ol class="wrong-list">${wrong.map(wrongItem).join('')}</ol></section>` : ''}`;
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
  // 全体：正答率と苦手の数だけを 1 行で（v0.17.5）
  const all = courses.flatMap((x) => x.list);
  const sum = (list, k) => list.reduce((n, z) => n + (z[k] ?? 0), 0);
  const allRate = pct(sum(all, 'correct'), sum(all, 'tries'));
  const allWrong = sum(all, 'wrong');
  const summary =
    allRate === null
      ? ''
      : `<p class="qz-hub__line">正答率 <b>${allRate}%</b>${allWrong ? `・苦手 <b>${allWrong}</b> 問` : ''}</p>`;
  const sections = courses
    .map(({c, list}) => {
      const wrong = sum(list, 'wrong');
      const ids = list.map((z) => z.id).join(',');
      const q = (mode) => `/quiz?course=${esc(c.id)}&quizzes=${esc(ids)}&mode=${mode}&back=quizzes`;
      const one = (z, mode) => `/quiz?course=${esc(c.id)}&quizzes=${esc(z.id)}&mode=${mode}&back=quizzes`;
      const rows = list
        .map((z) => {
          const rate = pct(z.correct ?? 0, z.tries ?? 0);
          return `<tr>
            <th scope="row"><span class="qz-hub__name">${esc(quizName(z))}</span>${z.flagged ? ` <span class="qcard__flag" title="AI の検算と答えが合わなかった問題">要確認 ${z.flagged}</span>` : ''}</th>
            <td data-label="正答率">${rateBar(rate)}</td>
            <td data-label="解いた問題">${z.answered ?? 0} / ${z.count} 問</td>
            <td data-label="苦手">${z.wrong ? `<button type="button" class="link qz-hub__wrong" data-action="nav" data-route="${one(z, 'retry')}" title="まちがえた問題を解き直す">${z.wrong} 問</button>` : '<span class="muted">0</span>'}</td>
            <td data-label="最後に解いた日">${lastDay(z.last_at)}</td>
            <td class="qz-hub__acts"><button class="btn btn--small" data-action="nav" data-route="${one(z, 'quiz')}">解く</button><button class="btn btn--small btn--quiet" data-action="nav" data-route="/quiz-edit/${esc(z.id)}?back=quizzes">編集</button></td>
          </tr>`;
        })
        .join('');
      return `<section class="card qz-hub__course">
        <header class="qz-hub__head">
          <h3><button type="button" class="link" data-action="nav" data-route="/course/${esc(c.id)}">${esc(c.name)}</button></h3>
          <span class="qz-hub__acts">${list.length > 1 ? `<button class="btn btn--small" data-action="nav" data-route="${q('exam')}">全部の回から解く</button>` : ''}${wrong ? `<button class="btn btn--small" data-action="nav" data-route="${q('retry')}">苦手な ${wrong} 問</button>` : ''}</span>
        </header>
        <table class="qz-hub__table">
          <colgroup><col class="qz-hub__c-name"><col class="qz-hub__c-rate"><col class="qz-hub__c-done"><col class="qz-hub__c-wrong"><col class="qz-hub__c-last"><col class="qz-hub__c-acts"></colgroup>
          <thead><tr><th scope="col">テスト</th><th scope="col">正答率</th><th scope="col">解いた問題</th><th scope="col">苦手</th><th scope="col">最後に解いた日</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
    })
    .join('');
  return `<nav class="page-nav"><h2>クイズ</h2></nav>
    ${review}
    ${summary}
    ${sections}`;
}

// ---- 問題の編集（SPEC §11.10） ----
// 変更は欄ごとに覚えておき（描き直しで消えないように）、「変更を保存」でまとめて保存する（v0.17.5）
let editing = null; // {key, quizId, back, questions, loading, drafts: {問題の id: {欄: 値}}}

/** 編集の欄（data-qe="欄" data-id="問題の id"）が変わったら、下書きに覚える（app.js の input から） */
export function quizEditInput(el) {
  if (!editing || !el?.dataset?.qe) return false;
  const d = (editing.drafts[el.dataset.id] ??= {});
  d[el.dataset.qe] = el.value;
  const btn = document.getElementById('qe-save-all');
  if (btn) btn.disabled = false;
  return true;
}

export function renderQuizEdit({data}, route) {
  const [quizId, query = ''] = route.split('?');
  const back = new URLSearchParams(query).get('back');
  if (!editing || editing.key !== route) {
    editing = {
      key: route,
      quizId,
      back,
      loading: true,
      questions: [],
      drafts: (editing?.quizId === quizId ? editing.drafts : null) ?? unsaved.get(quizId) ?? {}
    };
    unsaved.delete(quizId);
    const mine = editing;
    api['quiz.questions']({quizIds: [quizId]}).then((r) => {
      if (editing !== mine) return;
      mine.questions = r?.error ? [] : r;
      mine.error = r?.error;
      mine.loading = false;
      refresh();
    });
  }
  const courseId = Object.entries(data.quizzes ?? {}).find(([, l]) => l.some((z) => z.id === quizId))?.[0];
  const quiz = courseId ? data.quizzes[courseId].find((z) => z.id === quizId) : null;
  const course = data.courses.find((c) => c.id === courseId);
  // 戻る先：クイズの一覧から開いたら一覧、授業から開いたら授業
  const backBtn =
    back === 'quizzes'
      ? `<button class="btn" data-action="nav" data-route="/quizzes">← クイズ</button>`
      : course
        ? `<button class="btn" data-action="nav" data-route="/course/${esc(course.id)}">← ${esc(course.name)}</button>`
        : `<button class="btn" data-action="nav" data-route="/">← ホーム</button>`;
  const dirty = Object.keys(editing.drafts).length > 0;
  const title = [course?.name, quiz ? quizName(quiz) : ''].filter(Boolean).join('　');
  const head = `<nav class="page-nav">${backBtn}<h2>問題の編集${title ? ` <span class="muted">${esc(title)}</span>` : ''}</h2></nav>`;
  // 保存は画面の下に貼り付けた 1 つのボタンで、変えた問題をまとめて保存する
  const bar = `<div class="qedit__bar"><button class="btn btn--primary" id="qe-save-all" data-action="qe-save-all"${dirty ? '' : ' disabled'}>変更を保存</button></div>`;
  if (editing.loading) return head + '<p class="muted">読み込んでいます…</p>';
  if (editing.error) return head + `<div class="card"><p>${esc(editing.error)}</p></div>`;
  const items = editing.questions
    .map((q, i) => {
      const d = editing.drafts[q.id] ?? {};
      const v = (k, base) => esc(d[k] ?? base ?? '');
      const f = (k) => `data-qe="${k}" data-id="${esc(q.id)}"`;
      const rate = q.tries
        ? `正答率 ${Math.round(((q.correct ?? 0) / q.tries) * 100)}%（${q.tries} 回）`
        : 'まだ解いていません';
      const opts =
        q.type === 'choice' || q.type === 'cloze'
          ? `<div class="qedit__opts">${q.o
              .map(
                (o, k) =>
                  `<div class="qedit__opt"><label>誤答 ${k + 1}<input class="input" ${f(`o${k}`)} value="${v(`o${k}`, o)}"></label><label class="qedit__why">違う理由<textarea class="input" rows="2" ${f(`why${k}`)} maxlength="200">${v(`why${k}`, q.why?.[k])}</textarea></label></div>`
              )
              .join('')}</div>`
          : '';
      const answer =
        q.type === 'tf'
          ? `<label>正解<select class="input" ${f('a')}>${['○', '×'].map((x) => `<option value="${x}"${(d.a ?? q.a) === x ? ' selected' : ''}>${x === '○' ? '○（正しい）' : '×（まちがい）'}</option>`).join('')}</select></label>`
          : q.type === 'card'
            ? `<label>模範解答<textarea class="input" rows="3" ${f('a')}>${v('a', q.a)}</textarea></label>`
            : `<label>正解${q.type === 'num' ? `（数値${q.unit ? `・単位 ${esc(q.unit)}` : ''}）` : ''}<input class="input" ${f('a')} value="${v('a', q.a)}"${q.type === 'num' ? ' inputmode="decimal"' : ''}></label>`;
      return `<section class="card qedit">
        <header class="qedit__head"><strong>${i + 1}. ${esc(TYPE_LABEL[q.type] ?? q.type)}</strong>
          ${q.review === 'mismatch' ? '<span class="qcard__flag">要確認</span>' : ''}${q.report_reason ? `<span class="qcard__flag">報告：${esc(q.report_reason)}</span>` : ''}
          <span class="muted">${rate}${q.src_page ? `・根拠 p.${q.src_page}` : ''}</span></header>
        <label>問題文<textarea class="input" rows="2" ${f('q')}>${v('q', q.q)}</textarea></label>
        ${answer}
        ${opts}
        <label>解説<textarea class="input" rows="2" ${f('n')}>${v('n', q.n)}</textarea></label>
        ${q.src_quote ? `<blockquote class="qcard__src">「${esc(q.src_quote)}」</blockquote>` : ''}
        <div class="actions">
          ${q.review ? `<button class="btn btn--small" data-action="qe-ok" data-id="${esc(q.id)}">確かめた（要確認を外す）</button>` : ''}
          ${q.report_reason ? `<button class="btn btn--small" data-action="qe-unreport" data-id="${esc(q.id)}">報告を取り消す</button>` : ''}
          <button class="btn btn--small btn--quiet" data-action="qe-delete" data-id="${esc(q.id)}">削除</button>
        </div>
      </section>`;
    })
    .join('');
  return `${head}<div class="qedit-list">${items || '<p class="muted">問題がありません。</p>'}${items ? bar : ''}</div>`;
}

/** 下書きを、question.update に渡す形にする（変えた欄だけ。誤答・理由は 3 つそろえて渡す） */
function patchOf(q, d) {
  const patch = {};
  for (const k of ['q', 'a', 'n']) if (d[k] !== undefined && d[k] !== q[k]) patch[k] = d[k];
  if ([0, 1, 2].some((k) => d[`o${k}`] !== undefined)) patch.o = q.o.map((o, k) => d[`o${k}`] ?? o);
  if ([0, 1, 2].some((k) => d[`why${k}`] !== undefined))
    patch.why = q.o.map((_, k) => d[`why${k}`] ?? q.why?.[k] ?? '');
  return patch;
}

export async function quizEditAction(action, el) {
  if (!editing) return false;
  if (action === 'qe-save-all') {
    const ids = Object.keys(editing.drafts);
    let saved = 0;
    for (const id of ids) {
      const q = editing.questions.find((x) => x.id === id);
      const patch = q ? patchOf(q, editing.drafts[id]) : {};
      if (!q || !Object.keys(patch).length) {
        delete editing.drafts[id];
        continue;
      }
      const r = await api['question.update']({questionId: id, patch});
      if (r?.error) {
        toast(`${editing.questions.indexOf(q) + 1} 問目：${r.error}`, {error: true});
        refresh();
        return true;
      }
      editing.questions = editing.questions.map((x) => (x.id === id ? {...x, ...r} : x));
      delete editing.drafts[id];
      saved++;
    }
    toast(saved ? `${saved} 問を保存しました` : '変更はありません');
    refresh();
    return true;
  }
  const id = el.dataset.id;
  let patch;
  if (action === 'qe-ok') patch = {reviewed: true};
  else if (action === 'qe-unreport') patch = {report: null};
  else if (action === 'qe-delete') {
    if (!(await confirmDialog('この問題を削除しますか？（記録は残ります）', {ok: '削除する', danger: true})))
      return true;
    patch = {deleted: true};
  } else return false;
  const r = await api['question.update']({questionId: id, patch});
  if (r?.error) return (toast(r.error, {error: true}), true);
  if (patch.deleted) delete editing.drafts[id];
  editing.questions = patch.deleted
    ? editing.questions.filter((q) => q.id !== id)
    : editing.questions.map((q) => (q.id === id ? {...q, ...r} : q));
  toast(patch.deleted ? '削除しました' : '保存しました');
  refresh();
  return true;
}

/** 編集画面を離れる。保存していない変更は授業のテストごとに取っておき、もう一度開くと続きから直せる */
export function leaveQuizEdit() {
  if (editing && Object.keys(editing.drafts).length) {
    unsaved.set(editing.quizId, editing.drafts);
    toast('保存していない変更があります。もう一度開くと続きから直せます');
  }
  editing = null;
}
const unsaved = new Map(); // テストの id → 下書き
