// 着せ替えページ（SPEC-KISEKAE.md §3.2）と、フォルダの右クリックから出す選択パネル（§3.3）。
// 1 段目「おすすめから選ぶ」：押すとすぐ当たる。2 段目「細かく直す」：見本を見ながら直し、自作のテンプレートとして保存する
import {esc, navigate, refresh, reload, state, toast} from '../app.js';
import {folderCard} from './home.js';
import {
  LICENSES,
  LICENSE_LABEL,
  NOTE_GAPS,
  NOTE_GAP_LABEL,
  NOTE_TYPES,
  NOTE_TYPE_LABEL,
  SHAPES,
  SHAPE_LABEL,
  STICKERS_PER_PLACE,
  TAPE_PATTERNS,
  TAPE_PATTERN_LABEL,
  isBuiltin,
  normalizeTemplate,
  usage
} from '../../shared/skin.js';
import {allTemplates, forgetSticker, globalId, noteVars, skinOf, stickerUrl} from '../skin.js';

const api = window.daigaku;

// 色の見本（テーマの 8 色・淡い紙の色・濃い色）
const PALETTE = [
  '#ffffff', '#fbf8f1', '#fffaf0', '#fff6f8', '#f4fbf7', '#f3f8ff', '#f8f5ff', '#efe6d6',
  '#f6c445', '#f28b82', '#7fd1ae', '#8ab4f8', '#c58af9', '#ffab70', '#6fd3e6', '#f7a1c4',
  '#2c4a7a', '#3a3a3a'
];
const SAMPLE = [
  {id: 'sample-1', name: '管理会計Ⅱ', color: 1, tape_pattern: 'plain', weekday: '金', period: 2},
  {id: 'sample-2', name: 'マーケティング', color: 4, tape_pattern: 'stripe', weekday: '月', period: 1}
];

// 画面の状態（描き直しても残す）。draft は直している途中のテンプレート（baseId は元のテンプレート）。
// 対象・細かく直す・名前などは ui が決めるので、描き直しのときに前の値へ戻さない（data-keep="off"）
const ui = {target: '', part: 'note', open: false, draft: null, selected: null, confirm: null, route: null};

const courses = (data) => data.courses.filter((c) => !c.hidden);
const targetCourse = (data) => (ui.target ? (data.courses.find((c) => c.id === ui.target) ?? null) : null);
const samples = (data, course) => {
  const list = courses(data);
  const first = course ?? list[0] ?? SAMPLE[0];
  const second = list.find((c) => c.id !== first.id) ?? SAMPLE[1];
  return [first, second];
};
/** 今その対象に当たっているテンプレートの id（授業で「全体と同じ」なら null） */
const currentId = (data) => {
  const c = targetCourse(data);
  return c ? (c.skin_template_id ?? null) : globalId(data);
};

function startDraft(data, template, {asNew = false, name = null} = {}) {
  const t = template ?? skinOf(data, targetCourse(data)).template;
  const n = (data.skin?.templates ?? []).length + 1;
  ui.draft = {
    baseId: asNew || isBuiltin(t.id) ? null : t.id,
    name: name ?? (asNew || isBuiltin(t.id) ? `わたしの ${n}` : t.name),
    license: asNew || isBuiltin(t.id) ? 'personal' : t.license,
    parts: structuredClone(t.parts),
    stickers: structuredClone(t.stickers)
  };
  ui.selected = null;
  ui.confirm = null;
  ui.open = true;
}

/** 見本に当てる見た目：直している途中のテンプレートを、その授業に当たっているものとして扱う */
function draftSkin(data, course) {
  const d = ui.draft;
  const target = targetCourse(data);
  const note = target ? skinOf(data, course).note : d.parts.note;
  // 授業が対象のときは、全体のシールも貼り方（sticker_mode）のとおりに見せる。
  // 「全体のシールだけ」のまま授業のシールを貼ったら「両方」として見せる（保存すると「両方」になる）
  const mode = target ? stickerModeFor(target) : 'course';
  const global = target && mode !== 'course' ? skinOf(data).stickers.map((s) => ({...s, z: s.z - 100})) : [];
  const own = d.stickers.map((s, i) => ({...s, index: i}));
  return {template: null, own: true, note, folder: d.parts.folder, tape: d.parts.tape, stickers: [...global, ...own].sort((a, b) => a.z - b.z)};
}
const stickerModeFor = (course) => (course.sticker_mode === 'global' && ui.draft?.stickers.length ? 'both' : course.sticker_mode || 'global');
/** テンプレートの見た目（一覧の見本） */
function templateSkin(data, t) {
  return {template: t, own: true, note: targetCourse(data) ? skinOf(data).note : t.parts.note, folder: t.parts.folder, tape: t.parts.tape, stickers: t.stickers};
}

