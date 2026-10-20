// ホーム（SPEC §8.1）：罫線ノートの上に、マスキングテープで貼った授業フォルダ。
import {esc, jaWrap, progressText} from '../app.js';
import {browserState} from './settings.js';
import {folderShown, scopeLabel} from './folder.js';

// shared/ids.js の tapeAngle と同じ計算（レンダラは main のモジュールを読まないので写す）
function hash32(str) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(str)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const tapeAngle = (id) => (hash32(id) % 13) - 6;

export function folderCard(course) {
  const sub =
    course.kind === 'folder'
      ? scopeLabel(course)
      : course.weekday
        ? `${course.weekday}曜${course.period ? ` ${course.period}限` : ''}`
        : '';
  const badges = [
    course.unread
      ? `<span class="badge" style="--badge-color: var(--c${course.color})">新着 ${course.unread}</span>`
      : '',
    course.review ? `<span class="badge">復習 ${course.review}</span>` : ''
  ].join('');
  return `<button class="folder${course.hidden ? ' folder--hidden' : ''}${course.kind === 'folder' ? ' folder--mine' : ''}" data-action="open-course" data-id="${esc(course.id)}">
    <span class="tape tape--${esc(course.tape_pattern)}" style="--tape-color: var(--c${course.color}); --tape-angle: ${tapeAngle(course.id)}deg"></span>
    <span class="folder__name ja-wrap">${jaWrap(course.name)}</span>
    <span class="folder__sub">${esc(sub)}</span>
    <span class="folder__badges">${badges}</span>
  </button>`;
}

export function renderHome({data, progress}) {
  const courses = data.courses.filter((c) => !c.hidden && c.kind !== 'folder');
  const hidden = data.courses.filter((c) => c.hidden);
  // 自分のフォルダ：マイフォルダと今学期のフォルダ。前の学期のフォルダは畳んで下に
  const mine = data.courses.filter((c) => c.kind === 'folder' && !c.hidden);
  const shown = mine.filter((c) => folderShown(c, data.currentTermId));
  const past = mine.filter((c) => !folderShown(c, data.currentTermId));
  const myFolders = `<section class="my-folders" aria-labelledby="my-folders-title">
      <h2 class="my-folders__title" id="my-folders-title">自分のフォルダ</h2>
      ${shown.length ? `<div class="folders">${shown.map(folderCard).join('')}</div>` : '<p class="muted">自分でフォルダを作ったり、パソコンのフォルダを登録したりできます。</p>'}
      <div class="actions">
        <button class="btn" data-action="nav" data-route="/folder-new?mode=new">＋ フォルダを作る</button>
        <button class="btn" data-action="nav" data-route="/folder-new?mode=link">＋ パソコンのフォルダを登録</button>
      </div>
      ${past.length ? `<details class="my-folders__past" id="my-folders-past"><summary>前の学期のフォルダ ${past.length}</summary><div class="folders">${past.map(folderCard).join('')}</div></details>` : ''}
    </section>`;
  const last = data.lastSync;
  const status = progress
    ? esc(progressText(progress))
    : last
      ? `前回の同期 ${new Date(last.finished_at).toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'})}（授業 ${last.courses} 件・資料 ${last.materials} 件保存・失敗 ${last.failures} 件）`
      : 'まだ同期していません';
  const attention = data.connections
    .filter((c) => c.status === 'login-required')
    .map(
      (c) =>
        `<li>${esc(c.label)} へのログインが必要です。<button class="btn btn--small" data-action="login" data-id="${esc(c.id)}">ログイン窓を開く</button></li>`
    );
  // LMS の登録は任意。つないでいなければ、同期のボタンとブラウザの準備の知らせは出さない
  const hasLms = data.connections.some((c) => c.kind !== 'manual' && c.status !== 'disabled');
  if (hasLms && data.browser?.state === 'failed')
    attention.push(
      `<li>LMS を読むためのブラウザの${browserState(data.browser)}<button class="btn btn--small" data-action="install-browser">準備し直す</button></li>`
    );
  const preparing = data.browser?.state === 'pending';
  const syncing = !!progress || (data.jobs ?? []).some((j) => j.kind === 'sync');
  return `
    <div class="home${attention.length ? ' home--attention' : ''}">
      ${attention.length ? `<aside class="sticky attention" style="--sticky-color: var(--c2)" aria-labelledby="attention-title"><strong id="attention-title">要確認</strong><ul>${attention.join('')}</ul></aside>` : ''}
      ${
        courses.length
          ? `<section class="folders" aria-label="授業">${courses.map(folderCard).join('')}${hidden.length ? `<button class="folder folder--hidden" data-action="nav" data-route="/settings"><span class="tape"></span><span class="folder__name">非表示 ${hidden.length}</span><span class="folder__sub">設定で戻せます</span><span class="folder__badges"></span></button>` : ''}</section>`
          : hasLms
            ? `<div class="empty"><p>まだ授業がありません。同期すると、ここにフォルダが貼られます。</p><button class="btn btn--primary" data-action="sync" ${syncing ? 'disabled' : ''}>同期する</button></div>`
            : `<div class="empty"><p>LMS をつなぐと、授業の資料を自動で集めて、ここに授業のフォルダを貼ります（任意）。</p><button class="btn" data-action="nav" data-route="/setup">LMS をつなぐ</button></div>`
      }
      ${myFolders}
    </div>
    <footer class="home-foot">
      ${data.quiz?.reviewDue ? `<button class="btn btn--primary" data-action="nav" data-route="/review">今日の復習 ${data.quiz.reviewDue} 問</button>` : ''}
      ${
        hasLms
          ? `<button class="btn" data-action="sync" ${syncing ? 'disabled' : ''}>${syncing ? '同期中…' : '同期'}</button>
      <span class="muted" id="sync-status" role="status">${preparing ? 'LMS を読むためのブラウザを準備しています（初回だけ。数分かかります）。終わると同期が始まります。' : status}</span>`
          : ''
      }
      <span style="margin-left:auto"></span>
      <button class="btn" data-action="open-root">資料のフォルダ</button>
      <button class="btn" data-action="nav" data-route="/settings">⚙ 設定</button>
    </footer>`;
}
