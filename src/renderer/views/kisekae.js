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
  GLOBAL_ONLY_PLACES,
  PLACE_LABEL,
  STICKER_PLACES,
  SHAPES,
  SHAPE_LABEL,
  STICKERS_PER_PLACE,
  TAPE_PATTERNS,
  TAPE_PATTERN_LABEL,
  isBuiltin,
  normalizeTemplate,
  usage,
  BOOKMARK_SHAPES,
  BOOKMARK_SHAPE_LABEL,
  FILE_KINDS,
  FILE_KIND_LABEL,
  FIXED_PLACES,
  placeMax
} from '../../shared/skin.js';
import {STICKER_BASE, allTemplates, bookmarkLook, forgetSticker, globalId, noteVars, shapesOf, skinOf, stickerImg, stickerUrl} from '../skin.js';
import {fileArt} from './file-art.js';
import {BUILTIN_STICKERS, BUILTIN_STICKER_KIND, isBuiltinSticker} from '../../shared/stickers.js';

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
const ui = {target: '', part: 'note', place: 'folder', fileKind: 'pdf', book: 'all', open: false, draft: null, selected: null, confirm: null, route: null};

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
  return {template: null, own: true, ...d.parts, note, stickers: [...global, ...own].sort((a, b) => a.z - b.z)};
}
const stickerModeFor = (course) => (course.sticker_mode === 'global' && ui.draft?.stickers.length ? 'both' : course.sticker_mode || 'global');
/** テンプレートの見た目（一覧の見本） */
function templateSkin(data, t) {
  return {template: t, own: true, ...t.parts, note: targetCourse(data) ? skinOf(data).note : t.parts.note, stickers: t.stickers};
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
      ${isBuiltin(t.id) ? '' : `<button type="button" class="btn btn--small" data-ks="dup" data-id="${esc(t.id)}">複製</button><button type="button" class="btn btn--small" data-ks="export" data-id="${esc(t.id)}" title="ファイル（.dnskin）に書き出して、ほかのパソコンや友だちに渡せます">書き出す</button><button type="button" class="btn btn--small btn--danger" data-ks="remove" data-id="${esc(t.id)}">消す</button>`}
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
    <fieldset class="ks-field"><legend>柄</legend>${choice('tape.pattern', t.pattern, ['course', ...TAPE_PATTERNS], TAPE_PATTERN_LABEL)}</fieldset>
    ${
      t.pattern === 'image'
        ? `<fieldset class="ks-field"><legend>柄にする画像（シール帳から）</legend><div class="ks-book">${bookItems(data, 'tape-image', t.image)}</div>
          <p class="muted">取り込んだ画像は「シール」の欄から足せます。</p></fieldset>`
        : ''
    }`;
}
/** シール帳の並び（はじめから入っているシール＋取り込んだ画像）。filter：all・fav・mark・deco・mine・フォルダ名 */
function bookList(data, filter = 'all') {
  const mine = (data.skin?.stickers ?? []).map((b) => ({id: b.id, name: '取り込んだ画像', kind: 'mine', shape: b.shape, favorite: !!b.favorite, folder: b.folder}));
  const builtin = BUILTIN_STICKERS.map((b) => ({id: b.id, name: b.name, kind: b.kind, shape: 'cut'}));
  const all = [...mine, ...builtin];
  if (filter === 'all') return all;
  if (filter === 'fav') return mine.filter((b) => b.favorite);
  if (filter === 'mine') return mine;
  if (filter === 'mark' || filter === 'deco') return builtin.filter((b) => b.kind === filter);
  return mine.filter((b) => b.folder === filter);
}
/** シール帳の 1 つずつ。action：sticker-add（貼る）か tape-image（テープの柄にする） */
function bookItems(data, action, current = null, filter = 'all') {
  return bookList(data, filter)
    .map((b) => {
      const url = stickerUrl(b.id);
      const mine = b.kind === 'mine';
      const tools = action === 'sticker-add' && mine
        ? `<button type="button" class="ks-book__tool ks-book__fav" data-ks="sticker-fav" data-id="${b.id}" aria-pressed="${b.favorite}" title="${b.favorite ? 'お気に入りから外す' : 'お気に入りにする'}" aria-label="お気に入り">${b.favorite ? '★' : '☆'}</button><button type="button" class="ks-book__tool ks-book__folder" data-ks="sticker-folder" data-id="${b.id}" title="フォルダに分ける${b.folder ? `（今は「${esc(b.folder)}」）` : ''}" aria-label="フォルダに分ける">▤</button><button type="button" class="ks-book__del" data-ks="sticker-del" data-id="${b.id}" title="シール帳から消す" aria-label="シール帳から消す">×</button>`
        : '';
      return `<div class="ks-book__item"><button type="button" class="ks-book__pick" data-ks="${action}" data-id="${b.id}"${action === 'sticker-add' ? ' draggable="true"' : ''} aria-pressed="${current === b.id}" title="${esc(b.name)}">${url ? `<img src="${url}" alt="${esc(b.name)}" class="sticker--${esc(b.shape)}" draggable="false" />` : '…'}</button>${tools}</div>`;
    })
    .join('');
}
/** 貼れる場所。ホームの余白は全体のテンプレートだけ */
const places = (data) => STICKER_PLACES.filter((p) => !targetCourse(data) || !GLOBAL_ONLY_PLACES.includes(p));
function bookFilters(data) {
  const folders = [...new Set((data.skin?.stickers ?? []).map((b) => b.folder).filter(Boolean))];
  const list = [['all', 'すべて'], ['fav', '★ お気に入り'], ['mark', BUILTIN_STICKER_KIND.mark], ['deco', BUILTIN_STICKER_KIND.deco], ['mine', '取り込んだ画像'], ...folders.map((f) => [f, `▤ ${f}`])];
  return list.map(([v, l]) => `<button type="button" class="ks-choice" data-ks="book" data-value="${esc(v)}" aria-pressed="${ui.book === v}"><span>${esc(l)}</span></button>`).join('');
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
    <fieldset class="ks-field"><legend>貼る場所</legend>
      ${choice('place', ui.place, places(data), PLACE_LABEL)}
    </fieldset>
    ${ui.place === 'file' ? kindChoice() : ''}
    <p class="muted">シール帳のシールを押すか、見本へドラッグすると貼れます（1 か所に ${placeMax(ui.place)} 枚まで${FIXED_PLACES.includes(ui.place) ? '。貼る位置は決まっていて、貼り直すと入れ替わります' : ''}）。貼ったシールは見本の上で動かせます。${course ? '全体のシールの上に重ねて見せています（全体のシールはここでは動かせません）。' : ''}</p>
    <fieldset class="ks-field"><legend>シール帳</legend>
      <div class="ks-choices ks-book__filters">${bookFilters(data)}</div>
      <div class="ks-book">
        <label class="ks-book__add btn btn--small">＋ 画像を取り込む<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-ks-file hidden /></label>
        ${bookItems(data, 'sticker-add', null, ui.book)}
      </div>
    </fieldset>
    ${
      sel
        ? `<fieldset class="ks-field ks-sel"><legend>選んだシール</legend>
        <label>大きさ<input type="range" min="20" max="200" step="5" value="${Math.round(sel.scale * 100)}" data-ks-range="scale" /></label>
        <label>傾き<input type="range" min="-45" max="45" step="1" value="${sel.rotate}" data-ks-range="rotate" /></label>
        ${isBuiltinSticker(sel.asset) ? '' : `<label>形<select class="input" data-ks-shape="${sel.asset}">${SHAPES.map((s) => `<option value="${s}" ${shape === s ? 'selected' : ''}>${SHAPE_LABEL[s]}</option>`).join('')}</select></label>`}
        <div class="actions"><button type="button" class="btn btn--small" data-ks="z" data-dir="1">前へ</button><button type="button" class="btn btn--small" data-ks="z" data-dir="-1">後ろへ</button><button type="button" class="btn btn--small btn--danger" data-ks="peel">はがす</button></div>
      </fieldset>`
        : ''
    }`;
}