const styleOf = (vars) => Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join('; ');
const attrsOf = (attrs) => Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
/** ノートの見本の紙 */
function noteSwatch(note, cls, inner = '') {
  const {attrs, vars} = noteVars(note);
  return `<div class="note-swatch ${cls}" ${attrsOf(attrs)} style="${styleOf(vars)}">${inner}</div>`;
}

function usageText(data, t) {
  if (isBuiltin(t.id)) return '';
  const u = usage(t.id, data.courses, globalId(data));
  const parts = [];
  if (u.global) parts.push('全体');
  if (u.courses) parts.push(`${u.courses} つの授業`);
  return parts.length ? `${parts.join('と')}で使用中` : '';
}

function galleryCard(data, t, course, current) {
  const on = current === t.id;
  const skin = templateSkin(data, t);
  return `<div class="ks-card${on ? ' is-current' : ''}">
    <button type="button" class="ks-card__pick" data-ks="apply" data-id="${esc(t.id)}" aria-pressed="${on}">
      ${noteSwatch(skin.note, 'ks-card__paper', `<div class="ks-card__folder">${folderCard(course, {data, skin, edit: {still: true}})}</div>`)}
      <span class="ks-card__name">${on ? '✓ ' : ''}${esc(t.name)}</span>
      <span class="ks-card__meta muted">${isBuiltin(t.id) ? 'はじめからある' : esc(usageText(data, t) || '自作')}</span>
    </button>
    <div class="ks-card__tools">
      <button type="button" class="btn btn--small" data-ks="edit" data-id="${esc(t.id)}">${isBuiltin(t.id) ? 'もとにして作る' : '直す'}</button>
      ${isBuiltin(t.id) ? '' : `<button type="button" class="btn btn--small" data-ks="dup" data-id="${esc(t.id)}">複製</button><button type="button" class="btn btn--small btn--danger" data-ks="remove" data-id="${esc(t.id)}">消す</button>`}
    </div>
  </div>`;
}

// ---- 細かく直す：部品ごとの操作 ----
function colorField(key, label, value, {allowDefault = true, allowCourse = false, recent = []} = {}) {
  const sw = (v, text, cls = '') =>
    `<button type="button" class="ks-sw ${cls}" data-ks="color" data-key="${key}" data-value="${v}" aria-pressed="${value === v}" title="${esc(text)}"${v.startsWith('#') ? ` style="--sw: ${v}"` : ''}>${v.startsWith('#') ? '' : esc(text)}</button>`;
  const colors = [...new Set([...recent, ...PALETTE])];
  return `<fieldset class="ks-field"><legend>${label}</legend><div class="ks-swatches">
    ${allowDefault ? sw('default', 'テーマの色', 'ks-sw--text') : ''}
    ${allowCourse ? sw('course', '授業ごとの色', 'ks-sw--text') : ''}
    ${colors.map((c) => sw(c, c)).join('')}
    <label class="ks-sw ks-sw--pick" title="好きな色">＋<input type="color" data-ks-color="${key}" value="${value?.startsWith('#') ? value : '#ffffff'}" aria-label="${label}：好きな色" /></label>
  </div></fieldset>`;
}
const choice = (key, value, list, labels, {swatch = null} = {}) =>
  `<div class="ks-choices">${list
    .map(
      (v) =>
        `<button type="button" class="ks-choice" data-ks="set" data-key="${key}" data-value="${v}" aria-pressed="${value === v}">${swatch ? swatch(v) : ''}<span>${esc(labels[v])}</span></button>`
    )
    .join('')}</div>`;

