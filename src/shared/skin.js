// 着せ替え（SPEC-KISEKAE.md）：テンプレートの形式・はじめからあるテンプレート・どれが当たるか・色の計算。
// main（保存のときの検査）とレンダラ（見た目）の両方で使う。副作用なし・node のモジュールを使わない。
import {isBuiltinSticker} from './stickers.js';

export const FORMAT = 'daigaku-note.skin';
export const FORMAT_VERSION = 1;

export const NOTE_TYPES = ['ruled', 'grid', 'dot', 'ring', 'plain', 'cornell'];
export const NOTE_TYPE_LABEL = {ruled: '横罫', grid: '方眼', dot: 'ドット', ring: '丸ドット', plain: '無地', cornell: 'コーネル'};
export const NOTE_GAPS = {narrow: 24, normal: 32, wide: 40};
export const NOTE_GAP_LABEL = {narrow: '狭い', normal: 'ふつう', wide: '広い'};
export const TAPE_PATTERNS = ['plain', 'stripe', 'dot', 'check', 'image'];
export const TAPE_PATTERN_LABEL = {plain: '無地', stripe: 'ストライプ', dot: 'ドット', check: 'チェック', image: '画像', course: '授業ごと'};
export const LICENSES = ['personal', 'share', 'remix'];
export const LICENSE_LABEL = {personal: '自分で使うだけ', share: 'そのまま配ってよい', remix: '改変して配ってよい'};
export const STICKER_MODES = ['global', 'course', 'both'];
// シールを貼れる場所（SPEC-KISEKAE §5）。home（ホームの余白）は全体のテンプレートだけから貼る。
// round（回の付箋の角）・file（資料のイラスト。種類 kind ごと）・bookmark（しおりのリボンの先）は 1 枚ずつで、貼る位置は決まっている
export const STICKER_PLACES = ['folder', 'home', 'heading', 'viewer', 'round', 'file', 'bookmark'];
export const PLACE_LABEL = {
  folder: 'フォルダ',
  home: 'ホームの余白',
  heading: '授業ページの見出し',
  viewer: 'PDF 編集画面の余白',
  round: '回の付箋の角',
  file: '資料のイラスト',
  bookmark: 'しおりのリボンの先'
};
export const GLOBAL_ONLY_PLACES = ['home'];
export const FIXED_PLACES = ['round', 'file', 'bookmark'];
export const STICKERS_PER_PLACE = 5;
export const placeMax = (place) => (FIXED_PLACES.includes(place) ? 1 : STICKERS_PER_PLACE);
// 資料の種類（file-art.js の印と同じ）
export const FILE_KINDS = ['pdf', 'slide', 'doc', 'sheet', 'image', 'video', 'audio', 'zip', 'other'];
export const FILE_KIND_LABEL = {pdf: 'PDF', slide: 'スライド', doc: '文書', sheet: '表', image: '画像', video: '動画', audio: '音声', zip: '圧縮', other: 'その他'};
export const BOOKMARK_SHAPES = ['tag', 'ribbon', 'round'];
export const BOOKMARK_SHAPE_LABEL = {tag: 'タグ', ribbon: 'リボン（切れ込み）', round: '丸'};
export const ROUND_COLORS = 8; // 回の付箋の色の並び（第 1 回から順に。9 回目からはまた 1 色目）
export const PDF_NOTE_COLORS = 6; // PDF に貼る付箋の色の候補
export const SHAPES = ['cut', 'square', 'round', 'circle', 'framed'];
export const SHAPE_LABEL = {cut: '形どおり', square: 'そのまま', round: '角丸', circle: '丸', framed: '白いふち付き'};
export const CLASSIC_ID = 'builtin-classic';

const HEX = /^#[0-9a-f]{6}$/;
const SHA = /^[0-9a-f]{64}$/;
/** シールの素の id：取り込んだ画像（SHA-256）か、はじめから入っているシール */
export const isAssetId = (v) => SHA.test(String(v ?? '')) || isBuiltinSticker(v);
export const isHex = (v) => typeof v === 'string' && HEX.test(v.toLowerCase());

