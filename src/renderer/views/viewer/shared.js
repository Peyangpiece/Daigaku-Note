// PDF の編集画面の定数と小さな補助（viewer.js と viewer/*.js が使う）
import * as pdfjs from '../../../../node_modules/pdfjs-dist/legacy/build/pdf.min.mjs';
import {ROUND_DEFAULTS} from '../../../shared/skin.js';
import {DEFAULT_SIZE, MASK_COLOR, SIZE_MAX, SIZE_MIN} from '../../../shared/annotation.js';
import {cornersHtml} from '../../desk-tools.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  '../../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).href;
export const api = window.daigaku;
/** 画面の画素密度（dpr）を、ページの絵が MAX_CANVAS_PIXELS に収まるところまで下げる */
export const canvasScale = (vp, dpr) => {
  const px = vp.width * vp.height;
  return px > 0 ? Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / px)) : dpr;
};
export const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const clampZoom = (z) => Math.min(4, Math.max(0.25, z));
// 1 ページの絵（canvas）の画素数の上限。拡大 4 倍 × Retina で A4 が 5,700 万画素（約 228 MB）になるのを防ぐ。
// 超えるときは描く解像度を落とし、CSS で大きさを合わせる（pdf.js の maxCanvasPixels と同じ考え）
export const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
export const FILE_SAVE_DELAY = 1500;
// 注釈を保存してからファイルを上書きするまで（ms）。続けて書いている間は待つ
export const PINCH_IDLE = 180;
// ピンチの指が止まってから描き直すまで（ms）
export const NOTE_DEFAULT_PEN = {type: 'pen', color: '#2b2b2b', width: 1.1};
// 筆箱のボールペンを持っていないときのメモの手書き（黒の 0.5 相当）
export const PINCH_SPEED = 0.01;
// wheel の deltaY 1 あたりの拡大率の変化（指数）
export const FONT = "'Hiragino Kaku Gothic ProN', 'Hiragino Sans', sans-serif";
// styles/viewer.css の .anno-text と同じ
// OS に合わせた表記（SPEC §9）：Mac では ⌘、Windows・Linux では Ctrl。フォント名も Mac 以外ではヒラギノは入っていないので「標準のゴシック」
export const IS_MAC = /Mac/i.test(navigator.platform);
export const MOD = IS_MAC ? '⌘' : 'Ctrl';
export const key = (...parts) => (IS_MAC ? parts.join('') : parts.join('+'));
// key('⇧', MOD, 'Z') → ⇧⌘Z ／ Shift+Ctrl+Z
export const SHIFT = IS_MAC ? '⇧' : 'Shift';
export const FONT_LABEL = IS_MAC ? 'ヒラギノ角ゴ' : '標準のゴシック';
/** 行の字の上下（覆う範囲）と、その行をなぞったとみなす上下 */
export const lineOf = (items) => ({
  top: Math.min(...items.map((it) => it.top)),
  bottom: Math.max(...items.map((it) => it.bottom)),
  hitTop: Math.min(...items.map((it) => it.hitTop)),
  hitBottom: Math.max(...items.map((it) => it.hitBottom))
});
/** 文字隠しを横になぞっているか：上下の動きが小さいか、指が行の字の高さの中にとどまっている（行の字の縦幅を超えなければ、行のマーカーのまま） */
export const isFlat = (d, line) =>
  Math.abs(d.y1 - d.y0) < 12 || (!!line && d.y1 >= line.hitTop && d.y1 <= line.hitBottom);
export const LINE_HEIGHT = 1.4;
// styles/viewer.css の .anno-text と同じ
export const EXPORT_PX_PER_PT = 4;
// 書き出す文字入れの画像の細かさ（1pt = 4px、288dpi）
export const HISTORY_MAX = 200;
export const MASK_HEX = MASK_COLOR;
// 文字隠しの既定の色（shared/annotation.js）
// 付箋（インデックス）：pt。ページに重なる所（OVER）は薄く、はみ出す所は濃い色に言葉
export const INDEX_W = 44;
export const INDEX_H = 16;
export const INDEX_OVER = 14;
export const INDEX_GAP = 4;
// 続けて貼るときの間
export const INDEX_COLORS = ['#f28b82', '#fbbc04', '#fff475', '#ccff90', '#a7ffeb', '#aecbfa', '#d7aefb', '#fdcfe8'];
export const ERASER_PX = 9;
// 消しゴムの半径（画面の px）
export const SVG_NS = 'http://www.w3.org/2000/svg';
/** 文字入れの揃え（左・中央・右）のボタン。線の長さで揃え方を見せる */
const ALIGN_BUTTONS = [
  ['left', '左揃え', [2, 2, 2], [12, 8, 10]],
  ['center', '中央揃え', [2, 4, 3], [12, 8, 10]],
  ['right', '右揃え', [2, 6, 4], [12, 8, 10]]
]
  .map(
    ([v, label, xs, ws]) =>
      `<button type="button" data-align="${v}" aria-pressed="false" title="${label}" aria-label="${label}"><svg viewBox="0 0 16 14" aria-hidden="true"><path d="${xs.map((x, i) => `M${x} ${3 + i * 4}h${ws[i]}`).join('')}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>`
  )
  .join('');