function noteControls(data) {
  if (targetCourse(data))
    return `<p class="muted">ノートの紙はすべての授業で共通です。変えるときは、上の「対象」を「すべての授業」にしてください。</p>`;
  const n = ui.draft.parts.note;
  const recent = data.skin?.recent ?? [];
  const rules = data.settings?.rules ?? 'normal';
  return `
    <fieldset class="ks-field"><legend>ノートの種類</legend>
      ${choice('note.type', n.type, NOTE_TYPES, NOTE_TYPE_LABEL, {swatch: (v) => noteSwatch({...n, type: v}, 'ks-choice__swatch')})}
    </fieldset>
    ${colorField('note.paper', '紙の色', n.paper, {recent})}
    ${colorField('note.line', '線の色', n.line, {recent})}
    <fieldset class="ks-field"><legend>線の間隔</legend>${choice('note.gap', n.gap, Object.keys(NOTE_GAPS), NOTE_GAP_LABEL)}</fieldset>
    <label class="ks-check"><input type="checkbox" data-ks-check="note.margin" ${n.margin ? 'checked' : ''} /> 左の余白の縦線を引く</label>
    <fieldset class="ks-field"><legend>線の濃さ（すべてのテンプレートで共通）</legend>
      ${choice('rules', rules, ['normal', 'light', 'none'], {normal: '標準', light: '薄い', none: 'なし'})}
    </fieldset>`;
}
function folderControls(data) {
  const f = ui.draft.parts.folder;
  const recent = data.skin?.recent ?? [];
  return `${colorField('folder.card', 'カードの色', f.card, {recent})}${colorField('folder.tab', 'タブの色', f.tab, {recent})}`;
}
function tapeControls(data) {
  const t = ui.draft.parts.tape;
  return `${colorField('tape.color', 'テープの色', t.color, {allowDefault: false, allowCourse: true, recent: data.skin?.recent ?? []})}
    <fieldset class="ks-field"><legend>柄</legend>${choice('tape.pattern', t.pattern, ['course', ...TAPE_PATTERNS], TAPE_PATTERN_LABEL)}</fieldset>`;
}
function stickerControls(data) {
  const book = data.skin?.stickers ?? [];
  const d = ui.draft;
  const sel = ui.selected != null ? d.stickers[ui.selected] : null;
  const course = targetCourse(data);
  const shape = sel ? (book.find((b) => b.id === sel.asset)?.shape ?? 'cut') : null;
  return `
    ${
      course
        ? `<label class="ks-field">シールの貼り方<select class="input" data-ks-mode>
        ${[
          ['global', '全体のシールだけ'],
          ['course', 'この授業のシールだけ'],
          ['both', '両方']
        ]
          .map(([v, l]) => `<option value="${v}" ${course.sticker_mode === v ? 'selected' : ''}>${l}</option>`)
          .join('')}</select></label>`
        : ''
    }
    <p class="muted">シール帳のシールを押すか、見本のフォルダへドラッグすると貼れます（1 枚のフォルダに ${STICKERS_PER_PLACE} 枚まで）。貼ったシールは見本の上で動かせます。${course ? '全体のシールの上に重ねて見せています（全体のシールはここでは動かせません）。' : ''}</p>
    <div class="ks-book">
      <label class="ks-book__add btn btn--small">＋ 画像を取り込む<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-ks-file hidden /></label>
      ${book
        .map((b) => {
          const url = stickerUrl(b.id);
          return `<div class="ks-book__item"><button type="button" class="ks-book__pick" data-ks="sticker-add" data-id="${b.id}" draggable="true" title="貼る">${url ? `<img src="${url}" alt="シール" class="sticker--${esc(b.shape)}" draggable="false" />` : '…'}</button><button type="button" class="ks-book__del" data-ks="sticker-del" data-id="${b.id}" title="シール帳から消す" aria-label="シール帳から消す">×</button></div>`;
        })
        .join('')}
    </div>
    ${
      sel
        ? `<fieldset class="ks-field ks-sel"><legend>選んだシール</legend>
        <label>大きさ<input type="range" min="20" max="200" step="5" value="${Math.round(sel.scale * 100)}" data-ks-range="scale" /></label>
        <label>傾き<input type="range" min="-45" max="45" step="1" value="${sel.rotate}" data-ks-range="rotate" /></label>
        <label>形<select class="input" data-ks-shape="${sel.asset}">${SHAPES.map((s) => `<option value="${s}" ${shape === s ? 'selected' : ''}>${SHAPE_LABEL[s]}</option>`).join('')}</select></label>
        <div class="actions"><button type="button" class="btn btn--small" data-ks="z" data-dir="1">前へ</button><button type="button" class="btn btn--small" data-ks="z" data-dir="-1">後ろへ</button><button type="button" class="btn btn--small btn--danger" data-ks="peel">はがす</button></div>
      </fieldset>`
        : ''
    }`;
}

