// 授業画面（SPEC §8.2）：回ごとの付箋に、資料がイラスト付きの紙で貼ってある。
// 自分のファイルは「振り分け前」の付箋に入り、ドラッグか「移す」で回の付箋へ振り分ける（回に入れた資料はその回のクイズの材料になる）。
// 「振り分け前」の呼び名は main/ipc.js（取り込みの知らせ）と合わせる
import {todayJst} from '../../shared/schedule.js';
import {MIN_MASKS} from '../../shared/cloze.js';
import {esc, jaWrap, progressText} from '../ui-kit.js';
import {hash32} from '../../shared/hash.js';
import {orderRounds} from '../../shared/rounds.js';
import {addDays} from '../../shared/holidays.js';
import {canRename, state} from '../store.js';
import {extOf, fileArt, kindOf} from './file-art.js';
import {bookmarkLook, fixedSticker, skinOf, stickerLayer} from '../skin.js';
import {roundColorIndex} from '../../shared/skin.js';
import {features} from '../../shared/profile.js';

const fmtDate = (d) =>
  d
    ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${'日月火水木金土'[new Date(d + 'T00:00:00').getDay()]}）`
    : '';

const tilt = (id) => ((hash32(id) % 7) - 3) * 0.5; // -1.5 〜 +1.5 度

const EXTRACTABLE = /\.(pdf|docx|pptx|txt|md)$/i;
// 「その他」は回の名前ではないので、名前を自分で変えられる（title_user。空ならその他）
const otherName = (r) => r.title_user || 'その他';
const OWN_LABEL = '振り分け前'; // 回を決めていないファイルの置き場（PDF の中の「メモ」や回の付箋と紛れない名前に）
const placeName = (r) => (r ? (r.number === 0 ? otherName(r) : `第${r.number}回`) : OWN_LABEL);

// 資料の紙：押すと開く。ドラッグで別の付箋へ移せる。右上の「⋯」（右クリックでも）で、開く・フォルダで表示・移す・ゴミ箱へ
// （views/../app.js の material-menu。移せる先は placesOf）。copyOf は自分のフォルダの中の同じ中身の写し（開くと元の資料。注釈も同じ）
export function fileCard(m, course) {
  const ok = m.status === 'ok';
  const unread = !m.read_at && ok;
  // PDF はアプリ内のビューアで開いて編集する。書き出した PDF（§9.7：注釈の対象にしない）とほかの種類は OS の既定のアプリで開く
  const action = extOf(m.name) === 'pdf' && m.source !== 'export' ? 'open-pdf' : 'open-material';
  // 着せ替え（SPEC-KISEKAE）：種類ごとの色とシール、付箋（前のしおりも）のある資料には目印
  const sk = skinOf(state.data, course);
  const kind = kindOf(m.name);
  const bm = bookmarkLook(sk);
  const bmSticker = sk.stickers.find((st) => st.place === 'bookmark');
  const drag = ok && !m.copyOf;
  return `<div class="file${ok ? '' : ' file--missing'}"${drag ? ` draggable="true" data-drag-material="${esc(m.id)}"` : ''} data-material="${esc(m.id)}"${m.copyOf ? ' data-copy="1"' : ''}>
    <button class="file__open" data-action="${action}" data-id="${esc(m.id)}" ${ok ? '' : 'disabled'} title="${esc(m.name)}${ok ? '' : '（見つかりません）'}${m.bookmarks ? `（付箋 ${m.bookmarks}）` : ''}${m.copyOf ? `（「${esc(m.copyOf)}」と同じ中身。書き込みも同じものが出ます）` : ''}">
      <span class="file__art">${fileArt(m.name, {colors: sk.file, bodies: sk.fileBody, art: sk.fileArt})}${fixedSticker(
        sk.stickers.find((st) => st.place === 'file' && st.kind === kind),
        state.data,
        {x: 0.12, y: 0.16, base: 30}
      )}${m.bookmarks ? `<span class="file__ribbon bm ${bm.cls}" style="${bm.style}" aria-hidden="true">${m.bookmarks}${fixedSticker(bmSticker, state.data, {x: 0, y: 0.5, base: 22})}</span>` : ''}</span>
      ${unread ? `<span class="file__dot" style="--dot-color: var(--c${course.color})" aria-hidden="true"></span><span class="sr-only">未読</span>` : ''}
      <span class="file__name">${fileName(m.name)}</span>
      ${m.source === 'notice' ? '<span class="file__tag">お知らせ</span>' : ''}
      ${m.source === 'upload' ? '<span class="file__tag">自分で追加</span>' : ''}
      ${m.source === 'export' ? '<span class="file__tag">書き出し</span>' : ''}
      ${m.copyOf ? '<span class="file__tag">同じ中身の写し</span>' : ''}
      ${ok ? '' : '<span class="file__tag">見つかりません</span>'}
    </button>
    ${ok && !m.copyOf ? `<button type="button" class="file__more" data-action="material-menu" data-id="${esc(m.id)}" aria-label="${esc(m.name)} のメニュー" title="メニュー（右クリックでも出ます）" aria-haspopup="menu">⋯</button>` : ''}
  </div>`;
}
/** 資料の名前：区切り（_ - 空白・拡張子の前）で折り返せるようにする（言葉の途中で切れにくく） */
const fileName = (name) =>
  esc(name)
    .replace(/([_\-\s・])/g, '$1<wbr>')
    .replace(/\.([^.]+)$/, '<wbr>.$1');

/** 資料を移せる先：「振り分け前」と回（資料のない「その他」は除く）。[{value, label}] */
export function placesOf(data, course) {
  const rounds = data.rounds[course.id] ?? [];
  const mats = data.materials[course.id] ?? [];
  return [
    {value: 'own', label: OWN_LABEL},
    ...rounds
      .filter((r) => r.number > 0 || mats.some((m) => m.round_id === r.id && m.status !== 'trashed'))
      .sort((a, b) => (a.number === 0 ? 1 : b.number === 0 ? -1 : a.number - b.number))
      .map((r) => ({value: r.id, label: placeName(r)}))
  ];
}

// 振り分け前：授業画面で入れたファイルが最初に置かれる。ファイルがあるときだけ、回の付箋の前に付箋で出す。
// 空のときは、ファイルを落とせる細い帯だけ（ページの下まで探しに行かなくてよいように）
function ownNote(course, list) {
  if (!list.length)
    return `<div class="own-drop" data-drop="own" data-course-id="${esc(course.id)}">ここへファイルをドラッグすると「${OWN_LABEL}」に入ります（元のファイルは残ります）。あとで回の付箋へ移します</div>`;
  return `<section class="round-note round-note--own" data-drop="own" data-course-id="${esc(course.id)}" aria-label="振り分け前のファイル（回を決めていないファイル）">
    <header class="round-note__head">
      <span class="round-note__round" title="ここに入れたファイルは、回の付箋へドラッグか「⋯」の「移す」で振り分けます">${OWN_LABEL}</span>
    </header>
    <div class="round-note__files">${list.map((m) => fileCard(m, course)).join('')}</div>
  </section>`;
}

// これからの回で資料がまだないものは、見出しだけの小さな付箋にする（資料のある回を埋もれさせない）
// 授業のテスト（回をまたいだ試験前のテスト・まちがえた問題・まとめて作る）
// クイズを作る回を選ぶ（1 つでも複数でも）。回ごとに 1 つのクイズを作り、テストは「回を選んでテスト」で回をまたいで解く
function makePicker(makeable, byRound) {
  if (!makeable.length) return '';
  return `<details class="test-panel__range test-panel__make" id="qm-box"><summary>回を選んでクイズを作る</summary>
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
    <p class="muted">回ごとに作ります（1 回 1〜2 分・およそ十数円。資料の量で前後します）。作成済みの回は作り直しになります（前の版の記録は残ります）。</p>
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
  // API キーがなく、作った問題もなければ出さない（クイズを使わない人には毎回の雑音になる。入口は上の「⋯」の「クイズを使う…」）
  if (!ready.length && !hasKey) return '';
  // 回の付箋より上で場所を取りすぎないように、1 行にまとめる（回を選ぶ・作るは畳んでおく）
  if (!ready.length)
    return `<section class="test-panel" aria-label="この授業のテスト"><div class="test-panel__row"><strong>テスト</strong>
      <span class="muted">${makeable.length ? '回を選んでクイズを作ると、テストができます' : '資料（PDF・Word・PowerPoint・テキスト）のある回ができると、クイズを作れます'}</span></div>${make}</section>`;
  return `<section class="test-panel" aria-label="この授業のテスト"><div class="test-panel__row">
      <strong>テスト</strong><span class="muted">${ready.length} 回分・${total} 問${tries ? `・正答率 ${Math.round((correct / tries) * 100)}%` : ''}</span>
      <button class="btn btn--small btn--primary" data-action="nav" data-route="/quiz?course=${esc(course.id)}&quizzes=${esc(all)}&mode=exam">全部の回からテスト</button>
      <button class="btn btn--small" data-action="nav" data-route="/quiz?course=${esc(course.id)}&quizzes=${esc(all)}&mode=retry">まちがえた問題だけ</button>
    </div>
    <details class="test-panel__range" id="qr-box"><summary>回を選んでテスト</summary>
      <div class="test-panel__rounds">${ready.map((z) => `<label><input type="checkbox" name="quiz-range" id="qr-${esc(z.id)}" value="${esc(z.id)}" checked> ${esc(roundName(z))} <span class="muted">${z.count} 問</span></label>`).join('')}</div>
      <button class="btn btn--small" data-action="quiz-range" data-course-id="${esc(course.id)}">選んだ回でテスト</button>
    </details>
    ${make}
  </section>`;
}

