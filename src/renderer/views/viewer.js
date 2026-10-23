// PDF ビューアと編集（SPEC §9）。アプリ内で開けて編集できるのは PDF だけ。
// 編集は「文字入れ」（フォントはヒラギノ角ゴのみ。サイズ・太字・色を変えられる）・「メモ」（PDF の注釈のメモ。授業画面の付箋とは別物）・「文字隠し」。
// 文字隠しは水色のマーカー。ふだんは下の文字が読め、赤シートをかぶせたところだけ黒くつぶれて読めなくなる。
//   仕組み：マーカーの水色は赤の成分が 0（#00d2ff）で、ページに「乗算」で重ねる。赤シートも赤（赤だけ通す）を乗算で重ねるので、
//   マーカーの部分は 赤 0 × … = 黒 になる。白い紙は赤に、黒い文字は黒のままになり、本物の赤シートと同じ見え方になる
// 筆箱（§9.8）：ボールペン（手書きの線）・マーカー（文字の下に引く線）・文字隠しペンを 6 本まで入れて、画面の右に出す。
//   ペンを選ぶときは筆箱を開いて大きく出し、ペンを持ったら画面の右の外へしまう（書く邪魔にならない）。
//   出すとき：マウスを画面の右端へ動かす・右端の「筆箱」のつまみを押す・指（ペン）で画面の右端から左へなでる
//   どれを入れるかは「筆箱」のページで変える（文房具は shared/stationery.js）。消しゴムはペンの線・マーカーを消す。
//   ボールペンの書き味：なぞった点を間引かず受け取り（getCoalescedEvents）、筆圧で太さを変える（shared/ink.js）。
//   ペン（スタイラス）を一度使ったら、指で触れても書かない（手のひらが当たっても線にならない。指 1 本はスクロール）
// 画面の四隅（§9.9）：左上にシール帳・左下に素材・右上に筆箱・右下にポーチ。ふだんは画面の外にしまい、端のつまみだけ見せる。
//   出すとき：つまみを押す・マウスを画面の端（上半分・下半分）へ動かす・指（ペン）で画面の端からなでる。1 つ出すとほかはしまう
//   シール帳・素材：押すと見ているページの真ん中に、ドラッグするとページの好きな所に「貼りもの」（注釈の stamp）として貼る。
//     貼りものは選択の道具で動かし、右下のつまみで大きさを変える（シール・図は縦横の比を保つ）。ペンの線は上に重ねて書ける
//   ポーチ：赤シート・電卓・メモ帳・定規・付箋・タイマー。メモ帳はちぎると、書いた紙がページに貼りものとして貼られる（ちぎり口はぎざぎざ）。
//     定規はページの上に置き、ふちのすぐ外からボールペンで書くと、ふちに沿ったまっすぐな線になる。
//     付箋（インデックス）はページの右の端からはみ出して貼る色の目印。タイマーは時間になると音と知らせ
// 取り消し・やり直し（§9.1：200 手まで。履歴はメモリだけ）。注釈付きの PDF を別のファイルに書き出せる（§9.7）。
// 元の PDF は変えない（§9.1）。注釈はページ座標（PDF のユーザー空間、左下原点、pt）でメインの DB に保存する。
// ほかの画面と違い、状態が変わるたびに描き直さない（app.js が mount / unmount だけ呼ぶ）。
// pdf.js は互換版（legacy）を使う。通常版は Map.prototype.getOrInsertComputed などの新しい機能を前提にしており、
// Electron の Chromium の版によっては動かない
import * as pdfjs from '../../../node_modules/pdfjs-dist/legacy/build/pdf.min.mjs';
import {esc, isTyping, navigate, state, toast} from '../app.js';
import {bookmarkLook, fixedSticker, skinOf} from '../skin.js';
import {ROUND_DEFAULTS, inkOn} from '../../shared/skin.js';
import {charEdges, fitToInk, inkFromImage, snapRange, textIn, wordAt} from './text-snap.js';
import {
  boundsOf,
  createCapture,
  decodePoints,
  encodePoints,
  speedPressure,
  strokePath,
  touchesStroke
} from '../../shared/ink.js';
import {
  DEFAULT_HIDER,
  KIND_OF,
  TYPE_LABEL,
  TOOL_TYPES,
  heldPen,
  itemOf,
  nextRefill,
  stationeryState,
  toolArt
} from '../../shared/stationery.js';
import {MEMO_COLOR, MEMO_SIZE, NOTE_INK_SCALE, hidesUnderRedSheet} from '../../shared/annotation.js';
import {BUILTIN_STICKERS, BUILTIN_STICKER_KIND, builtinStickerUrl, isBuiltinSticker} from '../../shared/stickers.js';
import {FIGURES, FIGURE_PT_PER_UNIT, FIGURE_SUBJECTS, figureOf, figureUrl} from '../../shared/figures.js';
import {evaluate, formatNumber} from '../../shared/calc.js';
import {
  TIMER_PRESETS,
  clampMinutes,
  formatClock,
  isDone,
  isRunning,
  newTimer,
  pauseTimer,
  startTimer,
  timerLeft
} from '../../shared/timer.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  '../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).href;

const api = window.daigaku;
/** 画面の画素密度（dpr）を、ページの絵が MAX_CANVAS_PIXELS に収まるところまで下げる */
export const canvasScale = (vp, dpr) => {
  const px = vp.width * vp.height;
  return px > 0 ? Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / px)) : dpr;
};
const CSS_UNITS = 96 / 72; // 拡大率 100% で紙の実寸
const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const clampZoom = (z) => Math.min(4, Math.max(0.25, z));
// 1 ページの絵（canvas）の画素数の上限。拡大 4 倍 × Retina で A4 が 5,700 万画素（約 228 MB）になるのを防ぐ。
// 超えるときは描く解像度を落とし、CSS で大きさを合わせる（pdf.js の maxCanvasPixels と同じ考え）
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
const FILE_SAVE_DELAY = 1500; // 注釈を保存してからファイルを上書きするまで（ms）。続けて書いている間は待つ
const PINCH_IDLE = 180; // ピンチの指が止まってから描き直すまで（ms）
const NOTE_DEFAULT_PEN = {type: 'pen', color: '#2b2b2b', width: 1.1}; // 筆箱のボールペンを持っていないときのメモの手書き（黒の 0.5 相当）
const PINCH_SPEED = 0.01; // wheel の deltaY 1 あたりの拡大率の変化（指数）
// shared/annotation.js と同じ値（レンダラは shared を読まないので写す）
const SIZE_MIN = 6,
  SIZE_MAX = 72,
  DEFAULT_SIZE = 12,
  NOTE_SIZE = 20;
const FONT = "'Hiragino Kaku Gothic ProN', 'Hiragino Sans', sans-serif"; // notebook.css の .anno-text と同じ
// OS に合わせた表記（SPEC §9）：Mac では ⌘、Windows・Linux では Ctrl。フォント名も Mac 以外ではヒラギノは入っていないので「標準のゴシック」
const IS_MAC = /Mac/i.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const key = (...parts) => (IS_MAC ? parts.join('') : parts.join('+')); // key('⇧', MOD, 'Z') → ⇧⌘Z ／ Shift+Ctrl+Z
const SHIFT = IS_MAC ? '⇧' : 'Shift';
const FONT_LABEL = IS_MAC ? 'ヒラギノ角ゴ' : '標準のゴシック';
/** 行の字の上下（覆う範囲）と、その行をなぞったとみなす上下 */
const lineOf = (items) => ({
  top: Math.min(...items.map((it) => it.top)),
  bottom: Math.max(...items.map((it) => it.bottom)),
  hitTop: Math.min(...items.map((it) => it.hitTop)),
  hitBottom: Math.max(...items.map((it) => it.hitBottom))
});
/** 文字隠しを横になぞっているか：上下の動きが小さいか、指が行の字の高さの中にとどまっている（行の字の縦幅を超えなければ、行のマーカーのまま） */
const isFlat = (d, line) => Math.abs(d.y1 - d.y0) < 12 || (!!line && d.y1 >= line.hitTop && d.y1 <= line.hitBottom);
const LINE_HEIGHT = 1.4; // notebook.css の .anno-text と同じ
const EXPORT_PX_PER_PT = 4; // 書き出す文字入れの画像の細かさ（1pt = 4px、288dpi）
const HISTORY_MAX = 200;
const MASK_HEX = '#00d2ff'; // 文字隠しの既定の色（shared/annotation.js の MASK_COLOR）
const STICKER_PT = 72; // シール帳のシールを貼るときの幅（pt）
const MEMO_PT = 150; // メモ帳からちぎった紙の一辺（pt。100% 表示でメモ帳の紙と同じくらい）
const MEMO_COLORS = [MEMO_COLOR, '#fff3bf', '#ffe3ec', '#e3f2ff', '#e6f6e6'];
// ちぎった紙の寸法（pt。文字の大きさに掛けるものは倍率）。画面（place）と書き出し（stampToPng）で同じ値を使う
const MEMO_PAD = 8; // 左右の余白
const MEMO_TOP = 12; // 上の余白（ちぎり口の下から）
const MEMO_LINE = 1.6; // 行の高さ（文字の大きさの倍）
const MEMO_TOOTH = 8; // ちぎり口のぎざぎざの幅
const MEMO_DEPTH = 3; // ちぎり口のぎざぎざの深さ
// 定規：画面の px。目盛りは PDF の実寸（1 mm = 72 / 25.4 pt × 拡大率）。長さは 15 cm
const RULER_MM = 150;
const RULER_H = 56; // 定規の幅（px）
const RULER_PAD = 12; // 目盛りの 0 の左・150 mm の右の余白（px）
const RULER_SNAP = 28; // ふちの外側、これだけの所から書き始めると、ふちに沿う（px）
// 付箋（インデックス）：pt。ページに重なる所（OVER）は薄く、はみ出す所は濃い色に言葉
const INDEX_W = 44;
const INDEX_H = 16;
const INDEX_OVER = 14;
const INDEX_GAP = 4; // 続けて貼るときの間
const INDEX_COLORS = ['#f28b82', '#fbbc04', '#fff475', '#ccff90', '#a7ffeb', '#aecbfa', '#d7aefb', '#fdcfe8'];
const CALC_KEYS = [
  'C',
  '⌫',
  '(',
  ')',
  '÷',
  '7',
  '8',
  '9',
  '√',
  '×',
  '4',
  '5',
  '6',
  '^',
  '−',
  '1',
  '2',
  '3',
  'π',
  '+',
  '0',
  '.',
  '%',
  '='
];
/** ちぎり口（上の辺）のぎざぎざの点。幅 w・深さ d・歯の幅 tooth（同じ単位）。左上から右上へ */
const tearEdge = (w, d, tooth) => {
  const n = Math.max(2, Math.round(w / tooth));
  return Array.from({length: n + 1}, (_, i) => [(w * i) / n, i % 2 ? 0 : d]);
};
/** ちぎり口のある紙の clip-path（画面の px） */
const tearClip = (w, d, tooth) =>
  `polygon(${[...tearEdge(w, d, tooth), [w, d], ['100%', '100%'], [0, '100%']]
    .map(
      ([x, y]) =>
        `${typeof x === 'number' ? `${x.toFixed(1)}px` : x} ${typeof y === 'number' ? `${y.toFixed(1)}px` : y}`
    )
    .join(', ')})`;
const POUCH_ART = {
  sheet:
    '<svg viewBox="0 0 56 40" aria-hidden="true"><rect x="8" y="5" width="40" height="30" rx="3" fill="#e60000" opacity="0.88"/><rect x="13" y="10" width="14" height="3" rx="1.5" fill="#fff" opacity="0.8"/></svg>',
  calc:
    '<svg viewBox="0 0 56 40" aria-hidden="true"><rect x="14" y="2" width="28" height="36" rx="4" fill="#3b4252"/><rect x="17.5" y="5.5" width="21" height="8" rx="1.5" fill="#cfe3d2"/><g fill="#d8dee9">' +
    [0, 1, 2]
      .flatMap((r) => [0, 1, 2].map((c) => `<rect x="${18 + c * 7}" y="${17 + r * 7}" width="5" height="5" rx="1"/>`))
      .join('') +
    '</g></svg>',
  memo: '<svg viewBox="0 0 56 40" aria-hidden="true"><rect x="11" y="6" width="34" height="31" rx="1.5" fill="#fffdf6" stroke="#c9c6bd"/><rect x="11" y="4" width="34" height="6" rx="1.5" fill="#8b6f47"/><path d="M15 17H41M15 23H41M15 29H41" stroke="#bcd3ea" stroke-width="1.2"/></svg>',
  ruler:
    '<svg viewBox="0 0 56 40" aria-hidden="true"><g transform="rotate(-18 28 20)"><rect x="2" y="13" width="52" height="14" rx="2" fill="#dbeefa" stroke="#7aa7c7"/><path d="M6 13v5M11 13v3M16 13v5M21 13v3M26 13v5M31 13v3M36 13v5M41 13v3M46 13v5M51 13v3" stroke="#2f4f66" stroke-width="1"/></g></svg>',
  index:
    '<svg viewBox="0 0 56 40" aria-hidden="true"><rect x="8" y="5" width="30" height="30" rx="1" fill="#fff" stroke="#c9c6bd"/><rect x="26" y="8" width="22" height="7" rx="1.5" fill="#f28b82"/><rect x="26" y="17" width="22" height="7" rx="1.5" fill="#aecbfa"/><rect x="26" y="26" width="22" height="7" rx="1.5" fill="#ccff90"/></svg>',
  timer:
    '<svg viewBox="0 0 56 40" aria-hidden="true"><circle cx="28" cy="22" r="14" fill="#fff" stroke="#3b4252" stroke-width="2.5"/><rect x="25" y="3" width="6" height="4" rx="1" fill="#3b4252"/><path d="M28 22V13" stroke="#e5484d" stroke-width="2.5" stroke-linecap="round"/><path d="M28 22L34 26" stroke="#3b4252" stroke-width="2" stroke-linecap="round"/></svg>'
};
const ERASER_PX = 9; // 消しゴムの半径（画面の px）
const SVG_NS = 'http://www.w3.org/2000/svg';
const DRAW_TOOLS = ['ink', 'line', 'eraser']; // なぞって書く道具（注釈の上でも書く。動かさない）
const TEXT_COLORS = ['#2b2b2b', '#d93025', '#1a73e8', '#188038', '#e37400', '#9334e6', '#c2185b', '#ffffff'];
// 付箋は 6 色（tokens.css の --c1〜--c6 の明るい側の値）。既定は授業の色
// PDF のメモ（付箋）の色：授業ページの付箋と同じ 5 色（着せ替えで変えられる）
const NOTE_COLORS = ROUND_DEFAULTS;
const COURSE_HEX = [null, '#f6c445', '#f28b82', '#7fd1ae', '#8ab4f8', '#c58af9', '#ffab70', '#6fd3e6', '#f7a1c4'];
const COLOR_NAMES = {
  '#2b2b2b': '黒',
  '#d93025': '赤',
  '#1a73e8': '青',
  '#188038': '緑',
  '#e37400': '橙',
  '#9334e6': '紫',
  '#c2185b': '濃い桃',
  '#ffffff': '白',
  '#f6c445': '黄',
  '#f28b82': '赤',
  '#7fd1ae': '緑',
  '#8ab4f8': '青',
  '#c58af9': '紫',
  '#ffab70': '橙'
};
const clampSize = (v) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(Number(v) * 2) / 2 || DEFAULT_SIZE));

/** pdf.js が要る補助データ（CMap など）をメインから受け取る。file:// を直接読まない */
class IpcBinaryDataFactory {
  async fetch({kind, filename}) {
    const r = await api['pdf.asset']({kind, filename});
    if (r?.error) throw new Error(r.error);
    return r.bytes;
  }
}

const swatches = (colors, name) =>
  colors
    .map(
      (c) =>
        `<button type="button" class="swatch" data-${name}="${c}" style="--swatch: ${c}" title="${COLOR_NAMES[c] ?? c}" aria-label="${COLOR_NAMES[c] ?? c}"></button>`
    )
    .join('');

