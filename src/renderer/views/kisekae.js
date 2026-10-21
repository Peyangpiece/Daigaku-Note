// 着せ替えページ（SPEC-KISEKAE.md §3.2）と、フォルダの右クリックから出す選択パネル（§3.3）。
// 着せ替えページ（#/kisekae）「おすすめから選ぶ」：押すとすぐ当たる。
// 細かい編集のページ（#/kisekae/edit）：見本を見ながら直し、自作のテンプレートとして保存する
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
  FILE_ART_ITEMS,
  FILE_ART_SHIFT,
  ROUND_WEEKDAYS
} from '../../shared/skin.js';
import {STICKER_BASE, allTemplates, bookmarkLook, forgetSticker, globalId, noteVars, shapesOf, skinOf, stickerUrl} from '../skin.js';
import {fileArt, kindOf} from './file-art.js';
import {BUILTIN_STICKERS, BUILTIN_STICKER_KIND, isBuiltinSticker} from '../../shared/stickers.js';

const api = window.daigaku;

// 色の見本。紙・カードには淡い色、線・タブ・テープ・資料・しおりにははっきりした色（白などの淡い色は線やテープでは見えないため）
const LIGHT = ['#ffffff', '#fbf8f1', '#fffaf0', '#fff6f8', '#f4fbf7', '#f3f8ff', '#f8f5ff', '#efe6d6'];
const VIVID = ['#f6c445', '#f28b82', '#7fd1ae', '#8ab4f8', '#c58af9', '#ffab70', '#6fd3e6', '#f7a1c4', '#2c4a7a', '#3a3a3a'];
const RECENT_MAX = 4;
const SAMPLE = [
  {id: 'sample-1', name: '管理会計Ⅱ', color: 1, tape_pattern: 'plain', weekday: '金', period: 2},
  {id: 'sample-2', name: 'マーケティング', color: 4, tape_pattern: 'stripe', weekday: '月', period: 1}
];

// 画面の状態（描き直しても残す）。draft は直している途中のテンプレート（baseId は元のテンプレート）。
// 対象・名前などは ui が決めるので、描き直しのときに前の値へ戻さない（data-keep="off"）
const ui = {target: '', part: 'note', scene: 'home', history: [], future: [], fileKind: 'pdf', art: null, book: 'mark', draft: null, selected: null, confirm: null, route: null};

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
    from: t.name,
    name: name ?? (asNew || isBuiltin(t.id) ? `わたしの ${n}` : t.name),
    license: asNew || isBuiltin(t.id) ? 'personal' : t.license,
    parts: structuredClone(t.parts),
    stickers: structuredClone(t.stickers)
  };
  ui.selected = null;
  ui.art = null;
  ui.confirm = null;
  ui.history = [];
  ui.future = [];
}

