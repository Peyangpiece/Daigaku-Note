// 着せ替えをレンダラに当てる（SPEC-KISEKAE.md）。どのテンプレートが当たるかと色の計算は shared/skin.js。
// ノートは html の data-note・data-margin と CSS 変数で、フォルダとテープは各カードの style で変える。シールの画像は main から data: URL でもらう
import {BUILTIN_TEMPLATES, CLASSIC_ID, NOTE_GAPS, darken, inkOn, resolveSkin} from '../shared/skin.js';
import {builtinStickerUrl, isBuiltinSticker} from '../shared/stickers.js';

/** 今が暗い表示か（設定のテーマ、または OS に合わせる） */
export function isDark() {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (!t && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

/** すべてのテンプレート（はじめからある＋自作） */
export const allTemplates = (data) => [...BUILTIN_TEMPLATES, ...(data?.skin?.templates ?? [])];
export const globalId = (data) => data?.skin?.global ?? CLASSIC_ID;
export const skinOf = (data, course = null) => resolveSkin(allTemplates(data), globalId(data), course);

// 暗い表示では、選んだ色を色合いを保ったまま暗くする（SPEC-KISEKAE §4.5）。default はテーマの色のまま（null）
// 淡い色は HSL の彩度が高く出るので、暗くするときは彩度を大きく落とす（紙が赤黒く浮かないように）
const DARK = {
  paper: {lo: 0.12, span: 0.06, sat: 0.28},
  card: {lo: 0.18, span: 0.07, sat: 0.32},
  line: {lo: 0.26, span: 0.1, sat: 0.4},
  tab: {lo: 0.24, span: 0.12, sat: 0.55}
};
export const tone = (hex, kind, dark = isDark()) =>
  !hex || hex === 'default' ? null : dark ? darken(hex, DARK[kind]) : hex;

/** ノートの見た目を変数にする（html にも見本の紙にも使う）。戻りは {attrs, vars} */
export function noteVars(note, dark = isDark()) {
  const paper = tone(note.paper, 'paper', dark);
  const line = tone(note.line, 'line', dark);
  const vars = {'--rule-gap': `${NOTE_GAPS[note.gap] ?? 32}px`};
  if (paper) {
    vars['--paper'] = paper;
    const ink = inkOn(paper);
    vars['--paper-ink'] = ink;
    vars['--paper-ink-weak'] = `color-mix(in srgb, ${ink} 68%, ${paper})`;
  }
  if (line) vars['--rule'] = line;
  return {attrs: {'data-note': note.type, 'data-margin': note.margin ? 'on' : 'off'}, vars};
}

const NOTE_PROPS = ['--rule-gap', '--paper', '--paper-ink', '--paper-ink-weak', '--rule'];
/** 全体のノートを画面に当てる。テーマが変わったら当て直す */
export function applySkin(data) {
  const root = document.documentElement;
  const {attrs, vars} = noteVars(skinOf(data).note);
  for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
  for (const p of NOTE_PROPS) root.style.removeProperty(p);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}
/** OS の明るい・暗いが変わったら当て直す（テーマが「OS に合わせる」のとき）。描き直しは onChange で */
export function watchTheme(getData, onChange) {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applySkin(getData());
    onChange();
  });
}

/** フォルダのカードの style（カード・タブ・文字の色、テープの色）と、テープの柄 */
export function folderLook(course, skin, dark = isDark()) {
  const card = tone(skin.folder.card, 'card', dark);
  const tab = tone(skin.folder.tab, 'tab', dark);
  const vars = [];
  if (card) {
    const ink = inkOn(card);
    vars.push(
      `--folder-card: ${card}`,
      `--folder-ink: ${ink}`,
      `--folder-sub: color-mix(in srgb, ${ink} 68%, ${card})`
    );
  }
  if (tab) vars.push(`--folder-tab: ${tab}`);
  const tapeColor = skin.tape.color === 'course' ? `var(--c${course.color ?? 1})` : skin.tape.color;
  const pattern = skin.tape.pattern === 'course' ? course.tape_pattern || 'plain' : skin.tape.pattern;
  // 柄が画像のテープ：シールの素をくり返して貼る（画像がまだ届いていなければ色だけ）
  const image = pattern === 'image' && skin.tape.image ? stickerUrl(skin.tape.image) : '';
  return {style: vars.join('; '), tapeColor, pattern, tapeImage: image ? `url('${image}')` : ''};
}