// 色の値：#rrggbb か default（テーマの色のまま）。テープは course（授業ごとの色・柄）も
const color = (v, fallback, {course = false} = {}) =>
  isHex(v) ? v.toLowerCase() : v === 'default' || (course && v === 'course') ? v : fallback;
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const num = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback);
const text = (v, max, fallback = '') => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : fallback) || fallback;

export const DEFAULT_PARTS = {
  note: {type: 'ruled', paper: 'default', line: 'default', gap: 'normal', margin: true},
  folder: {card: 'default', tab: 'default'},
  tape: {color: 'course', pattern: 'course', image: null},
  file: Object.fromEntries(FILE_KINDS.map((k) => [k, 'default'])),
  fileArt: Object.fromEntries(FILE_KINDS.map((k) => [k, {mark: {dx: 0, dy: 0, on: true}, label: {dx: 0, dy: 0, on: true}}])),
  sticky: {round: 'default', pdf: 'default'},
  bookmark: {color: 'default', shape: 'tag'}
};

// 色の並び：default（はじめの色）か、#rrggbb を n 個（足りなければ default）
const colorList = (v, n) => (Array.isArray(v) && v.length === n && v.every(isHex) ? v.map((c) => c.toLowerCase()) : 'default');

// 資料のイラストの中身（種類の印・拡張子のラベル）：元の位置からのずれ（イラストの座標。幅 54・高さ 66）と、出すかどうか
export const FILE_ART_ITEMS = ['mark', 'label'];
export const FILE_ART_SHIFT = 40;
const artItem = (v = {}) => ({
  dx: Math.round(num(v.dx, -FILE_ART_SHIFT, FILE_ART_SHIFT, 0) * 10) / 10,
  dy: Math.round(num(v.dy, -FILE_ART_SHIFT, FILE_ART_SHIFT, 0) * 10) / 10,
  on: typeof v.on === 'boolean' ? v.on : true
});
const fileArtParts = (raw = {}) => Object.fromEntries(FILE_KINDS.map((k) => [k, Object.fromEntries(FILE_ART_ITEMS.map((i) => [i, artItem(raw?.[k]?.[i])]))]));

// テープ：柄が画像（image）のときは、シールの素を 1 つ柄にする。画像がなければ無地
function tape(t) {
  const d = DEFAULT_PARTS.tape;
  let pattern = oneOf(t.pattern, [...TAPE_PATTERNS, 'course'], d.pattern);
  const image = pattern === 'image' && isAssetId(t.image) ? t.image : null;
  if (pattern === 'image' && !image) pattern = 'plain';
  return {color: color(t.color, d.color, {course: true}), pattern, image};
}

/** 部品の値を決まった範囲に収める（知らない項目は捨て、範囲外は既定値） */
export function normalizeParts(raw = {}) {
  const n = raw.note ?? {},
    f = raw.folder ?? {},
    t = raw.tape ?? {};
  const d = DEFAULT_PARTS;
  return {
    note: {
      type: oneOf(n.type, NOTE_TYPES, d.note.type),
      paper: color(n.paper, d.note.paper),
      line: color(n.line, d.note.line),
      gap: oneOf(n.gap, Object.keys(NOTE_GAPS), d.note.gap),
      margin: typeof n.margin === 'boolean' ? n.margin : d.note.margin
    },
    folder: {card: color(f.card, d.folder.card), tab: color(f.tab, d.folder.tab)},
    tape: tape(t),
    file: Object.fromEntries(FILE_KINDS.map((k) => [k, color(raw.file?.[k], 'default')])),
    fileArt: fileArtParts(raw.fileArt),
    sticky: {round: colorList(raw.sticky?.round, ROUND_COLORS), pdf: colorList(raw.sticky?.pdf, PDF_NOTE_COLORS)},
    bookmark: {color: color(raw.bookmark?.color, 'default'), shape: oneOf(raw.bookmark?.shape, BOOKMARK_SHAPES, 'tag')}
  };
}