const PARTS = [
  ['note', 'ノート'],
  ['folder', 'フォルダ'],
  ['tape', 'マスキングテープ'],
  ['file', 'ファイル'],
  ['sticky', '付箋'],
  ['bookmark', 'しおり'],
  ['sticker', 'シール']
];

// 付箋のはじめの色（tokens.css の --pop1〜8 と viewer.js の NOTE_COLORS と同じ）
const POP = ['#ffe14d', '#ff9ec4', '#6fe3b8', '#7cccff', '#ffad5c', '#c3a6ff', '#c2f06a', '#ff8a7a'];
const PDF_NOTE = ['#f6c445', '#f28b82', '#7fd1ae', '#8ab4f8', '#c58af9', '#ffab70'];
// 資料の種類ごとの見本の名前（file-art.js の拡張子から種類が決まる）
const SAMPLE_FILE = {pdf: 'a.pdf', slide: 'a.pptx', doc: 'a.docx', sheet: 'a.xlsx', image: 'a.png', video: 'a.mp4', audio: 'a.mp3', zip: 'a.zip', other: 'a.abc'};
const kindChoice = () => `<fieldset class="ks-field"><legend>資料の種類</legend>${choice('fileKind', ui.fileKind, FILE_KINDS, FILE_KIND_LABEL)}</fieldset>`;

