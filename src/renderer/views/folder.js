// 自分のフォルダ：作る・パソコンのフォルダを登録する画面と、フォルダの中身の画面。
// 中身はパソコンのフォルダをそのまま見せる（登録したフォルダはコピーしない）。開くたびにメインが読み直す
import {esc, jaWrap} from '../ui-kit.js';
import {fileCard, quizLine} from './course.js';
import {skinOf, stickerLayer} from '../skin.js';
import {roundColorIndex} from '../../shared/skin.js';
import {features} from '../../shared/profile.js';
import {applyOrder} from '../../shared/arrange.js';

const SCOPE_LABEL = {term: '今学期のフォルダ', always: 'マイフォルダ'};
export const scopeLabel = (c) => SCOPE_LABEL[c.scope] ?? SCOPE_LABEL.always;

/** ホームに出すか：マイフォルダはいつも、今学期のフォルダはその学期のあいだだけ */
export const folderShown = (c, currentTermId) => c.scope === 'always' || c.term_id === currentTermId;

// 学期を使わない人（社会人）には選ばせず、いつもマイフォルダにする
function scopeChoice(terms, selected = 'term') {
  if (!terms) return '<input type="radio" name="fn-scope" value="always" checked hidden>';
  return `<fieldset class="folder-new__scope">
      <legend>どこに置きますか</legend>
      <label><input type="radio" name="fn-scope" value="term"${selected === 'term' ? ' checked' : ''}> 今学期のフォルダ <span class="muted">（今学期のあいだホームに出ます）</span></label>
      <label><input type="radio" name="fn-scope" value="always"${selected === 'always' ? ' checked' : ''}> マイフォルダ <span class="muted">（学期が変わっても残ります）</span></label>
    </fieldset>`;
}

/** 中のフォルダを 1 つずつ登録したときの知らせ（{added: [名前], failed: [{name, message}]}） */
export const eachText = (r) =>
  r.added.length
    ? `${r.added.length} 個のフォルダを登録しました${r.failed.length ? `（${r.failed.length} 個は登録できませんでした）` : ''}`
    : '登録できるフォルダがありませんでした';

/**
 * 登録のしかた：選んだフォルダを 1 つ（one）か、中のフォルダを 1 つずつ（each。授業ごとのフォルダが入ったフォルダを選ぶとき）。
 * 大学生で LMS を使う人は、授業ごとのフォルダをまとめて登録することが多いので each を先に選んでおく
 */
function eachChoice(data) {
  const each = data.settings.role === 'student' && data.settings.uses?.includes('lms');
  return `<fieldset class="folder-new__scope">
      <legend>登録のしかた</legend>
      <label><input type="radio" name="fn-each" value="one"${each ? '' : ' checked'}> 選んだフォルダを 1 つ登録する</label>
      <label><input type="radio" name="fn-each" value="each"${each ? ' checked' : ''}> 中のフォルダを 1 つずつ登録する</label>
    </fieldset>`;
}

/** /folder-new?mode=new|link */
export function renderFolderNew({data}, route) {
  const mode = new URLSearchParams(route.split('?')[1] ?? '').get('mode') === 'link' ? 'link' : 'new';
  // 学期がまだなければ（LMS をつながずに使い始めたとき）、メインが今日の日付から仮の学期を作る
  const noTerm = !data.terms.length;
  const useTerms = features(data.settings).terms;
  return `
    <nav class="page-nav">
      <button class="btn" data-action="nav" data-route="/">← ホーム</button>
      <h2>${mode === 'new' ? 'フォルダを作る' : 'パソコンのフォルダを登録'}</h2>
    </nav>
    <section class="card folder-new" data-form="folder-new-${mode}">
      ${
        mode === 'new'
          ? `<p class="muted">保存先の中にフォルダを作ります。</p>
        <label for="fn-name">フォルダの名前</label>
        <input class="input" id="fn-name" type="text" maxlength="80" placeholder="例：ゼミ・就活・資格の勉強" autocomplete="off">`
          : `<p class="muted">パソコンのフォルダを、コピーせずに開きます。</p>
        ${eachChoice(data)}
        <label for="fn-name">大学ノートでの名前 <span class="muted">（空ならフォルダの名前）</span></label>
        <input class="input" id="fn-name" type="text" maxlength="80" autocomplete="off">`
      }
      ${scopeChoice(useTerms)}
      ${noTerm && useTerms ? '<p class="muted">学期が未設定のため、仮の学期を作ります。</p>' : ''}
      <div class="actions">
        <button class="btn btn--primary" data-action="folder-create" data-mode="${mode}">${mode === 'new' ? '作る' : 'フォルダを選んで登録…'}</button>
      </div>
    </section>`;
}