// 回のクイズの行（SPEC §8.2「クイズ」）：作った問題の数・正答率・要確認と「解く」「作り直す」「編集」。資料があってクイズがなければ「作る」
export function quizLine(round, list, course, quiz, gen, hasKey, where = 'この回', {hintWhenNoKey = false} = {}) {
  const extractable = list.some((m) => m.status === 'ok' && EXTRACTABLE.test(m.name));
  // 文字隠しマーカーが MIN_MASKS 以上あれば、AI を使わない穴埋め（§11.3）。API キーがなくても作れる
  const masks = list.reduce((n, m) => n + (m.masks ?? 0), 0);
  const cloze =
    masks >= MIN_MASKS
      ? `<button class="btn btn--small btn--quiet" data-action="quiz-cloze" data-round="${esc(round.id)}" data-has-quiz="${quiz ? '1' : ''}" title="AI を使わず、文字隠しマーカーで隠した語（${masks} か所）を穴埋めの問題にします（API キーは要りません）">隠した箇所から穴埋めを作る</button>`
      : '';
  if (gen)
    return `<div class="round-quiz round-quiz--busy" role="status">${gen.state === 'failed' ? `<span>${esc(/^クイズを作れませんでした/.test(gen.message) ? gen.message : `クイズを作れませんでした：${gen.message}`)}</span> <button class="btn btn--small" data-action="quiz-generate" data-rounds="${esc(round.id)}">もう一度</button>` : `<span class="spinner" aria-hidden="true"></span><span>${esc(gen.message)}</span>`}</div>`;
  if (quiz) {
    const rate = quiz.tries ? `正答率 ${Math.round(((quiz.correct ?? 0) / quiz.tries) * 100)}%` : 'まだ解いていません';
    return `<div class="round-quiz">
      <span class="round-quiz__info">クイズ ${quiz.count} 問・${rate}${quiz.flagged ? `・<strong>要確認 ${quiz.flagged}</strong>` : ''}</span>
      <span class="round-quiz__btns">
        <button class="btn btn--small btn--primary" data-action="nav" data-route="/quiz?course=${esc(course.id)}&quizzes=${esc(quiz.id)}&mode=quiz">解く</button>
        <button class="btn btn--small btn--quiet" data-action="nav" data-route="/quiz-edit/${esc(quiz.id)}">編集</button>
        ${hasKey && extractable ? `<button class="btn btn--small btn--quiet" data-action="quiz-generate" data-rounds="${esc(round.id)}" title="資料から作り直します（前の版の記録は残ります）">作り直す</button>` : ''}
        ${cloze}
      </span></div>`;
  }
  if (!extractable) return '';
  // API キーがなければ回ごとには案内しない（授業画面の上に 1 つだけ）。自分のフォルダの画面にはその区画がないので、
  // hintWhenNoKey で 1 行だけ案内する（入口がどこにもないと、クイズの機能に気づけない）
  if (!hasKey)
    return hintWhenNoKey
      ? `<div class="round-quiz"><span class="muted">資料からクイズを作れます（自分の Claude API キーが要ります。1 回およそ十数円）</span> <button class="btn btn--small" data-action="nav" data-route="/settings?focus=quiz">設定 → クイズ</button>${cloze}</div>`
      : cloze && `<div class="round-quiz">${cloze}</div>`;
  return `<div class="round-quiz"><button class="btn btn--small" data-action="quiz-generate" data-rounds="${esc(round.id)}">${esc(where)}の資料からクイズを作る</button>${cloze}</div>`;
}