function fileControls(data) {
  const f = ui.draft.parts.file;
  return `${kindChoice()}${colorField(`file.${ui.fileKind}`, `${FILE_KIND_LABEL[ui.fileKind]}の色`, f[ui.fileKind], {recent: data.skin?.recent ?? []})}`;
}
/** 色の並び（回の付箋の 8 色・PDF の付箋の色の候補 6 色）。1 つずつ色の選び器で変える */
function colorRow(key, list, defaults, label) {
  const colors = list === 'default' ? defaults : list;
  return `<fieldset class="ks-field"><legend>${label}</legend><div class="ks-swatches">
    ${colors.map((c, i) => `<label class="ks-sw ks-sw--pick" style="--sw: ${c}" title="${i + 1}"><input type="color" data-ks-list="${key}" data-i="${i}" value="${c}" aria-label="${label}：${i + 1} つ目" /></label>`).join('')}
    <button type="button" class="ks-sw ks-sw--text" data-ks="set" data-key="${key}" data-value="default" aria-pressed="${list === 'default'}">はじめの色</button>
  </div></fieldset>`;
}
function stickyControls() {
  const st = ui.draft.parts.sticky;
  return `${colorRow('sticky.round', st.round, POP, '回の付箋の色（第 1 回から順に）')}${colorRow('sticky.pdf', st.pdf, PDF_NOTE, 'PDF に貼る付箋の色の候補')}`;
}
function bookmarkControls(data) {
  const b = ui.draft.parts.bookmark;
  return `${colorField('bookmark.color', 'リボンの色', b.color, {recent: data.skin?.recent ?? []})}
    <fieldset class="ks-field"><legend>形</legend>${choice('bookmark.shape', b.shape, BOOKMARK_SHAPES, BOOKMARK_SHAPE_LABEL)}</fieldset>`;
}

// 見本の中のシールの大きさ：ホームと PDF 編集画面は、窓（幅 1200px ほど）を半分ほどに縮めた見本なので基準も半分
const PREVIEW_SCALE = {folder: 1, home: 0.5, heading: 1, viewer: 0.5, round: 1, file: 1, bookmark: 1};
/** 場所の見本に貼るシール（直しているテンプレートのものだけ動かせる） */
function placeLayer(data, stickers, place) {
  const shapes = shapesOf(data);
  const base = STICKER_BASE[place] * PREVIEW_SCALE[place];
  return stickers
    .filter((st) => st.place === place)
    .map((st) => stickerImg(st, shapes, {base, ...(st.index != null ? {index: st.index, selected: ui.selected === st.index} : {})}))
    .join('');
}
/** 真ん中の見本。シールの欄では、選んだ貼る場所の見本にする */
/** 決まった位置のシール（見本では押して選べる） */
function fixedPreview(data, st, opts) {
  if (!st) return '';
  const img = stickerImg({...st, x: opts.x, y: opts.y}, shapesOf(data), {base: opts.base, ...(st.index != null ? {index: st.index, selected: ui.selected === st.index} : {})});
  return `<span class="sticker-layer sticker-layer--fixed" data-preview-place="${st.place}" data-preview-fixed>${img}</span>`;
}
/** ファイル・付箋・しおりの見本 */
function partPreview(data, kind, note, skin) {
  const find = (place, k) => skin.stickers.find((st) => st.place === place && (!k || st.kind === k));
  if (kind === 'file')
    return noteSwatch(note, 'ks-preview', `<div class="ks-files">${FILE_KINDS.map(
      (k) => `<div class="ks-file${ui.fileKind === k ? ' is-current' : ''}"><span class="file__art">${fileArt(SAMPLE_FILE[k], {colors: skin.file})}${fixedPreview(data, find('file', k), {x: 0.12, y: 0.16, base: 30})}</span><span class="muted">${FILE_KIND_LABEL[k]}</span></div>`
    ).join('')}</div>`);
  if (kind === 'round') {
    const colors = skin.sticky.round === 'default' ? POP : skin.sticky.round;
    return noteSwatch(note, 'ks-preview', `<div class="ks-notes">${[1, 2, 3, 4].map(
      (n) => `<div class="ks-note" style="--note-color: ${colors[n - 1]}">${fixedPreview(data, find('round'), {x: 0.92, y: 0.06, base: 44})}<strong>第${n}回</strong><span class="muted">資料なし</span></div>`
    ).join('')}</div>${colorChips(skin.sticky.pdf === 'default' ? PDF_NOTE : skin.sticky.pdf, 'PDF の付箋')}`);
  }
  const look = bookmarkLook(skin);
  const sticker = fixedPreview(data, find('bookmark'), {x: 0, y: 0.5, base: 28});
  return noteSwatch(note, 'ks-preview ks-preview--wide', `<div class="ks-pdf ks-pdf--bm" aria-hidden="true"><span></span><span></span><span></span>
    <span class="bookmark-ribbon bm ${look.cls}" style="${look.style}; top: 30%">${sticker}<span class="bookmark-ribbon__text">しおり1</span></span>
    <span class="bookmark-ribbon bm ${look.cls}" style="${look.style}; top: 62%"><span class="bookmark-ribbon__text">テストに出る</span></span></div>`);
}
const colorChips = (colors, label) => `<p class="ks-chips"><span class="muted">${label}</span>${colors.map((c) => `<span class="ks-chip" style="--sw: ${c}"></span>`).join('')}</p>`;

