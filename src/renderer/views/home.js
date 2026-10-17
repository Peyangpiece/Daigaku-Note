// ホーム（SPEC §8.1）：罫線ノートの上に、マスキングテープで貼った授業フォルダ。
import {esc} from '../app.js';

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
  const sub = course.weekday ? `${course.weekday}曜${course.period ? ` ${course.period}限` : ''}` : '';
  const badges = [
    course.unread ? `<span class="badge" style="--badge-color: var(--c${course.color})">新着 ${course.unread}</span>` : '',
    course.review ? `<span class="badge">復習 ${course.review}</span>` : ''
  ].join('');
  return `<button class="folder${course.hidden ? ' folder--hidden' : ''}" data-action="open-course" data-id="${esc(course.id)}" aria-label="${esc(course.name)}">
    <span class="tape tape--${esc(course.tape_pattern)}" style="--tape-color: var(--c${course.color}); --tape-angle: ${tapeAngle(course.id)}deg"></span>
    <span class="folder__name">${esc(course.name)}</span>
    <span class="folder__sub">${esc(sub)}</span>
    <span class="folder__badges">${badges}</span>
  </button>`;
}

export function renderHome({data, progress}) {
  const courses = data.courses.filter((c) => !c.hidden);
  const hidden = data.courses.filter((c) => c.hidden);
  const last = data.lastSync;
  const status = progress
    ? `同期中 ${progress.current}/${progress.total}（${esc(progress.courseName)}）`
    : last
      ? `前回の同期 ${new Date(last.finished_at).toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'})}（授業 ${last.courses} 件・資料 ${last.materials} 件保存・失敗 ${last.failures} 件）`
      : 'まだ同期していません';
  const attention = data.connections.filter((c) => c.status === 'login-required').map((c) => `${esc(c.label)} へのログインが必要です（設定 → 接続）`);
  if (data.browser?.state === 'failed') attention.push(`ブラウザの準備に失敗しました。<button class="btn" data-action="install-browser">準備し直す</button><br><small>${esc(data.browser.message)}</small>`);
  const preparing = data.browser?.state === 'pending';
  const syncing = !!progress || (data.jobs ?? []).some((j) => j.kind === 'sync');
  return `
    ${attention.length ? `<aside class="sticky" style="position:absolute; right: 48px; top: 112px; --sticky-color: var(--c2)"><strong>要確認</strong><br>${attention.join('<br>')}</aside>` : ''}
    ${
      courses.length
        ? `<section class="folders" aria-label="授業">${courses.map(folderCard).join('')}${hidden.length ? `<button class="folder folder--hidden" data-action="nav" data-route="/settings"><span class="tape"></span><span class="folder__name">非表示 ${hidden.length}</span><span class="folder__sub"></span><span class="folder__badges"></span></button>` : ''}</section>`
        : `<div class="empty"><p>まだ授業がありません。同期すると、ここにフォルダが貼られます。</p><button class="btn btn--primary" data-action="sync">同期する</button></div>`
    }
    <footer style="margin-top: var(--space-6); display:flex; gap: var(--space-3); align-items:center">
      <button class="btn" data-action="sync" ${syncing ? 'disabled' : ''}>${syncing ? '同期中…' : '同期'}</button>
      <span class="muted" id="sync-status">${preparing ? 'LMS を読むためのブラウザを準備しています（初回だけ。数分かかります）。終わると同期が始まります。' : status}</span>
      <span style="margin-left:auto"></span>
      <button class="btn" data-action="open-root">資料のフォルダ</button>
      <button class="btn" data-action="nav" data-route="/settings" aria-label="設定">⚙ 設定</button>
    </footer>`;
}
