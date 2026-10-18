// 授業画面（SPEC §8.2）：回ごとの付箋に、資料がイラスト付きの紙で貼ってある。M0 は一覧と開くだけ（ドラッグ・クイズは M1・M3）。
import {esc, jaWrap, progressText} from '../app.js';
import {fileArt} from './file-art.js';

const fmtDate = (d) =>
  d
    ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${'日月火水木金土'[new Date(d + 'T00:00:00').getDay()]}）`
    : '';

// shared/ids.js の hash32 と同じ（レンダラは main のモジュールを読まないので写す）。付箋ごとの小さな傾き
function hash32(str) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(str)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const tilt = (id) => ((hash32(id) % 7) - 3) * 0.5; // -1.5 〜 +1.5 度

function fileCard(m, course) {
  const ok = m.status === 'ok';
  const unread = !m.read_at && ok;
  return `<div class="file${ok ? '' : ' file--missing'}">
    <button class="file__open" data-action="open-material" data-id="${esc(m.id)}" ${ok ? '' : 'disabled'} title="${esc(m.name)}${ok ? '' : '（見つかりません）'}">
      ${fileArt(m.name)}
      ${unread ? `<span class="file__dot" style="--dot-color: var(--c${course.color})" aria-hidden="true"></span><span class="sr-only">未読</span>` : ''}
      <span class="file__name">${esc(m.name)}</span>
      ${m.source === 'notice' ? '<span class="file__tag">お知らせ</span>' : ''}
      ${ok ? '' : '<span class="file__tag">見つかりません</span>'}
    </button>
    <button class="file__reveal" data-action="reveal-material" data-id="${esc(m.id)}" title="${esc(m.name)} をフォルダで表示">📁 フォルダで表示</button>
  </div>`;
}

// これからの回で資料がまだないものは、見出しだけの小さな付箋にする（資料のある回を埋もれさせない）
// 授業のテスト（回をまたいだ試験前のテスト・まちがえた問題・まとめて作る）
function testPanel(course, quizzes, canMake, hasKey) {
  const ready = quizzes.filter((z) => z.count > 0);
  const total = ready.reduce((a, z) => a + z.count, 0);
  const tries = ready.reduce((a, z) => a + (z.tries ?? 0), 0);
  const correct = ready.reduce((a, z) => a + (z.correct ?? 0), 0);
  const all = ready.map((z) => z.id).join(',');
  const roundName = (z) => (z.round_number === 0 ? 'その他' : `第${z.round_number}回`);
  const make =
    canMake.length && hasKey
      ? `<button class="btn btn--small" data-action="quiz-generate" data-rounds="${esc(canMake.map((r) => r.id).join(','))}">資料のある ${canMake.length} 回分のクイズをまとめて作る</button>`
      : '';
  if (!ready.length)
    return `<section class="test-panel"><h3>この授業のテスト</h3>
      <p class="muted">${hasKey ? '回ごとの付箋の「この回の資料からクイズを作る」か、まとめて作るとテストができます。' : 'クイズを作るには Claude API キーが必要です。<button class="btn btn--small" data-action="nav" data-route="/settings">設定 → クイズ</button>'}</p>${make ? `<div class="actions">${make}</div>` : ''}</section>`;
  return `<section class="test-panel"><h3>この授業のテスト</h3>
    <p class="muted">${ready.length} 回分・${total} 問${tries ? `・これまでの正答率 ${Math.round((correct / tries) * 100)}%` : ''}</p>
    <div class="actions">
      <button class="btn btn--primary" data-action="nav" data-route="/quiz?course=${esc(course.id)}&quizzes=${esc(all)}&mode=exam">全部の回からテスト</button>
      <button class="btn" data-action="nav" data-route="/quiz?course=${esc(course.id)}&quizzes=${esc(all)}&mode=retry">まちがえた問題だけ</button>
      ${make}
    </div>
    <details class="test-panel__range"><summary>回を選んでテスト</summary>
      <div class="test-panel__rounds">${ready.map((z) => `<label><input type="checkbox" name="quiz-range" value="${esc(z.id)}" checked> ${esc(roundName(z))} <span class="muted">${z.count} 問</span></label>`).join('')}</div>
      <button class="btn btn--small" data-action="quiz-range" data-course-id="${esc(course.id)}">選んだ回でテスト</button>
    </details>
  </section>`;
}

// 回のクイズの行（SPEC §8.2「クイズ」）：作った問題の数・正答率・要確認と「解く」「作り直す」「編集」。資料があってクイズがなければ「作る」
function quizLine(round, list, course, quiz, gen, hasKey) {
  const extractable = list.some((m) => m.status === 'ok' && /\.(pdf|docx|pptx|txt|md)$/i.test(m.name));
  if (gen)
    return `<div class="round-quiz round-quiz--busy" role="status">${gen.state === 'failed' ? `<span>クイズを作れませんでした：${esc(gen.message)}</span> <button class="btn btn--small" data-action="quiz-generate" data-rounds="${esc(round.id)}">もう一度</button>` : `<span class="spinner" aria-hidden="true"></span><span>${esc(gen.message)}</span>`}</div>`;
  if (quiz) {
    const rate = quiz.tries ? `正答率 ${Math.round(((quiz.correct ?? 0) / quiz.tries) * 100)}%` : 'まだ解いていません';
    return `<div class="round-quiz">
      <span class="round-quiz__info">クイズ ${quiz.count} 問・${rate}${quiz.flagged ? `・<strong>要確認 ${quiz.flagged}</strong>` : ''}</span>
      <span class="round-quiz__btns">
        <button class="btn btn--small btn--primary" data-action="nav" data-route="/quiz?course=${esc(course.id)}&quizzes=${esc(quiz.id)}&mode=quiz">解く</button>
        <button class="btn btn--small btn--quiet" data-action="nav" data-route="/quiz-edit/${esc(quiz.id)}">編集</button>
        ${hasKey && extractable ? `<button class="btn btn--small btn--quiet" data-action="quiz-generate" data-rounds="${esc(round.id)}" title="資料から作り直します（前の版の記録は残ります）">作り直す</button>` : ''}
      </span></div>`;
  }
  if (!extractable) return '';
  return `<div class="round-quiz">${hasKey ? `<button class="btn btn--small" data-action="quiz-generate" data-rounds="${esc(round.id)}">この回の資料からクイズを作る</button>` : '<span class="muted">クイズを作るには Claude API キーが必要です（設定 → クイズ）</span>'}</div>`;
}

function roundNote(round, list, course, today, quizzes = {}) {
  const isToday = round.date === today;
  const upcoming = !list.length && round.number > 0 && round.date && round.date > today;
  const head = round.number === 0 ? 'その他' : `第${round.number}回`;
  const title = round.title_user || round.title || '';
  const cls = [
    'round-note',
    list.length ? '' : 'round-note--empty',
    upcoming ? 'round-note--upcoming' : '',
    isToday ? 'round-note--today' : ''
  ]
    .filter(Boolean)
    .join(' ');
  return `<section class="${cls}" style="--tilt: ${tilt(round.id)}deg; --note-color: var(--c${course.color})" aria-label="${esc(head)} ${esc(title)}${isToday ? '（今日）' : ''}"${isToday ? ' data-scroll-into-view' : ''}>
    <header class="round-note__head">
      <span class="round-note__round">${esc(head)}</span>
      <span class="round-note__title">${esc(title)}</span>
      ${isToday ? '<span class="round-note__today">今日</span>' : ''}
      <span class="round-note__date">${esc(fmtDate(round.date))}</span>
    </header>
    ${list.length ? `<div class="round-note__files">${list.map((m) => fileCard(m, course)).join('')}</div>` : upcoming ? '' : `<p class="round-note__none">まだ資料はありません</p>`}
    ${quizLine(round, list, course, quizzes.byRound?.get(round.id), quizzes.gen?.[round.id], quizzes.hasKey)}
  </section>`;
}

export function renderCourse({data, progress}, courseId) {
  const course = data.courses.find((c) => c.id === courseId);
  if (!course)
    return `<div class="card"><p>授業が見つかりません。</p><button class="btn" data-action="nav" data-route="/">ホームへ</button></div>`;
  const rounds = (data.rounds[courseId] ?? [])
    .slice()
    .sort((a, b) => (a.number === 0 ? 1 : b.number === 0 ? -1 : a.number - b.number));
  const materials = (data.materials[courseId] ?? []).filter((m) => m.status !== 'trashed');
  const byRound = new Map(rounds.map((r) => [r.id, materials.filter((m) => m.round_id === r.id)]));
  const today = new Date().toLocaleDateString('sv-SE');
  const slot = course.weekday ? `（${course.weekday}曜${course.period ? ` ${course.period}限` : ''}）` : '';
  // 「その他」は資料があるときだけ出す。回は資料の有無にかかわらず全部出す（空の付箋も並ぶ）
  const shown = rounds.filter((r) => r.number > 0 || byRound.get(r.id)?.length);
  const syncing = !!progress || (data.jobs ?? []).some((j) => j.kind === 'sync');
  const running = (data.jobs ?? []).some((j) => j.kind === 'sync' && j.status === 'running');
  const quizzes = data.quizzes?.[courseId] ?? [];
  const quizInfo = {
    byRound: new Map(quizzes.map((z) => [z.round_id, z])),
    gen: data.quiz?.generating ?? {},
    hasKey: !!data.quiz?.key?.set
  };
  const canMake = shown.filter(
    (r) =>
      !quizInfo.byRound.has(r.id) &&
      (byRound.get(r.id) ?? []).some((m) => m.status === 'ok' && /\.(pdf|docx|pptx|txt|md)$/i.test(m.name))
  );
  const status = progress
    ? progressText(progress)
    : running
      ? '同期しています…'
      : syncing
        ? '同期の順番を待っています…'
        : '';
  return `
    <nav class="page-nav">
      <button class="btn" data-action="nav" data-route="/">← ホーム</button>
      <h2 class="ja-wrap">${jaWrap(course.name)} <span class="muted">${esc(slot)}</span></h2>
    </nav>
    <div class="course-actions">
      <button class="btn btn--primary" data-action="sync" data-course-id="${esc(courseId)}" ${syncing ? 'disabled' : ''}>${syncing ? '同期中…' : 'この授業を同期'}</button>
      <button class="btn btn--quiet" data-action="sync" data-course-id="${esc(courseId)}" data-full="1" ${syncing ? 'disabled' : ''} aria-describedby="full-help">過去の回も全部確かめる</button>
      ${course.lms_url ? `<button class="btn btn--quiet" data-action="open-external" data-url="${esc(course.lms_url)}">LMS で開く</button>` : ''}
      <span class="muted" id="sync-status" role="status">${esc(status)}</span>
    </div>
    <p class="muted course-help" id="full-help">ふだんの同期は今日の前後 7 日の回だけを見ます。前の回の資料が足りないときは「過去の回も全部確かめる」を押してください（数分かかります）。</p>
    ${testPanel(course, quizzes, canMake, quizInfo.hasKey)}
    ${
      shown.length
        ? `<div class="round-notes">${shown.map((r) => roundNote(r, byRound.get(r.id) ?? [], course, today, quizInfo)).join('')}</div>`
        : `<div class="empty"><p>まだ回がありません。同期すると、回ごとの付箋がここに並びます。</p></div>`
    }`;
}
