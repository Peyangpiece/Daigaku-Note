// スマホのページ：今日の復習（docs/MOBILE.md §5）。パソコンの「今日の復習」と同じ問題・同じ記録（答えはその場でパソコンへ。次に出る日もパソコンが決める）
import {call} from './client.js';
import {esc, toast} from './ui.js';
import {BLANK, TYPE_LABEL, choicesOf} from '/m/shared/quiz.js';

const questionHtml = (q) => esc(q.q).replace(esc(BLANK), '<span class="m-q__blank">（　　）</span>');

/** 復習を始める。戻りは後片付け */
export async function openReview(app) {
  const {questions, next} = await call('quiz.review');
  const s = {questions, i: 0, results: {}, seed: Date.now() >>> 0, revealed: false, started: Date.now()};
  let gone = false;

  const head = `<header class="m-head"><a class="m-btn" href="#/">← ホーム</a><h1>今日の復習</h1></header>`;

  const render = () => {
    if (gone) return;
    if (!s.questions.length) {
      app.innerHTML = `${head}<div class="m-empty"><p>今日の復習はありません。</p>${next ? `<p class="m-muted">次は ${new Date(next.due).toLocaleDateString('ja-JP', {month: 'numeric', day: 'numeric'})} に ${next.count} 問です。</p>` : ''}<a class="m-btn" href="#/">ホームへ</a></div>`;
      return;
    }
    if (s.i >= s.questions.length) return renderDone();
    const q = s.questions[s.i];
    const res = s.results[q.id];
    app.innerHTML = `${head}
      <article class="m-card m-q${res ? (res.ok ? ' m-q--ok' : ' m-q--ng') : ''}" aria-live="polite">
        <header class="m-q__head"><span>${s.i + 1} / ${s.questions.length}</span><span class="m-sub">${esc(TYPE_LABEL[q.type] ?? q.type)}</span></header>
        <p class="m-q__q">${questionHtml(q)}</p>
        ${res ? feedback(q, res) : answerHtml(q)}
      </article>`;
    bind(q);
  };

  const answerHtml = (q) => {
    if (q.type === 'num')
      return `<form class="m-q__num" data-v="num"><input class="m-input" inputmode="decimal" autocomplete="off" placeholder="数値" aria-label="答え（数値）">${q.unit ? `<span>${esc(q.unit)}</span>` : ''}<button class="m-btn m-btn--primary" type="submit">答える</button></form>`;
    if (q.type === 'card') {
      if (!s.revealed) return `<button class="m-btn m-btn--primary m-btn--wide" data-v="reveal">答えを見る</button>`;
      return `<div class="m-q__answer"><strong>模範解答</strong><p>${esc(q.a)}</p></div>
        <div class="m-row"><button class="m-btn m-btn--wide" data-self="0">まだ</button><button class="m-btn m-btn--primary m-btn--wide" data-self="1">できた</button></div>`;
    }
    const opts = choicesOf(q, (s.seed + s.i * 7919) >>> 0);
    return `<ol class="m-q__choices">${opts.map((o) => `<li><button class="m-choice" data-value="${esc(o)}">${esc(o)}</button></li>`).join('')}</ol>`;
  };

  const feedback = (q, res) => `
    <div class="m-q__feedback" role="status">
      <p class="m-q__verdict">${q.type === 'card' ? (res.ok ? 'できた' : 'まだ（今度また）') : res.ok ? `正解！${res.points ? ` +${res.points} pt` : ''}` : `ざんねん。正解は「${esc(res.a ?? q.a)}${q.unit ? ` ${esc(q.unit)}` : ''}」`}</p>
      ${!res.ok && q.type !== 'card' ? `<p class="m-muted">あなたの答え：${esc(String(res.answer))}</p>` : ''}
      ${q.n ? `<p class="m-q__note">${esc(q.n)}</p>` : ''}
      ${q.src_quote ? `<blockquote class="m-q__src">「${esc(q.src_quote)}」${q.src_page ? `<cite>p.${q.src_page}</cite>` : ''}</blockquote>` : ''}
    </div>
    <button class="m-btn m-btn--primary m-btn--wide" data-v="next">${s.i + 1 < s.questions.length ? '次へ' : '結果を見る'}</button>`;

  const answer = async (q, value) => {
    const seconds = (Date.now() - s.started) / 1000;
    try {
      const r = await call('quiz.answer', {questionId: q.id, answer: value, seconds});
      s.results[q.id] = {...r, answer: value};
    } catch (e) {
      toast(e.message, {error: true});
      return;
    }
    render();
  };

  const bind = (q) => {
    for (const b of app.querySelectorAll('.m-choice')) b.onclick = () => answer(q, b.dataset.value);
    const form = app.querySelector('[data-v="num"]');
    if (form)
      form.onsubmit = (e) => {
        e.preventDefault();
        const v = form.querySelector('input').value.trim();
        if (v) answer(q, v);
      };
    const reveal = app.querySelector('[data-v="reveal"]');
    if (reveal)
      reveal.onclick = () => {
        s.revealed = true;
        render();
      };
    for (const b of app.querySelectorAll('[data-self]')) b.onclick = () => answer(q, b.dataset.self === '1');
    const nx = app.querySelector('[data-v="next"]');
    if (nx)
      nx.onclick = () => {
        s.i++;
        s.revealed = false;
        s.started = Date.now();
        render();
        window.scrollTo(0, 0);
      };
  };

  const renderDone = () => {
    const scored = s.questions.filter((q) => q.type !== 'card');
    const ok = scored.filter((q) => s.results[q.id]?.ok).length;
    const wrong = s.questions.filter((q) => s.results[q.id] && !s.results[q.id].ok);
    app.innerHTML = `${head}
      <section class="m-card"><h2>おつかれさまでした</h2>
        ${scored.length ? `<p class="m-big">${ok} / ${scored.length} 問 正解</p>` : ''}
        <p class="m-muted">結果はパソコンにも記録しました。まちがえた問題は近いうちにまた出ます。</p>
      </section>
      ${wrong.length ? `<section class="m-card"><h2>まちがえた問題</h2><ol class="m-wrong">${wrong.map((q) => `<li><p>${questionHtml(q)}</p><p class="m-muted">正解：${esc(q.a)}${q.unit ? ` ${esc(q.unit)}` : ''}</p></li>`).join('')}</ol></section>` : ''}
      <a class="m-btn m-btn--wide" href="#/">ホームへ</a>`;
  };

  render();
  return () => {
    gone = true;
  };
}
