// 学期の設定（SPEC §6.14・§12.2）。セットアップの手順 4 と、設定 → 学期 の編集画面で同じ入力欄を使う。
import {esc, navigate, reload, toast} from '../app.js';

const api = window.daigaku;
const LABELS = [
  '前期',
  '後期',
  '春学期',
  '秋学期',
  '第1クォーター',
  '第2クォーター',
  '第3クォーター',
  '第4クォーター',
  '通年'
];
let editingId; // undefined = いちばん新しい学期、null = 新しい学期を追加

/** 設定から入り直したときは、いちばん新しい学期から（app.js が呼ぶ） */
export function resetTerm() {
  editingId = undefined;
}

/** 年度は 4 月はじまり（1〜3 月は前の年度）。学期名は 4〜9 月なら春学期、それ以外は秋学期 */
function defaults() {
  const d = new Date();
  const m = d.getMonth() + 1;
  return {year: m < 4 ? d.getFullYear() - 1 : d.getFullYear(), label: m >= 4 && m <= 9 ? '春学期' : '秋学期'};
}

/** 入力欄。term があればその値を入れる（id は tm-*） */
export function termForm(data, term) {
  const d = defaults();
  const year = term?.year ?? d.year;
  const label = term?.label ?? d.label;
  return `<div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-2)">
      <label>年度<input class="input" id="tm-year" type="number" value="${esc(year)}"></label>
      <label>学期<select class="input" id="tm-label">${LABELS.map((l) => `<option ${l === label ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>開始日<input class="input" id="tm-start" type="date" value="${esc(term?.start_date ?? '')}"></label>
      <label>終了日<input class="input" id="tm-end" type="date" value="${esc(term?.end_date ?? '')}"></label>
      <label>回数<select class="input" id="tm-rounds">${[15, 14, 8, 7].map((n) => `<option ${n === (term?.rounds ?? 15) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>時限の開始時刻<select class="input" id="tm-preset"><option value="">${term?.periods_json ? '（いまの設定のまま）' : '（あとで設定）'}</option>${(data.presets ?? []).map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
    </div>
    <p class="muted">開始日・終了日を空にすると学期名からの既定（春・前期 4/1〜9/30、秋・後期 10/1〜3/31）になります。</p>`;
}

/** 入力欄から term.save に渡す値。時限と休みの日は、選び直さなければいまの設定を引き継ぐ */
export function readTermForm(term) {
  const $ = (id) => document.getElementById(id);
  const preset = $('tm-preset').value;
  return {
    year: Number($('tm-year').value),
    label: $('tm-label').value,
    start: $('tm-start').value,
    end: $('tm-end').value,
    rounds: Number($('tm-rounds').value),
    preset,
    periods: !preset && term?.periods_json ? JSON.parse(term.periods_json) : undefined,
    holidays: term?.holidays_json ? JSON.parse(term.holidays_json) : []
  };
}

export function renderTerm({data}) {
  const terms = data.terms ?? [];
  if (editingId === undefined || (editingId && !terms.some((t) => t.id === editingId)))
    editingId = terms.at(-1)?.id ?? null;
  const term = terms.find((t) => t.id === editingId) ?? null;
  queueMicrotask(() => bind(term));
  return `
    <nav class="page-nav">
      <button class="btn" data-action="nav" data-route="/settings">← 設定</button><h2>学期</h2>
    </nav>
    <section class="card" style="max-width: 760px">
      <label style="display:block; margin-bottom: var(--space-2)">編集する学期<select class="input" id="tm-pick" data-keep="off">${terms.map((t) => `<option value="${esc(t.id)}" ${t.id === editingId ? 'selected' : ''}>${t.year} ${esc(t.label)}</option>`).join('')}<option value="" ${editingId === null ? 'selected' : ''}>＋ 新しい学期を追加</option></select></label>
      <div data-form="${esc(editingId ?? 'new')}">${termForm(data, term)}</div>
      ${term ? '<p class="muted">年度か学期名を変えて保存すると、別の学期として追加されます（いまの学期はそのまま残ります）。</p>' : ''}
      <div class="actions"><button class="btn btn--primary" id="tm-save">保存</button></div>
    </section>`;
}

function bind(term) {
  const $ = (id) => document.getElementById(id);
  if ($('tm-pick'))
    $('tm-pick').onchange = (e) => {
      editingId = e.target.value || null;
      reload();
    };
  if ($('tm-save'))
    $('tm-save').onclick = async () => {
      const r = await api['term.save']({term: readTermForm(term)});
      if (r.error) return toast(r.error, {error: true});
      editingId = r.term?.id ?? editingId;
      toast('学期を保存しました');
      navigate('/settings');
    };
}
