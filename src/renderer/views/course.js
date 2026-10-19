// 授業画面（SPEC §8.2）：回ごとのクリップボードに、資料がイラスト付きの紙で留めてある。M0 は一覧と開くだけ（ドラッグ・クイズは M1・M3）。
import {esc} from '../app.js';
import {extOf, fileArt} from './file-art.js';

const fmtDate = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${'日月火水木金土'[new Date(d + 'T00:00:00').getDay()]}）` : '');

// shared/ids.js の hash32 と同じ（レンダラは main のモジュールを読まないので写す）。クリップボードごとの小さな傾き
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
  const tag =
    m.source === 'notice'
      ? '<span class="file__tag">お知らせ</span>'
      : m.source === 'export'
        ? '<span class="file__tag">書き出し</span>'
        : '';
  // PDF はアプリ内のビューアで開いて編集する。書き出した PDF（§9.7：注釈の対象にしない）とほかの種類は OS の既定のアプリで開く
  const action = extOf(m.name) === 'pdf' && m.source !== 'export' ? 'open-pdf' : 'open-material';
  return `<div class="file${ok ? '' : ' file--missing'}">
    <button class="file__open" data-action="${action}" data-id="${esc(m.id)}" ${ok ? '' : 'disabled'} title="${esc(m.name)}${ok ? '' : '（見つかりません）'}">
      ${fileArt(m.name)}
      ${!m.read_at && ok ? `<span class="file__dot" style="--dot-color: var(--c${course.color})" aria-label="未読"></span>` : ''}
      <span class="file__name">${esc(m.name)}</span>
    </button>
    ${tag}
    <button class="file__reveal" data-action="reveal-material" data-id="${esc(m.id)}" aria-label="フォルダで表示" title="フォルダで表示">📁</button>
  </div>`;
}

function clipboard(round, list, course, today) {
  const isToday = round.date === today;
  const head = round.number === 0 ? 'その他' : `第${round.number}回`;
  const title = round.title_user || round.title || '';
  return `<section class="clipboard${list.length ? '' : ' clipboard--empty'}${isToday ? ' clipboard--today' : ''}" style="--tilt: ${tilt(round.id)}deg" aria-label="${esc(head)} ${esc(title)}">
    <span class="clipboard__clip" aria-hidden="true"></span>
    <header class="clipboard__head">
      <span class="clipboard__round" style="--round-color: var(--c${course.color})">${esc(head)}</span>
      <span class="clipboard__title">${esc(title)}</span>
      <span class="clipboard__date muted">${esc(fmtDate(round.date))}</span>
    </header>
    ${list.length ? `<div class="clipboard__files">${list.map((m) => fileCard(m, course)).join('')}</div>` : `<p class="clipboard__none">まだ資料はありません</p>`}
  </section>`;
}

export function renderCourse({data}, courseId) {
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) return `<div class="card"><p>授業が見つかりません。</p><button class="btn" data-action="nav" data-route="/">ホームへ</button></div>`;
  const rounds = (data.rounds[courseId] ?? []).slice().sort((a, b) => (a.number === 0 ? 1 : b.number === 0 ? -1 : a.number - b.number));
  const materials = (data.materials[courseId] ?? []).filter((m) => m.status !== 'trashed');
  const byRound = new Map(rounds.map((r) => [r.id, materials.filter((m) => m.round_id === r.id)]));
  const today = new Date().toLocaleDateString('sv-SE');
  const slot = course.weekday ? `（${course.weekday}曜${course.period ? ` ${course.period}限` : ''}）` : '';
  // 「その他」は資料があるときだけ出す。回は資料の有無にかかわらず全部出す（空のボードも並ぶ）
  const shown = rounds.filter((r) => r.number > 0 || byRound.get(r.id)?.length);
  const syncing = (data.jobs ?? []).some((j) => j.kind === 'sync');
  return `
    <nav style="display:flex; gap: var(--space-2); align-items:center; margin-bottom: var(--space-3); flex-wrap: wrap">
      <button class="btn" data-action="nav" data-route="/">← ホーム</button>
      <h2>${esc(course.name)} <span class="muted">${esc(slot)}</span></h2>
      <span style="margin-left:auto"></span>
      <button class="btn" data-action="sync" data-course-id="${esc(courseId)}" ${syncing ? 'disabled' : ''}>この授業を同期</button>
      <button class="btn" data-action="sync" data-course-id="${esc(courseId)}" data-full="1" ${syncing ? 'disabled' : ''} title="過去の回も含めて、LMS にある資料を全部確かめます">全部の回を確かめる</button>
      ${course.lms_url ? `<button class="btn" data-action="open-external" data-url="${esc(course.lms_url)}">LMS で開く</button>` : ''}
    </nav>
    ${
      shown.length
        ? `<div class="clipboards">${shown.map((r) => clipboard(r, byRound.get(r.id) ?? [], course, today)).join('')}</div>`
        : `<div class="empty"><p>まだ回がありません。同期すると、回ごとのクリップボードがここに並びます。</p></div>`
    }`;
}