function roundNote(round, list, course, today, quizzes = {}) {
  const isToday = round.date === today;
  const upcoming = !list.length && round.number > 0 && round.date && round.date > today;
  const other = round.number === 0;
  const head = other ? otherName(round) : `第${round.number}回`;
  const title = other ? '' : round.title_user || round.title || '';
  const cls = [
    'round-note',
    list.length ? '' : 'round-note--empty',
    upcoming ? 'round-note--upcoming' : '',
    isToday ? 'round-note--today' : ''
  ]
    .filter(Boolean)
    .join(' ');
  // 回の付箋の色：第 1 回から順に 5 色（着せ替えで変えていなければ --pop1〜5）。角にはシールを 1 枚
  const sk = skinOf(state.data, course);
  const i = roundColorIndex(round.number);
  const noteColor = sk.sticky.round === 'default' ? `var(--pop${i + 1})` : sk.sticky.round[i];
  return `<section class="${cls}" data-drop="${esc(round.id)}" data-course-id="${esc(course.id)}" style="--tilt: ${tilt(round.id)}deg; --note-color: ${noteColor}" aria-label="${esc(head)} ${esc(title)}${isToday ? '（今日）' : ''}">
    ${fixedSticker(
      sk.stickers.find((st) => st.place === 'round'),
      state.data,
      {x: 0.95, y: 0.04, base: 44}
    )}
    <header class="round-note__head" data-rename-box>
      ${
        other
          ? `<span class="round-note__round" data-rename-target>${esc(head)}</span><span class="round-note__title"></span>`
          : `<span class="round-note__round">${esc(head)}</span>
      <span class="round-note__title" data-rename-target>${esc(title)}</span>`
      }
      <button type="button" class="rename-btn" data-action="rename" data-what="round" data-id="${esc(round.id)}" data-value="${esc(other ? round.title_user || '' : title)}" title="付箋の名前を変える" aria-label="${esc(head)}の名前を変える">✎</button>
      ${isToday ? '<span class="round-note__today">今日</span>' : ''}
      <span class="round-note__date">${esc(fmtDate(round.date))}</span>
    </header>
    ${list.length ? `<div class="round-note__files">${list.map((m) => fileCard(m, course)).join('')}</div>` : upcoming ? '' : `<p class="round-note__none">資料なし</p>`}
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
  const today = data.today ?? todayJst(); // 日本時間の今日（main と同じ）
  const slot = course.weekday ? `（${course.weekday}曜${course.period ? ` ${course.period}限` : ''}）` : '';
  // 「その他」は資料があるときだけ出す。回は資料の有無にかかわらず全部出す（空の付箋も並ぶ）
  const shown = rounds.filter((r) => r.number > 0 || byRound.get(r.id)?.length);
  // 並び：今週の回（と、もう資料のある先の回）→ これまでの回（新しい順）→ その他 → これからの回（資料のない先の回。畳む）。
  // 先の空の回が 10 枚以上並んで、資料のある前の回が下に追いやられないように
  const order = orderRounds(shown, today);
  const hasFiles = (r) => (byRound.get(r.id) ?? []).length > 0;
  // 回の日付が分からない授業（日付のない回だけ）は、今までどおり全部並べる
  const weekEnd = order.monday ? addDays(order.monday, 6) : null;
  const now = order.current.filter((r) => !weekEnd || hasFiles(r) || (r.date && r.date <= weekEnd));
  // 今週に回がない週（休み・学期の前）は、次の回を先頭に出す
  if (weekEnd && !now.length && order.current.length) now.push(order.current[0]);
  const later = order.current.filter((r) => !now.includes(r));
  const past = order.past.slice().reverse();
  // 同期できるのは LMS の接続がある授業だけ（LMS を使わない授業・接続を削除した授業には同期のボタンを出さない）
  const conn = data.connections.find((c) => c.id === course.connection_id);
  const syncable = !!conn && conn.kind !== 'manual';
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
  const note = (r) => roundNote(r, byRound.get(r.id) ?? [], course, today, quizInfo);
  // これからの回：回・名前・日付の 1 行ずつ（ファイルを落とせば、その回に入る）
  const laterList = later.length
    ? `<details class="later-rounds" id="later-rounds"><summary>これからの回 ${later.length}</summary><ul>${later
        .map(
          (r) =>
            `<li data-drop="${esc(r.id)}" data-course-id="${esc(course.id)}"><strong>第${r.number}回</strong> <span>${esc(r.title_user || r.title || '')}</span> <span class="muted">${esc(fmtDate(r.date))}</span></li>`
        )
        .join('')}</ul></details>`
    : '';
  const last = data.lastSync;
  const lastText = last
    ? `前回の同期 ${new Date(last.finished_at).toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'})}`
    : '';
  const status = progress
    ? progressText(progress)
    : running
      ? '同期しています…'
      : syncing
        ? '同期の順番を待っています…'
        : syncable
          ? lastText
          : '';
  // ⋯：めったに使わない操作（過去の回も全部確かめる・LMS で開く・クイズを使う）
  const quizSetup = !(quizInfo.hasKey || quizzes.length || !features(data.settings).quiz);
  const more = syncable || course.lms_url || quizSetup;
  return `
    <nav class="page-nav page-nav--stickers">
      ${stickerLayer(skinOf(data, course).stickers, 'heading', data)}
      <button class="btn" data-action="nav" data-route="/">← ホーム</button>
      <h2 class="ja-wrap" data-rename-box><span data-rename-target>${jaWrap(course.name)}</span>${canRename(course) ? ` <button type="button" class="rename-btn" data-action="rename" data-what="course" data-id="${esc(course.id)}" title="名前を変える" aria-label="授業の名前を変える">✎</button>` : ''} <span class="muted">${esc(slot)}</span></h2>
    </nav>
    <div class="course-actions">
      <button class="btn btn--primary" data-action="upload" data-course-id="${esc(course.id)}">ファイルを追加…</button>
      ${syncable ? `<button class="btn" data-action="sync" data-course-id="${esc(courseId)}" ${syncing ? 'disabled' : ''}>${syncing ? '同期中…' : 'この授業を同期'}</button>` : ''}
      ${more ? `<button type="button" class="btn btn--quiet course-actions__more" data-action="course-menu" data-id="${esc(course.id)}" aria-haspopup="menu" aria-label="ほかの操作" title="ほかの操作">⋯</button>` : ''}
      <span class="muted" id="sync-status" role="status">${esc(status)}</span>
    </div>
    ${testPanel(course, quizzes, makeable, quizInfo.byRound, quizInfo.hasKey)}
    ${own.length ? '' : ownNote(course, own)}
    <div class="round-notes">
      ${own.length ? ownNote(course, own) : ''}
      ${now.map(note).join('')}
      ${past.length ? `<h3 class="round-notes__divider">これまでの回</h3>${past.map(note).join('')}` : ''}
      ${order.other.map(note).join('')}
    </div>
    ${laterList}
    ${shown.length ? '' : `<div class="empty"><p>${syncable ? 'まだ回がありません。同期すると、回ごとの付箋がここに並びます。' : 'ファイルは上の「振り分け前」へドラッグするか、「ファイルを追加…」で入れます。'}</p></div>`}`;
}