const PARTS = [
  ['note', 'ノート'],
  ['folder', 'フォルダ'],
  ['tape', 'マスキングテープ'],
  ['sticker', 'シール']
];

function editor(data) {
  const course = targetCourse(data);
  const [first, second] = samples(data, course);
  const note = course ? skinOf(data, course).note : ui.draft.parts.note;
  const skin1 = draftSkin(data, first);
  const skin2 = course ? skinOf(data, second) : draftSkin(data, second);
  const controls = {note: noteControls, folder: folderControls, tape: tapeControls, sticker: stickerControls}[ui.part](data);
  const c = ui.confirm;
  return `
    <div class="ks-editor">
      <nav class="ks-parts" aria-label="部品">${PARTS.map(([k, l]) => `<button type="button" class="ks-part" data-ks="part" data-part="${k}" aria-pressed="${ui.part === k}">${l}</button>`).join('')}</nav>
      ${noteSwatch(note, 'ks-preview', `<div class="folders ks-preview__folders">${folderCard(first, {data, skin: skin1, edit: {selected: ui.selected}})}${folderCard(second, {data, skin: skin2, edit: {still: true}})}</div>`)}
      <div class="ks-controls">${controls}</div>
    </div>
    <div class="ks-save">
      <label>名前<input class="input" id="ks-name" data-keep="off" maxlength="40" value="${esc(ui.draft.name)}" /></label>
      <label>利用条件<select class="input" id="ks-license" data-keep="off">${LICENSES.map((l) => `<option value="${l}" ${ui.draft.license === l ? 'selected' : ''}>${LICENSE_LABEL[l]}</option>`).join('')}</select></label>
      <button type="button" class="btn btn--primary" data-ks="save">${ui.draft.baseId ? '保存して当てる' : '新しいテンプレートとして保存して当てる'}</button>
      ${ui.draft.baseId ? '<button type="button" class="btn" data-ks="save-new">別のテンプレートとして保存</button>' : ''}
      <button type="button" class="btn" data-ks="discard">やめる</button>
    </div>
    ${
      c
        ? `<div class="ks-confirm sticky" role="alertdialog" aria-labelledby="ks-confirm-text"><p id="ks-confirm-text">このテンプレートは${esc(c.text)}で使っています。保存すると、すべて変わります。</p>
        <div class="actions"><button type="button" class="btn btn--primary" data-ks="save-confirm">保存</button>${course ? '<button type="button" class="btn" data-ks="save-course">この授業用に複製</button>' : ''}<button type="button" class="btn" data-ks="confirm-cancel">やめる</button></div></div>`
        : ''
    }`;
}