/** 貼ったシール。位置は貼る先の大きさに対する割合（0〜1）。資料のイラストは種類（kind）ごとに 1 枚 */
export function normalizeStickers(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const count = {};
  for (const s of raw) {
    if (!s || !STICKER_PLACES.includes(s.place) || !isAssetId(s.asset)) continue;
    if (s.place === 'file' && !FILE_KINDS.includes(s.kind)) continue;
    const key = s.place === 'file' ? `file:${s.kind}` : s.place;
    if ((count[key] = (count[key] ?? 0) + 1) > placeMax(s.place)) continue;
    out.push({
      place: s.place,
      ...(s.place === 'file' ? {kind: s.kind} : {}),
      asset: s.asset,
      x: num(s.x, 0, 1, 0.5),
      y: num(s.y, 0, 1, 0.5),
      scale: num(s.scale, 0.2, 2, 1),
      rotate: Math.round(num(s.rotate, -180, 180, 0)),
      z: Math.round(num(s.z, 0, 99, 0))
    });
  }
  return out;
}

/**
 * テンプレートを決まった形にする（読み込み・保存のたびに通す）。値だけを持ち、プログラムも CSS の文字列も持たない。
 * 形式の版が新しすぎるものは断る（throw）
 */
export function normalizeTemplate(raw, {id, now = new Date().toISOString()} = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('テンプレートの形が不正です');
  if (raw.format !== undefined && raw.format !== FORMAT) throw new Error('大学ノートのテンプレートではありません');
  if (Number(raw.formatVersion ?? FORMAT_VERSION) > FORMAT_VERSION) throw new Error('新しい版の大学ノートで作られたテンプレートです。アプリを更新してください');
  const stickers = normalizeStickers(raw.stickers);
  const parts = normalizeParts(raw.parts);
  // 取り込んだ画像だけを assets に（はじめから入っているシールはアプリの中にある）
  const assets = {};
  for (const sid of [...stickers.map((s) => s.asset), parts.tape.image]) {
    if (!SHA.test(String(sid ?? '')) || assets[sid]) continue;
    const a = raw.assets?.[sid] ?? {};
    assets[sid] = {mime: 'image/png', w: Math.round(num(a.w, 1, 512, 256)), h: Math.round(num(a.h, 1, 512, 256))};
  }
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    id: id ?? text(raw.id, 64),
    name: text(raw.name, 40, '名前のないテンプレート'),
    author: text(raw.author, 40, 'わたし'),
    version: /^\d+\.\d+\.\d+$/.test(String(raw.version ?? '')) ? raw.version : '1.0.0',
    license: oneOf(raw.license, LICENSES, 'personal'),
    createdAt: typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt)) ? raw.createdAt : now,
    parts,
    stickers,
    assets
  };
}

// はじめからあるテンプレート。クラシックは今の見た目（テーマの色・授業ごとのテープ）のまま
const builtin = (key, name, parts) =>
  normalizeTemplate({id: `builtin-${key}`, name, author: '大学ノート', license: 'share', createdAt: '2026-10-21T00:00:00Z', parts}, {id: `builtin-${key}`});
export const BUILTIN_TEMPLATES = [
  builtin('classic', 'クラシック', {}),
  builtin('lemon', 'クリーム × レモン', {
    note: {type: 'ruled', paper: '#fffaf0', line: '#efdcae'},
    folder: {card: '#fffdf4', tab: '#ffe7a3'},
    tape: {color: '#f6c445', pattern: 'stripe'}
  }),
  builtin('mint', 'ミント方眼', {
    note: {type: 'grid', paper: '#f4fbf7', line: '#cde9db'},
    folder: {card: '#ffffff', tab: '#c6eedb'},
    tape: {color: '#7fd1ae', pattern: 'stripe'}
  }),
  builtin('sakura', 'さくらドット', {
    note: {type: 'dot', paper: '#fff6f8', line: '#efb9c8'},
    folder: {card: '#ffffff', tab: '#ffd3e0'},
    tape: {color: '#f7a1c4', pattern: 'dot'}
  }),
  builtin('sky', '空色の丸ドット', {
    note: {type: 'ring', paper: '#f3f8ff', line: '#b3cdef'},
    folder: {card: '#ffffff', tab: '#cfe2ff'},
    tape: {color: '#8ab4f8', pattern: 'check'}
  }),
  builtin('kraft', 'クラフト', {
    note: {type: 'plain', paper: '#efe6d6', line: '#d8c7aa', margin: false},
    folder: {card: '#fbf5ea', tab: '#dcc6a0'},
    tape: {color: '#c9a27a', pattern: 'plain'}
  }),
  builtin('navy', 'コーネル × 紺', {
    note: {type: 'cornell', paper: '#f7f8fb', line: '#c6d0e4'},
    folder: {card: '#ffffff', tab: '#2c4a7a'},
    tape: {color: '#2c4a7a', pattern: 'plain'}
  }),
  builtin('lavender', 'ラベンダー', {
    note: {type: 'ruled', paper: '#f8f5ff', line: '#d9cdf3', gap: 'wide'},
    folder: {card: '#ffffff', tab: '#e4d8ff'},
    tape: {color: '#c58af9', pattern: 'stripe'}
  })
];
const BUILTIN_IDS = new Set(BUILTIN_TEMPLATES.map((t) => t.id));
export const isBuiltin = (id) => BUILTIN_IDS.has(id);