/** 下のフォルダごとにまとめる（'' はフォルダの直下） */
function groups(list) {
  const by = new Map();
  for (const m of list) {
    const k = m.sub && m.sub !== '.' ? m.sub : '';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(m);
  }
  return [...by.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'ja')));
}

/** /course/<id>（kind = 'folder'） */
export function renderFolder({data}, course) {
  const list = (data.materials[course.id] ?? [])
    .filter((m) => m.status !== 'trashed')
    .sort((a, b) => a.name.localeCompare(b.name, 'ja', {numeric: true}));
  const round = (data.rounds[course.id] ?? []).find((r) => r.number === 0);
  const quizzes = data.quizzes?.[course.id] ?? [];
  const quiz = round ? quizzes.find((z) => z.round_id === round.id) : null;
  const gen = round ? data.quiz?.generating?.[round.id] : null;
  // 付箋：フォルダの直下と、下のフォルダごとに 1 枚ずつ、横に 5 枚まで並べる。色は着せ替えの回の付箋と同じく 1 枚目から順に
  const sk = skinOf(data, course);
  const picked = data.settings?.stickyColors?.[course.id] ?? {}; // 右クリック →「色を変える」で選んだ色
  const colorOf = (i, sub) =>
    picked[sub]
      ? `var(--pop${picked[sub]})`
      : sk.sticky.round === 'default'
        ? `var(--pop${roundColorIndex(i + 1) + 1})`
        : sk.sticky.round[roundColorIndex(i + 1, sk.sticky.round.length)];
  // 付箋の並び：最初の付箋（フォルダの直下）→ もとからある下のフォルダ（名前順）→ 足した付箋（足した順）。
  // ファイルのない下のフォルダ（足したばかりの付箋など）も付箋で出す
  const bySub = new Map(groups(list));
  const added = (course.added ?? []).filter((x) => (course.subs ?? []).includes(x) || bySub.has(x));
  const others = [...new Set([...(course.subs ?? []), ...bySub.keys()])]
    .filter((x) => x !== '' && !added.includes(x))
    .sort((x, y) => x.localeCompare(y, 'ja'));
  // 最初の付箋は、消したあと（直下のファイルがない間）は出さない
  const root = bySub.get('') ?? [];
  const base = [...(course.rootHidden && !root.length ? [] : ['']), ...others, ...added];
  // 右クリック →「並べ替え」で並べた並びがあれば、それに合わせる（新しい付箋は後ろ）。色はもとの並びの順で決めておき、並べ替えても変わらない
  const order = applyOrder(base, (x) => x, data.settings?.order?.[`course:${course.id}`]);
  const hasNote = (ms) => ms.some((m) => m.source === 'note' && m.status === 'ok');
  const titleOf = (sub) => (sub ? sub.split('/').pop() : (round?.title_user ?? ''));
  const notes = order
    .map((sub) => {
      const i = base.indexOf(sub);
      const ms = bySub.get(sub) ?? [];
      const title = titleOf(sub);
      // 最初の付箋の題は空のまま（薄く「タイトルを入力」）。押すと名前を入れられる（回 0 の title_user）
      const rename = sub
        ? `data-action="rename" data-what="sub" data-id="${esc(course.id)}" data-sub="${esc(sub)}" data-value="${esc(title)}"`
        : `data-action="rename" data-what="round" data-id="${esc(round?.id ?? '')}" data-value="${esc(title)}"`;
      const head = title
        ? `<span class="round-note__round">${sub ? '📁 ' : ''}<span data-rename-target>${esc(title)}</span></span>
        <button type="button" class="rename-btn" ${rename} title="${sub ? '付箋の名前を変える（パソコンのフォルダの名前も変わります）' : '付箋の名前を変える'}" aria-label="名前を変える">✎</button>`
        : `<button type="button" class="round-note__placeholder" ${rename} data-rename-target title="付箋の名前を入れる">タイトルを入力</button>`;
      return `<section class="round-note round-note--folder" style="--note-color: ${colorOf(i, sub)}" data-drop="own" data-course-id="${esc(course.id)}" data-sub="${esc(sub)}" data-sort-key="${esc(sub)}" aria-label="${esc(title || 'この付箋')} のファイル">
      <header class="round-note__head" data-rename-box>${head}</header>
      ${ms.length ? `<div class="round-note__files">${ms.map((m) => fileCard(m, course)).join('')}</div>` : '<p class="round-note__none">ここにファイルをドラッグ</p>'}
      <div class="round-notebook">${
        hasNote(ms) || !round
          ? ''
          : `<button type="button" class="btn btn--small btn--quiet" data-action="round-notebook" data-course-id="${esc(course.id)}" data-round-id="${esc(round.id)}" data-sub="${esc(sub)}" aria-haspopup="menu" title="この付箋のノートを作る（A4 縦。白い紙に青い罫線。横罫・方眼と行の間を選べます）">＋ ノート</button>`
      }<button type="button" class="btn btn--small btn--quiet" data-action="upload" data-course-id="${esc(course.id)}" data-sub="${esc(sub)}" title="この付箋にファイルを入れます（コピーします。元のファイルは残ります）">＋ ファイル</button><button type="button" class="btn btn--small btn--quiet round-notebook__del" data-action="sub-remove" data-course-id="${esc(course.id)}" data-sub="${esc(sub)}" data-name="${esc(title || 'この付箋')}" title="${sub ? 'この付箋を消します（パソコンのフォルダを中のファイルごとゴミ箱へ）' : 'この付箋を消します（フォルダの直下のファイルをゴミ箱へ。下のフォルダの付箋はそのまま）'}">付箋を消す</button></div>
    </section>`;
    })
    .join('');
  // クイズは付箋の中ではなく上に出す（このフォルダの資料から作る）
  const quizArea = round
    ? quizLine(round, list, course, quiz, gen, !!data.quiz?.key?.set, 'このフォルダ', {
        hintWhenNoKey: features(data.settings).quiz
      })
    : '';
  return `
    <nav class="page-nav page-nav--stickers">
      ${stickerLayer(sk.stickers, 'heading', data)}
      <button class="btn" data-action="nav" data-route="/">← ホーム</button>
      <h2 class="ja-wrap">${jaWrap(course.name)} <span class="muted">${esc(scopeLabel(course))}</span></h2>
      <button type="button" class="btn btn--quiet course-actions__more" data-action="course-menu" data-id="${esc(course.id)}" aria-haspopup="menu" aria-label="ほかの操作（フォルダを開く・読み直す・置き場所・ホームから外す・削除）" title="ほかの操作">⋯</button>
    </nav>
    ${quizArea ? `<section class="test-panel test-panel--folder" aria-label="このフォルダのクイズ">${quizArea}</section>` : ''}
    <div class="round-notes round-notes--folder" data-sort-scope="course:${esc(course.id)}">${notes}<button type="button" class="round-note-add" data-action="sub-add" data-course-id="${esc(course.id)}" title="新しい付箋を足します。いちばん後ろに、足した順に並びます（パソコンのフォルダの中にフォルダを作ります）"><span aria-hidden="true">＋</span>付箋を足す</button></div>`;
}