// ---- シールの画像（data: URL）。足りない分だけまとめてもらい、届いたら描き直す ----
const images = new Map();
let pending = new Set();
let timer = null;
let onLoaded = () => {};
export const setStickerReload = (fn) => (onLoaded = fn);
export function stickerUrl(sid) {
  if (isBuiltinSticker(sid)) return builtinStickerUrl(sid);
  if (images.has(sid)) return images.get(sid);
  pending.add(sid);
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const ids = [...pending];
    pending = new Set();
    for (const i of ids) images.set(i, '');
    const r = await window.daigaku['sticker.data']({ids});
    for (const [i, url] of Object.entries(r?.data ?? {})) images.set(i, url);
    onLoaded();
  }, 0);
  return '';
}
export const forgetSticker = (sid) => images.delete(sid);

// シールの基準の大きさ（px。scale を掛ける）。場所ごとに、貼る先の大きさに合わせる
export const STICKER_BASE = {folder: 56, home: 88, heading: 52, viewer: 96};

/** シール 1 枚の HTML。位置は貼る先の大きさに対する割合、大きさは場所ごとの基準 × scale */
export function stickerImg(s, shapes, {index = null, selected = false, base = STICKER_BASE[s.place] ?? 56} = {}) {
  const url = stickerUrl(s.asset);
  if (!url) return '';
  const shape = shapes[s.asset] ?? 'cut';
  return `<img class="sticker sticker--${shape}${selected ? ' is-selected' : ''}" src="${url}" alt="" draggable="false"${index != null ? ` data-sticker-index="${index}"` : ''}
    style="left: ${(s.x * 100).toFixed(2)}%; top: ${(s.y * 100).toFixed(2)}%; width: ${Math.round(base * s.scale)}px; transform: translate(-50%, -50%) rotate(${s.rotate}deg); z-index: ${s.z}" />`;
}
/** シールの形（取り込んだ画像は記録から、はじめから入っているシールは形どおり） */
export const shapesOf = (data) => Object.fromEntries((data?.skin?.stickers ?? []).map((s) => [s.id, s.shape]));

/** 場所（home・heading・viewer）に貼るシールの層。シールがなければ空 */
export function stickerLayer(stickers, place, data) {
  const list = stickers.filter((s) => s.place === place);
  if (!list.length) return '';
  const shapes = shapesOf(data);
  return `<div class="sticker-layer sticker-layer--${place}" aria-hidden="true">${list.map((s) => stickerImg(s, shapes)).join('')}</div>`;
}

/** 1 か所に 1 枚のシール（回の付箋・資料のイラスト・しおりのリボン）。x・y は動かしていないときの位置（貼る先の中の割合） */
export function fixedSticker(st, data, {x, y, base, cls = ''}) {
  if (!st) return '';
  const img = stickerImg(st.moved ? st : {...st, x, y}, shapesOf(data), {base});
  return img ? `<span class="sticker-layer sticker-layer--fixed ${cls}" aria-hidden="true">${img}</span>` : '';
}
/** しおりのリボンの色と形（着せ替え）。色が default ならはじめの赤 */
export const BOOKMARK_COLOR = '#e8505b';
export function bookmarkLook(skin) {
  const color = skin.bookmark.color === 'default' ? BOOKMARK_COLOR : skin.bookmark.color;
  return {cls: `bm--${skin.bookmark.shape}`, style: `--bm-color: ${color}; --bm-ink: ${inkOn(color)}`};
}