export const DRAW_TOOLS = ['ink', 'line', 'eraser'];
// なぞって書く道具（注釈の上でも書く。動かさない）
export const TEXT_COLORS = ['#2b2b2b', '#d93025', '#1a73e8', '#188038', '#e37400', '#9334e6', '#c2185b', '#ffffff'];
// 付箋は 6 色（tokens.css の --c1〜--c6 の明るい側の値）。既定は授業の色
// PDF のメモ（付箋）の色：授業ページの付箋と同じ 5 色（着せ替えで変えられる）
export const NOTE_COLORS = ROUND_DEFAULTS;
export const COURSE_HEX = [
  null,
  '#f6c445',
  '#f28b82',
  '#7fd1ae',
  '#8ab4f8',
  '#c58af9',
  '#ffab70',
  '#6fd3e6',
  '#f7a1c4'
];
export const COLOR_NAMES = {
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
export const clampSize = (v) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(Number(v) * 2) / 2 || DEFAULT_SIZE));
/** pdf.js が要る補助データ（CMap など）をメインから受け取る。file:// を直接読まない */
export class IpcBinaryDataFactory {
  async fetch({kind, filename}) {
    const r = await api['pdf.asset']({kind, filename});
    if (r?.error) throw new Error(r.error);
    return r.bytes;
  }
}
export const swatches = (colors, name) =>
  colors
    .map(
      (c) =>
        `<button type="button" class="swatch" data-${name}="${c}" style="--swatch: ${c}" title="${COLOR_NAMES[c] ?? c}" aria-label="${COLOR_NAMES[c] ?? c}"></button>`
    )
    .join('');
