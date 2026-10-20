// 授業画面（SPEC §8.2）：回ごとの付箋に、資料がイラスト付きの紙で貼ってある。
// 自分のファイルは「自分の付箋」に入り、ドラッグか「移す」で回の付箋へ振り分ける（回に入れた資料はその回のクイズの材料になる）。
import {esc, jaWrap, progressText} from '../app.js';
import {extOf, fileArt} from './file-art.js';

const fmtDate = (d) =>
  d
    ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${'日月火水木金土'[new Date(d + 'T00:00:00').getDay()]}）`
    : '';

// shared/rounds.js の weekStart・orderRounds と同じ（レンダラは main のモジュールを読まないので写す。テストは shared のほう）
/** その日を含む週の月曜（'YYYY-MM-DD'） */
function weekStart(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * 授業画面の付箋の並び。今週（月〜日）の回を先頭（左上）に、そのあとの回を順に、前の回は第 1 回から順に後ろへ。「その他」（第 0 回）は最後。
 * 今週に回がなければ次の回が先頭。学期が終わっていれば全部が前の回（第 1 回から）。日付のある回がなければ回の順のまま
 * @returns {{current: object[], past: object[], other: object[]}}
 */
function orderRounds(rounds, today) {
  const numbered = rounds.filter((r) => r.number > 0).sort((a, b) => a.number - b.number);
  const other = rounds.filter((r) => r.number === 0);
  if (!numbered.some((r) => r.date)) return {current: numbered, past: [], other};
  const monday = weekStart(today);
  let i = numbered.findIndex((r) => r.date && r.date >= monday);
  if (i < 0) i = numbered.length;
  return {current: numbered.slice(i), past: numbered.slice(0, i), other};
}

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

const EXTRACTABLE = /\.(pdf|docx|pptx|txt|md)$/i;
const placeName = (r) => (r ? (r.number === 0 ? 'その他' : `第${r.number}回`) : '自分の付箋');

// places：移せる先（自分の付箋と回）。資料の紙はドラッグで別の付箋へ移せる。キーボードでは「移す」の選択で
export function fileCard(m, course, places) {
  const ok = m.status === 'ok';
  const unread = !m.read_at && ok;
  const here = m.round_id ?? 'own';
  const move = ok && places.length
    ? `<select class="file__move" data-move-material="${esc(m.id)}" aria-label="${esc(m.name)} を別の付箋へ移す">
        <option value="">移す…</option>
        ${places
          .filter((p) => p.value !== here)
          .map((p) => `<option value="${esc(p.value)}">${esc(p.label)}へ</option>`)
          .join('')}
      </select>`
    : '';
  // PDF はアプリ内のビューアで開いて編集する。書き出した PDF（§9.7：注釈の対象にしない）とほかの種類は OS の既定のアプリで開く
  const action = extOf(m.name) === 'pdf' && m.source !== 'export' ? 'open-pdf' : 'open-material';
  return `<div class="file${ok ? '' : ' file--missing'}"${ok ? ` draggable="true" data-drag-material="${esc(m.id)}"` : ''}>
    <button class="file__open" data-action="${action}" data-id="${esc(m.id)}" ${ok ? '' : 'disabled'} title="${esc(m.name)}${ok ? '' : '（見つかりません）'}">
      ${fileArt(m.name)}
      ${unread ? `<span class="file__dot" style="--dot-color: var(--c${course.color})" aria-hidden="true"></span><span class="sr-only">未読</span>` : ''}
      <span class="file__name">${esc(m.name)}</span>
      ${m.source === 'notice' ? '<span class="file__tag">お知らせ</span>' : ''}
      ${m.source === 'upload' ? '<span class="file__tag">自分で追加</span>' : ''}
      ${m.source === 'export' ? '<span class="file__tag">書き出し</span>' : ''}
      ${ok ? '' : '<span class="file__tag">見つかりません</span>'}
    </button>
    <div class="file__tools">
      <button class="file__tool" data-action="reveal-material" data-id="${esc(m.id)}" title="${esc(m.name)} をフォルダで表示">📁 フォルダ</button>
      ${move}
      ${m.source === 'upload' ? `<button class="file__tool" data-action="remove-material" data-id="${esc(m.id)}" title="${esc(m.name)} を外してゴミ箱へ">外す</button>` : ''}
    </div>
  </div>`;
}

// 自分の付箋：授業画面で入れたファイルが最初に置かれる。ここから回の付箋へ振り分ける
function ownNote(course, list, places) {
  return `<section class="round-note round-note--own${list.length ? '' : ' round-note--own-empty'}" data-drop="own" data-course-id="${esc(course.id)}" aria-label="自分の付箋">
    <header class="round-note__head">
      <span class="round-note__round">自分の付箋</span>
      <span class="round-note__title muted">${list.length ? '回の付箋へドラッグか「移す」で振り分け' : 'ここにファイルをドラッグ（元のファイルは残ります）'}</span>
      <button class="btn btn--small" data-action="upload" data-course-id="${esc(course.id)}">ファイルを追加…</button>
    </header>
    ${list.length ? `<div class="round-note__files">${list.map((m) => fileCard(m, course, places)).join('')}</div>` : ''}
  </section>`;
}

// これからの回で資料がまだないものは、見出しだけの小さな付箋にする（資料のある回を埋もれさせない）
// 授業のテスト（回をまたいだ試験前のテスト・まちがえた問題・まとめて作る）
// クイズを作る回を選ぶ（1 つでも複数でも）。回ごとに 1 つのクイズを作り、テストは「回を選んでテスト」で回をまたいで解く
function makePicker(makeable, byRound) {
  if (!makeable.length) return '';
  return `<details class="test-panel__range test-panel__make" id="qm-box"${byRound.size ? '' : ' open'}><summary>回を選んでクイズを作る</summary>
    <div class="test-panel__rounds">${makeable
      .map((r) => {
        const z = byRound.get(r.id);
        const title = r.title_user || r.title || '';
        return `<label><input type="checkbox" name="quiz-make" id="qm-${esc(r.id)}" value="${esc(r.id)}" data-has-quiz="${z ? '1' : ''}" data-label="${esc(placeName(r))}"> ${esc(placeName(r))}${title ? ` <span class="muted">${esc(title)}</span>` : ''}${z ? ' <span class="muted">（作成済み）</span>' : ''}</label>`;
      })
      .join('')}</div>
    <div class="actions">
      <button class="btn btn--small btn--primary" data-action="quiz-make-picked">選んだ回のクイズを作る</button>
      <button class="btn btn--small btn--quiet" data-action="quiz-pick" data-pick="new">まだない回を選ぶ</button>
      <button class="btn btn--small btn--quiet" data-action="quiz-pick" data-pick="none">選ぶのをやめる</button>
    </div>
    <p class="muted">回ごとに作ります（1 回 1〜2 分・数円〜十数円）。作成済みの回は作り直しになります（前の版の記録は残ります）。</p>
  </details>`;
}

function testPanel(course, quizzes, makeable, byRound, hasKey) {
  const ready = quizzes.filter((z) => z.count > 0);
  const total = ready.reduce((a, z) => a + z.count, 0);
  const tries = ready.reduce((a, z) => a + (z.tries ?? 0), 0);
  const correct = ready.reduce((a, z) => a + (z.correct ?? 0), 0);
  const all = ready.map((z) => z.id).join(',');
  const roundName = (z) => (z.round_number === 0 ? 'その他' : `第${z.round_number}回`);
  const make = hasKey ? makePicker(makeable, byRound) : '';
  // API キーがなく、作った問題もなければ出さない（クイズを使わない人には毎回の雑音になる。入口は上の「クイズを使う…」）
  if (!ready.length && !hasKey) return '';
  if (!ready.length)
    return `<section class="test-panel"><h3>この授業のテスト</h3>
      <p class="muted">${hasKey ? (makeable.length ? '下で回を選んでクイズを作ると、テストができます。' : '資料（PDF・Word・PowerPoint・テキスト）のある回ができると、クイズを作れます。') : 'クイズを作るには Claude API キーが必要です。<button class="btn btn--small" data-action="nav" data-route="/settings">設定 → クイズ</button>'}</p>${make}</section>`;
  return `<section class="test-panel"><h3>この授業のテスト</h3>
    <p class="muted">${ready.length} 回分・${total} 問${tries ? `・これまでの正答率 ${Math.round((correct / tries) * 100)}%` : ''}</p>
    <div class="actions">
      <button class="btn btn--primary" data-action="nav" data-route="/quiz?course=${esc(course.id)}&quizzes=${esc(all)}&mode=exam">全部の回からテスト</button>
      <button class="btn" data-action="nav" data-route="/quiz?course=${esc(course.id)}&quizzes=${esc(all)}&mode=retry">まちがえた問題だけ</button>
    </div>
    <details class="test-panel__range" id="qr-box"><summary>回を選んでテスト</summary>
      <div class="test-panel__rounds">${ready.map((z) => `<label><input type="checkbox" name="quiz-range" id="qr-${esc(z.id)}" value="${esc(z.id)}" checked> ${esc(roundName(z))} <span class="muted">${z.count} 問</span></label>`).join('')}</div>
      <button class="btn btn--small" data-action="quiz-range" data-course-id="${esc(course.id)}">選んだ回でテスト</button>
    </details>
    ${make}
  </section>`;
}

// 回のクイズの行（SPEC §8.2「クイズ」）：作った問題の数・正答率・要確認と「解く」「作り直す」「編集」。資料があってクイズがなければ「作る」
export function quizLine(round, list, course, quiz, gen, hasKey, where = 'この回') {
  const extractable = list.some((m) => m.status === 'ok' && EXTRACTABLE.test(m.name));
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
  if (!extractable || !hasKey) return ''; // API キーがなければ回ごとには案内しない（授業画面の上に 1 つだけ）
  return `<div class="round-quiz"><button class="btn btn--small" data-action="quiz-generate" data-rounds="${esc(round.id)}">${esc(where)}の資料からクイズを作る</button></div>`;
}

function roundNote(round, list, course, today, quizzes = {}, places = []) {
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
  return `<section class="${cls}" data-drop="${esc(round.id)}" data-course-id="${esc(course.id)}" style="--tilt: ${tilt(round.id)}deg; --note-color: var(--pop${round.number === 0 ? 1 : ((round.number - 1) % 8) + 1})" aria-label="${esc(head)} ${esc(title)}${isToday ? '（今日）' : ''}">
    <header class="round-note__head">
      <span class="round-note__round">${esc(head)}</span>
      <span class="round-note__title">${esc(title)}</span>
      ${isToday ? '<span class="round-note__today">今日</span>' : ''}
      <span class="round-note__date">${esc(fmtDate(round.date))}</span>
    </header>
    ${list.length ? `<div class="round-note__files">${list.map((m) => fileCard(m, course, places)).join('')}</div>` : upcoming ? '' : `<p class="round-note__none">資料なし</p>`}
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
  // 今週の回を左上に。前の回は「これまでの回」として第 1 回から順に後ろへ
  const order = orderRounds(shown, today);
  const syncing = !!progress || (data.jobs ?? []).some((j) => j.kind === 'sync');
  const running = (data.jobs ?? []).some((j) => j.kind === 'sync' && j.status === 'running');
  const quizzes = data.quizzes?.[courseId] ?? [];
  const quizInfo = {
    byRound: new Map(quizzes.map((z) => [z.round_id, z])),
    gen: data.quiz?.generating ?? {},
    hasKey: !!data.quiz?.key?.set
  };
  // クイズを作れる回：読める資料（PDF・Word・PowerPoint・テキスト）がある回
  const makeable = shown.filter((r) =>
    (byRound.get(r.id) ?? []).some((m) => m.status === 'ok' && EXTRACTABLE.test(m.name))
  );
  const own = materials.filter((m) => !m.round_id);
  // 移せる先：自分の付箋・回（「その他」はまだなくても選べるようにはしない。回は資料の有無にかかわらず全部）
  const places = [
    {value: 'own', label: '自分の付箋'},
    ...rounds.filter((r) => r.number > 0 || byRound.get(r.id)?.length).map((r) => ({value: r.id, label: placeName(r)}))
  ];
  const note = (r) => roundNote(r, byRound.get(r.id) ?? [], course, today, quizInfo, places);
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
      <button class="btn btn--quiet" data-action="sync" data-course-id="${esc(courseId)}" data-full="1" ${syncing ? 'disabled' : ''} title="ふだんの同期は今日の前後 7 日の回だけを見ます。前の回の資料が足りないときに押してください（数分かかります）">過去の回も全部確かめる</button>
      ${course.lms_url ? `<button class="btn btn--quiet" data-action="open-external" data-url="${esc(course.lms_url)}">LMS で開く</button>` : ''}
      ${quizInfo.hasKey || quizzes.length ? '' : '<button class="btn btn--quiet" data-action="nav" data-route="/settings?focus=quiz" title="資料から復習のクイズを作れます（自分の Claude API キーが要ります）">クイズを使う…</button>'}
      <span class="muted" id="sync-status" role="status">${esc(status)}</span>
    </div>
    ${testPanel(course, quizzes, makeable, quizInfo.byRound, quizInfo.hasKey)}
    <div class="round-notes">
      ${order.current.map(note).join('')}
      ${order.past.length ? `<h3 class="round-notes__divider">これまでの回</h3>${order.past.map(note).join('')}` : ''}
      ${order.other.map(note).join('')}
      ${ownNote(course, own, places)}
    </div>
    ${shown.length ? '' : `<div class="empty"><p>まだ回がありません。同期すると、回ごとの付箋がここに並びます。</p></div>`}`;
}