function preview(data, {first, second, note, skin1, skin2}) {
  const part = {file: 'file', sticky: 'round', bookmark: 'bookmark'}[ui.part];
  if (part) return partPreview(data, part, note, skin1);
  const place = ui.part === 'sticker' ? ui.place : 'folder';
  if (FIXED_PLACES.includes(place)) return partPreview(data, place, note, skin1);
  const folders = `<div class="folders ks-preview__folders">${folderCard(first, {data, skin: skin1, edit: {selected: place === 'folder' ? ui.selected : null}})}${folderCard(second, {data, skin: skin2, edit: {still: true}})}</div>`;
  if (place === 'folder') return noteSwatch(note, 'ks-preview', folders);
  const layer = `<div class="ks-place ks-place--${place}" data-preview-place="${place}">${placeLayer(data, skin1.stickers, place)}`;
  if (place === 'home') return noteSwatch(note, 'ks-preview ks-preview--wide', `${layer}</div><div class="ks-mini">${folders}</div>`);
  if (place === 'heading')
    return noteSwatch(note, 'ks-preview', `${layer}<span class="btn">← ホーム</span><h2>${esc(first.name)}</h2></div>`);
  return noteSwatch(note, 'ks-preview ks-preview--wide', `${layer}</div><div class="ks-pdf" aria-hidden="true"><span></span><span></span><span></span></div>`);
}

