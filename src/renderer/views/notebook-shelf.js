// 持ち物の「ノート」（docs/SPEC-NOTEBOOK.md）：持っているノート（Palette）とマイノート、回のノートを作るときに最初に選ぶ紙、
// マイノートの調節の画面（左にページの見本、右に線の色・太さ・行の間・ページ上部の線・余白の線・紙の色）。
// ページの見本は shared/notebooks.js の pageSvg（PDF と同じ計算）
import {confirmDialog, esc, toast} from '../ui-kit.js';
import {navigate, refresh, state} from '../store.js';
import {itemOf, stationeryState} from '../../shared/stationery.js';
import {
  FORMATS,
  GAP_RANGE,
  GAP_STEP,
  HEADS,
  HEAD_LABEL,
  KIND_LABEL,
  LINE_SWATCHES,
  MY_NOTES_MAX,
  PAPER_SWATCHES,
  WEIGHTS,
  WEIGHT_LABEL,
  cleanDesign,
  coverArt,
  cropOf,
  gapFixed,
  pageSvg
} from '../../shared/notebooks.js';
import {openNoteTry} from './notebook-try.js';

const api = window.daigaku;
export const NOTES = '/fudebako?tab=notes';
const st = () => stationeryState(state.data?.stationery);

/** 札の絵：表紙と、ページの左上を拡大した見本（罫線がはっきり見える大きさ） */
export function cardArt(item, design) {
  return `${coverArt(item, {width: 64})}<span class="nb-card__page">${pageSvg(design, {width: 92, thumb: true, crop: cropOf(design)})}</span>`;
}

/** 罫の説明（種類・幅） */
export function formatSpec(design) {
  const d = cleanDesign(design);
  const f = FORMATS[d.format];
  if (f.kind === 'plain') return '無地';
  if (['genkou'].includes(f.kind)) return `${KIND_LABEL[f.kind]}・ます ${d.gap} mm`;
  if (['english', 'staff'].includes(f.kind)) return `${KIND_LABEL[f.kind]}・線の間 ${d.gap} mm`;
  if (['grid', 'dotgrid', 'kanji'].includes(f.kind)) return `${KIND_LABEL[f.kind]}・${d.gap} mm`;
  return `${KIND_LABEL[f.kind]}・行の間 ${d.gap} mm`;
}

// ---- 持ち物の「ノート」 ----

/** 最初に選ぶ紙の印・ボタン */
function defaultButton(s, key) {
  return s.noteDefault === key
    ? '<span class="nb-badge">最初に選ぶ紙</span>'
    : `<button type="button" class="btn btn--small btn--quiet" data-nb="default" data-key="${esc(key)}">最初に選ぶ紙にする</button>`;
}

export function notesPage() {
  const s = st();
  const books = s.owned.map(itemOf).filter((it) => it?.type === 'notebook');
  const mine = s.myNotes
    .map((n) => {
      const base = itemOf(n.base);
      return `<div class="nb-card${s.noteDefault === n.id ? ' is-in' : ''}">
        <button type="button" class="nb-card__art" data-action="nav" data-route="${NOTES}&edit=${encodeURIComponent(n.id)}" aria-label="${esc(n.name)}を調節する">
          ${cardArt(base, n.design)}
        </button>
        <div class="nb-card__name">${esc(n.name)}</div>
        <div class="muted nb-card__spec">${esc(formatSpec(n.design))}</div>
        <div class="nb-card__act">
          <button type="button" class="btn btn--small" data-action="nav" data-route="${NOTES}&edit=${encodeURIComponent(n.id)}">調節する</button>
          ${defaultButton(s, n.id)}
          <button type="button" class="btn btn--small btn--quiet" data-nb="remove" data-id="${esc(n.id)}" aria-label="${esc(n.name)}を消す">消す</button>
        </div>
      </div>`;
    })
    .join('');
  const owned = books
    .map(
      (it) => `<div class="nb-card${s.noteDefault === it.id ? ' is-in' : ''}">
        <button type="button" class="nb-card__art" data-action="nav" data-route="${NOTES}&base=${encodeURIComponent(it.id)}" aria-label="${esc(it.name)}をもとにマイノートを作る">${cardArt(it, {format: it.format})}</button>
        <div class="nb-card__name">${esc(it.name)}</div>
        ${gapFixed(it.format) ? '' : `<div class="muted nb-card__spec">${esc(formatSpec({format: it.format}))}</div>`}
        <div class="nb-card__act">
          <button type="button" class="btn btn--small" data-action="nav" data-route="${NOTES}&base=${encodeURIComponent(it.id)}">調節してマイノートに</button>
          ${defaultButton(s, it.id)}
        </div>
      </div>`
    )
    .join('');
  return `
    <section class="fb-group"><h3>マイノート <span class="muted nb-count">${s.myNotes.length} / ${MY_NOTES_MAX}</span></h3>
      ${mine ? `<div class="nb-grid">${mine}</div>` : '<p class="muted">まだありません</p>'}
    </section>
    <section class="fb-group"><h3>持っているノート</h3><div class="nb-grid">${owned}</div>
      <p><button type="button" class="btn" data-action="nav" data-route="/fudebako?tab=shop&type=notebook">ショップでほかのノートを見る</button></p>
    </section>`;
}