/** 新しい授業に順に割り当てるテンプレート（となり同士が同じにならないように。クラシックは除く） */
export const ROTATION = BUILTIN_TEMPLATES.filter((t) => t.id !== CLASSIC_ID).map((t) => t.id);
export const rotationFor = (index) => ROTATION[((index % ROTATION.length) + ROTATION.length) % ROTATION.length];

/**
 * 授業に当たる見た目。授業にテンプレートがあればそれ、なければ全体のテンプレート（SPEC-KISEKAE §4.1）。
 * ノートは全体のテンプレートだけから決まる。シールは授業の sticker_mode で、全体・授業・両方から集める（§4.3）
 */
export function resolveSkin(templates, globalId, course = null) {
  const byId = (id) => templates.find((t) => t.id === id) ?? null;
  const global = byId(globalId) ?? byId(CLASSIC_ID) ?? BUILTIN_TEMPLATES[0];
  const own = course?.skin_template_id ? byId(course.skin_template_id) : null;
  const mode = STICKER_MODES.includes(course?.sticker_mode) ? course.sticker_mode : 'global';
  const stickers =
    mode === 'course' ? (own?.stickers ?? []) : mode === 'both' ? [...global.stickers, ...(own?.stickers ?? [])] : global.stickers;
  return {
    template: own ?? global,
    own: !!own,
    note: global.parts.note,
    folder: (own ?? global).parts.folder,
    tape: (own ?? global).parts.tape,
    file: (own ?? global).parts.file,
    fileArt: (own ?? global).parts.fileArt,
    sticky: (own ?? global).parts.sticky,
    bookmark: (own ?? global).parts.bookmark,
    stickers: stickers.slice().sort((a, b) => a.z - b.z)
  };
}

/** テンプレートを使っている授業の数（全体で使っていれば all も true） */
export function usage(templateId, courses, globalId) {
  return {courses: courses.filter((c) => c.skin_template_id === templateId).length, global: globalId === templateId};
}

// ---- 色の計算 ----
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

/** 相対輝度（WCAG 2） */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** コントラスト比（1〜21） */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export const INK_DARK = '#2b2b2b';
export const INK_LIGHT = '#f4f5f7';
/** 背景の上の文字の色：黒と白のうち、コントラストの高いほう（どちらも 4.5:1 に届かなくても高いほう） */
export const inkOn = (bg) => (contrast(bg, INK_DARK) >= contrast(bg, INK_LIGHT) ? INK_DARK : INK_LIGHT);

function rgbToHsl([r, g, b]) {
  (r /= 255), (g /= 255), (b /= 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb([h, s, l]) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/**
 * 暗い表示の色：色合い（色相）を保ったまま、明るさを [lo, lo + span] に縮める（SPEC-KISEKAE §4.5）。
 * 紙は 0.12〜0.20、カードは 0.17〜0.25、線は 0.24〜0.34 ほど。彩度も少し落として、暗い所で色が浮かないようにする
 */
export function darken(hex, {lo = 0.12, span = 0.08, sat = 0.6} = {}) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb([h, s * sat, lo + span * l]));
}