export const BAR = `
  <h2 class="sr-only" data-v="title">PDF</h2>
  <div class="viewer-bar" role="toolbar" aria-label="PDF の編集">
    <button type="button" class="btn btn--small" data-v="back">← 授業へ</button>
    <span class="viewer-bar__name" data-v="name"></span>
    <div class="seg" role="group" aria-label="ツール">
      <button type="button" data-tool="select" title="選択・移動（Esc）：押してそのまま動かす">選択</button>
      <button type="button" data-tool="text" title="文字入れ（${key(MOD, 'T')}）：文字の上を押すと打つ・なぞると範囲を選ぶ。箱のふち（すぐ外側）を押して動かす">文字</button>
      <button type="button" data-tool="note" title="コメント（${key(MOD, 'M')}）：押した所にアイコンを置き、押すと開く吹き出しに書く">コメント</button>
    </div>
    <button type="button" class="viewer-bar__held" data-v="held" hidden title="持っている道具（押すと選択に戻る。Esc でも）"><span class="viewer-bar__held-dot" aria-hidden="true"></span><span data-v="held-name"></span><span aria-hidden="true">×</span></button>
    <div class="viewer-bar__toggles" role="group" aria-label="出す・しまう">
    <div class="viewer-bar__bookmarks">
      <button type="button" data-v="bookmarks" aria-expanded="false" aria-haspopup="true" title="付箋の一覧（押すとその場所へ。${key(SHIFT, MOD, 'D')} で今の場所に付箋を貼る）">付箋</button>
      <div class="bookmark-panel" data-v="bookmark-panel" hidden>
        <div class="bookmark-panel__head">
          <strong>付箋</strong>
          <button type="button" class="btn btn--small" data-v="bookmark-add" title="いま見ている場所に付箋を貼る（${key(SHIFT, MOD, 'D')}）">＋ ここに付箋</button>
        </div>
        <div class="bookmark-panel__colors" data-v="fusen-colors" role="group" aria-label="付箋の色"></div>
        <ul class="bookmark-panel__list" data-v="bookmark-list"></ul>
      </div>
    </div>
    </div>
    <div class="viewer-bar__history">
      <button type="button" data-v="undo" disabled title="取り消す（${key(MOD, 'Z')}）" aria-label="取り消す">↶</button>
      <button type="button" data-v="redo" disabled title="やり直す（${key(SHIFT, MOD, 'Z')}）" aria-label="やり直す">↷</button>
    </div>
    <button type="button" class="btn btn--small" data-v="delete" hidden title="選んだ注釈を消す（Delete）">削除</button>
    <button type="button" class="viewer-bar__find" data-v="find" title="PDF の中の文字を探す（${key(MOD, 'F')}）">検索</button>
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
    <button type="button" class="viewer-bar__export" data-v="export" title="注釈を描き込んだ PDF を別の名前で書き出す（${key(SHIFT, MOD, 'E')}）">書き出す…</button>
    <div class="viewer-bar__help">
      <button type="button" data-v="help" aria-expanded="false" aria-haspopup="true" title="キーボードの操作（${key(MOD, '/')}）" aria-label="キーボードの操作">? 操作</button>
      <div class="help-panel" data-v="help-panel" hidden>
        <strong>キーボードの操作</strong>
        <dl>
          <dt>${key(MOD, 'T')}・${key(MOD, 'M')}</dt><dd>文字入れ・コメント</dd>
          <dt>${key(MOD, '1')}〜${key(MOD, '6')}</dt><dd>筆箱の 1〜6 本目のペン（多機能ペンは、もう一度押すと次の芯に回る）</dd>
          <dt>${key(MOD, 'K')}・${key(MOD, 'E')}</dt><dd>文字隠しペン・消しゴム</dd>
          <dt>${key(MOD, 'B')}</dt><dd>太字（文字入れを選んでいるとき）</dd>
          <dt>${key(MOD, 'D')}</dt><dd>電卓（ポーチの中）を出す・しまう</dd>
          <dt>${key(SHIFT, MOD, 'D')}</dt><dd>今の場所に付箋</dd>
          <dt>${key(MOD, 'R')}</dt><dd>赤シート（ポーチの中）を出す・しまう</dd>
          <dt>Tab・Enter</dt><dd>注釈を順に選ぶ・選んだ文字を直す／コメントを開く</dd>
          <dt>Delete</dt><dd>選んだ注釈を消す</dd>
          <dt>Esc</dt><dd>選択をやめて選択ツールへ</dd>
          <dt>${key(MOD, 'F')}</dt><dd>PDF の中の文字を探す（Enter で次、Shift＋Enter で前）</dd>
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
  <div class="viewer-sub" data-v="sub" role="toolbar" aria-label="道具の設定" hidden>
    <div class="viewer-bar__group viewer-sub__group" data-group="text" hidden>
      <span class="viewer-bar__font" title="文字入れのフォントは${IS_MAC ? 'ヒラギノ角ゴ' : 'この OS の標準のゴシック体'}です（変えられません）">${FONT_LABEL}</span>
      <label class="viewer-bar__size">サイズ<input type="number" data-v="size" min="${SIZE_MIN}" max="${SIZE_MAX}" step="0.5" />pt</label>
      <button type="button" class="viewer-bar__bold" data-v="bold" aria-pressed="false" title="太字（${key(MOD, 'B')}）">B</button>
      <span class="viewer-bar__align" role="group" aria-label="揃え">${ALIGN_BUTTONS}</span>
      <span class="swatches" title="打っている途中で文字を選んでから色を押すと、その文字だけ色が変わります">${swatches(TEXT_COLORS, 'text-color')}</span>
      <input type="color" data-v="text-custom" title="ほかの色" aria-label="文字のほかの色" />
    </div>
    <div class="viewer-bar__group viewer-sub__group" data-group="note" hidden>
      <span class="muted">コメントの色</span>
      <span class="swatches">${swatches(NOTE_COLORS, 'note-color')}</span>
      <input type="color" data-v="note-custom" title="ほかの色" aria-label="コメントのほかの色" />
    </div>
    <div class="viewer-bar__group viewer-sub__group viewer-bar__refills" data-group="refill" role="group" aria-label="多機能ペンの芯" hidden></div>
    <div class="viewer-bar__group viewer-sub__group viewer-find" data-group="find" role="search" hidden>
      <input type="search" class="input viewer-find__q" data-v="find-q" placeholder="PDF の中を検索" aria-label="PDF の中を検索" />
      <span class="muted viewer-find__count" data-v="find-count" aria-live="polite"></span>
      <button type="button" data-v="find-prev" title="前（Shift＋Enter）" aria-label="前の場所">↑</button>
      <button type="button" data-v="find-next" title="次（Enter）" aria-label="次の場所">↓</button>
      <button type="button" data-v="find-close" title="検索を閉じる（Esc）" aria-label="検索を閉じる">×</button>
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
      <label><input type="checkbox" name="notes" checked /> コメントを PDF の注釈として入れる（ほかの PDF アプリでも読めます）</label>
      <div class="export-dialog__foot">
        <button type="submit" class="btn" value="cancel">やめる</button>
        <button type="submit" class="btn btn--primary" value="ok">書き出す…</button>
      </div>
    </form>
  </dialog>
  <aside class="fude-side is-tucked" data-v="side" data-corner="fude" aria-label="筆箱">
    <button type="button" class="fude-side__tab" data-corner-tab="fude" aria-expanded="false" title="筆箱を出す（マウスを画面の右上の端へ・右端から左へなでる）" aria-label="筆箱を出す"><span>筆箱</span></button>
    <div class="fude-side__head"><strong>筆箱</strong><span class="muted" data-v="case-name"></span><button type="button" class="fude-side__pin" data-v="pin" aria-pressed="false" title="開いたままにする（窓が広いときだけ。PDF は左に寄せて小さくします）">開いたまま</button></div>
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
${cornersHtml()}
  <div class="viewer-pages" data-v="pages"><p class="muted">読み込み中…</p></div>`;