function editor(data) {
  const course = targetCourse(data);
  const [first, second] = samples(data, course);
  const note = course ? skinOf(data, course).note : ui.draft.parts.note;
  const skin1 = draftSkin(data, first);
  const skin2 = course ? skinOf(data, second) : draftSkin(data, second);
  const controls = {note: noteControls, folder: folderControls, tape: tapeControls, file: fileControls, sticky: stickyControls, bookmark: bookmarkControls, sticker: stickerControls}[ui.part](data);
  const c = ui.confirm;
  return `
    <div class="ks-editor">
      <nav class="ks-parts" aria-label="部品">${PARTS.map(([k, l]) => `<button type="button" class="ks-part" data-ks="part" data-part="${k}" aria-pressed="${ui.part === k}">${l}</button>`).join('')}</nav>
      ${preview(data, {course, first, second, note, skin1, skin2})}
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
        <p class="muted ks-gallery__lead">押すとすぐに${course ? `「${esc(course.name)}」` : 'すべての授業'}に当たります。<button type="button" class="btn btn--small" data-ks="import">テンプレートを読み込む…</button></p>
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

// 貼る場所ごとの、はじめに置く位置（見本の真ん中を避ける）
const START = {folder: [0.72, 0.62], home: [0.9, 0.85], heading: [0.85, 0.5], viewer: [0.03, 0.9]};
function addSticker(asset, place = ui.place, at = START[place] ?? [0.5, 0.5]) {
  const d = ui.draft;
  // 決まった位置の場所（回の付箋の角・資料のイラスト・しおり）は 1 枚だけ。貼り直すと入れ替える
  if (FIXED_PLACES.includes(place)) {
    const kind = place === 'file' ? ui.fileKind : undefined;
    d.stickers = d.stickers.filter((s) => !(s.place === place && (place !== 'file' || s.kind === kind)));
    d.stickers.push({place, ...(kind ? {kind} : {}), asset, x: 0.5, y: 0.5, scale: 1, rotate: 0, z: 0});
    ui.selected = d.stickers.length - 1;
    return refresh();
  }
  if (d.stickers.filter((s) => s.place === place).length >= STICKERS_PER_PLACE)
    return toast(`${PLACE_LABEL[place]}に貼れるシールは ${STICKERS_PER_PLACE} 枚までです`, {error: true});
  // 押して貼るときは、前に貼ったシールと重ならないように少しずつずらす
  const n = d.stickers.filter((s) => s.place === place).length;
  const [x, y] = at === START[place] ? [Math.min(1, Math.max(0, at[0] + (at[0] > 0.5 ? -0.08 : 0.08) * n)), at[1]] : at;
  d.stickers.push({place, asset, x, y, scale: 1, rotate: Math.round(Math.random() * 20 - 10), z: Math.max(0, ...d.stickers.map((s) => s.z + 1))});
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
    if (ks === 'export') {
      const r = await api['skin.export']({id: el.dataset.id});
      if (r?.error) return toast(r.error, {error: true});
      if (r?.ok) toast(`「${r.name}」に書き出しました`);
      return;
    }
    if (ks === 'import') {
      const r = await api['skin.import']();
      if (r?.error) return toast(r.error, {error: true});
      if (!r?.ok) return;
      await reload();
      return toast(`「${r.template.name}」を読み込みました（作った人：${r.template.author}・${LICENSE_LABEL[r.template.license]}）`);
    }
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
      if (el.dataset.key === 'place') {
        ui.place = el.dataset.value;
        ui.selected = null;
      } else if (el.dataset.key === 'fileKind') ui.fileKind = el.dataset.value;
      else setPath(ui.draft.parts, el.dataset.key, el.dataset.value);
    } else if (ks === 'book') ui.book = el.dataset.value;
    else if (ks === 'tape-image') ui.draft.parts.tape.image = el.dataset.id;
    else if (ks === 'sticker-fav' || ks === 'sticker-folder') {
      const b = (data.skin?.stickers ?? []).find((x) => x.id === el.dataset.id);
      if (!b) return;
      let patch;
      if (ks === 'sticker-fav') patch = {favorite: !b.favorite};
      else {
        const name = window.prompt('シール帳のフォルダの名前（空にすると分けない）', b.folder ?? '');
        if (name === null) return;
        patch = {folder: name};
      }
      const r = await api['sticker.update']({id: b.id, ...patch});
      if (r?.error) return toast(r.error, {error: true});
      return reload();
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
  else if (el.dataset.ksList) {
    setListColor(el);
    refresh();
  } else if (el.dataset.ksColor) {
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
  if (el.dataset.ksList) {
    setListColor(el);
    repaintPreview();
  } else if (el.dataset.ksColor) {
    setPath(ui.draft.parts, el.dataset.ksColor, el.value.toLowerCase());
    repaintPreview();
  } else if (el.dataset.ksRange && ui.selected != null) {
    const s = ui.draft.stickers[ui.selected];
    if (el.dataset.ksRange === 'scale') s.scale = Number(el.value) / 100;
    else s.rotate = Number(el.value);
    repaintPreview();
  }
});
/** 色の並びの 1 つを変える（はじめの色のままなら、はじめの色を写してから） */
function setListColor(el) {
  const [a, b] = el.dataset.ksList.split('.');
  const defaults = el.dataset.ksList === 'sticky.round' ? POP : PDF_NOTE;
  const list = ui.draft.parts[a][b] === 'default' ? [...defaults] : [...ui.draft.parts[a][b]];
  list[Number(el.dataset.i)] = el.value.toLowerCase();
  ui.draft.parts[a][b] = list;
}
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
  const img = e.target.closest?.('.kisekae [data-preview-place] [data-sticker-index]');
  const folder = e.target.closest?.('.kisekae [data-preview-place]');
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
  if (folder.hasAttribute('data-preview-fixed')) {
    ui.selected = i;
    return refresh();
  }
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
  if (e.target.closest?.('.kisekae [data-preview-place]') && e.dataTransfer.types.includes('text/x-daigaku-sticker')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  const box = e.target.closest?.('.kisekae [data-preview-place]');
  const sid = e.dataTransfer?.getData('text/x-daigaku-sticker');
  if (!box || !sid || !ui.draft) return;
  e.preventDefault();
  const r = box.getBoundingClientRect();
  addSticker(sid, box.dataset.previewPlace, [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]);
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
