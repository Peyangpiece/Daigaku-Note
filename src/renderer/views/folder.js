// 自分のフォルダ：作る・パソコンのフォルダを登録する画面と、フォルダの中身の画面。
// 中身はパソコンのフォルダをそのまま見せる（登録したフォルダはコピーしない）。開くたびにメインが読み直す
import {esc, jaWrap} from '../app.js';
import {fileCard, quizLine} from './course.js';

const SCOPE_LABEL = {term: '今学期のフォルダ', always: 'マイフォルダ'};
export const scopeLabel = (c) => SCOPE_LABEL[c.scope] ?? SCOPE_LABEL.always;

/** ホームに出すか：マイフォルダはいつも、今学期のフォルダはその学期のあいだだけ */
export const folderShown = (c, currentTermId) => c.scope === 'always' || c.term_id === currentTermId;

function scopeChoice(selected = 'term') {
  return `<fieldset class="folder-new__scope">
      <legend>どこに置きますか</legend>
      <label><input type="radio" name="fn-scope" value="term"${selected === 'term' ? ' checked' : ''}> 今学期のフォルダ <span class="muted">（今学期のあいだホームに出ます）</span></label>
      <label><input type="radio" name="fn-scope" value="always"${selected === 'always' ? ' checked' : ''}> マイフォルダ <span class="muted">（学期が変わっても残ります）</span></label>
    </fieldset>`;
}

/** /folder-new?mode=new|link */
export function renderFolderNew({data}, route) {
  const mode = new URLSearchParams(route.split('?')[1] ?? '').get('mode') === 'link' ? 'link' : 'new';
  const noTerm = !data.terms.length;
  return `
    <nav class="page-nav">
      <button class="btn" data-action="nav" data-route="/">← ホーム</button>
      <h2>${mode === 'new' ? 'フォルダを作る' : 'パソコンのフォルダを登録'}</h2>
    </nav>
    <section class="card folder-new" data-form="folder-new-${mode}">
      ${
        mode === 'new'
          ? `<p class="muted">資料の保存先の中に新しいフォルダを作ります。あとから「ファイルを追加」かドラッグで、パソコンのファイルを入れられます（元のファイルはそのまま残り、コピーが入ります）。</p>
        <label for="fn-name">フォルダの名前</label>
        <input class="input" id="fn-name" type="text" maxlength="80" placeholder="例：ゼミ・就活・資格の勉強" autocomplete="off">`
          : `<p class="muted">パソコンにあるフォルダを、コピーせずにそのまま大学ノートで開けるようにします。フォルダにファイルを足したり消したりすると、次に開いたときに反映されます。大学ノートで追加したファイルも、そのフォルダに入ります。</p>
        <label for="fn-name">大学ノートでの名前 <span class="muted">（空ならフォルダの名前）</span></label>
        <input class="input" id="fn-name" type="text" maxlength="80" autocomplete="off">`
      }
      ${scopeChoice()}
      ${noTerm ? '<p class="muted">先に学期を設定してください（設定 → 学期）。</p>' : ''}
      <div class="actions">
        <button class="btn btn--primary" data-action="folder-create" data-mode="${mode}" ${noTerm ? 'disabled' : ''}>${mode === 'new' ? '作る' : 'フォルダを選んで登録…'}</button>
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
  const files = groups(list)
    .map(
      ([sub, ms]) =>
        `${sub ? `<h3 class="folder-page__sub">📁 ${esc(sub)}</h3>` : ''}<div class="round-note__files">${ms.map((m) => fileCard(m, course, [])).join('')}</div>`
    )
    .join('');
  return `
    <nav class="page-nav">
      <button class="btn" data-action="nav" data-route="/">← ホーム</button>
      <h2 class="ja-wrap">${jaWrap(course.name)} <span class="muted">${esc(scopeLabel(course))}</span></h2>
    </nav>
    <div class="course-actions">
      <button class="btn btn--primary" data-action="upload" data-course-id="${esc(course.id)}">ファイルを追加…</button>
      <button class="btn btn--quiet" data-action="folder-reveal" data-course-id="${esc(course.id)}">フォルダを開く</button>
      <button class="btn btn--quiet" data-action="folder-scan" data-course-id="${esc(course.id)}">読み直す</button>
      <button class="btn btn--quiet" data-action="folder-scope" data-course-id="${esc(course.id)}" data-scope="${course.scope === 'always' ? 'term' : 'always'}">${course.scope === 'always' ? '今学期のフォルダにする' : 'マイフォルダにする'}</button>
      <button class="btn btn--quiet" data-action="folder-hide" data-course-id="${esc(course.id)}">ホームから外す</button>
    </div>
    <p class="muted course-help">パソコンの「${esc(course.dirName ?? '')}」フォルダの中身をそのまま表示しています。追加したファイルはこのフォルダにコピーされます。ファイルの名前の変更や削除は Finder（Windows はエクスプローラー）で行い、「読み直す」で反映します。</p>
    <section class="round-note round-note--own round-note--folder" data-drop="own" data-course-id="${esc(course.id)}" aria-label="${esc(course.name)} のファイル">
      ${list.length ? files : '<p class="round-note__none">まだファイルがありません。ここにドラッグするか「ファイルを追加」で入れます。</p>'}
      ${round ? quizLine(round, list, course, quiz, gen, !!data.quiz?.key?.set, 'このフォルダ') : ''}
    </section>`;
}