const BAR = `
  <div class="viewer-bar" role="toolbar" aria-label="PDF の編集">
    <button type="button" class="btn btn--small" data-v="back">← 授業へ</button>
    <span class="viewer-bar__name" data-v="name"></span>
    <div class="seg" role="group" aria-label="ツール">
      <button type="button" data-tool="select" title="選択・移動（Esc）">選択</button>
      <button type="button" data-tool="text" title="文字入れ（${key(MOD, 'T')}）">文字</button>
      <button type="button" data-tool="note" title="メモ（${key(MOD, 'M')}）">メモ</button>
    </div>
    <div class="viewer-bar__toggles" role="group" aria-label="出す・しまう">
    <div class="viewer-bar__bookmarks">
      <button type="button" data-v="bookmarks" aria-expanded="false" aria-haspopup="true" title="しおり（${key(MOD, 'D')} で今の場所にしおりを足す）">しおり</button>
      <div class="bookmark-panel" data-v="bookmark-panel" hidden>
        <div class="bookmark-panel__head">
          <strong>しおり</strong>
          <button type="button" class="btn btn--small" data-v="bookmark-add" title="いま見ている場所にしおりを足す（${key(MOD, 'D')}）">＋ ここにしおり</button>
        </div>
        <ul class="bookmark-panel__list" data-v="bookmark-list"></ul>
      </div>
    </div>
    </div>
    <div class="viewer-bar__history">
      <button type="button" data-v="undo" disabled title="取り消す（${key(MOD, 'Z')}）" aria-label="取り消す">↶</button>
      <button type="button" data-v="redo" disabled title="やり直す（${key(SHIFT, MOD, 'Z')}）" aria-label="やり直す">↷</button>
    </div>
    <div class="viewer-bar__group" data-group="text" hidden>
      <span class="viewer-bar__font" title="文字入れのフォントは${IS_MAC ? 'ヒラギノ角ゴ' : 'この OS の標準のゴシック体'}です（変えられません）">${FONT_LABEL}</span>
      <label class="viewer-bar__size">サイズ<input type="number" data-v="size" min="${SIZE_MIN}" max="${SIZE_MAX}" step="0.5" />pt</label>
      <button type="button" class="viewer-bar__bold" data-v="bold" aria-pressed="false" title="太字（${key(MOD, 'B')}）">B</button>
      <span class="swatches">${swatches(TEXT_COLORS, 'text-color')}</span>
      <input type="color" data-v="text-custom" title="ほかの色" aria-label="文字のほかの色" />
    </div>
    <div class="viewer-bar__group" data-group="note" hidden>
      <span class="muted">メモの色</span>
      <span class="swatches">${swatches(NOTE_COLORS, 'note-color')}</span>
      <input type="color" data-v="note-custom" title="ほかの色" aria-label="メモのほかの色" />
    </div>
    <div class="viewer-bar__group viewer-bar__refills" data-group="refill" role="group" aria-label="多機能ペンの芯" hidden></div>
    <button type="button" class="btn btn--small" data-v="delete" hidden title="選んだ注釈を消す（Delete）">削除</button>
    <span class="viewer-bar__spacer"></span>
    <div class="viewer-bar__nav">
    <label class="viewer-bar__page" title="ページ番号を入れて Enter で移る">
      <input type="number" data-v="page" min="1" value="1" aria-label="ページ" /><span data-v="page-count">/ 1</span>
    </label>
    <div class="viewer-bar__zoom">
      <button type="button" data-v="zoom-out" aria-label="縮小">−</button>
      <span data-v="zoom-label">100%</span>
      <button type="button" data-v="zoom-in" aria-label="拡大">＋</button>
      <button type="button" data-v="fit" title="ページの幅を画面の幅に合わせる">ページ幅</button>
    </div>
    </div>
    <button type="button" class="muted viewer-bar__status" data-v="status" aria-live="polite" title="変更は自動で上書き保存します（${key(MOD, 'S')} ですぐに保存）。保存できなかったときは押すともう一度保存します"></button>
    <button type="button" class="btn btn--small btn--quiet" data-v="export" title="注釈を描き込んだ PDF を別の名前で書き出す（${key(SHIFT, MOD, 'E')}）">書き出す…</button>
    <div class="viewer-bar__help">
      <button type="button" data-v="help" aria-expanded="false" aria-haspopup="true" title="キーボードの操作（${key(MOD, '/')}）" aria-label="キーボードの操作">?</button>
      <div class="help-panel" data-v="help-panel" hidden>
        <strong>キーボードの操作</strong>
        <dl>
          <dt>${key(MOD, 'T')}・${key(MOD, 'M')}</dt><dd>文字入れ・メモ</dd>
          <dt>${key(MOD, '1')}〜${key(MOD, '6')}</dt><dd>筆箱の 1〜6 本目のペン（多機能ペンは、もう一度押すと次の芯に回る）</dd>
          <dt>${key(SHIFT, MOD, 'H')}・${key(MOD, 'E')}</dt><dd>文字隠しペン・消しゴム</dd>
          <dt>${key(MOD, 'B')}</dt><dd>太字（文字入れを選んでいるとき）</dd>
          <dt>${key(MOD, 'D')}</dt><dd>今の場所にしおり</dd>
          <dt>${key(MOD, 'R')}</dt><dd>赤シート（ポーチの中）を出す・しまう</dd>
          <dt>Tab・Enter</dt><dd>注釈を順に選ぶ・選んだ文字を直す／メモを開く</dd>
          <dt>Delete</dt><dd>選んだ注釈を消す</dd>
          <dt>Esc</dt><dd>選択をやめて選択ツールへ</dd>
          <dt>${key(MOD, 'Z')}・${key(SHIFT, MOD, 'Z')}</dt><dd>取り消す・やり直す</dd>
          <dt>${key(MOD, 'S')}・${key(SHIFT, MOD, 'E')}</dt><dd>すぐに保存（ふだんは自動）・書き出す</dd>
          <dt>${key(MOD, '/')}</dt><dd>この一覧を出す・しまう</dd>
          <dt>ピンチ・${MOD}＋ホイール</dt><dd>拡大・縮小</dd>
          <dt class="muted">文字を打っている間</dt><dd class="muted">ショートカットは効きません（1 文字のショートカットはありません）</dd>
        </dl>
        <p class="help-panel__note">変更は自動で保存されます（右上の「保存しました」が目印）。赤シートは、マーカーのところを黒く隠し、赤い字・赤ペンの線を見えなくします。</p>
        <p class="help-panel__note">画面の四隅：左上にシール帳、左下に素材、右上に筆箱、右下にポーチ（赤シート・電卓・メモ帳）。端のつまみを押すか、マウスを画面の端へ動かすと出ます。</p>
      </div>
    </div>
  </div>
  <dialog class="export-dialog" data-v="export-dialog">
    <form method="dialog">
      <h3>注釈付きで書き出す</h3>
      <p class="muted">元の PDF はそのまま残し、注釈を描き込んだ別の PDF を作ります。</p>
      <fieldset>
        <legend>文字隠しのマーカー</legend>
        <label><input type="radio" name="markers" value="blue" checked /> 水色のまま（印刷して赤シートをかぶせると隠れます）</label>
        <label><input type="radio" name="markers" value="black" /> 黒く塗りつぶす</label>
      </fieldset>
      <label><input type="checkbox" name="notes" checked /> メモを PDF の注釈として入れる（ほかの PDF アプリでも読めます）</label>
      <div class="export-dialog__foot">
        <button type="submit" class="btn" value="cancel">やめる</button>
        <button type="submit" class="btn btn--primary" value="ok">書き出す…</button>
      </div>
    </form>
  </dialog>
  <aside class="fude-side is-tucked" data-v="side" data-corner="fude" aria-label="筆箱">
    <button type="button" class="fude-side__tab" data-corner-tab="fude" aria-expanded="false" title="筆箱を出す（マウスを画面の右上の端へ・右端から左へなでる）" aria-label="筆箱を出す"><span>筆箱</span></button>
    <div class="fude-side__head"><strong>筆箱</strong><span class="muted" data-v="case-name"></span></div>
    <div class="fude-side__case" data-v="slots" role="group" aria-label="筆箱のペン（${key(MOD, '1')}〜${key(MOD, '6')}）"></div>
    <button type="button" class="fude-side__eraser" data-tool="eraser" title="消しゴム：ペンの線・マーカー・文字隠しをなぞって消す（${key(MOD, 'E')}）">
      <svg viewBox="0 0 64 28" aria-hidden="true"><rect x="2" y="5" width="40" height="18" rx="3" fill="#fbfbf8" stroke="#c9c6bd"/><rect x="26" y="4" width="36" height="20" rx="2" fill="#2f6fb5"/><rect x="30" y="9" width="28" height="10" rx="1" fill="#fff" opacity="0.9"/></svg>
      <span>消しゴム</span>
    </button>
    <div class="fude-side__swap">
      <button type="button" class="btn btn--small" data-v="case" aria-expanded="false" aria-haspopup="true" title="持っているペンを出して、入れ替える">ペンを入れ替える</button>
      <div class="case-panel" data-v="case-panel" hidden></div>
    </div>
  </aside>
  <aside class="corner corner--pouch is-tucked" data-corner="pouch" aria-label="ポーチ">
    <button type="button" class="corner__tab" data-corner-tab="pouch" aria-expanded="false" title="ポーチを出す（マウスを画面の右下の端へ・右端から左へなでる）" aria-label="ポーチを出す"><span>ポーチ</span></button>
    <div class="corner__head"><strong>ポーチ</strong></div>
    <div class="pouch__items">
      <button type="button" class="pouch__item" data-v="sheet" aria-pressed="false" title="赤シートを出す・しまう（${key(MOD, 'R')}）。マーカーのところだけ黒く隠れます">${POUCH_ART.sheet}<span>赤シート</span></button>
      <button type="button" class="pouch__item" data-v="calc" aria-pressed="false" title="電卓を出す・しまう">${POUCH_ART.calc}<span>電卓</span></button>
      <button type="button" class="pouch__item" data-v="memo" aria-pressed="false" title="メモ帳を出す・しまう。書いてちぎると、ページに貼れます">${POUCH_ART.memo}<span>メモ帳</span></button>
      <button type="button" class="pouch__item" data-v="ruler" aria-pressed="false" title="定規を出す・しまう。ふちのすぐ外からボールペンで書くと、まっすぐな線になります">${POUCH_ART.ruler}<span>定規</span></button>
      <button type="button" class="pouch__item" data-v="index" aria-pressed="false" title="付箋を出す・しまう。ページの端に貼る色の目印です">${POUCH_ART.index}<span>付箋</span></button>
      <button type="button" class="pouch__item" data-v="timer" aria-pressed="false" title="タイマーを出す・しまう">${POUCH_ART.timer}<span>タイマー</span><small class="pouch__badge" data-v="timer-badge" hidden></small></button>
    </div>
  </aside>
  <aside class="corner corner--seal is-tucked" data-corner="seal" aria-label="シール帳">
    <button type="button" class="corner__tab" data-corner-tab="seal" aria-expanded="false" title="シール帳を出す（マウスを画面の左上の端へ・左端から右へなでる）" aria-label="シール帳を出す"><span>シール帳</span></button>
    <div class="corner__head"><strong>シール帳</strong></div>
    <div class="corner__tabs" data-v="seal-tabs" role="tablist" aria-label="シールの種類"></div>
    <div class="corner__grid corner__grid--seal" data-v="seal-grid"></div>
    <p class="corner__hint">押すと見ているページの真ん中に、ドラッグするとページの好きな所に貼れます</p>
  </aside>
  <aside class="corner corner--sozai is-tucked" data-corner="sozai" aria-label="素材">
    <button type="button" class="corner__tab" data-corner-tab="sozai" aria-expanded="false" title="素材を出す（マウスを画面の左下の端へ・左端から右へなでる）" aria-label="素材を出す"><span>素材</span></button>
    <div class="corner__head"><strong>素材</strong><span class="muted">授業でよく使う図</span></div>
    <div class="corner__tabs" data-v="sozai-tabs" role="tablist" aria-label="教科"></div>
    <div class="corner__grid corner__grid--sozai" data-v="sozai-grid"></div>
    <p class="corner__hint">押すと見ているページの真ん中に、ドラッグするとページの好きな所に貼れます。ペンで上に書き込めます</p>
  </aside>
  <div class="viewer-pages" data-v="pages"><p class="muted">読み込み中…</p></div>`;

class Viewer {
  constructor(root, {materialId, course, onBack}) {
    this.root = root;
    this.materialId = materialId;
    this.course = course;
    this.onBack = onBack;
    this.tool = 'select';
    this.zoom = 1;
    this.pages = [];
    this.annos = new Map(); // key → 注釈（id は保存後に付く）
    this.seq = 0;
    this.selected = null;
    this.editing = null;
    this.drag = null;
    this.inflight = 0;
    this.bookmarks = []; // {id, page, y, name}。y はページの高さに対する割合（拡大率が変わっても同じ場所）
    this.failed = false;
    this.destroyed = false;
    const fontDefault = (() => {
      try {
        return JSON.parse(course?.font_json || '{}');
      } catch {
        return {};
      }
    })();
    this.textStyle = {size: clampSize(fontDefault.size ?? DEFAULT_SIZE), bold: false, color: TEXT_COLORS[0]};
    // 着せ替え（SPEC-KISEKAE）：付箋の色の候補・しおりのリボンの色と形・リボンの先のシール
    this.skin = skinOf(state.data, course ?? null);
    this.noteColors = this.skin.sticky.round === 'default' ? NOTE_COLORS : this.skin.sticky.round;
    this.noteColor =
      COURSE_HEX[course?.color] && this.noteColors.includes(COURSE_HEX[course.color])
        ? COURSE_HEX[course.color]
        : this.noteColors[0];
    this.listeners = [];
    this.chains = new Set(); // 保存中の処理（書き出しの前に待つ）
    this.undoStack = [];
    this.redoStack = [];
    this.sheet = null;
    // 筆箱（§9.8）：中身は 6 本。slot は今使っているペンの場所（筆箱にない文字隠しペンを H で使うときは null）
    this.st = stationeryState(state.data?.stationery);
    this.slot = null;
    this.penItem = null;
    this.penSeen = false; // ペン（スタイラス）を使ったか。使ったら指では書かない
    this.corner = null; // 出している四隅（fude・pouch・seal・sozai）
    this.stickerUrls = new Map(); // 取り込んだシールの画像（id → Promise<data: URL>）
    this.memoColor = MEMO_COLORS[0];
    this.memoDraft = '';
  }

