// 授業画面（SPEC §8.2）：インデックスタブで回、紙片で資料。M0 は一覧と開くだけ（ドラッグ・クイズは M1・M3）。
import {esc} from '../app.js';

const ICON = {pdf: '📄', pptx: '📊', ppt: '📊', docx: '📝', doc: '📝', xlsx: '📈', csv: '📈', png: '🖼', jpg: '🖼', jpeg: '🖼', mp4: '🎬', mp3: '🎧'};
const iconOf = (name) => ICON[String(name).split('.').pop().toLowerCase()] ?? '📎';
const fmtDate = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');

export function renderCourse({data}, courseId) {
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) return `<div class="card"><p>授業が見つかりません。</p><button class="btn" data-action="nav" data-route="/">ホームへ</button></div>`;
  const rounds = (data.rounds[courseId] ?? []).slice().sort((a, b) => a.number - b.number);
  const materials = data.materials[courseId] ?? [];
  const byRound = new Map(rounds.map((r) => [r.id, materials.filter((m) => m.round_id === r.id && m.status !== 'trashed')]));
  const today = new Date().toLocaleDateString('sv-SE');
  const selectedId = location.hash.split('?r=')[1] ?? (rounds.filter((r) => r.number > 0 && r.date && r.date <= today).at(-1) ?? rounds.find((r) => r.number > 0) ?? rounds[0])?.id;
  const selected = rounds.find((r) => r.id === selectedId) ?? rounds[0];
  const slot = course.weekday ? `（${course.weekday}曜${course.period ? ` ${course.period}限` : ''}）` : '';
  const tabs = rounds
    .map(
      (r) =>
        `<button class="index-tab${byRound.get(r.id)?.length ? '' : ' index-tab--empty'}" role="tab" aria-selected="${r.id === selected?.id}" style="--tab-color: var(--c${course.color})" data-action="nav" data-route="/course/${esc(courseId)}?r=${esc(r.id)}" title="${esc(r.title ?? '')}">${r.number === 0 ? '他' : r.number}</button>`
    )
    .join('');
  const list = selected ? byRound.get(selected.id) ?? [] : [];
  return `
    <nav style="display:flex; gap: var(--space-2); align-items:center; margin-bottom: var(--space-3)">
      <button class="btn" data-action="nav" data-route="/">← ホーム</button>
      <h2>${esc(course.name)} <span class="muted">${esc(slot)}</span></h2>
      <span style="margin-left:auto"></span>
      <button class="btn" data-action="sync" data-course-id="${esc(courseId)}">この授業を同期</button>
      ${course.lms_url ? `<button class="btn" data-action="open-external" data-url="${esc(course.lms_url)}">LMS で開く</button>` : ''}
    </nav>
    <div style="display:flex; gap: var(--space-4); align-items:flex-start">
      <div class="index-tabs" role="tablist" aria-label="回">${tabs}</div>
      <section style="flex:1; min-width:0">
        ${
          selected
            ? `<h3 style="margin-bottom: var(--space-2)">${selected.number === 0 ? 'その他' : `第${selected.number}回`}${selected.title_user || selected.title ? ` ${esc(selected.title_user || selected.title)}` : ''} <span class="muted">${esc(fmtDate(selected.date))}</span></h3>`
            : ''
        }
        ${
          list.length
            ? `<div style="display:grid; gap: var(--space-1)">${list
                .map(
                  (m) => `<div class="slip">
                    <span aria-hidden="true">${iconOf(m.name)}</span>
                    <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(m.name)}${m.status === 'missing' ? ' <span class="muted">（見つかりません）</span>' : ''}</span>
                    ${!m.read_at && m.status === 'ok' ? `<span class="badge" style="--badge-color: var(--c${course.color})">未読</span>` : ''}
                    <button class="btn" data-action="open-material" data-id="${esc(m.id)}" ${m.status !== 'ok' ? 'disabled' : ''}>開く</button>
                    <button class="btn" data-action="reveal-material" data-id="${esc(m.id)}" aria-label="フォルダで表示">📁</button>
                  </div>`
                )
                .join('')}</div>`
            : `<div class="empty"><p>この回の資料はまだありません。</p></div>`
        }
      </section>
    </div>`;
}
