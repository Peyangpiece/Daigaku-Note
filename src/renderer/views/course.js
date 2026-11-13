// 授業画面（SPEC §8.2）：回ごとの付箋に、資料がイラスト付きの紙で貼ってある。
// 自分のファイルは「振り分け前」の付箋に入り、ドラッグか「移す」で回の付箋へ振り分ける（回に入れた資料はその回のクイズの材料になる）。
// 「振り分け前」の呼び名は main/ipc.js（取り込みの知らせ）と合わせる
import {todayJst} from '../../shared/schedule.js';
import {MIN_MASKS} from '../../shared/cloze.js';
import {esc, jaWrap, progressText} from '../ui-kit.js';
import {hash32} from '../../shared/hash.js';
import {orderRounds} from '../../shared/rounds.js';
import {applyOrder, hasOrder} from '../../shared/arrange.js';
import {addDays} from '../../shared/holidays.js';
import {canRename, state} from '../store.js';
import {extOf, fileArt, kindOf, noteArt} from './file-art.js';
import {bookmarkLook, fixedSticker, skinOf, stickerLayer} from '../skin.js';
import {roundColorIndex} from '../../shared/skin.js';

const fmtDate = (d) =>
  d
    ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${'日月火水木金土'[new Date(d + 'T00:00:00').getDay()]}）`
    : '';

const tilt = (id) => ((hash32(id) % 7) - 3) * 0.5; // -1.5 〜 +1.5 度

const EXTRACTABLE = /\.(pdf|docx|pptx|txt|md)$/i;
// 「その他」は回の名前ではないので、名前を自分で変えられる（title_user。空ならその他）
const otherName = (r) => r.title_user || 'その他';
const OWN_LABEL = '振り分け前'; // 回を決めていないファイルの置き場（PDF の中の「メモ」や回の付箋と紛れない名前に）
// 自分で足した付箋は回の番号を出さない（題だけ。空なら「名前のない付箋」）
const placeName = (r) =>
  r ? (r.user_made ? r.title_user || '名前のない付箋' : r.number === 0 ? otherName(r) : `第${r.number}回`) : OWN_LABEL;

// 資料の紙：押すと開く。ドラッグで別の付箋へ移せる。右上の「⋯」（右クリックでも）で、開く・フォルダで表示・移す・ゴミ箱へ
// （views/../app.js の material-menu。移せる先は placesOf）。copyOf は自分のフォルダの中の同じ中身の写し（開くと元の資料。注釈も同じ）
export function fileCard(m, course) {
  const ok = m.status === 'ok';
  const unread = !m.read_at && ok;
  // PDF はアプリ内のビューアで開いて編集する。書き出した PDF（§9.7：注釈の対象にしない）とほかの種類は OS の既定のアプリで開く
  const action = extOf(m.name) === 'pdf' && m.source !== 'export' ? 'open-pdf' : 'open-material';
  // 着せ替え（SPEC-KISEKAE）：種類ごとの色とシール、付箋（前のしおりも）のある資料には目印
  const sk = skinOf(state.data, course);
  const kind = m.source === 'note' ? 'note' : kindOf(m.name);
  const bm = bookmarkLook(sk);
  const bmSticker = sk.stickers.find((st) => st.place === 'bookmark');
  const drag = ok && !m.copyOf;
  return `<div class="file${ok ? '' : ' file--missing'}"${drag ? ` draggable="true" data-drag-material="${esc(m.id)}"` : ''} data-material="${esc(m.id)}"${m.copyOf ? ' data-copy="1"' : ''}>
    <button class="file__open" data-action="${action}" data-id="${esc(m.id)}" ${ok ? '' : 'disabled'} title="${esc(m.name)}${ok ? '' : '（見つかりません）'}${m.bookmarks ? `（付箋 ${m.bookmarks}）` : ''}${m.copyOf ? `（「${esc(m.copyOf)}」と同じ中身。書き込みも同じものが出ます）` : ''}">
      <span class="file__art">${m.source === 'note' ? noteArt({colors: sk.file, bodies: sk.fileBody, art: sk.fileArt}) : fileArt(m.name, {colors: sk.file, bodies: sk.fileBody, art: sk.fileArt})}${fixedSticker(
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
    ${ok && !m.copyOf ? `<button type="button" class="file__more" data-action="material-menu" data-id="${esc(m.id)}" aria-label="${esc(m.name)} のメニュー" title="メニュー" aria-haspopup="menu">⋯</button>` : ''}
    ${
      // 見つからなくなった LMS の資料：ここから取り直せる（右クリックのメニューにもある）
      m.status === 'missing' && m.url && course.kind !== 'folder' && course.connection_id
        ? `<button type="button" class="btn btn--small file__refetch" data-action="refetch-material" data-id="${esc(m.id)}" data-name="${esc(m.name)}" title="LMS からもう一度ダウンロードして、同じ場所に戻します">取り直す</button>`
        : ''
    }
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
    return `<div class="own-drop" data-drop="own" data-course-id="${esc(course.id)}">ここにファイルをドラッグ（元のファイルは残ります）</div>`;
  return `<section class="round-note round-note--own" data-drop="own" data-course-id="${esc(course.id)}" aria-label="振り分け前のファイル（回を決めていないファイル）">
    <header class="round-note__head">
      <span class="round-note__round">${OWN_LABEL}</span>
    </header>
    <div class="round-note__files">${list.map((m) => fileCard(m, course)).join('')}</div>
  </section>`;
}

// 授業のクイズ（SPEC §8.2）：上の 1 段に、解く（全部の回・まちがえた問題・範囲を選ぶ）と、問題を作る（回を選ぶ）
function makePicker(makeable, byRound, open) {
  if (!makeable.length) return '';
  return `<details class="test-panel__range test-panel__make" id="qm-box"${open ? ' open' : ''}><summary>問題を作る</summary>
    <div class="test-panel__rounds">${makeable
      .map((r) => {
        const z = byRound.get(r.id);
        const title = r.title_user || r.title || '';
        return `<label><input type="checkbox" name="quiz-make" id="qm-${esc(r.id)}" value="${esc(r.id)}" data-has-quiz="${z ? '1' : ''}" data-label="${esc(placeName(r))}"> ${esc(placeName(r))}${title && !r.user_made ? ` <span class="muted">${esc(title)}</span>` : ''}${z ? ' <span class="muted">作成済み</span>' : ''}</label>`;
      })
      .join('')}</div>
    <div class="actions">
      <button class="btn btn--small btn--primary" data-action="quiz-make-picked">作る</button>
      <button class="btn btn--small btn--quiet" data-action="quiz-pick" data-pick="new">未作成をすべて選ぶ</button>
      <button class="btn btn--small btn--quiet" data-action="quiz-pick" data-pick="none">選択を外す</button>
    </div>
  </details>`;
}

function testPanel(course, quizzes, makeable, byRound, hasKey) {
  const ready = quizzes.filter((z) => z.count > 0);
  const total = ready.reduce((a, z) => a + z.count, 0);
  const tries = ready.reduce((a, z) => a + (z.tries ?? 0), 0);
  const correct = ready.reduce((a, z) => a + (z.correct ?? 0), 0);
  const all = ready.map((z) => z.id).join(',');
  const roundName = (z) =>
    z.round_number === 0
      ? 'その他'
      : z.round_title_user && z.round_user_made
        ? z.round_title_user
        : `第${z.round_number}回`;
  // 問題も作る手段もなければ出さない（入口は右上の「⋯」の「テストを作る…」）
  if (!ready.length && !(hasKey && makeable.length)) return '';
  const make = hasKey ? makePicker(makeable, byRound, !ready.length) : '';
  if (!ready.length)
    return `<section class="test-panel" aria-label="この授業のクイズ"><div class="test-panel__row"><strong>クイズ</strong></div>${make}</section>`;
  return `<section class="test-panel" aria-label="この授業のクイズ"><div class="test-panel__row">
      <strong>クイズ</strong><span class="muted">${total} 問${tries ? `・正答率 ${Math.round((correct / tries) * 100)}%` : ''}</span>
      <button class="btn btn--small btn--primary" data-action="nav" data-route="/quiz?course=${esc(course.id)}&quizzes=${esc(all)}&mode=exam">全部の回から解く</button>
      <button class="btn btn--small" data-action="nav" data-route="/quiz?course=${esc(course.id)}&quizzes=${esc(all)}&mode=retry">まちがえた問題</button>
    </div>
    ${
      ready.length > 1
        ? `<details class="test-panel__range" id="qr-box"><summary>回を選んで解く</summary>
      <div class="test-panel__rounds">${ready.map((z) => `<label><input type="checkbox" name="quiz-range" id="qr-${esc(z.id)}" value="${esc(z.id)}" checked> ${esc(roundName(z))} <span class="muted">${z.count} 問</span></label>`).join('')}</div>
      <button class="btn btn--small" data-action="quiz-range" data-course-id="${esc(course.id)}">解く</button>
    </details>`
        : ''
    }
    ${make}
  </section>`;
}

// 付箋の中のクイズの行：問題の数・正答率と「解く」「編集」「作り直す」。作っている途中・失敗も出す
export function quizLine(round, list, course, quiz, gen, hasKey, _where = 'この回', {hintWhenNoKey = false} = {}) {
  const extractable = list.some((m) => m.status === 'ok' && EXTRACTABLE.test(m.name));
  // 文字隠しマーカーが MIN_MASKS 以上あれば、AI を使わない穴埋め（§11.3）
  const masks = list.reduce((n, m) => n + (m.masks ?? 0), 0);
  const cloze =
    masks >= MIN_MASKS
      ? `<button class="btn btn--small btn--quiet" data-action="quiz-cloze" data-round="${esc(round.id)}" data-has-quiz="${quiz ? '1' : ''}" title="文字隠しマーカーで隠した ${masks} か所を穴埋めにします（AI は使いません）">隠した語で穴埋め</button>`
      : '';
  if (gen)
    return `<div class="round-quiz round-quiz--busy" role="status">${gen.state === 'failed' ? `<span>${esc(/^クイズを作れませんでした/.test(gen.message) ? gen.message : `作れませんでした：${gen.message}`)}</span> <button class="btn btn--small" data-action="quiz-generate" data-rounds="${esc(round.id)}">もう一度</button>` : `<span class="spinner" aria-hidden="true"></span><span>${esc(gen.message)}</span>`}</div>`;
  if (quiz) {
    const rate = quiz.tries ? `正答率 ${Math.round(((quiz.correct ?? 0) / quiz.tries) * 100)}%` : '未回答';
    return `<div class="round-quiz">
      <span class="round-quiz__info">クイズ ${quiz.count} 問・${rate}${quiz.flagged ? `・<strong title="AI の検算と答えが合わなかった問題">要確認 ${quiz.flagged}</strong>` : ''}</span>
      <span class="round-quiz__btns">
        <button class="btn btn--small btn--primary" data-action="nav" data-route="/quiz?course=${esc(course.id)}&quizzes=${esc(quiz.id)}&mode=quiz">解く</button>
        <button class="btn btn--small btn--quiet" data-action="nav" data-route="/quiz-edit/${esc(quiz.id)}">編集</button>
        ${hasKey && extractable ? `<button class="btn btn--small btn--quiet" data-action="quiz-generate" data-rounds="${esc(round.id)}">作り直す</button>` : ''}
        ${cloze}
      </span></div>`;
  }
  if (!extractable) return '';
  // AI を選んでいないとき：授業の画面では回ごとに案内しない（上の「⋯」から）。自分のフォルダの画面だけ 1 行出す
  if (!hasKey)
    return hintWhenNoKey
      ? `<div class="round-quiz"><button class="btn btn--small" data-action="nav" data-route="/settings?focus=quiz">AI を設定して問題を作る</button>${cloze}</div>`
      : cloze && `<div class="round-quiz">${cloze}</div>`;
  return `<div class="round-quiz"><button class="btn btn--small" data-action="quiz-generate" data-rounds="${esc(round.id)}">問題を作る</button>${cloze}</div>`;
}

/**
 * 回のノート（SPEC §8.6）：A4 縦の白紙のノート（PDF）。まだなければ「＋ ノート」（押すと紙を選んで作る）。
 * 作ったあとは、付箋の資料の並びに青い表紙のノートとして出る（押すと開く）
 */
function notebookLine(round, list, course) {
  const note = list.some((m) => m.source === 'note' && m.status === 'ok')
    ? ''
    : `<button type="button" class="btn btn--small btn--quiet" data-action="round-notebook" data-course-id="${esc(course.id)}" data-round-id="${esc(round.id)}" title="この回のノートを作る" aria-haspopup="menu">＋ ノート</button>`;
  // 付箋にファイルを入れる（パソコンのファイルを選ぶ。元のファイルは残る）。ドラッグでも入れられる
  const file = `<button type="button" class="btn btn--small btn--quiet" data-action="upload" data-course-id="${esc(course.id)}" data-round-id="${esc(round.id)}" title="コピーして入れます（元のファイルは残ります）">＋ ファイル</button>`;
  // 自分で足した付箋だけ消せる（LMS の回は次の同期でまた出るため消さない）
  const del = round.user_made
    ? `<button type="button" class="btn btn--small btn--quiet round-notebook__del" data-action="round-remove" data-round-id="${esc(round.id)}" data-name="${esc(round.title_user || '名前のない付箋')}" data-files="${list.length}" title="中の資料は「振り分け前」へ移します">付箋を消す</button>`
    : '';
  return `<div class="round-notebook">${note}${file}${del}</div>`;
}

function roundNote(round, list, course, today, quizzes = {}) {
  const isToday = !round.user_made && round.date === today;
  const upcoming = !list.length && round.number > 0 && round.date && round.date > today;
  const other = round.number === 0;
  const mine = !!round.user_made; // 自分で足した付箋：第何回・日付は出さず、題だけ（空なら薄く「タイトルを入力」）
  const head = other ? otherName(round) : mine ? '' : `第${round.number}回`;
  const title = other ? '' : round.title_user || round.title || '';
  const cls = [
    'round-note',
    list.length ? '' : 'round-note--empty',
    upcoming && !mine ? 'round-note--upcoming' : '',
    isToday ? 'round-note--today' : ''
  ]
    .filter(Boolean)
    .join(' ');
  // 回の付箋の色：第 1 回から順に 5 色（着せ替えで変えていなければ --pop1〜5）。角にはシールを 1 枚
  const sk = skinOf(state.data, course);
  const i = roundColorIndex(round.number, sk.sticky.round === 'default' ? undefined : sk.sticky.round.length);
  // 右クリック →「色を変える」で選んだ色があれば、それを使う
  const picked = state.data?.settings?.stickyColors?.[course.id]?.[round.id];
  const noteColor = picked
    ? `var(--pop${picked})`
    : sk.sticky.round === 'default'
      ? `var(--pop${i + 1})`
      : sk.sticky.round[i];
  return `<section class="${cls}" data-drop="${esc(round.id)}" data-sort-key="${esc(round.id)}" data-course-id="${esc(course.id)}" style="--tilt: ${tilt(round.id)}deg; --note-color: ${noteColor}" aria-label="${esc(mine ? title || '名前のない付箋' : `${head} ${title}`)}${isToday && !mine ? '（今日）' : ''}">
    ${fixedSticker(
      sk.stickers.find((st) => st.place === 'round'),
      state.data,
      {x: 0.95, y: 0.04, base: 44}
    )}
    <header class="round-note__head" data-rename-box>
      ${
        mine
          ? title
            ? `<span class="round-note__title round-note__title--mine" data-rename-target>${esc(title)}</span>
      <button type="button" class="rename-btn" data-action="rename" data-what="round" data-id="${esc(round.id)}" data-value="${esc(title)}" title="付箋の名前を変える" aria-label="付箋の名前を変える">✎</button>`
            : `<button type="button" class="round-note__placeholder" data-action="rename" data-what="round" data-id="${esc(round.id)}" data-value="" data-rename-target title="付箋の名前を入れる">タイトルを入力</button>`
          : `${
              other
                ? `<span class="round-note__round" data-rename-target>${esc(head)}</span><span class="round-note__title"></span>`
                : `<span class="round-note__round">${esc(head)}</span>
      <span class="round-note__title" data-rename-target>${esc(title)}</span>`
            }
      <button type="button" class="rename-btn" data-action="rename" data-what="round" data-id="${esc(round.id)}" data-value="${esc(other ? round.title_user || '' : title)}" title="付箋の名前を変える" aria-label="${esc(head)}の名前を変える">✎</button>
      ${isToday ? '<span class="round-note__today">今日</span>' : ''}
      <span class="round-note__date">${esc(fmtDate(round.date))}</span>`
      }
    </header>
    ${list.length ? `<div class="round-note__files">${list.map((m) => fileCard(m, course)).join('')}</div>` : upcoming ? '' : `<p class="round-note__none">資料なし</p>`}
    ${notebookLine(round, list, course)}
    ${quizzes.byRound?.get(round.id) || quizzes.gen?.[round.id] ? quizLine(round, list, course, quizzes.byRound?.get(round.id), quizzes.gen?.[round.id], quizzes.hasKey) : ''}
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
  // 自分で足した付箋は日付の並びに入れず、いちばん後ろに足した順（番号順）で並べる
  const mine = shown.filter((r) => r.user_made).sort((a, b) => a.number - b.number);
  const order = orderRounds(
    shown.filter((r) => !r.user_made),
    today
  );
  const hasFiles = (r) => (byRound.get(r.id) ?? []).length > 0;
  // 回の日付が分からない授業（日付のない回だけ）は、今までどおり全部並べる
  const weekEnd = order.monday ? addDays(order.monday, 6) : null;
  const now = order.current.filter((r) => !weekEnd || hasFiles(r) || (r.date && r.date <= weekEnd));
  // 今週に回がない週（休み・学期の前）は、次の回を先頭に出す
  if (weekEnd && !now.length && order.current.length) now.push(order.current[0]);
  // これからの回も、今週の回のあとに付箋で並べる（全部の回が付箋で見える。前は畳んだ一覧だった）
  const later = order.current.filter((r) => !now.includes(r));
  const past = order.past.slice().reverse();
  // 右クリック →「並べ替え」で並べた並びがあれば、それに合わせる（日付で分けた「これまでの回」の見出しは出さない。新しい回は後ろ）
  const saved = data.settings?.order?.[`course:${course.id}`];
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
  return `
    <nav class="page-nav page-nav--stickers">
      ${stickerLayer(skinOf(data, course).stickers, 'heading', data)}
      <button class="btn" data-action="nav" data-route="/">← ホーム</button>
      <h2 class="ja-wrap" data-rename-box><span data-rename-target>${jaWrap(course.name)}</span>${canRename(course) ? ` <button type="button" class="rename-btn" data-action="rename" data-what="course" data-id="${esc(course.id)}" title="名前を変える" aria-label="授業の名前を変える">✎</button>` : ''} <span class="muted">${esc(slot)}</span></h2>
      <button type="button" class="btn btn--quiet course-actions__more" data-action="course-menu" data-id="${esc(course.id)}" aria-haspopup="menu" aria-label="ほかの操作（同期・LMS で開く・ホームから外す）" title="ほかの操作">⋯</button>
    </nav>
    ${status ? `<p class="muted course-status" id="sync-status" role="status">${esc(status)}</p>` : '<p class="sr-only" id="sync-status" role="status"></p>'}
    ${testPanel(course, quizzes, makeable, quizInfo.byRound, quizInfo.hasKey)}
    ${own.length ? '' : ownNote(course, own)}
    <div class="round-notes" data-sort-scope="course:${esc(course.id)}">
      ${own.length ? ownNote(course, own) : ''}
      ${
        hasOrder(saved)
          ? applyOrder([...now, ...later, ...past, ...order.other, ...mine], (r) => r.id, saved)
              .map(note)
              .join('')
          : `${now.map(note).join('')}
      ${later.map(note).join('')}
      ${past.length ? `<h3 class="round-notes__divider">これまでの回</h3>${past.map(note).join('')}` : ''}
      ${order.other.map(note).join('')}
      ${mine.map(note).join('')}`
      }
      <button type="button" class="round-note-add" data-action="round-add" data-course-id="${esc(course.id)}"><span aria-hidden="true">＋</span>付箋を足す</button>
    </div>
    ${shown.length || !syncable ? '' : '<div class="empty"><p>まだ回がありません（「⋯」の「この授業を同期」で並びます）</p></div>'}`;
}