// ---- マイノートの調節 ----

/** 調節中の紙。route の edit（マイノートの id）か base（ノートの id）が変わったら作り直す */
const draft = {key: '', id: null, name: '', base: '', design: null};

function startDraft(s, params) {
  const edit = params.get('edit');
  const base = params.get('base');
  const key = edit ? `edit:${edit}` : `base:${base}`;
  if (draft.key === key && draft.design) return true;
  if (edit) {
    const n = s.myNotes.find((x) => x.id === edit);
    if (!n) return false;
    Object.assign(draft, {key, id: n.id, name: n.name, base: n.base, design: {...n.design}});
    return true;
  }
  const it = itemOf(base);
  if (!it || it.type !== 'notebook' || !s.owned.includes(it.id)) return false;
  Object.assign(draft, {
    key,
    id: null,
    name: `${FORMATS[it.format].name}（マイノート）`,
    base: it.id,
    design: cleanDesign({format: it.format})
  });
  return true;
}

/** 見本の幅：原稿用紙（A4 横）は横に広く */
const previewWidth = () => (FORMATS[cleanDesign(draft.design).format].landscape ? 460 : 340);

const swatches = (field, list, now) =>
  `<span class="nb-swatches" role="group">${list
    .map(
      (c) =>
        `<button type="button" class="nb-swatch${c === now ? ' is-on' : ''}" data-nbd="${field}" data-v="${c}" style="--sw:${c}" aria-pressed="${c === now}" title="${c}"><span class="sr-only">${c}</span></button>`
    )
    .join(
      ''
    )}<label class="nb-swatch nb-swatch--pick" title="ほかの色"><input type="color" data-nbd="${field}" value="${now}" aria-label="ほかの色" /></label></span>`;

function controls() {
  const d = cleanDesign(draft.design);
  const f = FORMATS[d.format];
  const [lo, hi] = GAP_RANGE[f.kind];
  const rows = [];
  const row = (label, html) =>
    rows.push(`<div class="nb-row"><span class="nb-row__label">${label}</span><div>${html}</div></div>`);
  row(
    '名前',
    `<input class="input" data-nbd="name" maxlength="30" value="${esc(draft.name)}" aria-label="マイノートの名前" />`
  );
  const gapLabel =
    f.kind === 'grid' || f.kind === 'dotgrid' || f.kind === 'kanji' || f.kind === 'genkou'
      ? 'ますの大きさ'
      : f.kind === 'english' || f.kind === 'staff'
        ? '線の間'
        : '行の間';
  // 幅が名前に書いてあるノートは、幅を変えられない（その幅のノート。gapFixed）
  if (gapFixed(d.format)) row(gapLabel, `<b>${d.gap} mm</b>`);
  else if (lo < hi)
    row(
      gapLabel,
      `<input type="range" min="${lo}" max="${hi}" step="${GAP_STEP}" value="${d.gap}" data-nbd="gap" aria-label="幅（mm）" /> <b id="nb-gap">${d.gap} mm</b>`
    );
  if (f.kind !== 'plain') row('罫線の色', swatches('line', LINE_SWATCHES, d.line));
  if (f.kind !== 'plain')
    row(
      '線の太さ',
      Object.keys(WEIGHTS)
        .map(
          (k) =>
            `<button type="button" class="shop-chip${d.weight === k ? ' is-on' : ''}" data-nbd="weight" data-v="${k}" aria-pressed="${d.weight === k}">${WEIGHT_LABEL[k]}</button>`
        )
        .join('')
    );
  if (f.kind === 'ruled' || f.kind === 'dotruled')
    row(
      '罫線の点',
      `<label><input type="checkbox" data-nbd="dots" ${d.dots ? 'checked' : ''}/> 罫線の上に点を打つ</label>`
    );
  if (f.kind === 'grid')
    row(
      '太線',
      `<select data-nbd="bold" aria-label="太線の間隔">${[0, 2, 4, 5, 10]
        .map(
          (n) =>
            `<option value="${n}"${d.bold === n ? ' selected' : ''}>${n ? `${n} ますごと（${n * d.gap} mm）` : 'なし'}</option>`
        )
        .join('')}</select>`
    );
  row(
    'ページ上部の線',
    HEADS.map(
      (k) =>
        `<button type="button" class="shop-chip${d.head === k ? ' is-on' : ''}" data-nbd="head" data-v="${k}" aria-pressed="${d.head === k}">${HEAD_LABEL[k]}</button>`
    ).join('')
  );
  if (d.head !== 'none') row('上の線の色', swatches('headColor', LINE_SWATCHES, d.headColor));
  if (f.kind === 'ruled' || f.kind === 'dotruled') {
    row(
      '左の余白の線',
      `<label><input type="checkbox" data-nbd="margin" ${d.margin ? 'checked' : ''}/> 左に縦の線を引く</label>`
    );
    if (d.margin)
      row('余白の線の色', swatches('marginColor', ['#e8a0a0', '#f2b8b5', '#9cc0e6', '#c9cfd6'], d.marginColor));
  }
  row('紙の色', swatches('paper', PAPER_SWATCHES, d.paper));
  return rows.join('');
}

