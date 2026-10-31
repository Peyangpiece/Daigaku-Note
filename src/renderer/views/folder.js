// 自分のフォルダ：作る・パソコンのフォルダを登録する画面と、フォルダの中身の画面。
// 中身はパソコンのフォルダをそのまま見せる（登録したフォルダはコピーしない）。開くたびにメインが読み直す
import {esc, jaWrap} from '../ui-kit.js';
import {fileCard, quizLine} from './course.js';
import {skinOf, stickerLayer} from '../skin.js';
import {roundColorIndex} from '../../shared/skin.js';
import {features} from '../../shared/profile.js';

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
      <label><input type="radio" name="fn-each" value="each"${each ? ' checked' : ''}> 中のフォルダを 1 つずつ登録する <span class="muted">（授業ごとのフォルダが入ったフォルダを選ぶとき。名前はそれぞれのフォルダの名前）</span></label>
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
          ? `<p class="muted">保存先の中にフォルダを作ります。ファイルはあとからドラッグか「ファイルを追加」で入れます（元のファイルは残ります）。</p>
        <label for="fn-name">フォルダの名前</label>
        <input class="input" id="fn-name" type="text" maxlength="80" placeholder="例：ゼミ・就活・資格の勉強" autocomplete="off">`
          : `<p class="muted">パソコンのフォルダを、コピーせずにそのまま開きます。中身の変更は次に開いたときに反映されます。</p>
        ${eachChoice(data)}
        <label for="fn-name">大学ノートでの名前 <span class="muted">（1 つ登録するとき。空ならフォルダの名前）</span></label>
        <input class="input" id="fn-name" type="text" maxlength="80" autocomplete="off">`
      }
      ${scopeChoice(useTerms)}
      ${noTerm && useTerms ? '<p class="muted">学期が未設定のため、今日の日付から仮の学期を作ります（設定 → 学期 で直せます）。</p>' : ''}
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
  const colorOf = (i) =>
    sk.sticky.round === 'default' ? `var(--pop${roundColorIndex(i + 1) + 1})` : sk.sticky.round[roundColorIndex(i + 1)];
  const parts = list.length ? groups(list) : [['', []]];
  const notes = parts
    .map(
      (
        [sub, ms],
        i
      ) => `<section class="round-note round-note--folder" style="--note-color: ${colorOf(i)}" data-drop="own" data-course-id="${esc(course.id)}" aria-label="${esc(sub || course.name)} のファイル">
      <header class="round-note__head" data-rename-box><span class="round-note__round">${sub ? '📁 ' : ''}<span data-rename-target>${esc(sub ? sub.split('/').pop() : course.name)}</span></span>
        <button type="button" class="rename-btn" data-action="rename" data-what="${sub ? 'sub' : 'folder'}" data-id="${esc(course.id)}" data-sub="${esc(sub)}" data-value="${esc(sub ? sub.split('/').pop() : course.name)}" title="${sub ? 'フォルダの名前を変える（パソコンのフォルダの名前も変わります）' : 'フォルダの名前を変える'}" aria-label="名前を変える">✎</button></header>
      ${ms.length ? `<div class="round-note__files">${ms.map((m) => fileCard(m, course, [])).join('')}</div>` : '<p class="round-note__none">ここにファイルをドラッグして入れます。</p>'}
      ${i === 0 && round ? quizLine(round, list, course, quiz, gen, !!data.quiz?.key?.set, 'このフォルダ', {hintWhenNoKey: features(data.settings).quiz}) : ''}
    </section>`
    )
    .join('');
  return `
    <nav class="page-nav page-nav--stickers">
      ${stickerLayer(sk.stickers, 'heading', data)}
      <button class="btn" data-action="nav" data-route="/">← ホーム</button>
      <h2 class="ja-wrap">${jaWrap(course.name)} <span class="muted">${esc(scopeLabel(course))}</span></h2>
    </nav>
    <div class="course-actions">
      <button class="btn btn--primary" data-action="upload" data-course-id="${esc(course.id)}">ファイルを追加…</button>
      <button class="btn btn--quiet" data-action="folder-reveal" data-course-id="${esc(course.id)}">フォルダを開く</button>
      <button class="btn btn--quiet" data-action="folder-scan" data-course-id="${esc(course.id)}">読み直す</button>
      ${features(data.settings).terms ? `<button class="btn btn--quiet" data-action="folder-scope" data-course-id="${esc(course.id)}" data-scope="${course.scope === 'always' ? 'term' : 'always'}">${course.scope === 'always' ? '今学期のフォルダにする' : 'マイフォルダにする'}</button>` : ''}
      <button class="btn btn--quiet" data-action="folder-hide" data-course-id="${esc(course.id)}">ホームから外す</button>
    </div>
    <p class="muted course-help">パソコンの「${esc(course.dirName ?? '')}」フォルダの中身です。フォルダの名前は ✎ かダブルクリックで変えられます。ファイルの削除は Finder（Windows はエクスプローラー）で行い、「読み直す」で反映します。</p>
    <div class="round-notes round-notes--folder">${notes}</div>`;
}