/** 着せ替えページ。#/kisekae?course=<id>&new=1 で、その授業を対象に「新しく作成」から始める */
export function renderKisekae({data}, route) {
  if (route !== ui.route) {
    ui.route = route;
    const q = new URLSearchParams(route.split('?')[1] ?? '');
    const cid = q.get('course');
    ui.target = cid && data.courses.some((c) => c.id === cid) ? cid : '';
    ui.draft = null;
    ui.open = false;
    if (q.get('new') === '1') {
      const c = targetCourse(data);
      startDraft(data, null, {asNew: true, name: c ? `${c.name} 用` : null});
      ui.part = 'folder';
    }
  }
  const course = targetCourse(data);
  if (ui.target && !course) ui.target = '';
  if (ui.open && !ui.draft) startDraft(data, null);
  const current = currentId(data);
  const [first] = samples(data, course);
  const templates = allTemplates(data);
  return `
    <div class="kisekae">
      <h2>着せ替え</h2>
      <label class="ks-target">対象<select class="input" id="ks-target" data-keep="off">
        <option value="" ${!course ? 'selected' : ''}>すべての授業</option>
        ${courses(data)
          .map((c) => `<option value="${esc(c.id)}" ${course?.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)
          .join('')}
      </select></label>
      <section aria-labelledby="ks-gallery-title">
        <h3 id="ks-gallery-title">おすすめから選ぶ</h3>
        <p class="muted">押すとすぐに${course ? `「${esc(course.name)}」` : 'すべての授業'}に当たります。</p>
        <div class="ks-gallery">
          ${
            course
              ? `<div class="ks-card${current === null ? ' is-current' : ''}"><button type="button" class="ks-card__pick ks-card__pick--global" data-ks="apply" data-id="" aria-pressed="${current === null}">
              ${noteSwatch(skinOf(data).note, 'ks-card__paper', `<div class="ks-card__folder">${folderCard({...first, skin_template_id: null}, {data, edit: {still: true}})}</div>`)}
              <span class="ks-card__name">${current === null ? '✓ ' : ''}全体と同じ</span><span class="ks-card__meta muted">すべての授業の設定に合わせる</span></button></div>`
              : ''
          }
          ${templates.map((t) => galleryCard(data, t, first, current)).join('')}
        </div>
      </section>
      <details class="ks-detail" id="ks-detail" data-keep="off" ${ui.open ? 'open' : ''}>
        <summary>細かく直す</summary>
        ${ui.open && ui.draft ? editor(data) : ''}
      </details>
    </div>`;
}

// ---- 操作 ----
const setPath = (obj, key, value) => {
  const [a, b] = key.split('.');
  obj[a][b] = value;
};
async function applyTemplate(data, templateId) {
  const course = targetCourse(data);
  const prev = currentId(data);
  const r = await api['skin.apply']({courseId: course?.id, templateId: templateId || null});
  if (r?.error) return toast(r.error, {error: true});
  await reload();
  const name = templateId ? (allTemplates(state.data).find((t) => t.id === templateId)?.name ?? '') : '全体と同じ';
  toast(`${course ? `「${course.name}」` : 'すべての授業'}を「${name}」にしました`, {
    action: {
      label: '元に戻す',
      run: async () => {
        await api['skin.apply']({courseId: course?.id, templateId: prev});
        reload();
      }
    }
  });
}

async function save({asNew = false, forCourse = false, confirmed = false} = {}) {
  const data = state.data;
  const d = ui.draft;
  const course = targetCourse(data);
  d.name = document.getElementById('ks-name')?.value.trim() || d.name;
  d.license = document.getElementById('ks-license')?.value || d.license;
  const baseId = asNew || forCourse ? null : d.baseId;
  if (baseId && !confirmed) {
    // ほかの授業（と全体）でも使っていれば、保存の前に知らせる（SPEC-KISEKAE §3.2）
    const others = data.courses.filter((c) => c.skin_template_id === baseId && c.id !== course?.id).length;
    const global = globalId(data) === baseId && !!course;
    if (others || global) {
      ui.confirm = {text: [global ? '全体' : '', others ? `ほかの ${others} つの授業` : ''].filter(Boolean).join('と')};
      return refresh();
    }
  }
  const name = forCourse ? `${course.name} 用` : asNew && d.baseId ? `${d.name} のコピー` : d.name;
  const template = normalizeTemplate({id: baseId ?? undefined, name, license: d.license, parts: d.parts, stickers: d.stickers, assets: {}});
  const r = await api['skin.save']({template: {...template, id: baseId ?? undefined}});
  if (r?.error) return toast(r.error, {error: true});
  const a = await api['skin.apply']({courseId: course?.id, templateId: r.template.id, stickerMode: course ? stickerModeFor(course) : undefined});
  if (a?.error) return toast(a.error, {error: true});
  ui.draft = null;
  ui.open = false;
  ui.confirm = null;
  await reload();
  toast(`「${r.template.name}」を保存して当てました`);
}

/** 画像をシールの素にする：長辺 512px 以内の PNG に描き直す（画像の中の付加情報を落とす）。透明な所があれば形どおり、なければ白いふち付き */
async function importSticker(file) {
  if (!file) return;
  let bmp;
  try {
    bmp = await window.createImageBitmap(file);
  } catch {
    return toast('この画像は読めませんでした（PNG・JPEG・WebP・GIF）', {error: true});
  }
  const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let clear = false;
  for (let i = 3; i < px.length && !clear; i += 4) if (px[i] < 250) clear = true;
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const r = await api['sticker.add']({bytes: new Uint8Array(await blob.arrayBuffer()), shape: clear ? 'cut' : 'framed'});
  if (r?.error) return toast(r.error, {error: true});
  await reload();
  toast('シール帳に入れました。押すか、見本のフォルダへドラッグして貼れます');
}

function addSticker(asset, x = 0.72, y = 0.62) {
  const d = ui.draft;
  if (d.stickers.filter((s) => s.place === 'folder').length >= STICKERS_PER_PLACE)
    return toast(`1 枚のフォルダに貼れるシールは ${STICKERS_PER_PLACE} 枚までです`, {error: true});
  d.stickers.push({place: 'folder', asset, x, y, scale: 1, rotate: Math.round(Math.random() * 20 - 10), z: Math.max(0, ...d.stickers.map((s) => s.z + 1))});
  ui.selected = d.stickers.length - 1;
  refresh();
}

const inKisekae = (el) => !!el?.closest?.('.kisekae');
document.addEventListener('click', async (e) => {
  const el = e.target.closest?.('[data-ks]');
  if (!el || !inKisekae(el)) return;
  const data = state.data;
  const {ks} = el.dataset;
  try {
    if (ks === 'apply') return await applyTemplate(data, el.dataset.id);
    if (ks === 'edit') {
      startDraft(data, allTemplates(data).find((t) => t.id === el.dataset.id));
      refresh();
      return document.getElementById('ks-detail')?.scrollIntoView({behavior: 'smooth', block: 'start'});
    }
    if (ks === 'dup') {
      const t = allTemplates(data).find((x) => x.id === el.dataset.id);
      const r = await api['skin.save']({template: {...t, id: undefined, name: `${t.name} のコピー`}});
      if (r?.error) return toast(r.error, {error: true});
      await reload();
      return toast(`「${r.template.name}」を作りました`);
    }
    if (ks === 'remove') {
      const t = allTemplates(data).find((x) => x.id === el.dataset.id);
      const u = usageText(data, t);
      if (!window.confirm(`「${t.name}」を消しますか？${u ? `\n${u}です。使っていた授業は「全体と同じ」に戻ります。` : ''}`)) return;
      const r = await api['skin.remove']({id: t.id});
      if (r?.error) return toast(r.error, {error: true});
      if (ui.draft?.baseId === t.id) ui.draft = null;
      await reload();
      return toast(`「${t.name}」を消しました`);
    }
    if (!ui.draft) return;
    if (ks === 'part') ui.part = el.dataset.part;
    else if (ks === 'color' || ks === 'set') {
      if (el.dataset.key === 'rules') {
        await api['settings.update']({patch: {rules: el.dataset.value}});
        return reload();
      }
      setPath(ui.draft.parts, el.dataset.key, el.dataset.value);
    } else if (ks === 'sticker-add') addSticker(el.dataset.id);
    else if (ks === 'sticker-del') {
      if (!window.confirm('このシールをシール帳から消しますか？（貼ってあるテンプレートからも見えなくなります）')) return;
      const r = await api['sticker.remove']({id: el.dataset.id});
      if (r?.error) return toast(r.error, {error: true});
      forgetSticker(el.dataset.id);
      ui.draft.stickers = ui.draft.stickers.filter((s) => s.asset !== el.dataset.id);
      ui.selected = null;
      return reload();
    } else if (ks === 'z' && ui.selected != null) ui.draft.stickers[ui.selected].z = Math.max(0, ui.draft.stickers[ui.selected].z + Number(el.dataset.dir));
    else if (ks === 'peel' && ui.selected != null) {
      ui.draft.stickers.splice(ui.selected, 1);
      ui.selected = null;
    } else if (ks === 'save') return await save();
    else if (ks === 'save-new') return await save({asNew: true});
    else if (ks === 'save-confirm') return await save({confirmed: true});
    else if (ks === 'save-course') return await save({forCourse: true});
    else if (ks === 'confirm-cancel') ui.confirm = null;
    else if (ks === 'discard') {
      ui.draft = null;
      ui.open = false;
    }
    refresh();
  } catch (err) {
    toast(err.message, {error: true});
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (!inKisekae(el)) return;
  if (el.id === 'ks-target') {
    ui.target = el.value;
    ui.draft = null;
    ui.selected = null;
    ui.confirm = null;
    return refresh();
  }
  if (!ui.draft) return;
  if (el.id === 'ks-name') ui.draft.name = el.value;
  else if (el.id === 'ks-license') ui.draft.license = el.value;
  else if (el.dataset.ksColor) {
    setPath(ui.draft.parts, el.dataset.ksColor, el.value.toLowerCase());
    const r = await api['skin.recentColor']({color: el.value});
    if (r?.recent && state.data.skin) state.data.skin.recent = r.recent;
    refresh();
  } else if (el.dataset.ksCheck) {
    setPath(ui.draft.parts, el.dataset.ksCheck, el.checked);
    refresh();
  } else if ('ksMode' in el.dataset) {
    const r = await api['skin.apply']({courseId: ui.target, stickerMode: el.value});
    if (r?.error) return toast(r.error, {error: true});
    reload();
  } else if (el.dataset.ksShape) {
    const r = await api['sticker.update']({id: el.dataset.ksShape, shape: el.value});
    if (r?.error) return toast(r.error, {error: true});
    reload();
  } else if ('ksFile' in el.dataset) {
    await importSticker(el.files?.[0]);
    el.value = '';
  } else if (el.dataset.ksRange) refresh();
});
// 色の選び器を動かしている間・つまみを動かしている間は、見本だけ変える（ページを描き直すと選び器が閉じるため）
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!inKisekae(el) || !ui.draft) return;
  if (el.dataset.ksColor) {
    setPath(ui.draft.parts, el.dataset.ksColor, el.value.toLowerCase());
    repaintPreview();
  } else if (el.dataset.ksRange && ui.selected != null) {
    const s = ui.draft.stickers[ui.selected];
    if (el.dataset.ksRange === 'scale') s.scale = Number(el.value) / 100;
    else s.rotate = Number(el.value);
    repaintPreview();
  }
});
function repaintPreview() {
  const old = document.querySelector('.kisekae .ks-preview');
  if (!old) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = editor(state.data);
  old.replaceWith(tmp.querySelector('.ks-preview'));
}

// 見本のフォルダの上で、貼ったシールを選んで動かす。シール帳からのドラッグで貼る
let drag = null;
document.addEventListener('pointerdown', (e) => {
  const img = e.target.closest?.('.kisekae [data-preview-folder] [data-sticker-index]');
  const folder = e.target.closest?.('.kisekae [data-preview-folder]');
  if (!folder || !ui.draft) return;
  if (!img) {
    if (ui.selected != null) {
      ui.selected = null;
      refresh();
    }
    return;
  }
  e.preventDefault();
  const i = Number(img.dataset.stickerIndex);
  drag = {i, folder, img, moved: false};
  img.setPointerCapture?.(e.pointerId);
  if (ui.selected !== i) {
    ui.selected = i;
    drag.reselect = true;
  }
});
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const r = drag.folder.getBoundingClientRect();
  const s = ui.draft.stickers[drag.i];
  s.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  s.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  drag.img.style.left = `${(s.x * 100).toFixed(2)}%`;
  drag.img.style.top = `${(s.y * 100).toFixed(2)}%`;
  drag.moved = true;
});
document.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.moved || d.reselect) refresh();
});
document.addEventListener('dragstart', (e) => {
  const b = e.target.closest?.('.kisekae [data-ks="sticker-add"]');
  if (b) e.dataTransfer.setData('text/x-daigaku-sticker', b.dataset.id);
});
document.addEventListener('dragover', (e) => {
  if (e.target.closest?.('.kisekae [data-preview-folder]') && e.dataTransfer.types.includes('text/x-daigaku-sticker')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  const folder = e.target.closest?.('.kisekae [data-preview-folder]');
  const sid = e.dataTransfer?.getData('text/x-daigaku-sticker');
  if (!folder || !sid || !ui.draft) return;
  e.preventDefault();
  const r = folder.getBoundingClientRect();
  addSticker(sid, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
});
document.addEventListener('toggle', (e) => {
  if (e.target.id !== 'ks-detail') return;
  ui.open = e.target.open;
  if (ui.open && !ui.draft) {
    startDraft(state.data, null);
    refresh();
    document.getElementById('ks-detail')?.scrollIntoView({behavior: 'smooth', block: 'start'});
  }
}, true);

// ---- フォルダの右クリック →「着せ替え…」：その場の選択パネル（SPEC-KISEKAE §3.3） ----
let picker = null;
export const closeSkinPicker = () => {
  picker?.el.remove();
  picker = null;
};
/** card：ホームのフォルダの要素。押すとすぐ当たり、マウスを乗せると仮にその見た目になる */
export function openSkinPicker(course, card, x, y) {
  closeSkinPicker();
  const el = document.createElement('div');
  el.className = 'skin-picker';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `${course.name} の着せ替え`);
  picker = {el, course, card};
  const paint = () => {
    const c = state.data.courses.find((v) => v.id === course.id) ?? course;
    const cur = c.skin_template_id ?? null;
    const item = (tid, name) => {
      const sk = skinOf(state.data, {...c, skin_template_id: tid});
      return `<button type="button" class="skin-picker__item" data-pick="${tid ?? ''}" aria-pressed="${cur === tid}">
        <span class="skin-picker__swatch" style="--sw-card: ${sk.folder.card === 'default' ? 'var(--card)' : sk.folder.card}; --sw-tape: ${sk.tape.color === 'course' ? `var(--c${c.color})` : sk.tape.color}"></span>
        <span>${esc(name)}</span>${cur === tid ? '<span class="skin-picker__check" aria-label="使用中">✓</span>' : ''}</button>`;
    };
    el.innerHTML = `<div class="skin-picker__head">${esc(c.name)} の着せ替え</div>
      <div class="skin-picker__list" role="group">
        ${item(null, '全体と同じ')}
        <hr />
        ${allTemplates(state.data).map((t) => item(t.id, t.name)).join('')}
      </div>
      <button type="button" class="skin-picker__new" data-pick-new>＋ 新しく作成</button>`;
  };
  paint();
  document.body.append(el);
  const {width, height} = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
  el.querySelector('[aria-pressed="true"]')?.focus() ?? el.querySelector('button')?.focus();
  // 本物のフォルダを仮にその見た目にする（外したら戻す）
  const preview = (tid) => {
    const target = document.querySelector(`.folder[data-action="open-course"][data-id="${window.CSS.escape(course.id)}"]`);
    if (!target) return;
    const c = state.data.courses.find((v) => v.id === course.id) ?? course;
    const tmp = document.createElement('div');
    tmp.innerHTML = folderCard(tid === undefined ? c : {...c, skin_template_id: tid}, {data: state.data, today: target.classList.contains('folder--today')});
    target.replaceWith(tmp.firstElementChild);
  };
  el.addEventListener('pointerover', (e) => {
    const b = e.target.closest('[data-pick]');
    if (b && e.pointerType !== 'touch') preview(b.dataset.pick || null);
  });
  el.addEventListener('pointerleave', () => preview(undefined));
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = [...el.querySelectorAll('button')];
    const i = list.indexOf(document.activeElement);
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus();
  });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-pick-new]')) {
      closeSkinPicker();
      return navigate(`/kisekae?course=${encodeURIComponent(course.id)}&new=1`);
    }
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const c = state.data.courses.find((v) => v.id === course.id) ?? course;
    const prev = c.skin_template_id ?? null;
    const tid = b.dataset.pick || null;
    const r = await api['skin.apply']({courseId: course.id, templateId: tid});
    if (r?.error) return toast(r.error, {error: true});
    await reload();
    if (picker?.el === el) paint();
    toast(`「${c.name}」を「${tid ? allTemplates(state.data).find((t) => t.id === tid)?.name : '全体と同じ'}」にしました`, {
      action: {
        label: '元に戻す',
        run: async () => {
          await api['skin.apply']({courseId: course.id, templateId: prev});
          await reload();
          if (picker?.el === el) paint();
        }
      }
    });
  });
}
document.addEventListener('pointerdown', (e) => picker && !picker.el.contains(e.target) && !e.target.closest?.('.toast') && closeSkinPicker());
document.addEventListener('keydown', (e) => e.key === 'Escape' && picker && closeSkinPicker());
window.addEventListener('hashchange', closeSkinPicker);

// 「＋ 新しく作成」から開いたときは、直す所まで送る
document.getElementById('view')?.addEventListener('rendered', (e) => {
  if (e.detail.fresh && e.detail.route.startsWith('/kisekae') && ui.open) document.getElementById('ks-detail')?.scrollIntoView({block: 'start'});
});