export function noteEditor(params) {
  const s = st();
  if (!startDraft(s, params))
    return `<p class="muted">そのノートはありません。</p><p><button type="button" class="btn" data-action="nav" data-route="${NOTES}">← ノート</button></p>`;
  const base = itemOf(draft.base);
  return `<p><button type="button" class="btn btn--small" data-action="nav" data-route="${NOTES}">← ノート</button></p>
    <div class="nb-editor">
      <div class="nb-editor__preview">
        <div id="nb-preview" class="nb-editor__page" role="img" aria-label="ページの見本">${pageSvg(draft.design, {width: previewWidth()})}</div>
        <p class="muted nb-editor__base">${coverArt(base, {width: 40})}<span>${esc(base.name)}</span></p>
      </div>
      <div class="nb-editor__form">
        <h3>${draft.id ? 'マイノートを調節する' : 'マイノートを作る'}</h3>
        <div id="nb-controls">${controls()}</div>
        <div class="nb-editor__act">
          <button type="button" class="btn btn--primary" data-nb="save">${draft.id ? '上書きして保存' : 'マイノートに保存'}</button>
          ${draft.id ? '<button type="button" class="btn" data-nb="save-new">別の名前で保存</button>' : ''}
          <button type="button" class="btn" data-nb="try">試し書き</button>
          <button type="button" class="btn btn--quiet" data-nb="reset">はじめの紙に戻す</button>
        </div>
      </div>
    </div>`;
}

/** 見本とコントロールだけ描き直す（名前の欄やつまみの操作を途切れさせない） */
function redraw({form = true} = {}) {
  const p = document.getElementById('nb-preview');
  if (p) p.innerHTML = pageSvg(draft.design, {width: previewWidth()});
  const c = document.getElementById('nb-controls');
  if (form && c) c.innerHTML = controls();
}

function setField(field, value) {
  if (field === 'name') return void (draft.name = value);
  const v =
    field === 'gap' || field === 'bold' ? Number(value) : field === 'dots' || field === 'margin' ? !!value : value;
  draft.design = cleanDesign({...draft.design, [field]: v});
}

async function save(asNew) {
  const r = await api['stationery.myNoteSave']({
    id: asNew ? null : draft.id,
    name: draft.name,
    base: draft.base,
    design: draft.design
  });
  if (r?.error) return toast(r.error, {error: true});
  state.data.stationery = r.stationery;
  toast(`マイノート「${draft.name.trim() || itemOf(draft.base).name}」を保存しました`);
  draft.key = `edit:${r.id}`;
  draft.id = r.id;
  navigate(`${NOTES}&edit=${encodeURIComponent(r.id)}`);
}

async function call(channel, arg, done) {
  const r = await api[channel](arg);
  if (r?.error) return toast(r.error, {error: true});
  state.data.stationery = r.stationery;
  refresh();
  if (done) toast(done);
}

document.addEventListener('input', (e) => {
  const el = e.target.closest('.nb-editor [data-nbd]');
  if (!el) return;
  const field = el.dataset.nbd;
  if (field === 'name') return setField('name', el.value);
  if (field === 'gap') {
    setField('gap', el.value);
    const b = document.getElementById('nb-gap');
    if (b) b.textContent = `${draft.design.gap} mm`;
    return redraw({form: false});
  }
  if (el.type === 'color') {
    setField(field, el.value);
    redraw({form: false});
  }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('.nb-editor [data-nbd]');
  if (!el || el.dataset.nbd === 'name' || el.dataset.nbd === 'gap') return;
  setField(el.dataset.nbd, el.type === 'checkbox' ? el.checked : el.value);
  redraw();
});
document.addEventListener('click', (e) => {
  const sw = e.target.closest('.nb-editor button[data-nbd]');
  if (sw) {
    setField(sw.dataset.nbd, sw.dataset.v);
    return redraw();
  }
  const b = e.target.closest('.fudebako [data-nb]');
  if (!b) return;
  const what = b.dataset.nb;
  if (what === 'save') save(false);
  else if (what === 'save-new') save(true);
  else if (what === 'try') openNoteTry(draft.design, draft.name.trim() || itemOf(draft.base).name);
  else if (what === 'reset') {
    draft.design = cleanDesign({format: itemOf(draft.base).format});
    redraw();
  } else if (what === 'default') call('stationery.noteDefault', {key: b.dataset.key}, '最初に選ぶ紙にしました');
  else if (what === 'remove') {
    const n = st().myNotes.find((x) => x.id === b.dataset.id);
    if (!n) return;
    confirmDialog(`マイノート「${n.name}」を消しますか？（作ったノートの紙はそのままです）`, {
      ok: '消す',
      danger: true
    }).then((ok) => ok && call('stationery.myNoteRemove', {id: n.id}, `「${n.name}」を消しました`));
  }
});