  $(name) {
    return this.root.querySelector(`[data-v="${name}"]`);
  }
  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  async start() {
    this.root.innerHTML = BAR;
    if (this.noteColors !== NOTE_COLORS)
      this.root.querySelector('[data-note-color]').parentElement.innerHTML = swatches(this.noteColors, 'note-color');
    this.pagesEl = this.$('pages');
    this.bindBar();
    this.bindPages();
    this.bindBookmarks();
    this.bindCase();
    this.bindSide();
    this.renderSlots();
    this.setTool('select');
    const r = await api['pdf.open']({materialId: this.materialId});
    if (this.destroyed) return;
    if (r?.error) return this.fail(r.error);
    this.$('name').textContent = r.material.name;
    this.$('name').title = r.material.name;
    // 文字入れの書式：この PDF で最後に使ったもの（なければ同じ授業で最後に使ったもの）を引き継ぐ
    if (r.textStyle && typeof r.textStyle === 'object')
      this.textStyle = {
        size: clampSize(r.textStyle.size, this.textStyle.size),
        bold: r.textStyle.bold === true,
        color: /^#[0-9a-f]{6}$/i.test(r.textStyle.color ?? '') ? r.textStyle.color.toLowerCase() : this.textStyle.color
      };
    document.title = `${r.material.name} — 大学ノート`;
    try {
      this.task = pdfjs.getDocument({
        data: r.bytes,
        BinaryDataFactory: IpcBinaryDataFactory,
        useWorkerFetch: false,
        cMapUrl: 'cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'standard_fonts/',
        wasmUrl: 'wasm/',
        isEvalSupported: false,
        enableXfa: false
      });
      this.doc = await this.task.promise;
    } catch (e) {
      return this.fail(
        e?.name === 'PasswordException' ? 'パスワード付きの PDF は開けません' : `PDF を読めませんでした（${e.message}）`
      );
    }
    if (this.destroyed) return;
    this.pagesEl.innerHTML = '';
    this.$('page').max = String(this.doc.numPages);
    this.$('page-count').textContent = `/ ${this.doc.numPages}`;
    for (let i = 1; i <= this.doc.numPages; i++) {
      const page = await this.doc.getPage(i);
      if (this.destroyed) return;
      const el = document.createElement('div');
      el.className = 'pdf-page';
      el.dataset.page = String(i);
      el.innerHTML = `<canvas class="pdf-page__canvas"></canvas><div class="pdf-page__layer"><svg class="pdf-page__ink" aria-hidden="true"><g></g></svg></div><span class="pdf-page__num muted">${i} / ${this.doc.numPages}</span>`;
      this.pagesEl.append(el);
      this.pages.push({
        num: i,
        page,
        el,
        canvas: el.querySelector('canvas'),
        layer: el.querySelector('.pdf-page__layer'),
        ink: el.querySelector('.pdf-page__ink g'), // ペンの線（PDF の座標のまま描き、拡大は g の変換で合わせる）
        viewport: null,
        rendered: false,
        visible: false
      });
    }
    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), {rootMargin: '1200px 0px'});
    this.zoom = this.fitZoom();
    this.layout();
    for (const p of this.pages) this.observer.observe(p.el);
    for (const a of r.annotations)
      if (a.page >= 1 && a.page <= this.pages.length) this.addAnno({...a, key: `k${this.seq++}`});
    this.bookmarks = (r.bookmarks ?? []).filter((b) => b.page >= 1 && b.page <= this.pages.length);
    this.renderBookmarks();
    this.updateBar();
  }

  // ---- しおり ----
  // 「ここにしおり」はツールバーのすぐ下に見えている場所（ページと、ページの中の高さ）に付ける。名前は「しおり1」「しおり2」…
  // 名前は一覧で変えられる（ダブルクリックか ✎）。ページの右端に小さなリボンを出す
  currentSpot() {
    const top = this.root.querySelector('.viewer-bar').getBoundingClientRect().bottom + 8;
    const p = this.pages.find((x) => x.el.getBoundingClientRect().bottom > top) ?? this.pages.at(-1);
    const r = p.el.getBoundingClientRect();
    return {page: p.num, y: Math.min(1, Math.max(0, (top - r.top) / r.height))};
  }
  async addBookmark() {
    if (!this.pages.length) return;
    const names = this.bookmarks.map((b) => b.name);
    let n = 0;
    for (const s of names) n = Math.max(n, Number(String(s).match(/^しおり\s*(\d+)$/)?.[1] ?? 0));
    const r = await api['bookmark.save']({
      materialId: this.materialId,
      bookmark: {...this.currentSpot(), name: `しおり${n + 1}`}
    });
    if (r?.error) return toast(r.error, {error: true});
    this.bookmarks.push(r.bookmark);
    this.renderBookmarks();
    this.openBookmarks(true);
    toast(`${r.bookmark.name} を付けました`);
  }
  async renameBookmark(b, name) {
    const clean = String(name).replace(/\s+/g, ' ').trim();
    if (!clean || clean === b.name) return this.renderBookmarks();
    const r = await api['bookmark.save']({materialId: this.materialId, bookmark: {...b, name: clean}});
    if (r?.error) toast(r.error, {error: true});
    else Object.assign(b, r.bookmark);
    this.renderBookmarks();
  }
  async removeBookmark(b) {
    const r = await api['bookmark.remove']({materialId: this.materialId, bookmarkId: b.id});
    if (r?.error) return toast(r.error, {error: true});
    this.bookmarks = this.bookmarks.filter((x) => x !== b);
    this.renderBookmarks();
  }
  jumpTo(b) {
    const p = this.pages[b.page - 1];
    if (!p) return;
    const bar = this.root.querySelector('.viewer-bar').getBoundingClientRect().bottom;
    const r = p.el.getBoundingClientRect();
    window.scrollTo({top: window.scrollY + r.top + b.y * r.height - bar - 8});
  }
  openHelp(open) {
    this.$('help-panel').hidden = !open;
    this.$('help').setAttribute('aria-expanded', String(open));
  }
  /** 今見ているページの番号をツールバーに出す（ページ番号の欄を打っているあいだは変えない） */
  showPage() {
    const input = this.$('page');
    if (!this.pages.length || document.activeElement === input) return;
    input.value = String(this.currentSpot().page);
  }
  openBookmarks(open) {
    const panel = this.$('bookmark-panel');
    panel.hidden = !open;
    this.$('bookmarks').setAttribute('aria-expanded', String(open));
  }
  renderBookmarks() {
    const esc = (t) =>
      String(t).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
    const list = [...this.bookmarks].sort((a, b) => a.page - b.page || a.y - b.y);
    this.$('bookmark-list').innerHTML = list.length
      ? list
          .map(
            (b) => `<li class="bookmark-panel__item" data-bm="${esc(b.id)}">
          <button type="button" class="bookmark-panel__name" data-bm-action="jump" title="${esc(b.name)}へ移る（ダブルクリックで名前を変える）">${esc(b.name)}</button>
          <span class="muted bookmark-panel__page">p.${b.page}</span>
          <button type="button" class="bookmark-panel__tool" data-bm-action="rename" title="名前を変える" aria-label="${esc(b.name)}の名前を変える">✎</button>
          <button type="button" class="bookmark-panel__tool" data-bm-action="remove" title="消す" aria-label="${esc(b.name)}を消す">×</button>
        </li>`
          )
          .join('')
      : '<li class="muted bookmark-panel__empty">まだしおりはありません。「＋ ここにしおり」か B で、いま見ている場所に付けます。</li>';
    this.$('bookmarks').textContent = this.bookmarks.length ? `しおり（${this.bookmarks.length}）` : 'しおり';
    // ページの右端のリボン（位置は割合なので、拡大率を変えても置き直さなくてよい）
    for (const el of this.pagesEl.querySelectorAll('.bookmark-ribbon')) el.remove();
    const look = bookmarkLook(this.skin);
    const sticker = fixedSticker(
      this.skin.stickers.find((st) => st.place === 'bookmark'),
      state.data,
      {x: 0, y: 0.5, base: 28}
    );
    for (const b of list) {
      const p = this.pages[b.page - 1];
      if (!p) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `bookmark-ribbon bm ${look.cls}`;
      el.style.cssText = `${look.style}; top: ${b.y * 100}%`;
      el.title = b.name;
      el.dataset.bm = b.id;
      el.setAttribute('aria-label', `しおり：${b.name}`);
      el.innerHTML = `${sticker}<span class="bookmark-ribbon__text"></span>`;
      el.lastElementChild.textContent = b.name;
      p.el.append(el);
    }
  }
  startRename(b) {
    const li = this.$('bookmark-list').querySelector(`[data-bm="${b.id}"]`);
    if (!li) return;
    const input = document.createElement('input');
    input.className = 'input bookmark-panel__input';
    input.value = b.name;
    input.maxLength = 40;
    input.setAttribute('aria-label', 'しおりの名前');
    li.querySelector('.bookmark-panel__name').replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) this.renameBookmark(b, input.value);
      else this.renderBookmarks();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }
  bindBookmarks() {
    const panel = this.$('bookmark-panel');
    const which = (e) => {
      const li = e.target.closest('[data-bm]');
      return li && this.bookmarks.find((b) => b.id === li.dataset.bm);
    };
    this.on(panel, 'click', (e) => {
      const btn = e.target.closest('[data-bm-action]');
      const b = btn && which(e);
      if (!b) return;
      if (btn.dataset.bmAction === 'jump') this.jumpTo(b);
      else if (btn.dataset.bmAction === 'rename') this.startRename(b);
      else if (btn.dataset.bmAction === 'remove') this.removeBookmark(b);
    });
    this.on(panel, 'dblclick', (e) => {
      const b = e.target.closest('[data-bm-action="jump"]') && which(e);
      if (b) this.startRename(b);
    });
    // ページのリボンを押したら、その場所へ
    this.on(this.pagesEl, 'click', (e) => {
      const rib = e.target.closest('.bookmark-ribbon');
      if (!rib) return;
      const b = this.bookmarks.find((x) => x.id === rib.dataset.bm);
      if (b) this.jumpTo(b);
    });
    // 一覧の外を押したら閉じる
    this.on(document, 'pointerdown', (e) => {
      if (!panel.hidden && !e.target.closest('.viewer-bar__bookmarks')) this.openBookmarks(false);
      if (!this.$('help-panel').hidden && !e.target.closest('.viewer-bar__help')) this.openHelp(false);
    });
  }

  fail(message) {
    this.pagesEl.innerHTML = `<div class="card"><p>${message.replace(/[&<>]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[c])}</p></div>`;
  }

  // ---- 表示 ----
  fitZoom() {
    const first = this.pages[0]?.page.getViewport({scale: CSS_UNITS});
    if (!first) return 1;
    // ページの右の端からはみ出す付箋（インデックス）の分も、左右に空けておく（ページは真ん中に置く）
    const avail = this.pagesEl.clientWidth - 32;
    const tab = (INDEX_W - INDEX_OVER) * CSS_UNITS * 2;
    return Math.min(2, Math.max(0.5, Math.floor((avail / (first.width + tab)) * 100) / 100));
  }

  layout(keepAnchor = true) {
    // 拡大率を変えても見ていた場所を保つ
    const anchor = keepAnchor ? this.pages.find((p) => p.el.getBoundingClientRect().bottom > 0) : null;
    const before = anchor?.el.getBoundingClientRect();
    const frac = before && before.height ? -before.top / before.height : 0;
    for (const p of this.pages) {
      p.viewport = p.page.getViewport({scale: this.zoom * CSS_UNITS});
      p.el.style.width = `${Math.floor(p.viewport.width)}px`;
      p.el.style.height = `${Math.floor(p.viewport.height)}px`;
      p.ink.setAttribute('transform', `matrix(${p.viewport.transform.join(',')})`);
      p.rendered = false;
      if (p.visible) this.renderPage(p);
    }
    for (const a of this.annos.values()) this.place(a);
    if (this.sheet) this.syncCovers();
    if (this.ruler) this.drawRuler();
    this.$('zoom-label').textContent = `${Math.round(this.zoom * 100)}%`;
    if (anchor && frac > 0) {
      const top = anchor.el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({top: top + frac * anchor.el.offsetHeight});
    }
  }

  /** ＋・−のボタンとメニューの「拡大」「縮小」（⌘＋・⌘−）「実際のサイズ」（⌘0）。PDF だけを拡大し、ツールバーや背景は変えない */
  zoomStep(dir) {
    if (!this.pages.length) return;
    if (dir === 'reset') this.setZoom(1, this.viewCenter());
    else if (dir === 'in') this.setZoom(ZOOMS.find((z) => z > this.zoom + 0.001) ?? this.zoom, this.viewCenter());
    else this.setZoom([...ZOOMS].reverse().find((z) => z < this.zoom - 0.001) ?? this.zoom, this.viewCenter());
  }

  /** ＋・−のボタンで拡大・縮小するときの基準：ツールバーより下に見えている範囲の真ん中 */
  viewCenter() {
    const top = this.root.querySelector('.viewer-bar').getBoundingClientRect().bottom;
    return {x: document.documentElement.clientWidth / 2, y: (top + window.innerHeight) / 2};
  }

  /** at（画面の座標）を渡すと、その下にあったページの場所を描き直したあとも同じ位置に保つ（ピンチの指の下） */
  setZoom(z, at = null) {
    // 指の下（ページとページの間なら、いちばん近いページ）
    const gap = (p) => {
      const r = p.el.getBoundingClientRect();
      return at.y < r.top ? r.top - at.y : at.y > r.bottom ? at.y - r.bottom : 0;
    };
    const hit = at && this.pages.length ? this.pages.reduce((a, b) => (gap(b) < gap(a) ? b : a)) : null;
    const before = hit?.el.getBoundingClientRect();
    this.zoom = clampZoom(z);
    this.layout(!hit);
    if (hit) {
      const after = hit.el.getBoundingClientRect();
      const fx = (at.x - before.left) / before.width;
      const fy = (at.y - before.top) / before.height;
      window.scrollBy(after.left + fx * after.width - at.x, after.top + fy * after.height - at.y);
    }
  }

  // トラックパッドの 2 本指（ピンチ）と Ctrl＋ホイールで拡大・縮小する。Chromium はピンチを ctrlKey 付きの wheel として送る。
  // 指を動かしているあいだは CSS の拡大で見た目だけを変え（PDF を毎回描き直すと重い）、止まったらその倍率で描き直す
  onWheel(e) {
    if (!e.ctrlKey || !this.pages.length || this.pinch?.touch) return;
    e.preventDefault(); // アプリ全体の拡大にしない
    if (!this.pinch) {
      const r = this.pagesEl.getBoundingClientRect();
      this.pinch = {zoom: this.zoom, x: e.clientX, y: e.clientY};
      this.pagesEl.style.transformOrigin = `${e.clientX - r.left}px ${e.clientY - r.top}px`;
    }
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // 行単位（マウスのホイール）はおよそのピクセルに
    this.pinch.zoom = clampZoom(this.pinch.zoom * Math.exp(-dy * PINCH_SPEED));
    this.pagesEl.style.transform = `scale(${this.pinch.zoom / this.zoom})`;
    clearTimeout(this.pinchTimer);
    this.pinchTimer = setTimeout(() => this.endPinch(), PINCH_IDLE);
  }
  endPinch() {
    const p = this.pinch;
    this.pinch = null;
    if (!p || this.destroyed) return;
    this.pagesEl.style.transform = '';
    this.pagesEl.style.transformOrigin = '';
    if (Math.abs(p.zoom - this.zoom) > 0.001) this.setZoom(p.zoom, p); // 2 本指で動かしただけなら描き直さない
    if (p.dx || p.dy) window.scrollBy(-p.dx, -p.dy); // 指を動かした分だけ、ページも指について動く
  }

  // タッチ画面の 2 本指で拡大・縮小する（Electron はブラウザのピンチ拡大を切っているので、自分で受ける）。
  // 基準は 2 本の指の真ん中。指をそろえて動かすとスクロールにもなる（文字隠しの道具では 1 本指がなぞりになるため）
  onTouchStart(e) {
    if (e.touches.length !== 2 || !this.pages.length || (this.pinch && !this.pinch.touch) || this.drawing?.byPen)
      return;
    e.preventDefault(); // ブラウザのスクロールに渡さない（あとの touchmove を止められるように）
    this.cancelPointer();
    clearTimeout(this.pinchTimer);
    const [a, b] = e.touches;
    const x = (a.clientX + b.clientX) / 2,
      y = (a.clientY + b.clientY) / 2;
    const r = this.pagesEl.getBoundingClientRect();
    const zoom = this.pinch?.zoom ?? this.zoom;
    this.pinch = {
      touch: true,
      zoom,
      start: zoom,
      x,
      y,
      dx: 0,
      dy: 0,
      dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1
    };
    this.pagesEl.style.transformOrigin = `${x - r.left}px ${y - r.top}px`;
  }
  onTouchMove(e) {
    const p = this.pinch;
    if (!p?.touch || e.touches.length < 2) return;
    if (e.cancelable) e.preventDefault();
    const [a, b] = e.touches;
    p.zoom = clampZoom((p.start * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)) / p.dist);
    p.dx = (a.clientX + b.clientX) / 2 - p.x;
    p.dy = (a.clientY + b.clientY) / 2 - p.y;
    this.pagesEl.style.transform = `translate(${p.dx}px, ${p.dy}px) scale(${p.zoom / this.zoom})`;
  }
  onTouchEnd(e) {
    if (this.pinch?.touch && e.touches.length < 2) this.endPinch();
  }

  /** 1 本目の指で始めたこと（なぞり中のマーカー・動かし中の注釈・置く前の文字入れや付箋）を取りやめる。2 本目の指が来たときなど */
  cancelPointer() {
    this.tap = null;
    this.pan = null;
    const dr = this.drawing;
    if (dr?.kind === 'eraser') {
      // 消しかけたものは戻さず、1 手として残す（取り消しで戻せる）
      this.drawing = null;
      this.recordGroup(dr.steps);
    } else if (dr) {
      if (dr.el !== this.ring) dr.el.remove();
      this.drawing = null;
    }
    const d = this.drag;
    if (d) {
      this.drag = null;
      d.a.el.classList.remove('is-dragging');
      d.a.el.style.left = `${d.left}px`;
      d.a.el.style.top = `${d.top}px`;
      if (d.a.kind === 'mask') this.syncCovers();
    }
  }

  onIntersect(entries) {
    for (const e of entries) {
      const p = this.pages[Number(e.target.dataset.page) - 1];
      p.visible = e.isIntersecting;
      if (p.visible && !p.rendered) this.renderPage(p);
      else if (!p.visible && p.rendered) {
        // 離れたページの絵は捨てる（§9.2：見えている前後だけ描く）
        p.renderTask?.cancel();
        p.canvas.width = p.canvas.height = 0;
        p.rendered = false;
      }
    }
  }

  async renderPage(p) {
    p.renderTask?.cancel();
    p.rendered = true;
    const vp = p.viewport;
    const dpr = canvasScale(vp, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page__canvas';
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    const task = p.page.render({canvas, viewport: vp, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0]});
    p.renderTask = task;
    try {
      await task.promise;
      if (p.renderTask !== task || this.destroyed) return;
      p.canvas.replaceWith(canvas); // 描き終わってから差し替える（ちらつかない）
      p.canvas = canvas;
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException' && p.renderTask === task) p.rendered = false;
    }
  }

  // ---- 注釈 ----
  addAnno(a) {
    const p = this.pages[a.page - 1];
    if (a.kind === 'ink') {
      // ペンの線：ページの SVG に path を足す（押しても選ばれない。消しゴムで消す）
      a.points = decodePoints(a.body) ?? [];
      a.el = document.createElementNS(SVG_NS, 'path');
      a.el.dataset.key = a.key;
      p.ink.append(a.el);
      this.annos.set(a.key, a);
      this.applyStyle(a);
      return a;
    }
    const el = document.createElement('div');
    el.dataset.key = a.key;
    if (a.kind === 'line') {
      el.className = 'anno-line';
      el.title = 'マーカー';
    } else if (a.kind === 'text') {
      el.className = 'anno-text';
      el.textContent = a.body;
    } else if (a.kind === 'stamp') {
      // 貼りもの：シール・素材の図は画像、ちぎった紙は文字。右下のつまみで大きさを変える（選んでいるときだけ見える）
      el.className = `anno-stamp anno-stamp--${a.style.type}`;
      el.innerHTML =
        a.style.type === 'memo'
          ? '<div class="anno-stamp__memo"><div class="anno-stamp__text"></div></div><span class="anno-stamp__grip" aria-hidden="true"></span>'
          : a.style.type === 'index'
            ? '<span class="anno-stamp__tab"></span>'
            : '<img class="anno-stamp__img" alt="" draggable="false" /><span class="anno-stamp__grip" aria-hidden="true"></span>';
    } else if (a.kind === 'mask') {
      el.className = 'anno-mask';
      el.title = '文字隠し';
      // 赤シートがかぶったところだけ見せる黒い覆い（syncCovers が切り抜く）。下の文字を確実に読めなくする
      el.innerHTML = '<span class="anno-mask__cover"></span>';
    } else {
      el.className = 'anno-note';
      el.innerHTML = `<button type="button" class="anno-note__icon" aria-label="メモ"></button>
        <div class="anno-note__pop" hidden>
          <textarea maxlength="5000" placeholder="メモを書く"></textarea>
          <div class="anno-note__draw" title="筆箱のボールペンで手書きできます（ペンを持っていなければ黒の 0.5）"><svg class="anno-note__ink" aria-label="手書き"></svg></div>
          <div class="anno-note__foot"><button type="button" class="btn btn--small" data-note="clear-ink" hidden>手書きを消す</button><button type="button" class="btn btn--small" data-note="delete">削除</button><button type="button" class="btn btn--small" data-note="close">閉じる</button></div>
        </div>`;
      this.bindNoteInk(a, el.querySelector('.anno-note__ink'));
      this.watchNoteSize(a, el.querySelector('.anno-note__pop'));
      const ta = el.querySelector('textarea');
      ta.value = a.body;
      ta.addEventListener('input', () => {
        a.body = ta.value;
        this.noteTitle(a);
        this.scheduleSave(a);
      });
      // 本文の書き換えは、書き始めから書き終わりまでを 1 手として取り消せる
      ta.addEventListener('focus', () => (a.bodyBefore = this.snap(a)));
      ta.addEventListener('blur', () => {
        if (a.bodyBefore) this.record(a.key, a.bodyBefore, this.snap(a));
        a.bodyBefore = null;
      });
    }
    // キーボードでも選べる（Tab で順に。Enter で文字を直す／メモを開く。Delete で消す）。メモは中のボタンが受けるので外側には付けない
    if (a.kind !== 'note') {
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      if (a.kind === 'text') el.setAttribute('aria-label', `文字入れ：${a.body.slice(0, 40)}`);
    }
    a.el = el;
    this.mountAnno(a, p);
    this.annos.set(a.key, a);
    this.applyStyle(a);
    this.place(a);
    return a;
  }
  /** 注釈の要素をページに入れる。貼りものはペンの線の下（線を上に書き込める）、ほかは上 */
  mountAnno(a, p) {
    if (a.kind === 'ink') p.ink.append(a.el);
    else if (a.kind === 'stamp') p.layer.insertBefore(a.el, p.ink.ownerSVGElement);
    else p.layer.append(a.el);
  }

  applyStyle(a) {
    if (a.kind === 'ink') {
      a.points = decodePoints(a.body) ?? a.points ?? [];
      a.el.setAttribute('fill', a.style.color);
      a.el.setAttribute('d', strokePath(a.points, a.style.width, {pressure: a.style.pressure !== false}));
    } else if (a.kind === 'line') a.el.style.setProperty('--line', a.style.color);
    else if (a.kind === 'mask') a.el.style.setProperty('--mask', a.style.color ?? MASK_HEX);
    else if (a.kind === 'text') {
      a.el.style.fontWeight = a.style.bold ? '700' : '400';
      a.el.style.color = a.style.color;
    } else if (a.kind === 'note') {
      a.el.style.setProperty('--note', a.style.color);
      this.noteTitle(a);
      this.applyNotePop(a);
    } else if (a.kind === 'stamp') this.applyStamp(a);
    // 赤く見える色の文字入れ・ペンの線は、赤シートの下に入ると見えなくなる（本物の赤シートと同じ）。syncCovers が隠す
    if (a.kind === 'text' || a.kind === 'ink') {
      const red = hidesUnderRedSheet(a.style.color);
      if (red) a.el.dataset.red = '1';
      else {
        delete a.el.dataset.red;
        a.el.style.clipPath = '';
      }
      if (this.sheet) this.syncCovers();
    }
  }

  /** 貼りものの中身：シールの画像（取り込んだ画像は届いてから）・図・ちぎった紙の文字と色 */
  applyStamp(a) {
    const {type, ref} = a.style;
    if (type === 'index') {
      a.el.style.setProperty('--index', a.style.color);
      a.el.style.setProperty('--index-ink', inkOn(a.style.color));
      a.el.querySelector('.anno-stamp__tab').textContent = a.body;
      a.el.setAttribute('aria-label', `付箋：${a.body || '（言葉なし）'}`);
      queueMicrotask(() => this.indexPad && this.renderIndexList()); // 位置（place）が決まってから並べる
      return;
    }
    if (type === 'memo') {
      a.el.style.setProperty('--memo', a.style.color ?? MEMO_COLOR);
      a.el.querySelector('.anno-stamp__text').textContent = a.body;
      a.el.setAttribute('aria-label', `メモ帳の紙：${a.body.slice(0, 40) || '（白紙）'}`);
      return;
    }
    const img = a.el.querySelector('img');
    if (type === 'figure') {
      img.src = figureUrl(ref);
      a.el.setAttribute('aria-label', `素材：${figureOf(ref)?.name ?? '図'}`);
      return;
    }
    const shape = isBuiltinSticker(ref)
      ? 'cut'
      : ((state.data?.skin?.stickers ?? []).find((x) => x.id === ref)?.shape ?? 'cut');
    img.className = `anno-stamp__img sticker--${shape}`;
    a.el.dataset.shape = shape;
    a.el.setAttribute('aria-label', `シール：${BUILTIN_STICKERS.find((x) => x.id === ref)?.name ?? '自分の画像'}`);
    this.stickerSrc(ref).then((url) => {
      if (url && a.style.ref === ref) img.src = url;
    });
  }
  /** シールの画像（data: URL）。取り込んだ画像はメインからもらい、覚えておく */
  stickerSrc(id) {
    if (isBuiltinSticker(id)) return Promise.resolve(builtinStickerUrl(id));
    if (!this.stickerUrls.has(id))
      this.stickerUrls.set(
        id,
        api['sticker.data']({ids: [id]}).then(
          (r) => r?.data?.[id] ?? '',
          () => ''
        )
      );
    return this.stickerUrls.get(id);
  }

  /** メモの吹き出し：大きさ（style.w・h）と中の手書き（style.ink）を画面に当てる */
  applyNotePop(a) {
    const pop = a.el.querySelector('.anno-note__pop');
    if (!pop) return;
    pop.style.width = a.style.w ? `${a.style.w}px` : '';
    pop.style.height = a.style.h ? `${a.style.h}px` : '';
    const svg = pop.querySelector('.anno-note__ink');
    const strokes = Array.isArray(a.style.ink) ? a.style.ink : [];
    svg.innerHTML = '';
    for (const s of strokes) {
      const points = decodePoints(s.p) ?? [];
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('fill', s.c);
      path.setAttribute('d', strokePath(points, s.w * NOTE_INK_SCALE, {pressure: s.pressure !== false}));
      svg.append(path);
    }
    pop.querySelector('[data-note="clear-ink"]').hidden = !strokes.length;
  }

  noteTitle(a) {
    const head = a.body.trim().slice(0, 80);
    a.el.querySelector('.anno-note__icon').title = head
      ? head + (a.body.trim().length > 80 ? '…' : '')
      : 'メモ（押すと開きます）';
  }

  /**
   * PDF の四角 → 画面の四角（ページの左上からの px）。ページに回転（/Rotate）があっても合うように、
   * 2 つの角を変換して小さいほう・大きいほうを取る。印刷の「横向き」で作った PDF は 90 度回転していることが多い
   */
  toScreen(page, r) {
    const vp = this.pages[page - 1].viewport;
    const [ax, ay] = vp.convertToViewportPoint(r.x, r.y);
    const [bx, by] = vp.convertToViewportPoint(r.x + r.w, r.y + r.h);
    return {left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay)};
  }

  /** 画面の四角 → PDF の四角（左下と幅・高さ） */
  fromScreen(page, s) {
    const vp = this.pages[page - 1].viewport;
    const [ax, ay] = vp.convertToPdfPoint(s.left, s.top);
    const [bx, by] = vp.convertToPdfPoint(s.left + s.width, s.top + s.height);
    return {x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay)};
  }

  /** PDF 座標 → 画面の位置 */
  place(a) {
    const vp = this.pages[a.page - 1].viewport;
    if (!vp || a.kind === 'ink') return; // ペンの線はページの g の変換で合う
    const s = this.toScreen(a.page, a.rect);
    a.el.style.left = `${s.left}px`;
    a.el.style.top = `${s.top}px`;
    if (a.kind === 'text') {
      a.el.style.fontSize = `${a.style.size * vp.scale}px`;
      a.el.style.maxWidth = `${Math.max(40, vp.width - s.left)}px`;
    } else if (a.kind === 'mask' || a.kind === 'line' || a.kind === 'stamp') {
      a.el.style.width = `${s.width}px`;
      a.el.style.height = `${s.height}px`;
      if (a.kind === 'mask') this.syncCovers();
      if (a.kind === 'stamp' && a.style.type === 'memo') this.placeMemo(a, s.width, vp.scale);
      if (a.kind === 'stamp' && a.style.type === 'index') {
        a.el.style.setProperty('--index-over', `${INDEX_OVER * vp.scale}px`);
        a.el.style.setProperty('--index-font', `${8 * vp.scale}px`);
      }
    } else a.el.style.setProperty('--note-size', `${NOTE_SIZE * vp.scale}px`);
  }

  /** ちぎった紙の文字の大きさ・余白・罫線・ちぎり口を、拡大率に合わせる（寸法は pt。書き出しと同じ） */
  placeMemo(a, width, scale) {
    const size = (a.style.size ?? MEMO_SIZE) * scale;
    const st = a.el.style;
    st.setProperty('--memo-font', `${size}px`);
    st.setProperty('--memo-lh', `${size * MEMO_LINE}px`);
    st.setProperty('--memo-pad', `${MEMO_PAD * scale}px`);
    st.setProperty('--memo-top', `${(MEMO_TOP + MEMO_DEPTH) * scale}px`);
    a.el.firstElementChild.style.clipPath = tearClip(width, MEMO_DEPTH * scale, MEMO_TOOTH * scale);
  }

  /** 画面の箱（左上と大きさ）から rect を取り直す */
  measure(a) {
    a.rect = this.fromScreen(a.page, {
      left: parseFloat(a.el.style.left),
      top: parseFloat(a.el.style.top),
      width: a.el.offsetWidth,
      height: a.el.offsetHeight
    });
  }

  createAt(kind, p, vx, vy) {
    const scale = p.viewport.scale;
    if (kind === 'text') {
      const style = {...this.textStyle};
      // 押した点に文字カーソルが来るように置く：1 行目の高さの真ん中を押した点に、左の余白（1px）ぶん左へずらす
      const h = style.size * LINE_HEIGHT * scale;
      const a = this.addAnno({
        key: `k${this.seq++}`,
        id: null,
        page: p.num,
        kind,
        rect: this.fromScreen(p.num, {left: vx - 1, top: vy - h / 2, width: 0, height: h}),
        body: '',
        style
      });
      a.fresh = true; // 取り消すと「置く前」に戻る
      this.select(a);
      this.edit(a);
    } else {
      const n = NOTE_SIZE * scale;
      const a = this.addAnno({
        key: `k${this.seq++}`,
        id: null,
        page: p.num,
        kind,
        rect: this.fromScreen(p.num, {left: vx - n / 2, top: vy - n / 2, width: n, height: n}),
        body: '',
        style: {color: this.noteColor}
      });
      this.record(a.key, null, this.snap(a));
      this.select(a);
      this.scheduleSave(a, 0);
      this.openNote(a, true);
    }
  }

  select(a) {
    if (this.selected === a) return;
    this.selected?.el.classList.remove('is-selected');
    this.selected = a;
    a?.el.classList.add('is-selected');
    this.updateBar();
  }

  edit(a) {
    if (this.editing === a) return;
    this.finishEdit();
    this.editing = a;
    a.editBefore = a.fresh ? null : this.snap(a);
    a.fresh = false;
    const el = a.el;
    el.contentEditable = 'plaintext-only';
    el.classList.add('is-editing');
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    a.onBlur = () => this.finishEdit();
    a.onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        el.blur();
      }
    };
    el.addEventListener('blur', a.onBlur);
    el.addEventListener('keydown', a.onKey);
  }

  finishEdit() {
    const a = this.editing;
    if (!a) return;
    this.editing = null;
    const el = a.el;
    el.removeEventListener('blur', a.onBlur);
    el.removeEventListener('keydown', a.onKey);
    el.contentEditable = 'false';
    el.classList.remove('is-editing');
    const body = el.innerText.replace(/\n+$/, '').slice(0, 2000);
    if (!body.trim()) {
      this.removeAnno(a, false);
      return this.record(a.key, a.editBefore, null);
    }
    if (body !== el.innerText) el.textContent = body;
    a.body = body;
    this.measure(a);
    this.record(a.key, a.editBefore, this.snap(a));
    this.scheduleSave(a, 0);
  }

  openNote(a, open) {
    const pop = a.el.querySelector('.anno-note__pop');
    pop.hidden = !open;
    a.el.classList.toggle('is-open', open);
    if (open) pop.querySelector('textarea').focus();
  }

  /** 注釈を消す。record が真なら取り消しの履歴に積む */
  removeAnno(a, record = true) {
    if (a.removed) return;
    if (record) this.record(a.key, this.snap(a), null);
    a.removed = true;
    clearTimeout(a.timer);
    a.el.remove();
    this.annos.delete(a.key);
    if (this.selected === a) this.select(null);
    if (this.editing === a) this.editing = null;
    if (a.kind === 'stamp' && a.style.type === 'index' && this.indexPad) this.renderIndexList();
    // 同じ注釈の保存と消去は 1 本の鎖で順に行う。保存中に消されたときは flush の末尾が先に消すので、removedOnServer で 2 回送らない
    if (a.id || a.chain)
      this.track(a, async () => {
        if (!a.id || a.removedOnServer) return;
        a.removedOnServer = true;
        await api['annotation.remove']({materialId: this.materialId, annotationId: a.id});
      });
    this.updateBar();
  }

  // ---- 保存（§9.1：変更から少し待って自動で保存。注釈ごとに順番を守る）----
  scheduleSave(a, delay = 600) {
    if (a.removed) return;
    clearTimeout(a.timer);
    this.setStatus('saving');
    a.timer = setTimeout(() => this.flush(a), delay);
  }

  flush(a) {
    clearTimeout(a.timer);
    a.timer = null;
    if (a.removed) return;
    this.track(a, async () => {
      if (a.removed) return;
      const r = await api['annotation.save']({
        materialId: this.materialId,
        annotation: {id: a.id ?? null, page: a.page, kind: a.kind, rect: {...a.rect}, body: a.body, style: {...a.style}}
      });
      if (r?.error) throw new Error(r.error);
      a.id = r.annotation.id;
      if (a.removed && !a.removedOnServer) {
        // 保存中に消された
        a.removedOnServer = true;
        await api['annotation.remove']({materialId: this.materialId, annotationId: a.id});
      }
    });
  }

  track(a, fn) {
    this.inflight++;
    this.setStatus('saving');
    const chain = (a.chain = (a.chain ?? Promise.resolve())
      .then(fn)
      .then(
        () => {
          this.failed = false;
          this.markDirty();
        },
        (e) => {
          this.failed = true;
          console.error(e);
          this.saveFailed(a, e);
        }
      )
      .finally(() => {
        this.inflight--;
        this.chains.delete(chain);
        this.setStatus();
      }));
    this.chains.add(chain);
  }

  /** 保存待ち・保存中をすべて終わらせる */
  async settle() {
    this.flushAll();
    while (this.chains.size) await Promise.allSettled([...this.chains]);
    return !this.failed;
  }

  // ---- 取り消し・やり直し（§9.1）。1 手 = ある注釈の「前」と「後」の写し。null は「ない」 ----
  snap(a) {
    if (!a || a.removed) return null;
    return structuredClone({page: a.page, kind: a.kind, rect: a.rect, body: a.body, style: a.style});
  }

  record(key, before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.pushStep({key, before, after});
  }
  /** いくつかの注釈の変更を 1 手にまとめる（消しゴムでひとなぞりに消した線など）。steps は {key, before, after} の並び */
  recordGroup(steps) {
    if (steps.length === 1) return this.record(steps[0].key, steps[0].before, steps[0].after);
    if (steps.length) this.pushStep({group: steps});
  }
  pushStep(step) {
    this.undoStack.push(step);
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
    this.redoStack = [];
    this.updateHistory();
  }

  undo() {
    this.finishEdit();
    const step = this.undoStack.pop();
    if (!step) return;
    for (const st of step.group ? [...step.group].reverse() : [step]) this.restore(st.key, st.before);
    this.redoStack.push(step);
    this.updateHistory();
  }

  redo() {
    this.finishEdit();
    const step = this.redoStack.pop();
    if (!step) return;
    for (const st of step.group ?? [step]) this.restore(st.key, st.after);
    this.undoStack.push(step);
    this.updateHistory();
  }

  /** 注釈を写しの状態に戻す。写しが null なら消し、ない注釈なら作り直す（DB には新しい行として保存） */
  restore(key, snap) {
    let a = this.annos.get(key);
    if (!snap) {
      if (a) this.removeAnno(a, false);
      return;
    }
    const data = structuredClone(snap);
    if (!a) a = this.addAnno({key, id: null, ...data});
    else {
      if (a.page !== data.page) this.mountAnno(a, this.pages[data.page - 1]);
      Object.assign(a, data);
      if (a.kind === 'text') a.el.textContent = a.body;
      else if (a.kind === 'note') a.el.querySelector('textarea').value = a.body;
      this.applyStyle(a);
      this.place(a);
    }
    if (a.kind !== 'ink') this.select(a); // ペンの線は選ばない（押しても選べないので）
    this.scheduleSave(a, 0);
  }

  updateHistory() {
    this.$('undo').disabled = !this.undoStack.length;
    this.$('redo').disabled = !this.redoStack.length;
  }

  flushAll() {
    this.finishEdit();
    for (const a of this.annos.values()) if (a.timer) this.flush(a);
  }

  /** 注釈を保存できなかったとき：原因と「もう一度」を知らせる（続けて失敗しても 10 秒に 1 回だけ） */
  saveFailed(a, e) {
    const now = Date.now();
    if (now - (this.failToastAt ?? 0) < 10000) return;
    this.failToastAt = now;
    toast('注釈を保存できませんでした', {
      error: true,
      detail: String(e?.message ?? e),
      action: {label: 'もう一度', run: () => this.retrySaves()}
    });
  }
  /** 保存できなかった注釈をもう一度保存する（右上の「保存できませんでした」を押したときも） */
  retrySaves() {
    this.failed = false;
    for (const x of this.annos.values()) if (!x.removed) this.scheduleSave(x, 0);
    if (this.fileDirty) this.saveFile();
  }

  setStatus(state) {
    const el = this.$('status');
    if (!el) return;
    const pending = state === 'saving' || this.inflight > 0 || [...this.annos.values()].some((a) => a.timer);
    el.textContent = this.failed
      ? '保存できませんでした（押すともう一度）'
      : pending || this.fileSaving || this.fileDirty
        ? '保存中…'
        : this.fileBlocked
          ? 'ファイルには保存していません'
          : this.annos.size || this.saved
            ? '保存しました'
            : '';
    if (!pending && !this.failed) this.saved = true;
    el.classList.toggle('is-error', this.failed);
  }

  // ---- 操作 ----
  setTool(tool) {
    this.tool = tool;
    if (!['ink', 'line', 'mask'].includes(tool)) this.slot = null;
    if (tool !== 'select') {
      this.finishEdit();
      if (this.selected && this.selected.kind !== tool) this.select(null);
    }
    this.pagesEl.dataset.tool = tool;
    for (const b of this.root.querySelectorAll('[data-tool]'))
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    for (const b of this.root.querySelectorAll('[data-slot]'))
      b.setAttribute('aria-pressed', String(this.slot !== null && Number(b.dataset.slot) === this.slot));
    if (tool !== 'eraser') this.ring?.remove();
    // しまった筆箱のつまみに、今持っているペンの色を出す
    const pen = ['ink', 'line', 'mask'].includes(tool) ? this.penItem?.color : tool === 'eraser' ? '#2f6fb5' : null;
    this.$('side')?.style.setProperty('--current', pen ?? 'transparent');
    this.updateBar();
  }

  // ---- 筆箱（§9.8）----
  /** 筆箱の i 本目（null なら筆箱の外の品）のペンを持つ */
  usePen(item, i = null) {
    if (!item) return;
    this.penItem = heldPen(item, this.st.refills?.[item.id]); // 多機能ペンは選んだ芯の色・太さ

    this.slot = i;
    this.setTool(KIND_OF[item.type]);
    this.slot = i; // setTool が外したのを戻す
    for (const b of this.root.querySelectorAll('[data-slot]'))
      b.setAttribute('aria-pressed', String(i !== null && Number(b.dataset.slot) === i));
  }
  /** 筆箱の i 本目を持つ（空なら何もしない）。持っている多機能ペンをもう一度押すと、次の芯に回す（回転式） */
  useSlot(i) {
    const item = itemOf(this.st.slots[i]);
    if (!item) return;
    if (item.refills && this.slot === i && this.tool === KIND_OF[item.type]) {
      const next = nextRefill(item, this.penItem?.refill?.id);
      this.pickRefill(next);
      toast(`${item.name}：${heldPen(item, next).refill.name}に回しました`);
    } else this.usePen(item, i);
  }
  /** 持っている多機能ペンの芯を選ぶ（設定に残す） */
  async pickRefill(rid) {
    const item = itemOf(this.penItem?.id);
    if (!item?.refills || !item.refills.some((r) => r.id === rid)) return;
    this.st = {...this.st, refills: {...this.st.refills, [item.id]: rid}};
    if (state.data) state.data.stationery = this.st;
    this.usePen(item, this.slot);
    this.renderSlots();
    const r = await api['stationery.arrange']({refills: {[item.id]: rid}});
    if (r?.error) return toast(r.error, {error: true});
    this.st = r.stationery;
    if (state.data) state.data.stationery = r.stationery;
  }
  /** 文字隠しペン（⇧⌘H）：筆箱の中の最初の文字隠しペン。なければ水色 */
  useHider() {
    const i = this.st.slots.findIndex((id) => itemOf(id)?.type === 'hider');
    if (i >= 0) this.useSlot(i);
    else this.usePen(itemOf(DEFAULT_HIDER));
  }
  renderSlots() {
    const box = this.$('slots');
    const kase = itemOf(this.st.caseId);
    this.$('side').style.setProperty('--case-base', kase.base);
    this.$('side').style.setProperty('--case-trim', kase.trim);
    this.$('case-name').textContent = kase.name;
    box.innerHTML = this.st.slots
      .map((id, i) => {
        const it = itemOf(id);
        if (!it)
          return `<button type="button" class="fude-side__pen is-empty" data-slot="${i}" disabled title="空き（「ペンを入れ替える」で入れる）" aria-label="${i + 1} 本目：空き"><span class="fude-side__num">${i + 1}</span></button>`;
        const held = heldPen(it, this.st.refills?.[it.id]);
        const tip = held.refill
          ? `${it.name}（${held.refill.name}・キー ${i + 1}。もう一度押すと次の芯）`
          : `${it.name}（${TYPE_LABEL[it.type]}・キー ${i + 1}）`;
        return `<button type="button" class="fude-side__pen" data-slot="${i}" title="${tip}" aria-label="${tip}" aria-pressed="false" style="--ink: ${held.color}"><span class="fude-side__num">${i + 1}</span>${toolArt(it, {label: false})}</button>`;
      })
      .join('');
    // 使っていたペンが筆箱から出たら、選択に戻す
    if (this.slot !== null && this.st.slots[this.slot] !== this.penItem?.id) this.setTool('select');
    else this.setTool(this.tool);
  }
  openCase(open) {
    const panel = this.$('case-panel');
    panel.hidden = !open;
    this.$('case').setAttribute('aria-expanded', String(open));
    if (!open) return;
    const at = this.slot ?? Math.max(0, this.st.slots.indexOf(null));
    const groups = TOOL_TYPES.map((type) => {
      const items = this.st.owned.map(itemOf).filter((it) => it?.type === type);
      return `<div class="case-panel__group"><span class="muted">${TYPE_LABEL[type]}</span>
        ${items
          .map((it) => {
            const where = this.st.slots.indexOf(it.id);
            return `<button type="button" class="case-panel__item${where >= 0 ? ' is-in' : ''}" data-case-item="${it.id}" title="${it.name}${where >= 0 ? `（${where + 1} 本目）` : ''}">${toolArt(it, {label: false})}<span>${it.name}</span></button>`;
          })
          .join('')}</div>`;
    });
    panel.innerHTML = `<div class="case-panel__head"><strong>筆箱</strong><span class="muted">押したペンを ${at + 1} 本目に入れて持ちます</span></div>
      ${groups.join('')}
      <div class="case-panel__foot"><button type="button" class="btn btn--small" data-case-go>筆箱を整理する・ショップへ →</button></div>`;
    panel.dataset.at = String(at);
  }
  /** 筆箱の外のペンを、at 本目に入れて持つ（入っていたペンは出す）。もう入っていればそのまま持つ */
  async putInCase(id, at) {
    const now = this.st.slots.indexOf(id);
    if (now >= 0) return this.useSlot(now);
    const slots = [...this.st.slots];
    slots[at] = id;
    const r = await api['stationery.arrange']({slots});
    if (r?.error) return toast(r.error, {error: true});
    this.st = r.stationery;
    if (state.data) state.data.stationery = r.stationery;
    this.renderSlots();
    this.useSlot(at);
  }
  /** 筆箱を出す（true）・しまう（false） */
  openSide(open) {
    this.openCorner(open ? 'fude' : null);
  }
  /** 四隅の 1 つ（fude・pouch・seal・sozai）を出す。null ですべてしまう。1 つ出すとほかはしまう */
  openCorner(name) {
    clearTimeout(this.tuckTimer);
    if (this.corner === name) return;
    if (this.corner === 'fude') this.openCase(false);
    this.corner = name;
    this.cornerEntered = false; // 出したあと一度でも中でマウスを動かしたか（動かしてから離れたらしまう）
    this.cornerAt = window.performance.now();
    this.root.toggleAttribute('data-corner-open', !!name); // 出している間は、ほかのつまみを隠す（箱の下からはみ出さない）
    for (const el of this.root.querySelectorAll('[data-corner]')) {
      const on = el.dataset.corner === name;
      el.classList.toggle('is-tucked', !on);
      el.querySelector('[data-corner-tab]').setAttribute('aria-expanded', String(on));
    }
    if (name === 'seal') this.renderSeal();
    else if (name === 'sozai' && !this.$('sozai-grid').childElementCount) this.renderSozai();
  }
  tuckSoon() {
    clearTimeout(this.tuckTimer);
    this.tuckTimer = setTimeout(() => !this.destroyed && this.openCorner(null), 350);
  }
  bindSide() {
    const EDGE = 10; // 画面の端から何 px でマウスを寄せたとみなすか
    // 画面の端のどこか：右の上半分は筆箱、右の下半分はポーチ、左の上半分はシール帳、左の下半分は素材
    const cornerAt = (side, y) =>
      side === 'right'
        ? y < window.innerHeight / 2
          ? 'fude'
          : 'pouch'
        : y < window.innerHeight / 2
          ? 'seal'
          : 'sozai';
    const inCorner = (e) => !!e.target.closest?.('[data-corner]');
    // マウス：端へ寄せたら出し、出したものから離れたらしまう
    this.on(document, 'pointermove', (e) => {
      if (e.pointerType !== 'mouse' || this.drawing || this.drag || this.carry || this.corner) return;
      if (e.clientX >= document.documentElement.clientWidth - EDGE) this.openCorner(cornerAt('right', e.clientY));
      else if (e.clientX <= EDGE) this.openCorner(cornerAt('left', e.clientY));
    });
    for (const el of this.root.querySelectorAll('[data-corner]')) {
      // 出したとき、マウスはつまみ（端）にあって、まだ中に入っていないことが多い。出てくる動き（0.28 秒）の途中で
      // 箱がマウスの下を通り過ぎても入ったことにしない。止まった箱の中でマウスを動かし、そこから離れたときだけしまう
      this.on(el, 'pointerleave', (e) => {
        if (e.pointerType !== 'mouse' || this.corner !== el.dataset.corner || this.carry || !this.cornerEntered) return;
        if (this.$('case-panel').hidden) this.tuckSoon();
      });
      this.on(el, 'pointermove', (e) => {
        clearTimeout(this.tuckTimer);
        if (
          e.pointerType === 'mouse' &&
          this.corner === el.dataset.corner &&
          window.performance.now() - this.cornerAt > 320
        )
          this.cornerEntered = true;
      });
    }
    // 指・ペン：画面の端から内側へなでたら出す。出したものの外を押したらしまう
    this.on(
      document,
      'pointerdown',
      (e) => {
        if (e.pointerType === 'mouse') {
          if (this.corner && !inCorner(e)) this.openCorner(null);
          return;
        }
        const w = document.documentElement.clientWidth;
        const side = e.clientX >= w - 24 ? 'right' : e.clientX <= 24 ? 'left' : null;
        if (side && !inCorner(e)) this.edge = {pointer: e.pointerId, x: e.clientX, y: e.clientY, side};
        else if (this.corner && !inCorner(e)) this.openCorner(null);
      },
      {capture: true}
    );
    this.on(document, 'pointermove', (e) => {
      const g = this.edge;
      if (!g || g.pointer !== e.pointerId) return;
      const inward = g.side === 'right' ? g.x - e.clientX : e.clientX - g.x;
      if (inward > 30 && Math.abs(e.clientY - g.y) < 60) {
        this.edge = null;
        this.cancelPointer(); // 書きかけの線にしない
        this.openCorner(cornerAt(g.side, g.y));
      }
    });
    const endEdge = (e) => this.edge?.pointer === e.pointerId && (this.edge = null);
    this.on(document, 'pointerup', endEdge);
    this.on(document, 'pointercancel', endEdge);
    // シール帳・素材：押すと見ているページの真ん中に、ドラッグすると離した所に貼る
    for (const name of ['seal', 'sozai'])
      this.on(this.root.querySelector(`[data-corner="${name}"]`), 'pointerdown', (e) => {
        const item = e.target.closest('[data-seal], [data-figure]');
        if (item) this.startCarry(e, this.itemSpec(item));
      });
  }

  // ---- シール帳・素材（§9.9）----
  renderSeal(tab = this.sealTab ?? 'mark') {
    const mine = state.data?.skin?.stickers ?? [];
    if (tab === 'mine' && !mine.length) tab = 'mark';
    this.sealTab = tab;
    const tabs = [
      ['mark', BUILTIN_STICKER_KIND.mark],
      ['deco', BUILTIN_STICKER_KIND.deco],
      ...(mine.length ? [['mine', '自分の画像']] : [])
    ];
    this.$('seal-tabs').innerHTML = tabs
      .map(
        ([v, l]) => `<button type="button" role="tab" data-seal-tab="${v}" aria-selected="${v === tab}">${l}</button>`
      )
      .join('');
    const items =
      tab === 'mine'
        ? mine.map((x) => ({id: x.id, name: '自分の画像', shape: x.shape ?? 'cut'}))
        : BUILTIN_STICKERS.filter((x) => x.kind === tab).map((x) => ({id: x.id, name: x.name, shape: 'cut'}));
    const grid = this.$('seal-grid');
    grid.innerHTML = items
      .map(
        (it) =>
          `<button type="button" class="corner__item" data-seal="${esc(it.id)}" title="${esc(it.name)}"><img class="sticker--${esc(it.shape)}" alt="${esc(it.name)}" draggable="false" /></button>`
      )
      .join('');
    for (const b of grid.querySelectorAll('[data-seal]'))
      this.stickerSrc(b.dataset.seal).then((url) => url && (b.firstElementChild.src = url));
  }
  renderSozai(subject = this.sozaiSubject ?? FIGURE_SUBJECTS[0]) {
    this.sozaiSubject = subject;
    this.$('sozai-tabs').innerHTML = FIGURE_SUBJECTS.map(
      (v) =>
        `<button type="button" role="tab" data-sozai-tab="${esc(v)}" aria-selected="${v === subject}">${esc(v)}</button>`
    ).join('');
    this.$('sozai-grid').innerHTML = FIGURES.filter((f) => f.subject === subject)
      .map(
        (f) =>
          `<button type="button" class="corner__item" data-figure="${f.id}" title="${esc(f.name)}"><img src="${figureUrl(f.id)}" alt="" draggable="false" /><span>${esc(f.name)}</span></button>`
      )
      .join('');
  }
  /** シール帳・素材の 1 つから、貼るものの中身と大きさ（pt）を作る */
  itemSpec(item) {
    if (item.dataset.figure) {
      const f = figureOf(item.dataset.figure);
      return {type: 'figure', ref: f.id, w: f.w * FIGURE_PT_PER_UNIT, h: f.h * FIGURE_PT_PER_UNIT};
    }
    const img = item.querySelector('img');
    const ratio = img?.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
    return {type: 'sticker', ref: item.dataset.seal, w: STICKER_PT, h: Math.round(STICKER_PT * ratio * 100) / 100};
  }

  /** 画面の点の下のページ（なければ null） */
  pageAt(x, y) {
    return (
      this.pages.find((p) => {
        const r = p.el.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      }) ?? null
    );
  }
  /**
   * 押したものをページへ運ぶ。動かすと影（ghost）が指について来て、ページの上で離すとそこに貼る。
   * 動かさずに離したら onTap（なければ見ているページの真ん中に貼る）。ページの外で離したら onCancel
   * opts：ghost（影を作る関数。なければ貼りものの見本）・dx・dy（影の左上から押した点まで。なければ真ん中）・onLift（動かし始めた）
   */
  startCarry(e, spec, opts = {}) {
    if (e.button !== 0 || this.carry) return;
    e.preventDefault();
    const c = {pointer: e.pointerId, x: e.clientX, y: e.clientY, ghost: null};
    const move = (ev) => {
      if (ev.pointerId !== c.pointer) return;
      if (!c.ghost) {
        if (Math.hypot(ev.clientX - c.x, ev.clientY - c.y) < 6) return;
        c.ghost = opts.ghost?.() ?? this.stampGhost(spec);
        c.ghost.classList.add('carry-ghost');
        this.root.append(c.ghost);
        opts.onLift?.();
        if (this.corner === 'seal' || this.corner === 'sozai') this.openCorner(null); // 貼る所を見せる
      }
      c.ghost.style.left = `${ev.clientX - (opts.dx ?? c.ghost.offsetWidth / 2)}px`;
      c.ghost.style.top = `${ev.clientY - (opts.dy ?? c.ghost.offsetHeight / 2)}px`;
    };
    const up = (ev) => {
      if (ev.pointerId !== c.pointer) return;
      const g = c.ghost?.getBoundingClientRect(); // 影を外す（off）前に、置く場所を読む
      c.off();
      if (!c.ghost) {
        if (ev.type === 'pointerup') (opts.onTap ?? (() => this.placeStamp(spec)))();
        return;
      }
      const p = ev.type === 'pointerup' ? this.pageAt(ev.clientX, ev.clientY) : null;
      if (!p) return opts.onCancel?.();
      const box = p.el.getBoundingClientRect();
      this.placeStamp(spec, {p, x: g.left + g.width / 2 - box.left, y: g.top + g.height / 2 - box.top});
    };
    c.off = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      c.ghost?.remove();
      if (this.carry === c) this.carry = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this.carry = c;
  }
  /** 運んでいる間の影：いまの拡大率で貼ったときと同じ大きさの見本 */
  stampGhost(spec) {
    const scale = this.pages[0]?.viewport?.scale ?? 1;
    const img = document.createElement('img');
    img.alt = '';
    img.src = spec.type === 'figure' ? figureUrl(spec.ref) : '';
    if (spec.type === 'sticker') this.stickerSrc(spec.ref).then((url) => (img.src = url));
    Object.assign(img.style, {width: `${spec.w * scale}px`, height: `${spec.h * scale}px`});
    return img;
  }
  /**
   * 貼りものを置く。at（{p, x, y}：ページの左上からの px）がなければ、見ているページの真ん中（続けて押したら少しずつずらす）。
   * 置いたら選択の道具にして選ぶ（すぐ動かせる・大きさを変えられる）。戻りは注釈
   */
  placeStamp(spec, at = null) {
    let p, x, y;
    if (at) ({p, x, y} = at);
    else {
      const c = this.viewCenter();
      const dist = (q) => {
        const r = q.el.getBoundingClientRect();
        return c.y < r.top ? r.top - c.y : c.y > r.bottom ? c.y - r.bottom : 0;
      };
      p = this.pages.length ? this.pages.reduce((a, b) => (dist(b) < dist(a) ? b : a)) : null;
      if (!p) return null;
      const box = p.el.getBoundingClientRect();
      const n = (this.placed = ((this.placed ?? -1) + 1) % 6);
      x = Math.min(Math.max(c.x - box.left, 0), box.width) + n * 14;
      y = Math.min(Math.max(c.y - box.top, 0), box.height) + n * 14;
    }
    const vp = p?.viewport;
    if (!vp) return null;
    const sw = spec.w * vp.scale,
      sh = spec.h * vp.scale;
    // 付箋（インデックス）はページの右の端に、外へはみ出して貼る（ページに重なるのは INDEX_OVER だけ）
    const left =
      spec.type === 'index'
        ? vp.width - INDEX_OVER * vp.scale
        : Math.min(Math.max(x - sw / 2, 0), Math.max(0, vp.width - sw));
    const top = Math.min(
      Math.max(spec.type === 'index' && !at ? this.indexSlot(p) : y - sh / 2, 0),
      Math.max(0, vp.height - sh)
    );
    const style =
      spec.type === 'memo'
        ? {type: 'memo', color: spec.color ?? MEMO_COLOR, size: spec.size ?? MEMO_SIZE}
        : spec.type === 'index'
          ? {type: 'index', color: spec.color}
          : {type: spec.type, ref: spec.ref};
    const a = this.addAnno({
      key: `k${this.seq++}`,
      id: null,
      page: p.num,
      kind: 'stamp',
      rect: this.fromScreen(p.num, {left, top, width: sw, height: sh}),
      body: spec.body ?? '',
      style
    });
    if (spec.type === 'memo') {
      // 書いた文字が紙に収まらなければ、紙を下へ伸ばす
      const need = a.el.querySelector('.anno-stamp__text').scrollHeight + MEMO_PAD * vp.scale;
      if (need > sh) {
        a.rect = this.fromScreen(p.num, {left, top, width: sw, height: Math.min(need, vp.height - top)});
        this.place(a);
      }
    }
    this.record(a.key, null, this.snap(a));
    if (this.tool !== 'select') this.setTool('select');
    this.select(a);
    this.scheduleSave(a, 0);
    return a;
  }

  // ---- ポーチ：電卓・メモ帳（§9.9）。画面に浮かぶ小さな窓。上の帯をつかんで動かす ----
  /** 浮かぶ窓を作る。right・bottom は最初の位置（画面の右下から） */
  floatTool(cls, label, inner, {right, bottom}, onClose) {
    const el = document.createElement('div');
    el.className = `float-tool ${cls}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', label);
    el.innerHTML = `<div class="float-tool__head"><strong>${label}</strong><button type="button" class="float-tool__close" data-float-close aria-label="${label}をしまう" title="しまう">×</button></div>${inner}`;
    Object.assign(el.style, {right: `${right}px`, bottom: `${bottom}px`});
    el.querySelector('[data-float-close]').addEventListener('click', onClose);
    el.querySelector('.float-tool__head').addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left,
        dy = e.clientY - r.top;
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const w = document.documentElement.clientWidth;
        Object.assign(el.style, {
          right: '',
          bottom: '',
          left: `${Math.min(Math.max(ev.clientX - dx, 8 - r.width / 2), w - r.width / 2)}px`,
          top: `${Math.min(Math.max(ev.clientY - dy, 0), window.innerHeight - 40)}px`
        });
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    this.root.append(el);
    return el;
  }

  toggleCalc(on = !this.calc) {
    if (!on) {
      this.calc?.remove();
      this.calc = null;
    } else if (!this.calc) {
      const keys = CALC_KEYS.map(
        (k) =>
          `<button type="button" class="calc__key${/[0-9.π]/.test(k) ? ' is-num' : k === '=' ? ' is-eq' : k === 'C' || k === '⌫' ? ' is-clear' : ''}" data-calc="${k}">${k}</button>`
      ).join('');
      const el = this.floatTool(
        'calc',
        '電卓',
        `<div class="calc__screen"><div class="calc__prev" data-calc-prev aria-live="polite"></div><input class="calc__input" data-calc-input spellcheck="false" autocomplete="off" aria-label="式（キーボードでも打てます。Enter で計算）" /></div><div class="calc__keys">${keys}</div>`,
        {right: 340, bottom: 24},
        () => this.toggleCalc(false)
      );
      const input = el.querySelector('[data-calc-input]');
      const prev = el.querySelector('[data-calc-prev]');
      const run = () => {
        const expr = input.value.trim();
        if (!expr) return;
        try {
          const v = formatNumber(evaluate(expr));
          prev.textContent = `${expr} =`;
          prev.classList.remove('is-error');
          input.value = v;
        } catch (err) {
          prev.textContent = err.message;
          prev.classList.add('is-error');
        }
      };
      el.addEventListener('pointerdown', (e) => e.target.closest('[data-calc]') && e.preventDefault()); // 式の欄のカーソルを保つ
      el.addEventListener('click', (e) => {
        const k = e.target.closest('[data-calc]')?.dataset.calc;
        if (!k) return;
        if (k === '=') run();
        else if (k === 'C') {
          input.value = '';
          prev.textContent = '';
        } else if (k === '⌫') {
          const a = input.selectionStart ?? input.value.length,
            b = input.selectionEnd ?? a;
          input.setRangeText('', a === b ? Math.max(0, a - 1) : a, b, 'end');
        } else {
          const a = input.selectionStart ?? input.value.length;
          input.setRangeText(k, a, input.selectionEnd ?? a, 'end');
        }
        input.focus();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          run();
        }
      });
      this.calc = el;
      input.focus();
    }
    this.$('calc').setAttribute('aria-pressed', String(!!this.calc));
  }

  toggleMemo(on = !this.memo) {
    if (!on) {
      this.memo?.remove();
      this.memo = null;
    } else if (!this.memo) {
      const colors = MEMO_COLORS.map(
        (c) =>
          `<button type="button" class="swatch" data-memo-color="${c}" style="--swatch: ${c}" aria-pressed="${c === this.memoColor}" aria-label="紙の色 ${c}" title="紙の色"></button>`
      ).join('');
      const el = this.floatTool(
        'memo-pad',
        'メモ帳',
        `<div class="memo-pad__block">
          <div class="memo-pad__glue" data-memo-grip title="ここを持って引っぱるとちぎれます（ページの上で離すとそこに貼れます）"></div>
          <div class="memo-pad__sheet" style="--memo: ${this.memoColor}">
            <div class="memo-pad__perf" data-memo-grip title="ここを持って引っぱるとちぎれます（ページの上で離すとそこに貼れます）"></div>
            <textarea maxlength="2000" placeholder="書いてからちぎると、ページに貼れます（白紙のままちぎって、ペンで書き込むこともできます）"></textarea>
          </div>
        </div>
        <div class="memo-pad__foot"><span class="swatches">${colors}</span><button type="button" class="btn btn--small btn--primary" data-memo-tear title="いちばん上の紙をちぎって、見ているページに貼る">ちぎる</button></div>`,
        {right: 24, bottom: 160},
        () => this.toggleMemo(false)
      );
      const ta = el.querySelector('textarea');
      ta.value = this.memoDraft;
      ta.addEventListener('input', () => (this.memoDraft = ta.value));
      el.addEventListener('click', (e) => {
        const c = e.target.closest('[data-memo-color]')?.dataset.memoColor;
        if (c) {
          this.memoColor = c;
          el.querySelector('.memo-pad__sheet').style.setProperty('--memo', c);
          for (const b of el.querySelectorAll('[data-memo-color]'))
            b.setAttribute('aria-pressed', String(b.dataset.memoColor === c));
        } else if (e.target.closest('[data-memo-tear]')) this.tearMemo();
      });
      // 紙の上の帯（ミシン目・のり）を持って引っぱると、ちぎって運ぶ
      el.querySelector('.memo-pad__block').addEventListener('pointerdown', (e) => {
        if (!e.target.closest('[data-memo-grip]')) return;
        const sheet = el.querySelector('.memo-pad__sheet');
        const r = sheet.getBoundingClientRect();
        const spec = this.memoSpec();
        this.startCarry(e, spec, {
          ghost: () => this.memoGhost(sheet),
          dx: e.clientX - r.left,
          dy: Math.max(0, e.clientY - r.top),
          onLift: () => this.clearMemo(),
          onCancel: () => {
            // ページの外で離した：ちぎらずに戻す
            ta.value = this.memoDraft = spec.body;
          },
          onTap: () => ta.focus()
        });
      });
      this.memo = el;
      ta.focus();
    }
    this.$('memo').setAttribute('aria-pressed', String(!!this.memo));
  }
  // ---- 定規：ページの上に置く透明な定規。ドラッグで動かし、右の端のつまみで回す（15° ごとに吸い付く）。ダブルクリックで水平に ----
  toggleRuler(on = !this.ruler) {
    if (!on) {
      this.ruler?.el.remove();
      this.ruler = null;
    } else if (!this.ruler) {
      const el = document.createElement('div');
      el.className = 'ruler';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', '定規');
      el.innerHTML =
        '<svg class="ruler__ticks" aria-hidden="true"></svg><span class="ruler__angle" aria-hidden="true"></span><button type="button" class="ruler__turn" title="回す（15° ごとに止まります。ダブルクリックで水平に）" aria-label="定規を回す">↻</button>';
      this.root.append(el);
      const w = document.documentElement.clientWidth;
      this.ruler = {el, cx: w / 2, cy: window.innerHeight * 0.62, angle: 0, len: 0};
      el.addEventListener('pointerdown', (e) => this.dragRuler(e));
      el.addEventListener('dblclick', () => {
        this.ruler.angle = 0;
        this.drawRuler();
      });
      this.drawRuler();
    }
    this.$('ruler').setAttribute('aria-pressed', String(!!this.ruler));
  }
  /** 目盛りと位置・向きを描く（拡大率が変わったら描き直す。目盛りはページの実寸） */
  drawRuler() {
    const r = this.ruler;
    const scale = this.pages[0]?.viewport?.scale ?? CSS_UNITS;
    const mm = (72 / 25.4) * scale;
    r.len = RULER_MM * mm + RULER_PAD * 2;
    const ticks = [];
    for (let i = 0; i <= RULER_MM; i++) {
      const x = (RULER_PAD + i * mm).toFixed(2);
      const h = i % 10 === 0 ? 14 : i % 5 === 0 ? 10 : 6;
      ticks.push(`<path d="M${x} 0V${h}"/>`);
      if (i % 10 === 0) ticks.push(`<text x="${x}" y="26">${i / 10}</text>`);
    }
    const svg = r.el.querySelector('.ruler__ticks');
    svg.setAttribute('viewBox', `0 0 ${r.len.toFixed(2)} ${RULER_H}`);
    svg.innerHTML = ticks.join('');
    Object.assign(r.el.style, {
      left: `${r.cx - r.len / 2}px`,
      top: `${r.cy - RULER_H / 2}px`,
      width: `${r.len}px`,
      height: `${RULER_H}px`,
      transform: `rotate(${r.angle}deg)`
    });
    r.el.querySelector('.ruler__angle').textContent = `${Math.round(((r.angle % 360) + 360) % 360)}°`;
  }
  dragRuler(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = this.ruler;
    const turn = !!e.target.closest('.ruler__turn');
    r.el.setPointerCapture(e.pointerId);
    r.el.classList.toggle('is-turning', turn);
    const sx = e.clientX - r.cx,
      sy = e.clientY - r.cy;
    const move = (ev) => {
      if (turn) {
        let a = (Math.atan2(ev.clientY - r.cy, ev.clientX - r.cx) * 180) / Math.PI;
        const near = Math.round(a / 15) * 15;
        if (Math.abs(a - near) < 3) a = near; // 15° ごとに吸い付く
        r.angle = a;
      } else {
        r.cx = ev.clientX - sx;
        r.cy = ev.clientY - sy;
      }
      this.drawRuler();
    };
    const up = () => {
      r.el.classList.remove('is-turning');
      r.el.removeEventListener('pointermove', move);
      r.el.removeEventListener('pointerup', up);
      r.el.removeEventListener('pointercancel', up);
    };
    r.el.addEventListener('pointermove', move);
    r.el.addEventListener('pointerup', up);
    r.el.addEventListener('pointercancel', up);
  }
  /**
   * 画面の点が定規のふちのすぐ外（RULER_SNAP 以内）なら、そのふちの線（点と向き）。なければ null。
   * 定規の向き u、ふちの外向き n。ふちの長さの範囲（少しはみ出しても可）だけ
   */
  rulerEdgeAt(x, y) {
    const r = this.ruler;
    if (!r) return null;
    const a = (r.angle * Math.PI) / 180;
    const u = [Math.cos(a), Math.sin(a)],
      n = [-Math.sin(a), Math.cos(a)];
    const dx = x - r.cx,
      dy = y - r.cy;
    const t = dx * u[0] + dy * u[1],
      s = dx * n[0] + dy * n[1];
    if (Math.abs(t) > r.len / 2 + 8) return null;
    const out = Math.abs(s) - RULER_H / 2;
    if (out < -2 || out > RULER_SNAP) return null;
    const side = Math.sign(s) || 1;
    return {x: r.cx + n[0] * side * (RULER_H / 2), y: r.cy + n[1] * side * (RULER_H / 2), u};
  }
  /** 書いている線が定規に沿うとき、点をふちの線の上へ移す */
  onRule(d, x, y) {
    const e = d.rule;
    if (!e) return [x, y];
    const t = (x - e.x) * e.u[0] + (y - e.y) * e.u[1];
    return [e.x + e.u[0] * t, e.y + e.u[1] * t];
  }

  // ---- 付箋（インデックス）：色を押すと、見ているページの右の端の空いている所に貼る。ドラッグすると離した高さに ----
  toggleIndexPad(on = !this.indexPad) {
    if (!on) {
      this.indexPad?.remove();
      this.indexPad = null;
    } else if (!this.indexPad) {
      this.indexColor ??= INDEX_COLORS[0];
      const colors = INDEX_COLORS.map(
        (c) =>
          `<button type="button" class="index-pad__color" data-index-color="${c}" style="--index: ${c}" title="この色の付箋を貼る（ドラッグすると好きな高さに）" aria-label="付箋を貼る ${c}"></button>`
      ).join('');
      const el = this.floatTool(
        'index-pad',
        '付箋',
        `<label class="index-pad__label">書く言葉（なくても可）<input type="text" maxlength="12" data-index-label placeholder="例：第3章・試験範囲" /></label>
        <div class="index-pad__colors">${colors}</div>
        <p class="index-pad__hint">色を押すと、見ているページの右の端に貼れます。貼った付箋は上下に動かせます</p>
        <div class="index-pad__list" data-index-list></div>`,
        {right: 24, bottom: 160},
        () => this.toggleIndexPad(false)
      );
      el.addEventListener('pointerdown', (e) => {
        const b = e.target.closest('[data-index-color]');
        if (b)
          this.startCarry(e, this.indexSpec(b.dataset.indexColor), {
            ghost: () => this.indexGhost(b.dataset.indexColor)
          });
      });
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-index-color]');
        if (b && e.detail === 0) this.placeStamp(this.indexSpec(b.dataset.indexColor)); // キーボード
        const go = e.target.closest('[data-index-go]');
        if (go) {
          const a = this.annos.get(go.dataset.indexGo);
          if (a) {
            this.jumpTo({
              page: a.page,
              y: Math.max(0, parseFloat(a.el.style.top) / this.pages[a.page - 1].el.offsetHeight - 0.1)
            });
            this.select(a);
          }
        }
      });
      this.indexPad = el;
      this.renderIndexList();
    }
    this.$('index').setAttribute('aria-pressed', String(!!this.indexPad));
  }
  indexSpec(color) {
    const label = (this.indexPad?.querySelector('[data-index-label]').value ?? '').trim().slice(0, 12);
    return {type: 'index', color, body: label, w: INDEX_W, h: INDEX_H};
  }
  indexGhost(color) {
    const scale = this.pages[0]?.viewport?.scale ?? 1;
    const g = document.createElement('div');
    g.className = 'index-ghost';
    g.style.setProperty('--index', color);
    Object.assign(g.style, {width: `${INDEX_W * scale}px`, height: `${INDEX_H * scale}px`});
    return g;
  }
  /** ページの右の端で、上から見て最初に空いている高さ（画面の px） */
  indexSlot(p) {
    const s = p.viewport.scale;
    const h = INDEX_H * s,
      step = (INDEX_H + INDEX_GAP) * s;
    const taken = [...this.annos.values()]
      .filter((a) => a.page === p.num && a.kind === 'stamp' && a.style.type === 'index' && !a.removed)
      .map((a) => parseFloat(a.el.style.top));
    for (let y = 36 * s; y + h <= p.viewport.height; y += step) if (!taken.some((t) => Math.abs(t - y) < h)) return y;
    return 36 * s;
  }
  /** 貼った付箋の一覧（押すとその場所へ） */
  renderIndexList() {
    const list = [...this.annos.values()]
      .filter((a) => a.kind === 'stamp' && a.style.type === 'index' && !a.removed)
      .sort((a, b) => a.page - b.page || parseFloat(a.el.style.top) - parseFloat(b.el.style.top));
    this.indexPad.querySelector('[data-index-list]').innerHTML = list.length
      ? `<strong>貼った付箋</strong>${list
          .map(
            (a) =>
              `<button type="button" class="index-pad__item" data-index-go="${a.key}"><span class="index-pad__chip" style="--index: ${a.style.color}"></span>${esc(a.body || '（言葉なし）')}<span class="muted">${a.page} ページ</span></button>`
          )
          .join('')}`
      : '';
  }

  // ---- タイマー：時間を選んで「開始」。時間になると音を鳴らして知らせる。窓をしまっても動き続け、ポーチに残りを出す ----
  toggleTimer(on = !this.timerEl, {stop = false} = {}) {
    if (!on) {
      this.timerEl?.remove();
      this.timerEl = null;
      if (stop) {
        this.stopTick();
        this.timer = null;
      }
    } else if (!this.timerEl) {
      this.timer ??= newTimer(TIMER_PRESETS[2] * 60000);
      const presets = TIMER_PRESETS.map(
        (m) => `<button type="button" class="timer__preset" data-timer-min="${m}">${m} 分</button>`
      ).join('');
      const el = this.floatTool(
        'timer',
        'タイマー',
        `<div class="timer__face"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="timer__track"/><circle cx="60" cy="60" r="52" class="timer__ring" data-timer-ring pathLength="1"/></svg><output class="timer__clock" data-timer-clock aria-live="off"></output></div>
        <div class="timer__presets">${presets}<label class="timer__custom"><input type="number" min="1" max="180" data-timer-custom aria-label="分を入れる" placeholder="分" /></label></div>
        <div class="timer__foot"><button type="button" class="btn btn--small" data-timer-reset>リセット</button><button type="button" class="btn btn--small btn--primary" data-timer-go></button></div>`,
        {right: 300, bottom: 24},
        () => this.toggleTimer(false)
      );
      el.addEventListener('click', (e) => {
        const m = e.target.closest('[data-timer-min]')?.dataset.timerMin;
        if (m) this.setTimer(Number(m));
        else if (e.target.closest('[data-timer-go]'))
          this.timer = isRunning(this.timer) ? pauseTimer(this.timer, Date.now()) : startTimer(this.timer, Date.now());
        else if (e.target.closest('[data-timer-reset]')) this.timer = newTimer(this.timer.total);
        else return;
        this.tickTimer();
      });
      el.querySelector('[data-timer-custom]').addEventListener('change', (e) => {
        const m = clampMinutes(e.target.value);
        if (m) this.setTimer(m);
        e.target.value = '';
        this.tickTimer();
      });
      this.timerEl = el;
      this.tickTimer();
    }
    this.$('timer').setAttribute('aria-pressed', String(!!this.timerEl));
    if (stop || !this.timerEl) this.tickTimer();
  }
  setTimer(min) {
    this.timer = newTimer(min * 60000);
  }
  stopTick() {
    clearInterval(this.timerTick);
    this.timerTick = 0;
  }
  /** 表示を今の残りに合わせる。時間になったら鳴らす */
  tickTimer() {
    const t = this.timer;
    const badge = this.$('timer-badge');
    if (!t) {
      if (badge) badge.hidden = true;
      return this.stopTick();
    }
    const now = Date.now();
    if (isDone(t, now)) {
      this.timer = newTimer(t.total);
      this.timer.left = 0;
      this.chime();
      toast('タイマー：時間です');
      this.timerEl?.classList.add('is-done');
      setTimeout(() => this.timerEl?.classList.remove('is-done'), 2400);
    }
    const cur = this.timer;
    const left = timerLeft(cur, now);
    const running = isRunning(cur);
    if (badge) {
      badge.hidden = !running || !!this.timerEl;
      badge.textContent = formatClock(left);
    }
    // 動いている間か窓を出している間だけ、0.25 秒ごとに描き直す
    if (!running && !this.timerEl) return this.stopTick();
    if (!this.timerTick) this.timerTick = setInterval(() => this.tickTimer(), 250);
    const el = this.timerEl;
    if (!el) return;
    el.querySelector('[data-timer-clock]').textContent = formatClock(left);
    el.querySelector('[data-timer-ring]').style.strokeDashoffset = String(1 - left / cur.total);
    el.querySelector('[data-timer-go]').textContent = running
      ? '一時停止'
      : left < cur.total && left > 0
        ? '再開'
        : '開始';
    for (const b of el.querySelectorAll('[data-timer-min]'))
      b.setAttribute('aria-pressed', String(Number(b.dataset.timerMin) * 60000 === cur.total));
    el.classList.toggle('is-running', running);
  }
  /** 時間になった音（短く 3 回） */
  chime() {
    try {
      const ctx = new window.AudioContext();
      for (let i = 0; i < 3; i++) {
        const o = ctx.createOscillator(),
          g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.35);
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.35 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.35 + 0.25);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.35);
        o.stop(ctx.currentTime + i * 0.35 + 0.26);
      }
      setTimeout(() => ctx.close(), 1500);
    } catch {
      // 音を出せない環境では知らせだけ
    }
  }

  /** いまメモ帳に書いてある紙の中身（貼るもの） */
  memoSpec() {
    const body = (this.memo?.querySelector('textarea').value ?? '').replace(/\s+$/, '');
    return {type: 'memo', body, color: this.memoColor, size: MEMO_SIZE, w: MEMO_PT, h: MEMO_PT};
  }
  /** ちぎった紙の影（いまの紙の写し。上の辺はぎざぎざ） */
  memoGhost(sheet) {
    const r = sheet.getBoundingClientRect();
    const g = document.createElement('div');
    g.className = 'memo-ghost';
    g.style.setProperty('--memo', this.memoColor);
    Object.assign(g.style, {left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`});
    g.style.clipPath = tearClip(r.width, 4, 10);
    g.textContent = this.memo?.querySelector('textarea').value ?? '';
    return g;
  }
  /** 新しい紙にする（ちぎったあと） */
  clearMemo() {
    if (!this.memo) return;
    const ta = this.memo.querySelector('textarea');
    ta.value = this.memoDraft = '';
    const sheet = this.memo.querySelector('.memo-pad__sheet');
    sheet.classList.remove('is-fresh');
    void sheet.offsetWidth;
    sheet.classList.add('is-fresh');
  }
  /** 「ちぎる」：いちばん上の紙をちぎって、見ているページに貼る（紙が飛んでいって貼られる） */
  tearMemo() {
    if (!this.memo) return;
    const sheet = this.memo.querySelector('.memo-pad__sheet');
    const spec = this.memoSpec();
    const ghost = this.memoGhost(sheet);
    ghost.classList.add('carry-ghost');
    this.root.append(ghost);
    const from = ghost.getBoundingClientRect();
    this.clearMemo();
    const a = this.placeStamp(spec);
    if (!a || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return ghost.remove();
    a.el.style.visibility = 'hidden';
    const to = a.el.getBoundingClientRect();
    ghost
      .animate(
        [
          {transform: 'none'},
          {transform: 'translate(6px, -16px) rotate(-5deg)', offset: 0.3},
          {
            transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`
          }
        ],
        {duration: 560, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)'}
      )
      .finished.catch(() => {})
      .finally(() => {
        ghost.remove();
        a.el.style.visibility = '';
      });
  }

  bindCase() {
    const panel = this.$('case-panel');
    this.on(panel, 'click', (e) => {
      const item = e.target.closest('[data-case-item]');
      if (item) {
        this.openCase(false);
        return void this.putInCase(item.dataset.caseItem, Number(panel.dataset.at ?? 0));
      }
      if (e.target.closest('[data-case-go]')) {
        this.openCase(false);
        navigate('/fudebako');
      }
    });
    this.on(document, 'pointerdown', (e) => {
      if (!panel.hidden && !e.target.closest('.fude-side__swap')) this.openCase(false);
    });
  }

  /** 選んだ注釈に書式を当てる。何も選んでいなければ次に置く注釈の書式にする */
  setTextStyle(patch, record = true) {
    const a = this.selected;
    if (a?.kind === 'text') {
      const before = this.snap(a);
      Object.assign(a.style, patch);
      this.applyStyle(a);
      this.place(a);
      if (this.editing !== a) {
        this.measure(a);
        if (record) this.record(a.key, before, this.snap(a));
        this.scheduleSave(a);
      }
    }
    Object.assign(this.textStyle, patch);
    this.rememberTextStyle();
    this.updateBar();
  }

  /** 文字入れの書式を覚える（少し待ってまとめて。この PDF と同じ授業の次の PDF の初期値になる） */
  rememberTextStyle() {
    clearTimeout(this.textStyleTimer);
    this.textStyleTimer = setTimeout(() => {
      api['pdf.textStyle']({materialId: this.materialId, style: {...this.textStyle}}).catch(() => {});
    }, 500);
  }

  setNoteColor(color, record = true) {
    const a = this.selected;
    if (a?.kind === 'note') {
      const before = this.snap(a);
      a.style.color = color;
      if (record) this.record(a.key, before, this.snap(a));
      this.applyStyle(a);
      this.scheduleSave(a);
    }
    this.noteColor = color;
    this.updateBar();
  }

  updateBar() {
    const a = this.selected;
    const textOn = this.tool === 'text' || a?.kind === 'text';
    const noteOn = this.tool === 'note' || a?.kind === 'note';
    this.root.querySelector('[data-group="text"]').hidden = !textOn;
    this.root.querySelector('[data-group="note"]').hidden = !noteOn;
    const ts = a?.kind === 'text' ? a.style : this.textStyle;
    const size = this.$('size');
    if (document.activeElement !== size) size.value = String(ts.size);
    this.$('bold').setAttribute('aria-pressed', String(ts.bold));
    for (const b of this.root.querySelectorAll('[data-text-color]'))
      b.setAttribute('aria-pressed', String(b.dataset.textColor === ts.color));
    this.$('text-custom').value = ts.color;
    const nc = a?.kind === 'note' ? a.style.color : this.noteColor;
    for (const b of this.root.querySelectorAll('[data-note-color]'))
      b.setAttribute('aria-pressed', String(b.dataset.noteColor === nc));
    this.$('note-custom').value = nc;
    // 多機能ペンを持っているとき：芯の切り替え
    const rg = this.root.querySelector('[data-group="refill"]');
    const multi = this.tool === 'ink' && this.penItem?.refills ? this.penItem : null;
    rg.hidden = !multi;
    if (multi) {
      const cur = multi.refill?.id;
      const html =
        `<span class="viewer-bar__refills-name">${esc(multi.name)}</span>` +
        multi.refills
          .map(
            (r) =>
              `<button type="button" class="viewer-bar__refill" data-refill="${r.id}" aria-pressed="${r.id === cur}" style="--swatch: ${r.color}" title="${esc(r.name)} ${r.mm} mm">${esc(r.name)}</button>`
          )
          .join('');
      if (rg.innerHTML !== html) rg.innerHTML = html;
    }
    this.$('delete').hidden = !a; // 選んでいるときだけ出す（ツールバーを 1 行に収める）
  }

  bindBar() {
    const bar = this.root.querySelector('.viewer-bar');
    // ツールバーは窓に固定なので、ページの上にツールバーの高さ（2 行に折り返したときも）＋余白を空ける
    this.barObserver = new ResizeObserver(() => {
      const top = this.pagesEl.parentElement.getBoundingClientRect().top + window.scrollY; // ページの並びの親の上端（紙の上の余白の下）
      this.pagesEl.style.marginTop = `${Math.max(0, bar.offsetHeight + 24 - top)}px`;
    });
    this.barObserver.observe(bar);
    // ツールバーを押しても文字入れの編集を終わらせない（書式を変えながら打てるように）
    this.on(bar, 'pointerdown', (e) => {
      // 文字入れの編集中・メモの本文を打っている間は、ツールバーを押してもフォーカスを奪わない（続けて打てる）
      const inNote = document.activeElement?.closest?.('.anno-note__pop');
      if ((this.editing || inNote) && e.target.closest('button, .swatch')) e.preventDefault();
    });
    // 四隅の上の 2 つ（筆箱・シール帳）が見えている場所：ツールバーの下から
    this.sideObserver = new ResizeObserver(() =>
      this.root.style.setProperty('--corner-top', `${bar.getBoundingClientRect().bottom + 16}px`)
    );
    this.sideObserver.observe(bar);
    const onClick = (e) => {
      const t = e.target.closest('button');
      if (!t || t.closest('.case-panel')) return;
      const fromSide = !!t.closest('.fude-side');
      if (t.dataset.cornerTab) return this.openCorner(t.dataset.cornerTab);
      // シール帳・素材の 1 つ：押す・ドラッグは startCarry が受ける。ここに来るのはキーボード（Enter・Space）のとき
      if (t.dataset.seal || t.dataset.figure) return e.detail === 0 && this.placeStamp(this.itemSpec(t));
      if (t.dataset.sealTab) return this.renderSeal(t.dataset.sealTab);
      if (t.dataset.sozaiTab) return this.renderSozai(t.dataset.sozaiTab);
      // ポーチから出したら、少し見せてからしまう（筆箱のペンと同じ）
      const POUCH = {
        calc: () => this.toggleCalc(),
        memo: () => this.toggleMemo(),
        ruler: () => this.toggleRuler(),
        index: () => this.toggleIndexPad(),
        timer: () => this.toggleTimer()
      };
      if (POUCH[t.dataset.v]) {
        POUCH[t.dataset.v]();
        return this.tuckSoon();
      }
      if (t.dataset.tool) this.setTool(t.dataset.tool);
      else if (t.dataset.refill) this.pickRefill(t.dataset.refill);
      else if (t.dataset.slot !== undefined) this.useSlot(Number(t.dataset.slot));
      else if (t.dataset.v === 'case') this.openCase(this.$('case-panel').hidden);
      else if (t.dataset.textColor) this.setTextStyle({color: t.dataset.textColor});
      else if (t.dataset.noteColor) this.setNoteColor(t.dataset.noteColor);
      else if (t.dataset.v === 'bold')
        this.setTextStyle({bold: !(this.selected?.kind === 'text' ? this.selected.style : this.textStyle).bold});
      else if (t.dataset.v === 'delete' && this.selected) this.removeAnno(this.selected);
      else if (t.dataset.v === 'zoom-in') this.zoomStep('in');
      else if (t.dataset.v === 'zoom-out') this.zoomStep('out');
      else if (t.dataset.v === 'fit') this.setZoom(this.fitZoom());
      else if (t.dataset.v === 'back') this.onBack();
      else if (t.dataset.v === 'bookmarks') this.openBookmarks(this.$('bookmark-panel').hidden);
      else if (t.dataset.v === 'bookmark-add') this.addBookmark();
      else if (t.dataset.v === 'undo') this.undo();
      else if (t.dataset.v === 'redo') this.redo();
      else if (t.dataset.v === 'sheet') {
        this.toggleSheet();
        this.tuckSoon();
      } else if (t.dataset.v === 'status') this.failed && this.retrySaves();
      else if (t.dataset.v === 'export') this.openExport();
      else if (t.dataset.v === 'help') this.openHelp(this.$('help-panel').hidden);
      // 筆箱からペン（消しゴム）を持ったら、少し見せてから画面の外へしまう
      if (fromSide && (t.dataset.slot !== undefined || t.dataset.tool === 'eraser')) this.tuckSoon();
    };
    this.on(bar, 'click', onClick);
    for (const el of this.root.querySelectorAll('[data-corner]')) {
      this.on(el, 'click', onClick);
      this.on(el, 'pointerdown', (e) => {
        if (this.editing && e.target.closest('button')) e.preventDefault();
      });
    }
    // ページ番号を入れて移る。スクロールしたら今のページを出す
    const page = this.$('page');
    const goPage = () => {
      const n = Math.min(this.pages.length, Math.max(1, Math.round(Number(page.value) || 1)));
      page.value = String(n);
      this.jumpTo({page: n, y: 0});
    };
    this.on(page, 'change', goPage);
    this.on(page, 'keydown', (e) => e.key === 'Enter' && goPage());
    this.on(window, 'scroll', () => this.showPage(), {passive: true});
    const size = this.$('size');
    this.on(size, 'change', () => {
      const v = clampSize(size.value);
      size.value = String(v);
      this.setTextStyle({size: v});
    });
    // 色の選び皿は動かしている間ずっと input が来るので、選び終わり（change）で 1 手にまとめる
    const pickStart = () => {
      if (!this.pick && this.selected && this.editing !== this.selected)
        this.pick = {key: this.selected.key, before: this.snap(this.selected)};
    };
    const pickEnd = () => {
      const pk = this.pick;
      this.pick = null;
      if (pk) this.record(pk.key, pk.before, this.snap(this.annos.get(pk.key)));
    };
    this.on(this.$('text-custom'), 'input', (e) => {
      pickStart();
      this.setTextStyle({color: e.target.value.toLowerCase()}, false);
    });
    this.on(this.$('note-custom'), 'input', (e) => {
      pickStart();
      this.setNoteColor(e.target.value.toLowerCase(), false);
    });
    this.on(this.$('text-custom'), 'change', pickEnd);
    this.on(this.$('note-custom'), 'change', pickEnd);
    const dialog = this.$('export-dialog');
    this.on(dialog, 'close', () => {
      if (dialog.returnValue === 'ok') {
        const f = dialog.querySelector('form');
        this.exportPdf({markers: f.markers.value, notes: f.notes.checked});
      }
    });
  }

  bindPages() {
    const el = this.pagesEl;
    this.on(window, 'wheel', (e) => this.onWheel(e), {passive: false});
    this.on(el, 'pointerdown', (e) => this.onPointerDown(e));
    this.on(el, 'pointermove', (e) => this.onPointerMove(e));
    this.on(el, 'pointerup', (e) => this.onPointerUp(e));
    this.on(el, 'pointercancel', (e) => {
      if ([this.drawing, this.drag, this.tap, this.pan].some((t) => t?.pointer === e.pointerId)) this.cancelPointer();
    });
    // 画面に触れている指（ページの外で離したときも数え落とさないよう window で受ける）
    this.touchIds = new Set();
    const lift = (e) => this.touchIds.delete(e.pointerId);
    this.on(window, 'pointerup', lift);
    this.on(window, 'pointercancel', lift);
    this.on(el, 'touchstart', (e) => this.onTouchStart(e), {passive: false});
    this.on(el, 'touchmove', (e) => this.onTouchMove(e), {passive: false});
    this.on(el, 'touchend', (e) => this.onTouchEnd(e));
    this.on(el, 'touchcancel', (e) => this.onTouchEnd(e));
    this.on(el, 'dblclick', (e) => {
      const a = this.annoOf(e.target);
      if (a?.kind === 'text') this.edit(a);
    });
    this.on(el, 'click', (e) => {
      const btn = e.target.closest('[data-note]');
      const a = btn && this.annoOf(btn);
      if (!a) return;
      if (btn.dataset.note === 'delete') this.removeAnno(a);
      else if (btn.dataset.note === 'clear-ink') {
        const before = this.snap(a);
        a.style = {...a.style};
        delete a.style.ink;
        this.applyNotePop(a);
        this.record(a.key, before, this.snap(a));
        this.scheduleSave(a, 0);
      } else this.openNote(a, false);
    });
    this.on(document, 'keydown', (e) => this.onKey(e));
    // Tab で注釈にフォーカスが来たら、押したときと同じく選ぶ（メモは中のアイコンのボタンに来る）
    this.on(el, 'focusin', (e) => {
      const a = this.annoOf(e.target);
      if (a && a !== this.editing) this.select(a);
    });
    this.on(window, 'beforeunload', () => this.flushAll());
    this.on(window, 'scroll', () => this.sheet && this.syncCovers(), {passive: true});
  }

  annoOf(target) {
    const el = target.closest?.('[data-key]');
    return el ? this.annos.get(el.dataset.key) : null;
  }

  onPointerDown(e) {
    if (e.pointerType === 'touch') {
      this.touchIds.add(e.pointerId);
      // 2 本目の指は書き込みに使わない（ピンチ）。1 本目で始めたことも取りやめる（ペンで書いている間の手のひらは無視）
      if (this.drawing?.byPen) return;
      if (this.touchIds.size > 1) return this.cancelPointer();
    }
    if (e.pointerType === 'pen' && !this.penSeen) {
      this.penSeen = true;
      this.pagesEl.dataset.pen = 'seen';
    }
    if (e.target.closest('.bookmark-ribbon')) return; // しおりのリボンは押しても書き込まない
    // 画面の左右の端（指・ペン）は四隅を出すなでる操作の始まり。書き始めない
    if (e.pointerType !== 'mouse' && (e.clientX >= document.documentElement.clientWidth - 24 || e.clientX <= 24))
      return;
    // ペンの消しゴムの側（スタイラスの後ろ・消しゴムのボタン）は、どの道具のときも消しゴム
    const penEraser = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
    if (penEraser || DRAW_TOOLS.includes(this.tool)) return this.startDraw(e, penEraser);
    if (e.button !== 0) return;
    if (e.target.closest('.anno-note__pop')) return; // メモの本文は普通に打てる
    let a = this.annoOf(e.target);
    // 貼りもの（図・シール・紙）は下敷き：選択の道具のときだけ選んで動かす。ほかの道具では上に文字・メモ・文字隠しを置く
    if (a?.kind === 'stamp' && this.tool !== 'select') a = null;
    if (this.editing && this.editing !== a) this.finishEdit();
    if (a) {
      if (this.editing === a) return; // 編集中の文字はカーソル移動・範囲選択
      e.preventDefault();
      this.select(a);
      this.drag = {
        a,
        before: this.snap(a),
        x: e.clientX,
        y: e.clientY,
        left: parseFloat(a.el.style.left),
        top: parseFloat(a.el.style.top),
        // 貼りものの右下のつまみ：大きさを変える
        resize: a.kind === 'stamp' && !!e.target.closest('.anno-stamp__grip'),
        width: a.el.offsetWidth,
        height: a.el.offsetHeight,
        moved: false,
        pointer: e.pointerId
      };
      this.pagesEl.setPointerCapture(e.pointerId);
      return;
    }
    const pageEl = e.target.closest('.pdf-page');
    if (!pageEl) return this.select(null);
    const p = this.pages[Number(pageEl.dataset.page) - 1];
    const box = pageEl.getBoundingClientRect();
    if (this.tool === 'select') return this.select(null);
    e.preventDefault();
    if (this.tool === 'mask') return this.startMask(e, p, box);
    // 指では、離したときに置く（2 本指のピンチやスクロールの始まりで文字入れ・付箋ができないように）
    if (e.pointerType === 'touch') return void (this.tap = {pointer: e.pointerId, p, x: e.clientX, y: e.clientY});
    this.createAt(this.tool, p, e.clientX - box.left, e.clientY - box.top);
  }

  // ---- ペン・マーカー・消しゴム（§9.8）----
  startDraw(e, penEraser = false) {
    if (e.button !== 0 && !penEraser) return;
    if (e.target.closest('.anno-note__pop')) return;
    const pageEl = e.target.closest('.pdf-page');
    if (!pageEl) return;
    // ペンを使ったあとの指：書かずに、1 本指でスクロールする（手のひらが当たっても線にならない）
    if (e.pointerType === 'touch' && this.penSeen) {
      if (!this.drawing) this.pan = {pointer: e.pointerId, x: e.clientX, y: e.clientY};
      return;
    }
    e.preventDefault();
    this.finishEdit();
    this.select(null);
    this.openCase(false);
    const p = this.pages[Number(pageEl.dataset.page) - 1];
    const tool = penEraser ? 'eraser' : this.tool;
    try {
      this.pagesEl.setPointerCapture(e.pointerId); // ページの外へはみ出しても、離すまで受け取る
    } catch {
      // 指がもう離れていた（押してすぐ離した）など。受け取れる間だけ書く
    }
    const byPen = e.pointerType === 'pen';
    if (tool === 'eraser') {
      this.drawing = {kind: 'eraser', p, pointer: e.pointerId, byPen, steps: [], el: this.eraserRing()};
      return this.eraseAt(e);
    }
    if (tool === 'line') {
      this.startLine(e, p, pageEl.getBoundingClientRect());
      this.drawing.byPen = byPen;
      return;
    }
    const box = pageEl.getBoundingClientRect();
    const pressure = e.pointerType === 'pen';
    const vp = p.viewport;
    const el = document.createElementNS(SVG_NS, 'path');
    el.setAttribute('fill', this.penItem.color);
    el.classList.add('ink-draft');
    p.ink.append(el);
    // 間引き：画面で 0.3px より近い点は捨てる。なめらかさ：ペンは控えめ（遅れを小さく）、指・マウスは強め（手ぶれを抑える）
    const cap = createCapture({minGap: 0.3 / vp.scale, streamline: pressure ? 0.2 : 0.4});
    const d = (this.drawing = {
      kind: 'ink',
      p,
      el,
      cap,
      box,
      pressure,
      byPen: pressure,
      pointer: e.pointerId,
      item: this.penItem,
      sim: 0.5,
      last: null,
      extra: [],
      rule: this.rulerEdgeAt(e.clientX, e.clientY) // 定規のふちのすぐ外から書き始めたら、ふちに沿わせる
    });
    this.addInkPoint(d, e);
    this.drawInk();
  }

  /** 画面の点 → PDF の点と筆圧。筆圧の取れない道具では動く速さから作る */
  inkPoint(d, ev) {
    const [cx, cy] = this.onRule(d, ev.clientX, ev.clientY);
    const [x, y] = d.p.viewport.convertToPdfPoint(cx - d.box.left, cy - d.box.top);
    let pr;
    if (d.pressure) pr = ev.pressure > 0 ? ev.pressure : 0.5;
    else {
      const t = ev.timeStamp;
      if (d.last) {
        const dt = Math.max(1, t - d.last.t);
        d.sim = speedPressure(d.sim, Math.hypot(x - d.last.x, y - d.last.y) / dt);
      }
      d.last = {x, y, t};
      pr = d.sim;
    }
    return [x, y, pr];
  }
  addInkPoint(d, e) {
    // 間の点（画面の描き直しより細かく来る点）もすべて使う。線がかくかくしない
    const evs = e.getCoalescedEvents?.() ?? [];
    for (const ev of evs.length ? evs : [e]) {
      const [x, y, pr] = this.inkPoint(d, ev);
      if (!d.cap.add(x, y, pr) && d.cap.points.length >= 5000) return this.finishInk(e);
    }
    // この先に来そうな点（予測）。線の先が指・ペンに遅れて見えないように、下書きにだけ足す
    d.extra = (e.getPredictedEvents?.() ?? []).slice(0, 2).map((ev) => {
      const [cx, cy] = this.onRule(d, ev.clientX, ev.clientY);
      const [x, y] = d.p.viewport.convertToPdfPoint(cx - d.box.left, cy - d.box.top);
      return [x, y, d.cap.points.at(-1)?.[2] ?? 0.5];
    });
  }
  drawInk() {
    if (this.inkFrame) return;
    this.inkFrame = requestAnimationFrame(() => {
      this.inkFrame = 0;
      const d = this.drawing;
      if (d?.kind !== 'ink') return;
      d.el.setAttribute('d', strokePath([...d.cap.points, ...d.extra], d.item.width, {pressure: d.pressure}));
    });
  }
  finishInk(e) {
    const d = this.drawing;
    this.drawing = null;
    cancelAnimationFrame(this.inkFrame);
    this.inkFrame = 0;
    d.el.remove();
    const [x, y, pr] = this.inkPoint(d, e);
    const points = d.cap.finish(x, y, pr);
    if (!points.length) return;
    const style = {color: d.item.color, width: d.item.width, ...(d.pressure ? {} : {pressure: false})};
    const a = this.addAnno({
      key: `k${this.seq++}`,
      id: null,
      page: d.p.num,
      kind: 'ink',
      rect: boundsOf(points, d.item.width),
      body: encodePoints(points),
      style
    });
    this.record(a.key, null, this.snap(a));
    this.scheduleSave(a, 0);
  }

  // マーカー（アンダーライン）：なぞった横の範囲に、文字の行の下へまっすぐな線を引く。文字のない所では、なぞった高さに引く
  startLine(e, p, box) {
    p.textPromise ??= this.textItems(p);
    const el = document.createElement('div');
    el.className = 'anno-line anno-line--draft';
    el.style.setProperty('--line', this.penItem.color);
    p.layer.append(el);
    const x = e.clientX - box.left,
      y = e.clientY - box.top;
    const d = (this.drawing = {
      kind: 'line',
      p,
      el,
      box,
      item: this.penItem,
      x0: x,
      y0: y,
      x1: x,
      y1: y,
      pointer: e.pointerId,
      line: null
    });
    p.textPromise
      .then((raw) => {
        const onLine = this.screenItems(p, raw).filter((it) => y >= it.hitTop && y <= it.hitBottom);
        if (!onLine.length || this.drawing !== d) return;
        d.line = lineOf(onLine);
        this.drawLineDraft();
      })
      .catch(() => {});
    this.drawLineDraft();
  }
  /** マーカーの線の箱（ページの中の px）。文字の行の上なら字の下端に、そうでなければなぞり始めの高さに */
  lineBox(d, x1 = Math.min(d.x0, d.x1), x2 = Math.max(d.x0, d.x1)) {
    const h = Math.max(2, d.item.width * d.p.viewport.scale);
    const mid = d.line ? d.line.bottom : d.y0;
    return {left: x1, top: mid - h / 2, width: x2 - x1, height: h};
  }
  drawLineDraft() {
    const d = this.drawing;
    const b = this.lineBox(d);
    Object.assign(d.el.style, {left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`});
  }
  async finishLine() {
    const d = this.drawing;
    this.drawing = null;
    d.el.remove();
    let x1 = Math.min(d.x0, d.x1),
      x2 = Math.max(d.x0, d.x1);
    if (x2 - x1 < 3) return;
    const raw = await d.p.textPromise.catch(() => []);
    if (this.destroyed) return;
    // 文字の行の上なら、端を字の切れ目に合わせる（字の途中で切らない）
    const onLine = this.screenItems(d.p, raw).filter((it) => d.y0 >= it.hitTop && d.y0 <= it.hitBottom);
    if (onLine.length) {
      d.line = lineOf(onLine);
      const hit = onLine.filter((it) => it.left < x2 && it.right > x1);
      const snapped = hit.length && snapRange(hit, x1, x2, this.measureChar);
      if (snapped) {
        x1 = snapped.left;
        x2 = snapped.right;
      }
    }
    const a = this.addAnno({
      key: `k${this.seq++}`,
      id: null,
      page: d.p.num,
      kind: 'line',
      rect: this.fromScreen(d.p.num, this.lineBox(d, x1, x2)),
      body: '',
      style: {color: d.item.color, width: d.item.width}
    });
    this.record(a.key, null, this.snap(a));
    this.scheduleSave(a, 0);
  }

  // 消しゴム：なぞったところに触れたペンの線・マーカー・文字隠しを消す。ひとなぞりで消したものは 1 手で取り消せる
  eraserRing() {
    this.ring ??= Object.assign(document.createElement('div'), {className: 'eraser-ring'});
    this.ring.style.setProperty('--r', `${ERASER_PX}px`);
    if (!this.ring.isConnected) this.root.append(this.ring);
    return this.ring;
  }
  moveRing(e) {
    const ring = this.eraserRing();
    ring.style.left = `${e.clientX}px`;
    ring.style.top = `${e.clientY}px`;
  }
  eraseAt(e) {
    const d = this.drawing;
    this.moveRing(e);
    const p = d.p;
    const box = p.el.getBoundingClientRect();
    const evs = e.getCoalescedEvents?.() ?? [];
    for (const ev of evs.length ? evs : [e]) {
      const sx = ev.clientX - box.left,
        sy = ev.clientY - box.top;
      const [x, y] = p.viewport.convertToPdfPoint(sx, sy);
      const r = ERASER_PX / p.viewport.scale;
      for (const a of [...this.annos.values()]) {
        if (a.page !== p.num || a.removed) continue;
        let hit = false;
        if (a.kind === 'ink') {
          const b = a.rect;
          hit =
            x >= b.x - r &&
            x <= b.x + b.w + r &&
            y >= b.y - r &&
            y <= b.y + b.h + r &&
            touchesStroke(a.points, a.style.width, x, y, r);
        } else if (a.kind === 'line' || a.kind === 'mask') {
          const s = this.toScreen(a.page, a.rect);
          const nx = Math.max(s.left, Math.min(sx, s.left + s.width)),
            ny = Math.max(s.top, Math.min(sy, s.top + s.height));
          hit = Math.hypot(sx - nx, sy - ny) <= ERASER_PX;
        }
        if (!hit) continue;
        d.steps.push({key: a.key, before: this.snap(a), after: null});
        this.removeAnno(a, false);
      }
    }
  }

  // ---- 文字隠し：文字の上をなぞって水色のマーカーを引く。文字の行に高さを合わせる ----
  startMask(e, p, box) {
    this.select(null);
    p.textPromise ??= this.textItems(p);
    const el = document.createElement('div');
    el.className = 'anno-mask anno-mask--draft';
    el.style.setProperty('--mask', this.maskColor());
    p.layer.append(el);
    const x = e.clientX - box.left,
      y = e.clientY - box.top;
    const d = (this.drawing = {p, el, x0: x, y0: y, x1: x, y1: y, pointer: e.pointerId, line: null});
    // なぞっている行の高さ（文字の上下）。文字が読めたら下書きもその高さにそろえる
    p.textPromise
      .then((raw) => {
        const onLine = this.screenItems(p, raw).filter((it) => y >= it.hitTop && y <= it.hitBottom);
        if (!onLine.length || this.drawing !== d) return;
        d.line = lineOf(onLine);
        this.drawDraft();
      })
      .catch(() => {});
    this.pagesEl.setPointerCapture(e.pointerId);
    this.drawDraft();
  }

  drawDraft() {
    const d = this.drawing;
    const flat = isFlat(d, d.line); // 横になぞっている（行の高さの中なら上下に動いても）
    const h = DEFAULT_SIZE * d.p.viewport.scale;
    const top = flat ? (d.line?.top ?? d.y0 - h / 2) : Math.min(d.y0, d.y1);
    const height = flat ? (d.line ? d.line.bottom - d.line.top : h) : Math.abs(d.y1 - d.y0);
    Object.assign(d.el.style, {
      left: `${Math.min(d.x0, d.x1)}px`,
      top: `${top}px`,
      width: `${Math.abs(d.x1 - d.x0)}px`,
      height: `${height}px`
    });
  }

  /**
   * マーカーの箱（ページの中の px）を、描かれた字に合わせて直す（text-snap.js の fitToInk）。
   * 字の幅は見積もりなので、そのままだと字の右や左が少し見えることがある。ページの絵がまだなければそのまま
   */
  fitMask(p, box, fh, edges = null) {
    const c = p.canvas;
    if (!c?.width) return box;
    const k = c.width / p.viewport.width; // ページの px → canvas の画素
    const m = fh; // 調べる範囲の余白
    const x0 = Math.max(0, box.left - m),
      y0 = Math.max(0, box.top - m);
    const x1 = Math.min(p.viewport.width, box.left + box.width + m),
      y1 = Math.min(p.viewport.height, box.top + box.height + m);
    let img;
    try {
      img = c
        .getContext('2d')
        .getImageData(Math.floor(x0 * k), Math.floor(y0 * k), Math.ceil((x1 - x0) * k), Math.ceil((y1 - y0) * k));
    } catch {
      return box;
    }
    const ink = inkFromImage(img, {x0: Math.floor(x0 * k) / k, y0: Math.floor(y0 * k) / k, scale: k});
    if (!ink) return box;
    const r = fitToInk({left: box.left, right: box.left + box.width, top: box.top, bottom: box.top + box.height}, ink, {
      fh,
      step: 1 / k,
      edges
    });
    return {left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top};
  }

  /** 字の相対的な幅（全角・半角の違い）。文字列の幅を字ごとに分けるのに使う（text-snap.js） */
  measureChar = (ch) => {
    const ctx = (this.measureCtx ??= document.createElement('canvas').getContext('2d'));
    ctx.font = `100px ${FONT}`;
    return ctx.measureText(ch).width;
  };

  /**
   * ページの文字列（pdf.js の textContent。画面の座標へは finishMask で直す）。
   * 文字列には全体の幅しかないので、PDF に書かれた字ごとの送り幅（描く命令の字形の幅）を ws に添える。
   * MS P ゴシックのような字ごとに幅の違うフォントでも、字の切れ目が描かれた字とそろう（text-snap.js の charEdges）
   */
  async textItems(p) {
    const [tc, widths] = await Promise.all([p.page.getTextContent(), this.glyphWidths(p.page).catch(() => null)]);
    return tc.items
      .filter((it) => it.str && it.width > 0)
      .map((it) => ({...it, ws: widths && Array.from(it.str, (ch) => widths.get(`${it.fontName}|${ch}`) ?? null)}));
  }

  /** フォントと字ごとの送り幅（1 em = 1000）。描く命令（operator list）の字形から集める */
  async glyphWidths(page) {
    const ops = await page.getOperatorList();
    const out = new Map();
    let font = null;
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === pdfjs.OPS.setFont) font = ops.argsArray[i][0];
      else if (ops.fnArray[i] === pdfjs.OPS.showText)
        for (const g of ops.argsArray[i][0])
          if (g?.unicode && g.width > 0 && !out.has(`${font}|${g.unicode}`)) out.set(`${font}|${g.unicode}`, g.width);
    }
    return out;
  }

  /** 文字列の画面での箱。画面で横書きに見えるものだけ（回転したページでも、見た目が横書きなら使う） */
  screenItems(p, items) {
    const vp = p.viewport;
    return items
      .map((it) => {
        const m = pdfjs.Util.transform(vp.transform, it.transform);
        const run = Math.hypot(m[0], m[1]);
        if (!run || m[0] <= 0 || Math.abs(m[1]) > run * 0.05) return null;
        const fh = Math.hypot(m[2], m[3]); // 文字の高さ（px）
        if (!fh) return null;
        // 覆う範囲は基線から上へ 0.96、下へ 0.22（字の上下をはみ出さずに覆う）。
        // その行をなぞったとみなす範囲は少し広く、基線から上へ 1.05、下へ 0.3
        return {
          str: it.str,
          ws: it.ws,
          left: m[4],
          right: m[4] + it.width * vp.scale,
          top: m[5] - fh * 0.96,
          bottom: m[5] + fh * 0.22,
          hitTop: m[5] - fh * 1.05,
          hitBottom: m[5] + fh * 0.3
        };
      })
      .filter(Boolean);
  }

  /** 今の文字隠しペンの色（筆箱の外で H を押したときなどは水色） */
  maskColor() {
    return this.penItem?.type === 'hider' ? this.penItem.color : MASK_HEX;
  }

  async finishMask() {
    const d = this.drawing;
    this.drawing = null;
    d.el.remove();
    const p = d.p;
    const raw = await p.textPromise.catch(() => []);
    if (this.destroyed) return;
    const items = this.screenItems(p, raw);
    // 画面の座標で考える（左上原点、px）
    let x1 = Math.min(d.x0, d.x1),
      x2 = Math.max(d.x0, d.x1);
    const measure = this.measureChar;
    const pieces = (list, from, to) => textIn(list, from, to, measure);
    let box, hidden;
    const onLine = items.filter((it) => d.y0 >= it.hitTop && d.y0 <= it.hitBottom);
    if (isFlat(d, onLine.length ? lineOf(onLine) : null)) {
      // 横になぞった（指が行の字の高さの中にとどまっていれば、上下に動いても）：なぞり始めの高さにある行に合わせ、
      // 左右の端は字の切れ目に合わせる（字の途中で切らない）。動かさずに押しただけ（ダブルクリックも）なら、その位置の単語を覆う
      let hit = onLine.filter((it) => it.left < x2 && it.right > x1);
      if (x2 - x1 < 2) {
        const it = onLine.find((t) => t.left <= x1 && x1 <= t.right);
        const word = it && wordAt(it, x1, measure);
        if (!word) return;
        hit = [it];
        x1 = word.left;
        x2 = word.right;
      } else if (hit.length) {
        const snapped = snapRange(hit, x1, x2, measure);
        if (snapped) {
          x1 = snapped.left;
          x2 = snapped.right;
          hit = hit.filter((it) => it.left < x2 && it.right > x1);
        }
      }
      if (hit.length) {
        const top = Math.min(...hit.map((it) => it.top));
        const bottom = Math.max(...hit.map((it) => it.bottom));
        // 見積もりの字の切れ目（同じ行の字すべて）。描かれた字のかたまりを字ごとにまとめるのに使う
        const edges = [...new Set(onLine.flatMap((it) => charEdges(it, measure)))].sort((a, b) => a - b);
        box = this.fitMask(p, {left: x1, top, width: x2 - x1, height: bottom - top}, (bottom - top) / 1.18, edges);
        hidden = pieces(hit, box.left, box.left + box.width);
      } else {
        const h = DEFAULT_SIZE * p.viewport.scale;
        box = {left: x1, top: d.y0 - h / 2, width: x2 - x1, height: h};
      }
    } else {
      // 斜め・縦になぞった：囲んだ四角そのまま
      const y1 = Math.min(d.y0, d.y1),
        y2 = Math.max(d.y0, d.y1);
      box = {left: x1, top: y1, width: x2 - x1, height: y2 - y1};
      hidden = pieces(
        items.filter((it) => {
          const mid = (it.top + it.bottom) / 2;
          return mid >= y1 && mid <= y2 && it.left < x2 && it.right > x1;
        }),
        x1,
        x2
      );
    }
    if (box.width < 2 || box.height < 2) return;
    const a = this.addAnno({
      key: `k${this.seq++}`,
      id: null,
      page: p.num,
      kind: 'mask',
      rect: this.fromScreen(p.num, box),
      body: (hidden ?? '').slice(0, 2000),
      style: this.maskColor() === MASK_HEX ? {} : {color: this.maskColor()}
    });
    this.record(a.key, null, this.snap(a));
    this.scheduleSave(a, 0);
  }

  /**
   * 赤シートとマーカーの重なりだけ、マーカーの黒い覆いを見せる（clip-path で切り抜く）。
   * 赤シートは乗算で重ねており、水色のマーカーは理屈では黒くなるが、字のふちや色によっては形が透けることがあるため、
   * 重なった部分は不透明の黒で確実に隠す。シートを動かしたとき・大きさを変えたとき・スクロールしたときに呼ぶ
   */
  syncCovers() {
    if (this.coverFrame) return;
    this.coverFrame = requestAnimationFrame(() => {
      this.coverFrame = 0;
      const sr = this.sheet?.getBoundingClientRect();
      for (const a of this.annos.values()) {
        if ((a.kind === 'text' || a.kind === 'ink') && a.el.dataset.red) {
          this.hideRed(a, sr);
          continue;
        }
        if (a.kind !== 'mask') continue;
        const cover = a.el.firstElementChild;
        const r = a.el.getBoundingClientRect();
        const left = sr ? Math.max(sr.left, r.left) - r.left : 0;
        const top = sr ? Math.max(sr.top, r.top) - r.top : 0;
        const right = sr ? r.right - Math.min(sr.right, r.right) : 0;
        const bottom = sr ? r.bottom - Math.min(sr.bottom, r.bottom) : 0;
        const on = sr && left + right < r.width && top + bottom < r.height;
        cover.style.display = on ? 'block' : 'none';
        if (on) cover.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
      }
    });
  }

  /**
   * 赤く見える文字入れ・ペンの線のうち、赤シートの下に入った部分だけを見えなくする（本物の赤シートの下では赤い字が消える）。
   * 全体の四角から、シートと重なる四角を穴にした clip-path（evenodd）をかける。文字入れは画面 px、ペンの線は PDF の座標（path の座標系）で
   */
  hideRed(a, sr) {
    const el = a.el;
    const r = el.getBoundingClientRect();
    const over = sr && sr.left < r.right && sr.right > r.left && sr.top < r.bottom && sr.bottom > r.top;
    if (!over) {
      el.style.clipPath = '';
      return;
    }
    const poly = (x0, y0, x1, y1, hx0, hy0, hx1, hy1) =>
      `polygon(evenodd, ${x0}px ${y0}px, ${x1}px ${y0}px, ${x1}px ${y1}px, ${x0}px ${y1}px, ${x0}px ${y0}px, ${hx0}px ${hy0}px, ${hx1}px ${hy0}px, ${hx1}px ${hy1}px, ${hx0}px ${hy1}px, ${hx0}px ${hy0}px)`;
    if (a.kind === 'text') {
      const hx0 = Math.max(sr.left, r.left) - r.left,
        hy0 = Math.max(sr.top, r.top) - r.top,
        hx1 = Math.min(sr.right, r.right) - r.left,
        hy1 = Math.min(sr.bottom, r.bottom) - r.top;
      el.style.clipPath = poly(-4, -4, r.width + 4, r.height + 4, hx0, hy0, hx1, hy1);
      return;
    }
    // ペンの線：clip-path の座標は path の座標系（PDF の pt。基準の箱は線の囲み）
    const p = this.pages[a.page - 1];
    const pr = p.el.getBoundingClientRect();
    const [ax, ay] = p.viewport.convertToPdfPoint(sr.left - pr.left, sr.top - pr.top);
    const [bx, by] = p.viewport.convertToPdfPoint(sr.right - pr.left, sr.bottom - pr.top);
    const box = el.getBBox();
    const hx0 = Math.min(ax, bx) - box.x,
      hx1 = Math.max(ax, bx) - box.x,
      hy0 = Math.min(ay, by) - box.y,
      hy1 = Math.max(ay, by) - box.y;
    el.style.clipPath = poly(-8, -8, box.width + 8, box.height + 8, hx0, hy0, hx1, hy1);
  }

  // ---- メモの中の手書き：吹き出しの中の SVG に、筆箱のボールペン（持っていなければ黒の 0.5）で書く ----
  notePen() {
    return this.penItem?.type === 'pen' ? this.penItem : NOTE_DEFAULT_PEN;
  }
  bindNoteInk(a, svg) {
    let d = null;
    const point = (ev, box, pressure) => [
      ev.clientX - box.left,
      ev.clientY - box.top,
      pressure ? (ev.pressure > 0 ? ev.pressure : 0.5) : 0.5
    ];
    const draw = () => {
      if (!d) return;
      d.path.setAttribute('d', strokePath(d.cap.points, d.pen.width * NOTE_INK_SCALE, {pressure: d.pressure}));
    };
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      this.finishEdit();
      const pen = this.notePen();
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('fill', pen.color);
      svg.append(path);
      d = {
        pointer: e.pointerId,
        pen,
        path,
        pressure: e.pointerType === 'pen',
        box: svg.getBoundingClientRect(),
        cap: createCapture({minGap: 0.3, streamline: e.pointerType === 'pen' ? 0.2 : 0.4})
      };
      svg.setPointerCapture(e.pointerId);
      const [x, y, pr] = point(e, d.box, d.pressure);
      d.cap.add(x, y, pr);
      draw();
    });
    svg.addEventListener('pointermove', (e) => {
      if (!d || e.pointerId !== d.pointer) return;
      e.stopPropagation();
      for (const ev of e.getCoalescedEvents?.() ?? [e]) {
        const [x, y, pr] = point(ev, d.box, d.pressure);
        d.cap.add(x, y, pr);
      }
      draw();
    });
    const finish = (e) => {
      if (!d || e.pointerId !== d.pointer) return;
      e.stopPropagation();
      const [x, y, pr] = point(e, d.box, d.pressure);
      const points = d.cap.finish(x, y, pr);
      d.path.remove();
      const {pen, pressure} = d;
      d = null;
      if (!points.length) return;
      const before = this.snap(a);
      const stroke = {p: encodePoints(points), c: pen.color, w: pen.width, ...(pressure ? {} : {pressure: false})};
      a.style = {...a.style, ink: [...(a.style.ink ?? []), stroke]};
      this.applyNotePop(a);
      this.record(a.key, before, this.snap(a));
      this.scheduleSave(a, 0);
    };
    svg.addEventListener('pointerup', finish);
    svg.addEventListener('pointercancel', finish);
  }
  /** メモの吹き出しは右下の角で大きさを変えられる。変えたら style.w・h に覚える（開いている間だけ見る） */
  watchNoteSize(a, pop) {
    const ro = new ResizeObserver(() => {
      if (pop.hidden || a.removed) return;
      const w = Math.round(pop.offsetWidth),
        h = Math.round(pop.offsetHeight);
      if (!w || !h || (a.style.w === w && a.style.h === h)) return;
      if (!a.style.w && !a.style.h && !a.sizeSeen) {
        a.sizeSeen = true; // 初めて開いたときの大きさ（CSS の既定）は覚えない
        return;
      }
      clearTimeout(a.sizeTimer);
      a.sizeTimer = setTimeout(() => {
        if (a.removed || pop.hidden) return;
        const before = this.snap(a);
        a.style = {...a.style, w, h};
        this.record(a.key, before, this.snap(a));
        this.scheduleSave(a);
      }, 300);
    });
    ro.observe(pop);
    this.listeners.push(() => ro.disconnect());
  }

  // ---- 赤シート：画面の上に置く赤い下敷き。ドラッグで動かし、右下の角で大きさを変える ----
  toggleSheet(on = !this.sheet) {
    if (!on) {
      this.sheet?.remove();
      this.sheet = null;
      for (const a of this.annos.values()) if (a.el.dataset?.red) a.el.style.clipPath = '';
    } else if (!this.sheet) {
      const el = document.createElement('div');
      el.className = 'red-sheet';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', '赤シート');
      el.innerHTML = '<span class="red-sheet__label">赤シート</span>';
      const first = this.pages[0]?.el.getBoundingClientRect();
      const width = Math.min(first?.width ?? 600, window.innerWidth - 40);
      Object.assign(el.style, {
        left: `${Math.max(20, first?.left ?? 20)}px`,
        top: `${Math.round(window.innerHeight * 0.45)}px`,
        width: `${width}px`,
        height: '200px'
      });
      el.addEventListener('pointerdown', (e) => {
        const r = el.getBoundingClientRect();
        if (e.button !== 0 || (e.clientX > r.right - 20 && e.clientY > r.bottom - 20)) return; // 右下は大きさ変え
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const sx = e.clientX - r.left,
          sy = e.clientY - r.top;
        const move = (ev) => {
          el.style.left = `${ev.clientX - sx}px`;
          el.style.top = `${ev.clientY - sy}px`;
          this.syncCovers();
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      });
      this.root.append(el);
      this.sheet = el;
      this.sheetResize = new ResizeObserver(() => this.syncCovers());
      this.sheetResize.observe(el);
    }
    if (!this.sheet) {
      this.sheetResize?.disconnect();
      this.sheetResize = null;
    }
    this.syncCovers();
    this.$('sheet').setAttribute('aria-pressed', String(!!this.sheet));
  }

  // ---- 書き出し（§9.7）----
  openExport() {
    this.finishEdit();
    const dialog = this.$('export-dialog');
    dialog.returnValue = ''; // Esc で閉じたときに前回の「書き出す」が残らないように
    if (!dialog.open) dialog.showModal();
  }

  async exportPdf(options) {
    const btn = this.$('export');
    btn.disabled = true;
    try {
      const snaps = this.textSnaps();
      if (!(await this.settle())) return toast('保存できていない注釈があるため書き出せません');
      const r = await api['pdf.export']({materialId: this.materialId, options, texts: await this.textImages(snaps)});
      if (r?.error) toast(r.error);
      else if (r?.ok) toast(`書き出しました：${r.name}`);
    } catch (e) {
      toast(`書き出せませんでした（${e.message}）`);
    } finally {
      btn.disabled = false;
    }
  }

  // ---- ファイルへの上書き保存 ----
  // 注釈を保存するたびに少し待って、注釈を描き込んだ PDF でファイルを上書きする（Finder で開いても注釈が見える）。
  // 元の PDF の写しはメインが取っておくので、アプリの中ではこれまでどおり注釈を編集できる
  markDirty() {
    if (this.fileBlocked) return;
    this.fileDirty = true;
    clearTimeout(this.fileTimer);
    if (this.destroyed) return; // 閉じたあとは、閉じるときに始めた保存が拾う（画面がないので新しくは始めない）
    this.fileTimer = setTimeout(() => !this.destroyed && this.saveFile(), FILE_SAVE_DELAY);
  }
  saveFile({manual = false} = {}) {
    clearTimeout(this.fileTimer);
    if (this.fileSaving) {
      this.fileAgain = true;
      return this.fileSaving;
    }
    if (manual) this.fileBlocked = false; // 手で保存するときは、前に止めた理由をもう一度確かめる
    if (this.fileBlocked) return Promise.resolve();
    this.finishEdit(); // 書きかけの文字入れも保存に回す
    // 文字入れの行は画面のレイアウトから読むので、待つ前（画面を閉じる前）に写しておく
    const snaps = this.textSnaps();
    this.fileSaving = (async () => {
      try {
        if (!(await this.settle())) throw new Error('保存できていない注釈があります');
        if (!this.fileDirty && !manual) return;
        this.fileDirty = false;
        const r = await api['pdf.save']({materialId: this.materialId, texts: await this.textImages(snaps)});
        if (r?.error) {
          // ほかのアプリで変更された・元の写しがないときは、何度も試さず止める（「書き出す…」は使える）
          this.fileBlocked = true;
          throw new Error(r.error);
        }
        if (manual) toast(r.changed ? `${r.name} を上書き保存しました` : `${r.name} は保存済みです`);
      } catch (e) {
        toast(`ファイルに保存できませんでした：${e.message}`, {error: true});
      } finally {
        this.fileSaving = null;
        this.setStatus();
        if (this.fileAgain) {
          this.fileAgain = false;
          if (this.fileDirty) this.saveFile();
        }
      }
    })();
    this.setStatus();
    return this.fileSaving;
  }

  /** 文字入れの写し（行の区切り・大きさ・書式）。画面が消えても PNG を作れるように、その場で読んでおく */
  textSnaps() {
    const out = [];
    for (const a of this.annos.values()) {
      if ((a.kind !== 'text' && a.kind !== 'stamp') || a.removed) continue;
      const p = this.pages[a.page - 1];
      if (!p?.viewport) continue;
      if (a.kind === 'stamp') {
        // 貼りもの：紙は画面の行の区切りのまま、シール・図は画面に出ている画像のまま
        const memo = a.style.type === 'memo';
        out.push({
          a,
          stamp: true,
          lines: memo ? this.textLines(a.el.querySelector('.anno-stamp__text')) : null,
          box: this.toScreen(a.page, a.rect),
          scale: p.viewport.scale,
          style: {...a.style},
          src: a.el.querySelector('img')?.src ?? '',
          label: a.body,
          shape: a.el.dataset.shape ?? 'cut'
        });
        continue;
      }
      out.push({
        a,
        lines: this.textLines(a.el),
        box: this.toScreen(a.page, a.rect),
        scale: p.viewport.scale,
        style: {...a.style}
      });
    }
    return out;
  }
  async textImages(snaps) {
    const texts = [];
    for (const s of snaps) {
      if (!s.a.id || s.a.removed) continue;
      const png = s.stamp ? await this.stampToPng(s).catch(() => null) : await this.textToPng(s);
      if (png) texts.push({id: s.a.id, png});
    }
    return texts;
  }

  /** 貼りものを PNG にする（288dpi）。紙はちぎり口・罫線・文字を描き、シール・図は画像を描く。描けなければ null */
  async stampToPng({box, scale, style, lines, src, shape, label}) {
    const k = EXPORT_PX_PER_PT;
    const W = Math.max(1, Math.ceil((box.width / scale) * k));
    const H = Math.max(1, Math.ceil((box.height / scale) * k));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (style.type === 'index') {
      // 付箋：ページに重なる所は薄く、残りは濃い色に言葉
      const over = INDEX_OVER * k;
      ctx.fillStyle = style.color;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(0, 0, over, H);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.roundRect(over, 0, W - over, H, [0, 2 * k, 2 * k, 0]);
      ctx.fill();
      const font = `700 ${8 * k}px ${FONT}`;
      await document.fonts.load(font).catch(() => {});
      ctx.font = font;
      ctx.fillStyle = inkOn(style.color);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label ?? '', over + (W - over) / 2, H / 2, W - over - 2 * k);
    } else if (style.type === 'memo') {
      const edge = tearEdge(W, MEMO_DEPTH * k, MEMO_TOOTH * k);
      ctx.beginPath();
      edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fillStyle = style.color ?? MEMO_COLOR;
      ctx.fill();
      ctx.save();
      ctx.clip();
      const size = (style.size ?? MEMO_SIZE) * k;
      const lh = size * MEMO_LINE;
      const top = (MEMO_TOP + MEMO_DEPTH) * k;
      ctx.fillStyle = '#bcd3ea';
      for (let y = top + lh; y < H; y += lh) ctx.fillRect(0, y - k / 2, W, k / 2); // 罫線（画面の 1px にあたる）
      const font = `400 ${size}px ${FONT}`;
      await document.fonts.load(font).catch(() => {});
      ctx.font = font;
      ctx.fillStyle = '#2b2b2b';
      const m = ctx.measureText('あ');
      const base = (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
      (lines ?? []).forEach((line, i) => ctx.fillText(line, MEMO_PAD * k, top + i * lh + base));
      ctx.restore();
    } else {
      if (!src) return null;
      const img = new window.Image();
      img.src = src;
      await img.decode();
      ctx.save();
      ctx.beginPath();
      if (shape === 'circle') ctx.ellipse(W / 2, H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
      else if (shape === 'round') ctx.roundRect(0, 0, W, H, Math.min(W, H) * 0.18);
      else ctx.rect(0, 0, W, H);
      ctx.clip();
      ctx.drawImage(img, 0, 0, W, H);
      ctx.restore();
      if (shape === 'framed') {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = (6 * k) / scale; // 画面の 3px のふち（内側の半分が見える）
        ctx.strokeRect(0, 0, W, H);
      }
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }

  /** 画面に出ている行の区切りのまま、文字入れを PNG にする（ヒラギノで描く。フォントは PDF に埋め込まない） */
  async textToPng({lines, box, scale, style}) {
    const k = EXPORT_PX_PER_PT;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil((box.width / scale) * k));
    canvas.height = Math.max(1, Math.ceil((box.height / scale) * k));
    const ctx = canvas.getContext('2d');
    const font = `${style.bold ? 700 : 400} ${style.size * k}px ${FONT}`;
    await document.fonts.load(font).catch(() => {});
    ctx.font = font;
    ctx.fillStyle = style.color;
    const m = ctx.measureText('あ');
    const lh = style.size * LINE_HEIGHT * k;
    const base = (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const pad = k / scale; // .anno-text の左の余白 1px
    lines.forEach((line, i) => ctx.fillText(line, pad, i * lh + base));
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** 箱の中の文字を、画面で折り返されている行ごとに分ける */
  textLines(el) {
    const lines = [];
    let cur = '',
      lastTop = null;
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.data;
      for (let i = 0; i < t.length; ) {
        const len = t.codePointAt(i) > 0xffff ? 2 : 1;
        const ch = t.slice(i, i + len);
        if (ch === '\n') {
          lines.push(cur);
          cur = '';
          lastTop = null;
        } else {
          range.setStart(n, i);
          range.setEnd(n, i + len);
          const r = range.getClientRects()[0];
          if (r) {
            if (lastTop !== null && r.top > lastTop + r.height * 0.5) {
              lines.push(cur);
              cur = '';
            }
            lastTop = r.top;
          }
          cur += ch;
        }
        i += len;
      }
    }
    lines.push(cur);
    return lines;
  }

  onPointerMove(e) {
    if (this.tool === 'eraser' && !this.drawing && e.pointerType !== 'touch') this.moveRing(e);
    const pan = this.pan;
    if (pan?.pointer === e.pointerId) {
      if (this.drawing) return; // ペンで書いている間の手のひら
      window.scrollBy(pan.x - e.clientX, pan.y - e.clientY);
      pan.x = e.clientX;
      pan.y = e.clientY;
      return;
    }
    const dr = this.drawing;
    if (dr?.pointer === e.pointerId && dr.kind === 'ink') {
      this.addInkPoint(dr, e);
      return this.drawInk();
    }
    if (dr?.pointer === e.pointerId && dr.kind === 'eraser') return this.eraseAt(e);
    if (dr?.pointer === e.pointerId && dr.kind === 'line') {
      const box = dr.p.el.getBoundingClientRect();
      dr.x1 = Math.min(Math.max(e.clientX - box.left, 0), box.width);
      dr.y1 = e.clientY - box.top;
      return this.drawLineDraft();
    }
    if (this.drawing?.pointer === e.pointerId) {
      const box = this.drawing.p.el.getBoundingClientRect();
      this.drawing.x1 = Math.min(Math.max(e.clientX - box.left, 0), box.width);
      this.drawing.y1 = Math.min(Math.max(e.clientY - box.top, 0), box.height);
      return this.drawDraft();
    }
    const d = this.drag;
    if (!d || d.pointer !== e.pointerId) return;
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    d.a.el.classList.add('is-dragging');
    if (d.resize) {
      // シール・図は縦横の比を保つ。紙は自由に（文字は折り返し直す）
      const w = Math.max(16, d.width + dx);
      const h = d.a.style.type === 'memo' ? Math.max(16, d.height + dy) : (w * d.height) / d.width;
      d.a.el.style.width = `${w}px`;
      d.a.el.style.height = `${h}px`;
      if (d.a.style.type === 'memo') this.placeMemo(d.a, w, this.pages[d.a.page - 1].viewport.scale);
      return;
    }
    // 付箋（インデックス）はページの端に沿って上下にだけ動かす
    if (!(d.a.kind === 'stamp' && d.a.style.type === 'index')) d.a.el.style.left = `${d.left + dx}px`;
    d.a.el.style.top = `${d.top + dy}px`;
    if (d.a.kind === 'mask') this.syncCovers();
  }

  onPointerUp(e) {
    if (this.pan?.pointer === e.pointerId) this.pan = null;
    const dr = this.drawing;
    if (dr?.pointer === e.pointerId && dr.kind === 'ink') return void this.finishInk(e);
    if (dr?.pointer === e.pointerId && dr.kind === 'line') return void this.finishLine();
    if (dr?.pointer === e.pointerId && dr.kind === 'eraser') {
      this.drawing = null;
      if (this.tool !== 'eraser') this.ring?.remove();
      return void this.recordGroup(dr.steps);
    }
    if (this.drawing?.pointer === e.pointerId) return void this.finishMask();
    const t = this.tap;
    if (t?.pointer === e.pointerId) {
      this.tap = null;
      if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10) return; // 指が動いた（スクロール）
      const box = t.p.el.getBoundingClientRect();
      return void this.createAt(this.tool, t.p, e.clientX - box.left, e.clientY - box.top);
    }
    const d = this.drag;
    if (!d || d.pointer !== e.pointerId) return;
    this.drag = null;
    const a = d.a;
    a.el.classList.remove('is-dragging');
    if (d.moved) {
      const p = this.pages[a.page - 1];
      // ページの外へは出さない
      const left = Math.min(Math.max(parseFloat(a.el.style.left), 0), p.viewport.width - 8);
      const top = Math.min(Math.max(parseFloat(a.el.style.top), 0), p.viewport.height - 8);
      let {width, height} = this.toScreen(a.page, a.rect);
      if (d.resize) {
        // ページの外へははみ出さない（シール・図は比を保ったまま縮める）
        const maxW = p.viewport.width - left,
          maxH = p.viewport.height - top;
        width = a.el.offsetWidth;
        height = a.el.offsetHeight;
        const k = a.style.type === 'memo' ? 1 : Math.min(1, maxW / width, maxH / height);
        width = Math.min(width * k, maxW);
        height = Math.min(height * k, maxH);
      }
      a.rect = this.fromScreen(a.page, {left, top, width, height});
      this.place(a);
      this.record(a.key, d.before, this.snap(a));
      this.scheduleSave(a, 0);
    } else if (a.kind === 'note') this.openNote(a, a.el.querySelector('.anno-note__pop').hidden);
    else if (a.kind === 'text' && this.tool === 'text') this.edit(a);
  }

  /**
   * キーボード（SPEC §9.5）。ショートカットは ⌘（Windows・Linux は Ctrl）＋キーだけ。1 文字のショートカットはない。
   * 文字を打っている間（入力欄・メモの本文・文字入れの編集中・日本語入力の変換中）は、Esc 以外は何もしない
   */
  onKey(e) {
    const t = e.target;
    if (this.$('export-dialog')?.open) return; // 書き出しの窓が開いている間は効かせない
    if (isTyping(e)) {
      if (e.key === 'Escape' && t.tagName === 'TEXTAREA') {
        const a = this.annoOf(t);
        if (a) this.openNote(a, false);
      }
      return;
    }
    const k = e.key.toLowerCase();
    // ⌘／Ctrl ＋ キー。Mac では Ctrl、Windows では Win キーの組み合わせは使わない
    const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (mod && !e.altKey) {
      const shift = e.shiftKey;
      if (k === 'z' && !shift) this.undo();
      else if ((k === 'z' && shift) || (k === 'y' && !shift)) this.redo();
      else if (k === 'e' && shift) this.openExport();
      else if (k === 'e') this.setTool('eraser');
      else if (k === 's' && !shift) this.saveFile({manual: true});
      else if (k === 't' && !shift) this.setTool('text');
      else if (k === 'm' && !shift) this.setTool('note');
      else if (k === 'h' && shift) this.useHider();
      else if (k === 'b' && !shift) {
        // 太字：文字入れを選んでいる（または文字入れの道具）のときだけ
        if (this.selected?.kind === 'text' || this.tool === 'text')
          this.setTextStyle({bold: !(this.selected?.kind === 'text' ? this.selected.style : this.textStyle).bold});
        else return;
      } else if (k === 'd' && !shift) this.addBookmark();
      else if (k === 'r' && !shift) this.toggleSheet();
      else if (k === '/' || e.key === '?') this.openHelp(this.$('help-panel').hidden);
      else if (/^[1-6]$/.test(e.key) && !shift) this.useSlot(Number(e.key) - 1);
      else return;
      return e.preventDefault();
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      this.openHelp(false);
      this.openCase(false);
      this.openCorner(null);
      this.select(null);
      this.setTool('select');
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      e.preventDefault();
      this.removeAnno(this.selected);
    } else if (e.key === 'Enter' && this.selected && this.annoOf(t) === this.selected) {
      // フォーカスのある注釈で Enter：文字入れは直す、メモは開く（マウスで押したときと同じ）
      const a = this.selected;
      if (a.kind === 'text') {
        e.preventDefault();
        this.edit(a);
      } else if (a.kind === 'note') {
        e.preventDefault();
        this.openNote(a, true);
      }
    }
  }

  unmount() {
    // 閉じる前の変更もファイルに残す（書きかけ・保存待ちの注釈も含む。文字入れの行は画面があるうちにここで写す。変更がなければ何もしない）
    this.saveFile();
    this.flushAll();
    this.destroyed = true;
    clearTimeout(this.pinchTimer);
    for (const off of this.listeners) off();
    this.observer?.disconnect();
    this.barObserver?.disconnect();
    this.sideObserver?.disconnect();
    clearTimeout(this.tuckTimer);
    this.toggleSheet(false);
    this.toggleCalc(false);
    this.toggleMemo(false);
    this.toggleRuler(false);
    this.toggleIndexPad(false);
    this.toggleTimer(false, {stop: true});
    this.carry?.off();
    this.ring?.remove();
    cancelAnimationFrame(this.coverFrame);
    cancelAnimationFrame(this.inkFrame);
    for (const p of this.pages) p.renderTask?.cancel();
    this.task?.destroy();
    document.title = '大学ノート';
  }
}

/** ビューアを root に開く。戻り値の unmount() で閉じる（保存待ちの注釈はその場で保存する） */
export function mountViewer(root, opts) {
  const v = new Viewer(root, opts);
  v.start().catch((e) => v.fail(`開けませんでした（${e.message}）`));
  return v;
}