// ---- 取り消し・やり直し（直している途中のテンプレートだけ。50 手まで） ----
const snap = () => JSON.stringify({parts: ui.draft.parts, stickers: ui.draft.stickers});
/** 変える前に呼ぶ。今の形を取り消しの履歴に積む */
function remember() {
  ui.history.push(snap());
  if (ui.history.length > 50) ui.history.shift();
  ui.future = [];
}
function travel(from, to) {
  if (!from.length) return;
  to.push(snap());
  const {parts, stickers} = JSON.parse(from.pop());
  ui.draft.parts = parts;
  ui.draft.stickers = stickers;
  ui.selected = null;
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
function colorField(key, label, value, {allowDefault = true, allowCourse = false, recent = [], light = false} = {}) {
  const sw = (v, text, cls = '') =>
    `<button type="button" class="ks-sw ${cls}" data-ks="color" data-key="${key}" data-value="${v}" aria-pressed="${value === v}" title="${esc(text)}"${v.startsWith('#') ? ` style="--sw: ${v}"` : ''}>${v.startsWith('#') ? '' : esc(text)}</button>`;
  // 最近使った色（4 つまで）・今の色（候補になくても見せる）・候補
  const colors = [...new Set([...recent.slice(0, RECENT_MAX), ...(value?.startsWith('#') ? [value] : []), ...(light ? LIGHT : VIVID)])];
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
    ${colorField('note.paper', '紙の色', n.paper, {recent, light: true})}
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
  return `${colorField('folder.card', 'カードの色', f.card, {recent, light: true})}${colorField('folder.tab', 'タブの色', f.tab, {recent})}`;
}
function tapeControls(data) {
  const t = ui.draft.parts.tape;
  return `${colorField('tape.color', 'テープの色', t.color, {allowDefault: false, allowCourse: true, recent: data.skin?.recent ?? []})}
    <fieldset class="ks-field"><legend>柄</legend>${choice('tape.pattern', t.pattern, TAPE_PATTERNS, TAPE_PATTERN_LABEL)}</fieldset>
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
/** シール帳のジャンル（上のバー）。[値, 名前, 見本のシール]。お気に入り・取り込んだ画像は、あれば出す。フォルダは取り込んだ画像のフォルダ分け */
function bookTabs(data) {
  const mine = data.skin?.stickers ?? [];
  const first = (filter) => bookList(data, filter)[0]?.id ?? null;
  const folders = [...new Set(mine.map((b) => b.folder).filter(Boolean))];
  return [
    ...(mine.some((b) => b.favorite) ? [['fav', 'お気に入り', first('fav')]] : []),
    ['mark', BUILTIN_STICKER_KIND.mark, first('mark')],
    ['deco', BUILTIN_STICKER_KIND.deco, first('deco')],
    ['mine', '取り込んだ画像', first('mine')],
    ...folders.map((f) => [f, f, first(f)])
  ];
}
function stickerControls(data) {
  const book = data.skin?.stickers ?? [];
  const d = ui.draft;
  const sel = ui.selected != null ? d.stickers[ui.selected] : null;
  const course = targetCourse(data);
  const shape = sel ? (book.find((b) => b.id === sel.asset)?.shape ?? 'cut') : null;
  const mode = course
    ? `<label class="ks-field">全体のシールとの重ね方<select class="input" data-ks-mode>
        ${[
          ['global', '全体のシールだけ'],
          ['course', 'この授業のシールだけ'],
          ['both', '両方']
        ]
          .map(([v, l]) => `<option value="${v}" ${course.sticker_mode === v ? 'selected' : ''}>${l}</option>`)
          .join('')}</select></label>`
    : '';
  if (!sel)
    return `<p class="muted">見本の上のシールを押すと、ここで大きさや傾きを変えられます。貼るときは、下のシール帳から見本へドラッグします。</p>${mode}`;
  return `
    <p class="muted">${esc(PLACE_LABEL[sel.place])}${sel.place === 'file' ? `（${esc(FILE_KIND_LABEL[sel.kind])}）` : ''}に貼ってあります。見本の上で、ドラッグで動かし、角の ◢ で大きさ、上の ↻ で傾きを変えられます。矢印キーでも動かせます。</p>
    <label class="ks-range">大きさ<input type="range" min="20" max="200" step="5" value="${Math.round(sel.scale * 100)}" data-ks-range="scale" /><output>${Math.round(sel.scale * 100)}%</output></label>
    <label class="ks-range">傾き<input type="range" min="-180" max="180" step="1" value="${sel.rotate}" data-ks-range="rotate" /><output>${sel.rotate}°</output></label>
    ${isBuiltinSticker(sel.asset) ? '' : `<label class="ks-field">形<select class="input" data-ks-shape="${sel.asset}">${SHAPES.map((x) => `<option value="${x}" ${shape === x ? 'selected' : ''}>${SHAPE_LABEL[x]}</option>`).join('')}</select></label>`}
    <div class="actions">
      ${FIXED_PLACES.includes(sel.place) ? (sel.moved ? '<button type="button" class="btn btn--small" data-ks="unmove">元の位置に</button>' : '') : '<button type="button" class="btn btn--small" data-ks="z" data-dir="1">前へ</button><button type="button" class="btn btn--small" data-ks="z" data-dir="-1">後ろへ</button>'}
      <button type="button" class="btn btn--small" data-ks="straight">まっすぐに</button>
      <button type="button" class="btn btn--small btn--danger" data-ks="peel">はがす</button>
    </div>
    ${mode}`;
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
const POP = ['#ffe14d', '#ff9ec4', '#6fe3b8', '#7cccff', '#ffad5c'];
const PDF_NOTE = ['#f6c445', '#f28b82', '#7fd1ae', '#8ab4f8', '#c58af9', '#ffab70'];

const ART_LABEL = {mark: '種類の印（文字・絵）', label: '拡張子のラベル'};
function fileControls(data) {
  const f = ui.draft.parts.file;
  const art = ui.draft.parts.fileArt[ui.fileKind];
  const row = (i) => `<div class="ks-artrow${ui.art === i ? ' is-on' : ''}"><span>${ART_LABEL[i]}${art[i].on ? '' : '<span class="muted">（消しています）</span>'}</span>
      <span class="actions">${art[i].on ? `<button type="button" class="btn btn--small" data-ks="art-hide" data-art-item="${i}">消す</button>` : `<button type="button" class="btn btn--small" data-ks="art-show" data-art-item="${i}">出す</button>`}
      ${art[i].dx || art[i].dy ? `<button type="button" class="btn btn--small" data-ks="art-reset" data-art-item="${i}">元の位置に</button>` : ''}</span></div>`;
  return `${colorField(`file.${ui.fileKind}`, `${FILE_KIND_LABEL[ui.fileKind]}の色`, f[ui.fileKind], {recent: data.skin?.recent ?? []})}
    <fieldset class="ks-field"><legend>イラストの中身</legend>
      <p class="muted">見本の大きなイラストの上で、文字やラベルをドラッグして動かせます。選んで Delete で消せます。</p>
      ${FILE_ART_ITEMS.map(row).join('')}
    </fieldset>`;
}
/** 色の並び（回の付箋の 8 色・PDF の付箋の色の候補 6 色）。1 つずつ色の選び器で変える */
function colorRow(key, list, defaults, label, names = null) {
  const colors = list === 'default' ? defaults : list;
  const name = (i) => names?.[i] ?? `${i + 1} つ目`;
  const sw = (c, i) => `<label class="ks-sw ks-sw--pick" style="--sw: ${c}" title="${esc(name(i))}"><input type="color" data-ks-list="${key}" data-i="${i}" value="${c}" aria-label="${label}：${esc(name(i))}" /></label>`;
  return `<fieldset class="ks-field"><legend>${label}</legend><div class="ks-swatches">
    ${colors.map((c, i) => (names ? `<span class="ks-sw-named">${sw(c, i)}<span>${esc(names[i])}</span></span>` : sw(c, i))).join('')}
    <button type="button" class="ks-sw ks-sw--text" data-ks="set" data-key="${key}" data-value="default" aria-pressed="${list === 'default'}">はじめの色</button>
  </div></fieldset>`;
}
function stickyControls() {
  const st = ui.draft.parts.sticky;
  return `${colorRow('sticky.round', st.round, POP, '回の付箋の色（曜日ごと）', ROUND_WEEKDAYS)}${colorRow('sticky.pdf', st.pdf, PDF_NOTE, 'PDF に貼る付箋の色の候補')}`;
}
/** しおりの形の見本：PDF の紙の右の端から出るリボン */
function bookmarkSwatch(bookmark) {
  const look = bookmarkLook({bookmark});
  return `<span class="ks-choice__swatch ks-bmswatch" aria-hidden="true"><span></span><span></span><span class="bookmark-ribbon bm ${look.cls}" style="${look.style}"></span></span>`;
}
function bookmarkControls(data) {
  const b = ui.draft.parts.bookmark;
  return `${colorField('bookmark.color', 'リボンの色', b.color, {recent: data.skin?.recent ?? []})}
    <fieldset class="ks-field"><legend>形</legend>${choice('bookmark.shape', b.shape, BOOKMARK_SHAPES, BOOKMARK_SHAPE_LABEL, {swatch: (v) => bookmarkSwatch({...b, shape: v})})}</fieldset>`;
}

// ---- 見本（ステージ）：場面ごとの見本の上で、部分を押して直し、シールをドラッグで貼って動かす ----
// 場面：home（ホーム：紙・フォルダ・テープ・フォルダとホームの余白のシール）、course（授業ページ：見出し・回の付箋・資料・しおり）、
// viewer（PDF 編集画面：余白・しおりのリボン・PDF の付箋の色）
const SCENES = [
  ['home', 'ホーム'],
  ['course', '授業ページ'],
  ['file', 'ファイル'],
  ['viewer', 'PDF']
];
// 部分を選んだときに見せる場面
const SCENE_OF = {note: 'home', folder: 'home', tape: 'home', file: 'file', sticky: 'course', bookmark: 'viewer'};
// 場面で押して貼ったときの場所（ドラッグなら落とした所）
const SCENE_PLACE = {home: 'folder', course: 'heading', file: 'file', viewer: 'viewer'};
// 見本の中のシールの大きさ：ホームと PDF 編集画面の見本は、窓（幅 1200px ほど）を半分ほどに縮めたものなので基準も半分
const PREVIEW_SCALE = {folder: 1, home: 0.5, heading: 1, viewer: 0.5, round: 1, file: 1, bookmark: 1};
// 決まった位置のシールの位置と大きさ（授業画面・編集画面と同じ）
const FIXED_AT = {round: {x: 0.95, y: 0.04, base: 44}, file: {x: 0.12, y: 0.16, base: 30}, bookmark: {x: 0, y: 0.5, base: 28}};

/** 見本の上のシール 1 枚。直しているテンプレートのシールは選べて、選んだシールには取っ手（大きさ・傾き・複製・はがす）を出す */
function stageSticker(data, st, {base, fixed = null}) {
  const url = stickerUrl(st.asset);
  if (!url) return '';
  const shape = shapesOf(data)[st.asset] ?? 'cut';
  const x = fixed && !st.moved ? fixed.x : st.x,
    y = fixed && !st.moved ? fixed.y : st.y;
  const mine = st.index != null;
  const sel = mine && ui.selected === st.index;
  const style = `left: ${(x * 100).toFixed(2)}%; top: ${(y * 100).toFixed(2)}%; width: ${Math.round(base * st.scale)}px; transform: translate(-50%, -50%) rotate(${st.rotate}deg); z-index: ${sel ? 50 : st.z}`;
  const handles = sel
    ? `<span class="ks-h ks-h--scale" data-h="scale" title="引いて大きさを変える"></span>
       <span class="ks-h ks-h--rotate" data-h="rotate" title="回して傾ける"></span>
       <button type="button" tabindex="-1" class="ks-h ks-h--del" data-h="del" title="はがす（Delete）" aria-label="はがす">×</button>
       ${fixed ? '' : '<button type="button" tabindex="-1" class="ks-h ks-h--dup" data-h="dup" title="もう 1 枚貼る" aria-label="複製">＋</button>'}`
    : '';
  return `<span class="ks-st${sel ? ' is-selected' : ''}${mine ? '' : ' is-locked'}"${mine ? ` data-sticker-index="${st.index}" tabindex="0" role="button" aria-label="シール（${esc(PLACE_LABEL[st.place] ?? '')}）。矢印で動かし、Delete ではがす"` : ''}${fixed ? ' data-fixed' : ''} data-base="${base}" style="${style}" title="${mine ? 'ドラッグで動かす・押して選ぶ' : '全体のシール（ここでは動かせません）'}">
    <img class="sticker sticker--${shape}" src="${url}" alt="" draggable="false" />${handles}</span>`;
}
const stageLayer = (data, stickers, place) =>
  stickers
    .filter((st) => st.place === place)
    .map((st) => stageSticker(data, st, {base: STICKER_BASE[place] * PREVIEW_SCALE[place]}))
    .join('');
const fixedOne = (data, st) => (st ? `<span class="ks-fixed">${stageSticker(data, st, {base: FIXED_AT[st.place].base, fixed: FIXED_AT[st.place]})}</span>` : '');
const editAttr = (part, label) => `data-edit="${part}" title="押すと${label}を変えられます"`;
const isOn = (part, kind = null) => (ui.part === part && (kind == null || ui.fileKind === kind) && ui.selected == null ? ' is-editing' : '');

function homeScene(data, {first, second, note, skin1, skin2}) {
  const course = targetCourse(data);
  const render = (st) => stageSticker(data, st, {base: STICKER_BASE.folder});
  return noteSwatch(note, `ks-stage ks-stage--home${isOn('note')}`, `
    <div class="ks-place" ${course ? '' : 'data-drop-place="home"'} ${editAttr('note', 'ノート（紙と線）')}>${stageLayer(data, skin1.stickers, 'home')}</div>
    <div class="folders ks-stage__folders">
      <div class="ks-target${isOn('folder')}">${folderCard(first, {data, skin: skin1, edit: {render}})}</div>
      ${folderCard(second, {data, skin: skin2, edit: {still: true}})}
    </div>`);
}
// 資料の種類（FILE_KINDS）ごとの見本の名前。授業ページの見本では 5 回に 2 つずつ分ける
const KIND_FILE = {pdf: 'a.pdf', slide: 'a.pptx', doc: 'a.docx', sheet: 'a.xlsx', image: 'a.png', video: 'a.mp4', audio: 'a.mp3', zip: 'a.zip', other: 'a.dat'};
const SCENE_FILES = Object.values(KIND_FILE);
function courseScene(data, {first, note, skin1}) {
  const sk = skin1;
  const colors = sk.sticky.round === 'default' ? POP : sk.sticky.round;
  const find = (place, k) => sk.stickers.find((st) => st.place === place && (!k || st.kind === k));
  const file = (name) => {
    const kind = kindOf(name);
    return `<span class="ks-file" ${editAttr('file', `${FILE_KIND_LABEL[kind]}のイラスト`)} data-kind="${kind}" data-drop-place="file">
      <span class="file__art">${fileArt(name, {colors: sk.file, art: sk.fileArt})}${fixedOne(data, find('file', kind))}</span>
      <span class="muted">${FILE_KIND_LABEL[kind]}</span></span>`;
  };
  // 回の付箋：曜日ごとの 5 色が全部見えるように、月〜金の 5 枚
  const roundNote = (n, files) =>
    `<div class="ks-note${isOn('sticky')}" style="--note-color: ${colors[n - 1]}" ${editAttr('sticky', '付箋の色')} aria-label="${ROUND_WEEKDAYS[n - 1]}曜の付箋" data-drop-place="round">
      ${n === 1 ? fixedOne(data, find('round')) : ''}<span class="ks-note__files">${files.map(file).join('')}</span></div>`;
  return noteSwatch(note, `ks-stage ks-stage--course${isOn('note')}`, `
    <div class="ks-place ks-place--heading" data-drop-place="heading" title="シールをここへドラッグすると見出しに貼れます">${stageLayer(data, sk.stickers, 'heading')}
      <span class="btn">← ホーム</span><h2>${esc(first.name)}</h2></div>
    <div class="ks-notes">${[0, 1, 2, 3, 4].map((i) => roundNote(i + 1, SCENE_FILES.slice(i * 2, i * 2 + 2))).join('')}</div>`);
}
// ファイルの場面：選んでいる種類の資料のイラストを大きく出す。印とラベルはドラッグで動かせる。下に種類の切り替え
const BIG = 3.4;
function fileScene(data, {note, skin1}) {
  const sk = skin1;
  const k = ui.fileKind;
  const st = sk.stickers.find((x) => x.place === 'file' && x.kind === k);
  let art = fileArt(KIND_FILE[k], {colors: sk.file, art: sk.fileArt, editable: true});
  if (ui.art) art = art.replace(`data-art="${ui.art}"`, `data-art="${ui.art}" class="is-sel"`);
  return noteSwatch(note, 'ks-stage ks-stage--file', `
    <div class="ks-bigfile${ui.art ? '' : isOn('file', k)}" ${editAttr('file', `${FILE_KIND_LABEL[k]}の色`)} data-kind="${k}" data-drop-place="file" style="--big: ${BIG}">
      <span class="file__art">${art}${st ? `<span class="ks-fixed">${stageSticker(data, st, {base: FIXED_AT.file.base * BIG, fixed: FIXED_AT.file})}</span>` : ''}</span>
    </div>
    <div class="ks-kinds" role="group" aria-label="資料の種類">${FILE_KINDS.map(
      (x) =>
        `<button type="button" class="ks-kind" data-ks="set" data-key="fileKind" data-value="${x}" aria-pressed="${x === k}">${fileArt(KIND_FILE[x], {colors: sk.file, art: sk.fileArt})}<span>${FILE_KIND_LABEL[x]}</span></button>`
    ).join('')}</div>`);
}
function viewerScene(data, {note, skin1}) {
  const sk = skin1;
  const look = bookmarkLook(sk);
  const pdf = sk.sticky.pdf === 'default' ? PDF_NOTE : sk.sticky.pdf;
  const ribbon = (top, name, withSticker) =>
    `<span class="bookmark-ribbon bm ${look.cls}${isOn('bookmark')}" style="${look.style}; top: ${top}%" ${editAttr('bookmark', 'しおり')} data-drop-place="bookmark">${withSticker ? fixedOne(data, sk.stickers.find((st) => st.place === 'bookmark')) : ''}<span class="bookmark-ribbon__text">${name}</span></span>`;
  return noteSwatch(note, `ks-stage ks-stage--viewer${isOn('note')}`, `
    <div class="ks-place" data-drop-place="viewer" ${editAttr('note', 'ノート（紙と線）')}>${stageLayer(data, sk.stickers, 'viewer')}</div>
    <div class="ks-pdf ks-pdf--stage"><span></span><span></span><span></span>${ribbon(30, 'しおり1', true)}${ribbon(62, 'テストに出る', false)}
      <span class="ks-pdfnotes${isOn('sticky')}" ${editAttr('sticky', 'PDF に貼る付箋の色')}>${pdf.map((c) => `<span class="ks-chip" style="--sw: ${c}"></span>`).join('')}</span></div>`);
}

/** 場面の見本 */
function stage(data, ctx) {
  return {home: homeScene, course: courseScene, file: fileScene, viewer: viewerScene}[ui.scene](data, ctx);
}

/** シール帳（見本の下の棚）。ドラッグで見本の好きな所へ、押すと今の場面の決まった所へ貼る */
function tray(data) {
  const tabs = bookTabs(data);
  if (!tabs.some(([v]) => v === ui.book)) ui.book = 'mark';
  const items = bookItems(data, 'sticker-add', null, ui.book);
  const empty = ui.book === 'mine' ? 'まだありません。右の ＋ から画像を取り込むと、ここに並びます。' : 'まだありません。';
  return `<div class="ks-tray">
    <div class="ks-tray__bar" role="tablist" aria-label="シール帳のジャンル">
      ${tabs
        .map(([v, label, sid]) => {
          const url = sid ? stickerUrl(sid) : '';
          return `<button type="button" class="ks-tray__tab" role="tab" data-ks="book" data-value="${esc(v)}" aria-selected="${ui.book === v}" title="${esc(label)}">
            <span class="ks-tray__icon">${url ? `<img src="${url}" alt="" draggable="false" />` : v === 'fav' ? '★' : '🖼'}</span><span class="ks-tray__label">${esc(label)}</span></button>`;
        })
        .join('')}
      <label class="ks-tray__tab ks-tray__add" title="画像を取り込んでシールにする"><span class="ks-tray__icon">＋</span><span class="ks-tray__label">取り込む</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-ks-file hidden /></label>
    </div>
    <div class="ks-book ks-tray__grid" role="tabpanel" aria-label="${esc(tabs.find(([v]) => v === ui.book)?.[1] ?? '')}">${items || `<p class="muted ks-tray__empty">${empty}</p>`}</div>
  </div>`;
}

const PART_TITLE = {
  note: 'ノート（紙と線）',
  folder: 'フォルダ',
  tape: 'マスキングテープ',
  file: 'ファイル（資料のイラスト）',
  sticky: '付箋',
  bookmark: 'しおり',
  sticker: 'シール'
};
function inspector(data) {
  const controls = {note: noteControls, folder: folderControls, tape: tapeControls, file: fileControls, sticky: stickyControls, bookmark: bookmarkControls, sticker: stickerControls}[
    ui.selected != null ? 'sticker' : ui.part
  ](data);
  const title = ui.selected != null ? '選んだシール' : PART_TITLE[ui.part];
  return `<aside class="ks-inspector" aria-label="${esc(title)}を変える">
    <div class="ks-inspector__parts" role="group" aria-label="変える部分">${PARTS.filter(([k]) => k !== 'sticker')
      .map(([k, l]) => `<button type="button" class="ks-chipbtn" data-ks="part" data-part="${k}" aria-pressed="${ui.selected == null && ui.part === k}">${l}</button>`)
      .join('')}</div>
    <h4 class="ks-inspector__title">${esc(title)}</h4>
    ${controls}
  </aside>`;
}

function editor(data) {
  const course = targetCourse(data);
  const [first, second] = samples(data, course);
  const note = course ? skinOf(data, course).note : ui.draft.parts.note;
  const skin1 = draftSkin(data, first);
  const skin2 = course ? skinOf(data, second) : draftSkin(data, second);
  const c = ui.confirm;
  return `
    <div class="ks-studio">
      <div class="ks-stagecol">
        <div class="ks-stagebar">
          <div class="ks-scenes" role="group" aria-label="見本の場面">${SCENES.map(([k, l]) => `<button type="button" class="ks-chipbtn" data-ks="scene" data-scene="${k}" aria-pressed="${ui.scene === k}">${l}</button>`).join('')}</div>
          <span class="ks-stagebar__undo">
            <button type="button" class="ks-chipbtn" data-ks="undo" ${ui.history.length ? '' : 'disabled'} title="取り消す（⌘Z / Ctrl+Z）" aria-label="取り消す">↶</button>
            <button type="button" class="ks-chipbtn" data-ks="redo" ${ui.future.length ? '' : 'disabled'} title="やり直す（⇧⌘Z / Ctrl+Y）" aria-label="やり直す">↷</button>
          </span>
        </div>
        <div class="ks-stagewrap" tabindex="0" aria-label="見本。部分を押すと右で変えられます。シールは矢印キーで動かし、Delete ではがせます">${stage(data, {course, first, second, note, skin1, skin2})}</div>
        <p class="muted ks-hint">部分を押すと右で直せます。シールは下から見本へドラッグして貼ります。</p>
        ${tray(data)}
        <div class="ks-save">
          <label>名前<input class="input" id="ks-name" data-keep="off" maxlength="40" value="${esc(ui.draft.name)}" /></label>
          <label>利用条件<select class="input" id="ks-license" data-keep="off">${LICENSES.map((l) => `<option value="${l}" ${ui.draft.license === l ? 'selected' : ''}>${LICENSE_LABEL[l]}</option>`).join('')}</select></label>
          <button type="button" class="btn btn--primary" data-ks="save">保存して当てる</button>
          ${ui.draft.baseId ? '<button type="button" class="btn" data-ks="save-new">別のテンプレートとして保存</button>' : ''}
          <button type="button" class="btn" data-ks="discard">やめる</button>
        </div>
        ${
          c
            ? `<div class="ks-confirm sticky" role="alertdialog" aria-labelledby="ks-confirm-text"><p id="ks-confirm-text">このテンプレートは${esc(c.text)}で使っています。保存すると、すべて変わります。</p>
            <div class="actions"><button type="button" class="btn btn--primary" data-ks="save-confirm">保存</button>${course ? '<button type="button" class="btn" data-ks="save-course">この授業用に複製</button>' : ''}<button type="button" class="btn" data-ks="confirm-cancel">やめる</button></div></div>`
            : ''
        }
      </div>
      ${inspector(data)}
    </div>`;
}

/** ページの行き先。target は授業の id（空ならすべての授業） */
const query = (params) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return q.size ? `?${q}` : '';
};
const galleryRoute = () => `/kisekae${query({course: ui.target})}`;
const editRoute = (extra = {}) => `/kisekae/edit${query({course: ui.target, ...extra})}`;

/** 着せ替えページ（#/kisekae?course=<id>）と、細かい編集のページ（#/kisekae/edit?course=<id>&id=<テンプレート>、new=1 なら新しく作成） */
export function renderKisekae({data}, route) {
  const editing = route.split('?')[0] === '/kisekae/edit';
  if (route !== ui.route) {
    ui.route = route;
    const q = new URLSearchParams(route.split('?')[1] ?? '');
    const cid = q.get('course');
    ui.target = cid && data.courses.some((c) => c.id === cid) ? cid : '';
    ui.draft = null;
    if (editing && q.get('new') === '1') {
      const c = targetCourse(data);
      startDraft(data, null, {asNew: true, name: c ? `${c.name} 用` : null});
      ui.part = 'folder';
    } else if (editing) startDraft(data, allTemplates(data).find((t) => t.id === q.get('id')) ?? null);
  }
  const course = targetCourse(data);
  if (ui.target && !course) ui.target = '';
  if (editing) {
    if (!ui.draft) startDraft(data, null);
    return editPage(data, course);
  }
  const current = currentId(data);
  const [first] = samples(data, course);
  const templates = allTemplates(data);
  const builtins = templates.filter((t) => isBuiltin(t.id));
  const mine = templates.filter((t) => !isBuiltin(t.id));
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
        <p class="muted ks-gallery__lead">押すとすぐに${course ? `「${esc(course.name)}」` : 'すべての授業'}に当たります。</p>
        <div class="ks-gallery">
          ${
            course
              ? `<div class="ks-card${current === null ? ' is-current' : ''}"><button type="button" class="ks-card__pick ks-card__pick--global" data-ks="apply" data-id="" aria-pressed="${current === null}">
              ${noteSwatch(skinOf(data).note, 'ks-card__paper', `<div class="ks-card__folder">${folderCard({...first, skin_template_id: null}, {data, edit: {still: true}})}</div>`)}
              <span class="ks-card__name">${current === null ? '✓ ' : ''}全体と同じ</span><span class="ks-card__meta muted">すべての授業の設定に合わせる</span></button></div>`
              : ''
          }
          ${builtins.map((t) => galleryCard(data, t, first, current)).join('')}
        </div>
      </section>
      <section class="ks-mine" aria-labelledby="ks-mine-title">
        <h3 id="ks-mine-title">マイノート</h3>
        <p class="muted ks-gallery__lead">自分で作ったものと、読み込んだものです。押すとすぐ当たります。
          <button type="button" class="btn btn--small" data-ks="import">テンプレートを読み込む…</button></p>
        ${
          mine.length
            ? `<div class="ks-gallery">${mine.map((t) => galleryCard(data, t, first, current)).join('')}</div>`
            : '<p class="muted ks-mine__empty">まだありません。上のテンプレートの「もとにして作る」か、下の「細かい編集へ」から作れます。</p>'
        }
        <div class="ks-tolab">
          <p class="muted">今の${course ? `「${esc(course.name)}」の` : ''}テンプレートをもとに、紙・フォルダ・テープ・シールなどを見本の上で直せます。</p>
          <button type="button" class="btn btn--primary" data-ks="open-editor">細かい編集へ →</button>
        </div>
      </section>
    </div>`;
}


/** 細かい編集のページ */
function editPage(data, course) {
  return `
    <div class="kisekae kisekae--edit">
      <div class="ks-editbar">
        <button type="button" class="btn" data-ks="back">← 着せ替えへ</button>
        <h2>細かい編集</h2>${ui.history.length ? '<span class="ks-dirty" title="保存していない変更があります">● 未保存</span>' : ''}
        <span class="muted">対象：${course ? `「${esc(course.name)}」` : 'すべての授業'}・「${esc(ui.draft.from)}」${ui.draft.baseId ? 'を直しています' : 'をもとに新しく作ります'}</span>
      </div>
      ${editor(data)}
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
  ui.confirm = null;
  navigate(galleryRoute());
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
function addSticker(asset, place = SCENE_PLACE[ui.scene], at = START[place] ?? [0.5, 0.5], fileKind = ui.fileKind) {
  const d = ui.draft;
  if (targetCourse(state.data) && GLOBAL_ONLY_PLACES.includes(place)) place = 'folder';
  remember();
  // 決まった位置の場所（回の付箋の角・資料のイラスト・しおり）は 1 枚だけ。貼り直すと入れ替える
  if (FIXED_PLACES.includes(place)) {
    const kind = place === 'file' ? fileKind : undefined;
    d.stickers = d.stickers.filter((s) => !(s.place === place && (place !== 'file' || s.kind === kind)));
    d.stickers.push({place, ...(kind ? {kind} : {}), asset, x: 0.5, y: 0.5, scale: 1, rotate: 0, z: 0});
    ui.selected = d.stickers.length - 1;
    return refresh();
  }
  if (d.stickers.filter((s) => s.place === place).length >= STICKERS_PER_PLACE) {
    ui.history.pop();
    return toast(`${PLACE_LABEL[place]}に貼れるシールは ${STICKERS_PER_PLACE} 枚までです`, {error: true});
  }
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
    if (ks === 'edit') return navigate(editRoute({id: el.dataset.id}));
    if (ks === 'open-editor') return navigate(editRoute());
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
    if (ks === 'back' || ks === 'discard') {
      if (ui.history.length && !window.confirm('直した内容は保存されていません。捨てて戻りますか？')) return;
      ui.draft = null;
      return navigate(galleryRoute());
    }
    if (ks === 'part') selectPart(el.dataset.part);
    else if (ks === 'scene') {
      ui.scene = el.dataset.scene;
      ui.selected = null;
      ui.art = null;
      if (ui.scene === 'file') ui.part = 'file';
      else if (!AVAIL[ui.part]?.includes(ui.scene)) ui.part = 'note';
    } else if (ks === 'undo') travel(ui.history, ui.future);
    else if (ks === 'redo') travel(ui.future, ui.history);
    else if (ks === 'color' || ks === 'set') {
      if (el.dataset.key === 'rules') {
        await api['settings.update']({patch: {rules: el.dataset.value}});
        return reload();
      }
      peek = null; // 乗せて試していた色は、押した色で決まる
      if (el.dataset.key === 'fileKind') {
        ui.fileKind = el.dataset.value;
        ui.part = 'file';
        ui.selected = null;
        ui.art = null;
      }
      else {
        remember();
        setPath(ui.draft.parts, el.dataset.key, el.dataset.value);
      }
    } else if (ks === 'book') ui.book = el.dataset.value;
    else if (ks === 'tape-image') {
      remember();
      ui.draft.parts.tape.image = el.dataset.id;
    } else if (ks === 'art-hide' || ks === 'art-show' || ks === 'art-reset') {
      remember();
      const a = ui.draft.parts.fileArt[ui.fileKind][el.dataset.artItem];
      if (ks === 'art-reset') Object.assign(a, {dx: 0, dy: 0});
      else a.on = ks === 'art-show';
      if (ks === 'art-hide' && ui.art === el.dataset.artItem) ui.art = null;
    } else if (ks === 'unmove' && ui.selected != null) {
      remember();
      delete ui.draft.stickers[ui.selected].moved;
    } else if (ks === 'straight' && ui.selected != null) {
      remember();
      ui.draft.stickers[ui.selected].rotate = 0;
    }
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
    } else if (ks === 'z' && ui.selected != null) {
      remember();
      ui.draft.stickers[ui.selected].z = Math.max(0, ui.draft.stickers[ui.selected].z + Number(el.dataset.dir));
    } else if (ks === 'peel' && ui.selected != null) peel(); else if (ks === 'save') return await save();
    else if (ks === 'save-new') return await save({asNew: true});
    else if (ks === 'save-confirm') return await save({confirmed: true});
    else if (ks === 'save-course') return await save({forCourse: true});
    else if (ks === 'confirm-cancel') ui.confirm = null;
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
    return navigate(galleryRoute());
  }
  if (!ui.draft) return;
  if (el.id === 'ks-name') ui.draft.name = el.value;
  else if (el.id === 'ks-license') ui.draft.license = el.value;
  else if (el.dataset.ksList) {
    setListColor(el);
    refresh();
  } else if (el.dataset.ksColor) {
    setPath(ui.draft.parts, el.dataset.ksColor, el.value.toLowerCase());
    pickStart = null;
    const r = await api['skin.recentColor']({color: el.value});
    if (r?.recent && state.data.skin) state.data.skin.recent = r.recent;
    refresh();
  } else if (el.dataset.ksCheck) {
    remember();
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
  } else if (el.dataset.ksRange) {
    rangeStart = null;
    refresh();
  }
});
// 色の選び器を動かしている間・つまみを動かしている間は、見本だけ変える（ページを描き直すと選び器が閉じるため）
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!inKisekae(el) || !ui.draft) return;
  if (el.dataset.ksList) {
    if (!pickStart) (pickStart = true), remember();
    setListColor(el);
    repaintPreview();
  } else if (el.dataset.ksColor) {
    if (!pickStart) (pickStart = true), remember();
    setPath(ui.draft.parts, el.dataset.ksColor, el.value.toLowerCase());
    repaintPreview();
  } else if (el.dataset.ksRange && ui.selected != null) {
    if (!rangeStart) (rangeStart = true), remember();
    const s = ui.draft.stickers[ui.selected];
    if (el.dataset.ksRange === 'scale') s.scale = Number(el.value) / 100;
    else s.rotate = Number(el.value);
    el.nextElementSibling && (el.nextElementSibling.textContent = el.dataset.ksRange === 'scale' ? `${el.value}%` : `${el.value}°`);
    repaintPreview();
  }
});
let pickStart = null; // 色の選び器・つまみを動かし始めたら 1 回だけ履歴に積む
let rangeStart = null;
/** 色の並びの 1 つを変える（はじめの色のままなら、はじめの色を写してから） */
function setListColor(el) {
  const [a, b] = el.dataset.ksList.split('.');
  const defaults = el.dataset.ksList === 'sticky.round' ? POP : PDF_NOTE;
  const list = ui.draft.parts[a][b] === 'default' ? [...defaults] : [...ui.draft.parts[a][b]];
  list[Number(el.dataset.i)] = el.value.toLowerCase();
  ui.draft.parts[a][b] = list;
}
/** 見本だけ描き直す（右の欄の入力や選び器は閉じない） */
function repaintPreview() {
  const old = document.querySelector('.kisekae .ks-stage');
  if (!old) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = editor(state.data);
  old.replaceWith(tmp.querySelector('.ks-stage'));
}

// ---- 見本の上で直接さわる ----
// 部分が見える場面（部分を選んだとき、今の場面になければ移る）
const AVAIL = {note: ['home', 'course', 'viewer'], folder: ['home'], tape: ['home'], file: ['file'], sticky: ['course', 'viewer'], bookmark: ['viewer']};
function selectPart(part, kind = null) {
  ui.part = part;
  ui.selected = null;
  ui.art = null;
  if (kind) ui.fileKind = kind;
  if (!AVAIL[part]?.includes(ui.scene)) ui.scene = SCENE_OF[part];
}
function peel() {
  if (ui.selected == null) return;
  remember();
  ui.draft.stickers.splice(ui.selected, 1);
  ui.selected = null;
}
function duplicate() {
  const s = ui.draft.stickers[ui.selected];
  if (!s || FIXED_PLACES.includes(s.place)) return;
  if (ui.draft.stickers.filter((x) => x.place === s.place).length >= STICKERS_PER_PLACE)
    return toast(`${PLACE_LABEL[s.place]}に貼れるシールは ${STICKERS_PER_PLACE} 枚までです`, {error: true});
  remember();
  ui.draft.stickers.push({...s, x: Math.min(1, s.x + 0.06), y: Math.min(1, s.y + 0.06), z: Math.max(0, ...ui.draft.stickers.map((x) => x.z + 1))});
  ui.selected = ui.draft.stickers.length - 1;
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const shift = (v) => Math.round(Math.min(FILE_ART_SHIFT, Math.max(-FILE_ART_SHIFT, v)) * 10) / 10;

// 色の見本にマウスを乗せると、押す前に見本へ映す（外すと戻す）
let peek = null;
document.addEventListener('pointerover', (e) => {
  const sw = e.target.closest?.('.kisekae .ks-inspector [data-ks="color"], .kisekae .ks-inspector [data-ks="set"]');
  if (!sw || !ui.draft || e.pointerType === 'touch' || !sw.dataset.key.includes('.')) return;
  const [a, b] = sw.dataset.key.split('.');
  if (!ui.draft.parts[a] || peek?.el === sw) return;
  if (peek) ui.draft.parts[peek.a][peek.b] = peek.value;
  peek = {el: sw, a, b, value: ui.draft.parts[a][b]};
  ui.draft.parts[a][b] = sw.dataset.value;
  repaintPreview();
});
document.addEventListener('pointerout', (e) => {
  if (!peek || e.target.closest?.('[data-ks]') !== peek.el || peek.el.contains(e.relatedTarget)) return;
  ui.draft.parts[peek.a][peek.b] = peek.value;
  peek = null;
  repaintPreview();
});

// 見本：シールを押す・掴んで動かす・取っ手で大きさと傾きを変える。部分を押すとその部分を直す
let grip = null;
document.addEventListener('pointerdown', (e) => {
  const stageEl = e.target.closest?.('.kisekae .ks-stage');
  if (!stageEl || !ui.draft || e.button > 0) return;
  const st = e.target.closest('.ks-st[data-sticker-index]');
  if (st) {
    e.preventDefault();
    const i = Number(st.dataset.stickerIndex);
    const h = e.target.closest('[data-h]')?.dataset.h;
    if (h === 'del') return peel(), refresh();
    if (h === 'dup') return duplicate(), refresh();
    ui.art = null;
    if (ui.selected !== i) {
      // 選ぶ（描き直すので、続けて掴むのは次の押しから。押したまま動かせば、そのまま動かす）
      ui.selected = i;
      ui.part = 'sticker';
    }
    const s = ui.draft.stickers[i];
    const box = st.parentElement.closest('[data-drop-place], .ks-place, .folder__stickers, .ks-fixed')?.getBoundingClientRect() ?? stageEl.getBoundingClientRect();
    const r = st.getBoundingClientRect();
    const cx = r.left + r.width / 2,
      cy = r.top + r.height / 2;
    const box0 = st.closest('.folder')?.getBoundingClientRect() ?? box;
    grip = {
      i,
      el: st,
      mode: h ?? 'move',
      // 掴んだ所とシールの中心のずれ（掴み直しても跳ばないように）
      sx: (cx - box0.left) / box0.width,
      sy: (cy - box0.top) / box0.height,
      x0: e.clientX,
      y0: e.clientY,
      box: box0,
      cx,
      cy,
      dist: Math.hypot(e.clientX - cx, e.clientY - cy) || 1,
      angle: Math.atan2(e.clientY - cy, e.clientX - cx),
      start: {...s},
      base: Number(st.dataset.base),
      moved: false
    };
    st.setPointerCapture?.(e.pointerId);
    if (!st.classList.contains('is-selected')) {
      for (const x of stageEl.querySelectorAll('.ks-st.is-selected')) x.classList.remove('is-selected');
      st.classList.add('is-selected');
    }
    return;
  }
  // 資料のイラストの印・ラベル：選んで、掴んだまま動かす
  const artEl = e.target.closest('.ks-bigfile [data-art]');
  if (artEl) {
    e.preventDefault();
    ui.part = 'file';
    ui.selected = null;
    ui.art = artEl.dataset.art;
    for (const x of stageEl.querySelectorAll('[data-art].is-sel')) x.classList.remove('is-sel');
    artEl.classList.add('is-sel');
    grip = {mode: 'art', item: ui.art, el: artEl, x0: e.clientX, y0: e.clientY, ratio: artEl.ownerSVGElement.getBoundingClientRect().width / 54, start: {...ui.draft.parts.fileArt[ui.fileKind][ui.art]}, moved: false};
    return;
  }
  // 部分を押した：その部分を右で直す
  const part = e.target.closest('[data-edit]');
  if (part) {
    selectPart(part.dataset.edit, part.dataset.kind ?? part.closest('[data-kind]')?.dataset.kind ?? null);
    refresh();
  }
});
document.addEventListener('pointermove', (e) => {
  if (!grip || grip.mode === 'none') return;
  if (grip.mode === 'art') {
    const a = ui.draft.parts.fileArt[ui.fileKind][grip.item];
    if (!grip.moved) remember();
    grip.moved = true;
    a.dx = shift(grip.start.dx + (e.clientX - grip.x0) / grip.ratio);
    a.dy = shift(grip.start.dy + (e.clientY - grip.y0) / grip.ratio);
    grip.el.setAttribute('transform', `translate(${a.dx} ${a.dy})`);
    return;
  }
  const s = ui.draft.stickers[grip.i];
  if (!grip.moved) remember();
  grip.moved = true;
  if (grip.mode === 'move') {
    s.x = clamp01(grip.sx + (e.clientX - grip.x0) / grip.box.width);
    s.y = clamp01(grip.sy + (e.clientY - grip.y0) / grip.box.height);
    if (FIXED_PLACES.includes(s.place)) s.moved = true;
    grip.el.style.left = `${(s.x * 100).toFixed(2)}%`;
    grip.el.style.top = `${(s.y * 100).toFixed(2)}%`;
  } else if (grip.mode === 'scale') {
    s.scale = Math.min(2, Math.max(0.2, Math.round(((grip.start.scale * Math.hypot(e.clientX - grip.cx, e.clientY - grip.cy)) / grip.dist) * 100) / 100));
    grip.el.style.width = `${Math.round(grip.base * s.scale)}px`;
  } else if (grip.mode === 'rotate') {
    let deg = Math.round(grip.start.rotate + ((Math.atan2(e.clientY - grip.cy, e.clientX - grip.cx) - grip.angle) * 180) / Math.PI);
    deg = ((deg + 540) % 360) - 180;
    for (const snapTo of [-180, -90, 0, 90, 180]) if (Math.abs(deg - snapTo) <= 4) deg = snapTo; // まっすぐ・横向きに吸い付く
    s.rotate = deg;
    grip.el.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
  }
});
document.addEventListener('pointerup', () => {
  if (!grip) return;
  grip = null;
  refresh();
});
// 選んだシールの上でホイール：大きさ
document.addEventListener(
  'wheel',
  (e) => {
    const st = e.target.closest?.('.kisekae .ks-st.is-selected');
    if (!st || ui.selected == null) return;
    e.preventDefault();
    const s = ui.draft.stickers[ui.selected];
    if (!wheelTimer) remember();
    s.scale = Math.min(2, Math.max(0.2, Math.round((s.scale * (e.deltaY < 0 ? 1.06 : 1 / 1.06)) * 100) / 100));
    st.style.width = `${Math.round(Number(st.dataset.base) * s.scale)}px`;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => ((wheelTimer = null), refresh()), 300);
  },
  {passive: false}
);
let wheelTimer = null;
// キー：⌘Z・Ctrl+Z で取り消し、⇧⌘Z・Ctrl+Y でやり直し。シールを選んでいれば、矢印で動かし Delete ではがし Esc で選ぶのをやめる
document.addEventListener('keydown', (e) => {
  if (!ui.draft || !document.querySelector('.kisekae .ks-studio')) return;
  const typing = e.target.matches?.('input:not([type=range]):not([type=color]), textarea, select');
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !typing && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
    e.preventDefault();
    if (e.key === 'y' || e.shiftKey) travel(ui.future, ui.history);
    else travel(ui.history, ui.future);
    return refresh();
  }
  // 資料のイラストの印・ラベルを選んでいるとき：矢印で動かし、Delete で消し、Esc で選ぶのをやめる
  if (ui.art && ui.selected == null && !typing) {
    const a = ui.draft.parts.fileArt[ui.fileKind][ui.art];
    const step = e.shiftKey ? 4 : 1;
    const move = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]}[e.key];
    if (e.key === 'Delete' || e.key === 'Backspace') {
      remember();
      a.on = false;
      ui.art = null;
    } else if (e.key === 'Escape') ui.art = null;
    else if (move) {
      remember();
      a.dx = shift(a.dx + move[0]);
      a.dy = shift(a.dy + move[1]);
    } else return;
    e.preventDefault();
    return refresh();
  }
  if (ui.selected == null || typing) return;
  const s = ui.draft.stickers[ui.selected];
  const onSticker = !!e.target.closest?.('.ks-st[data-sticker-index]');
  const inStage = !!e.target.closest?.('.ks-stagewrap');
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    peel();
    refresh();
    return document.querySelector('.kisekae .ks-stagewrap')?.focus();
  }
  if (e.key === 'Escape') {
    ui.selected = null;
    refresh();
    return inStage && document.querySelector('.kisekae .ks-stagewrap')?.focus();
  }
  if (onSticker) ui.refocus = true; // 描き直したあと、同じシールにキーボードの位置を戻す
  const step = e.shiftKey ? 0.05 : 0.01;
  const move = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]}[e.key];
  if (move) {
    e.preventDefault();
    remember();
    if (FIXED_PLACES.includes(s.place) && !s.moved) Object.assign(s, {x: FIXED_AT[s.place].x, y: FIXED_AT[s.place].y, moved: true});
    else if (FIXED_PLACES.includes(s.place)) s.moved = true;
    s.x = clamp01(s.x + move[0]);
    s.y = clamp01(s.y + move[1]);
    refresh();
  }
});

// シール帳から見本へドラッグして貼る。落とした所（フォルダ・ホームの余白・見出し・回の付箋・資料・しおり・PDF の余白）に貼る
document.addEventListener('dragstart', (e) => {
  const b = e.target.closest?.('.kisekae [data-ks="sticker-add"]');
  if (!b) return;
  e.dataTransfer.setData('text/x-daigaku-sticker', b.dataset.id);
  e.dataTransfer.effectAllowed = 'copy';
  document.querySelector('.kisekae .ks-stage')?.classList.add('is-dropping');
});
document.addEventListener('dragend', () => document.querySelector('.kisekae .ks-stage')?.classList.remove('is-dropping'));
let hover = null;
document.addEventListener('dragover', (e) => {
  const t = e.target.closest?.('.kisekae [data-drop-place]');
  if (hover && hover !== t) hover.classList.remove('is-drop');
  hover = t;
  if (!t || !e.dataTransfer.types.includes('text/x-daigaku-sticker')) return;
  e.preventDefault();
  t.classList.add('is-drop');
});
document.addEventListener('drop', (e) => {
  const box = e.target.closest?.('.kisekae [data-drop-place]');
  const sid = e.dataTransfer?.getData('text/x-daigaku-sticker');
  hover?.classList.remove('is-drop');
  if (!box || !sid || !ui.draft) return;
  e.preventDefault();
  const r = box.getBoundingClientRect();
  addSticker(sid, box.dataset.dropPlace, [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)], box.dataset.kind ?? box.closest('[data-kind]')?.dataset.kind);
});

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
    const mineList = allTemplates(state.data).filter((t) => !isBuiltin(t.id));
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
        ${allTemplates(state.data).filter((t) => isBuiltin(t.id)).map((t) => item(t.id, t.name)).join('')}
        ${mineList.length ? `<div class="skin-picker__group">マイノート</div>${mineList.map((t) => item(t.id, t.name)).join('')}` : ''}
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
      return navigate(`/kisekae/edit?course=${encodeURIComponent(course.id)}&new=1`);
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


// 直した内容を守る：保存せずに細かい編集のページを離れようとしたら確かめる（「← 着せ替えへ」「やめる」は click で確かめる）。
// app.js の hashchange（描き直し）より先に登録されるので、やめたときは描き直しを止めて元のアドレスに戻す
window.addEventListener('hashchange', (e) => {
  const from = new URL(e.oldURL).hash;
  if (!from.startsWith('#/kisekae/edit') || location.hash.startsWith('#/kisekae/edit') || !ui.draft || !ui.history.length) return;
  if (window.confirm('直した内容は保存されていません。捨ててこのページを離れますか？')) {
    ui.draft = null;
    return;
  }
  e.stopImmediatePropagation();
  history.replaceState(null, '', e.oldURL);
});
window.addEventListener('beforeunload', (e) => {
  if (location.hash.startsWith('#/kisekae/edit') && ui.draft && ui.history.length) e.preventDefault();
});

// 右の欄は描き直しても、同じ部分を直している間はスクロールの位置を保つ（色を押すたびに上へ戻らないように）
const inspectorKey = () => (ui.selected != null ? 'sticker' : `${ui.part}:${ui.fileKind}`);
let inspectorScroll = {key: null, top: 0};
document.addEventListener(
  'scroll',
  (e) => {
    if (e.target.classList?.contains('ks-inspector')) inspectorScroll = {key: inspectorKey(), top: e.target.scrollTop};
  },
  true
);
document.getElementById('view')?.addEventListener('rendered', () => {
  const el = document.querySelector('.kisekae .ks-inspector');
  if (el && inspectorScroll.key === inspectorKey()) el.scrollTop = inspectorScroll.top;
});

// キーボード：Tab で見本のシールに移ると、そのシールを選ぶ（矢印で動かし、Delete ではがし、Esc でやめる）
document.addEventListener('focusin', (e) => {
  const st = e.target.closest?.('.kisekae .ks-st[data-sticker-index]');
  if (!st || !ui.draft) return;
  const i = Number(st.dataset.stickerIndex);
  if (ui.selected === i) return;
  ui.selected = i;
  ui.art = null;
  ui.part = 'sticker';
  ui.refocus = true;
  refresh();
});
document.getElementById('view')?.addEventListener('rendered', () => {
  if (!ui.refocus) return;
  ui.refocus = false;
  if (ui.selected != null) document.querySelector(`.kisekae .ks-st[data-sticker-index="${ui.selected}"]`)?.focus({preventScroll: true});
});
