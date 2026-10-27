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
import {state} from '../store.js';
import {skinOf} from '../skin.js';
import {stationeryState} from '../../shared/stationery.js';
import {DEFAULT_SIZE} from '../../shared/annotation.js';
import {cleanAlign} from '../../shared/text-runs.js';
import {CSS_UNITS, DeskTools} from '../desk-tools.js';
import {methods as bookmarksMethods} from './viewer/bookmarks.js';
import {methods as pagesMethods} from './viewer/pages.js';
import {methods as annotationsMethods} from './viewer/annotations.js';
import {methods as historyMethods} from './viewer/history.js';
import {methods as toolsMethods} from './viewer/tools.js';
import {methods as stampsMethods} from './viewer/stamps.js';
import {methods as pointerMethods} from './viewer/pointer.js';
import {methods as inkMethods} from './viewer/ink.js';
import {methods as maskMethods} from './viewer/mask.js';
import {methods as notesMethods} from './viewer/notes.js';
import {methods as exportMethods} from './viewer/export.js';
import {methods as keysMethods} from './viewer/keys.js';
import {
  api,
  FONT,
  TEXT_COLORS,
  NOTE_COLORS,
  COURSE_HEX,
  clampSize,
  IpcBinaryDataFactory,
  swatches,
  BAR
} from './viewer/shared.js';

/** 画面の画素密度（dpr）を、ページの絵が MAX_CANVAS_PIXELS に収まるところまで下げる */

// 1 ページの絵（canvas）の画素数の上限。拡大 4 倍 × Retina で A4 が 5,700 万画素（約 228 MB）になるのを防ぐ。
// 超えるときは描く解像度を落とし、CSS で大きさを合わせる（pdf.js の maxCanvasPixels と同じ考え）

// 注釈を保存してからファイルを上書きするまで（ms）。続けて書いている間は待つ
// ピンチの指が止まってから描き直すまで（ms）
// 筆箱のボールペンを持っていないときのメモの手書き（黒の 0.5 相当）
// wheel の deltaY 1 あたりの拡大率の変化（指数）
// styles/viewer.css の .anno-text と同じ
// OS に合わせた表記（SPEC §9）：Mac では ⌘、Windows・Linux では Ctrl。フォント名も Mac 以外ではヒラギノは入っていないので「標準のゴシック」

// key('⇧', MOD, 'Z') → ⇧⌘Z ／ Shift+Ctrl+Z

/** 行の字の上下（覆う範囲）と、その行をなぞったとみなす上下 */

/** 文字隠しを横になぞっているか：上下の動きが小さいか、指が行の字の高さの中にとどまっている（行の字の縦幅を超えなければ、行のマーカーのまま） */

// styles/viewer.css の .anno-text と同じ
// 書き出す文字入れの画像の細かさ（1pt = 4px、288dpi）

// 文字隠しの既定の色（shared/annotation.js）
// 付箋（インデックス）：pt。ページに重なる所（OVER）は薄く、はみ出す所は濃い色に言葉

// 続けて貼るときの間

// 消しゴムの半径（画面の px）

// なぞって書く道具（注釈の上でも書く。動かさない）

// 付箋は 6 色（tokens.css の --c1〜--c6 の明るい側の値）。既定は授業の色
// PDF のメモ（付箋）の色：授業ページの付箋と同じ 5 色（着せ替えで変えられる）

/** pdf.js が要る補助データ（CMap など）をメインから受け取る。file:// を直接読まない */

class Viewer extends DeskTools {
  constructor(root, {materialId, course, onBack}) {
    super(root);
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
    this.textStyle = {
      size: clampSize(fontDefault.size ?? DEFAULT_SIZE),
      bold: false,
      color: TEXT_COLORS[0],
      align: 'left'
    };
    // 着せ替え（SPEC-KISEKAE）：付箋の色の候補・しおりのリボンの色と形・リボンの先のシール
    this.skin = skinOf(state.data, course ?? null);
    this.noteColors = this.skin.sticky.round === 'default' ? NOTE_COLORS : this.skin.sticky.round;
    this.noteColor =
      COURSE_HEX[course?.color] && this.noteColors.includes(COURSE_HEX[course.color])
        ? COURSE_HEX[course.color]
        : this.noteColors[0];
    this.chains = new Set(); // 保存中の処理（書き出しの前に待つ）
    this.undoStack = [];
    this.redoStack = [];
    this.sheet = null;
    // 筆箱（§9.8）：中身は 6 本。slot は今使っているペンの場所（筆箱にない文字隠しペンを H で使うときは null）
    this.st = stationeryState(state.data?.stationery);
    this.slot = null;
    this.penItem = null;
    this.penSeen = false; // ペン（スタイラス）を使ったか。使ったら指では書かない
  }

  // ---- 四隅の道具（desk-tools.js）に、PDF のページの場合を教える ----
  busy() {
    return !!(this.drawing || this.drag || this.carry || this.editing); // 文字を打っている間は、端へ寄せても四隅を出さない
  }
  keepCorner() {
    return !this.$('case-panel').hidden; // ペンの入れ替えを開いている間はしまわない
  }
  onCornerClose(name) {
    if (name === 'fude') this.openCase(false);
  }
  stampScale() {
    return this.pages[0]?.viewport?.scale ?? CSS_UNITS;
  }
  /** 運んで離した点の下のページに貼る（影の真ん中をページの中の位置にして）。ページの外なら false */
  dropStamp(spec, px, py, cx, cy) {
    const p = this.pageAt(px, py);
    if (!p) return false;
    const box = p.el.getBoundingClientRect();
    this.placeStamp(spec, {p, x: cx - box.left, y: cy - box.top});
    return true;
  }
  pouchAction(v) {
    if (v !== 'index') return super.pouchAction(v);
    this.toggleIndexPad();
    this.tuckSoon();
    return true;
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
    this.$('title').textContent = `PDF：${r.material.name}`;
    // 文字入れの書式：この PDF で最後に使ったもの（なければ同じ授業で最後に使ったもの）を引き継ぐ
    if (r.textStyle && typeof r.textStyle === 'object')
      this.textStyle = {
        size: clampSize(r.textStyle.size, this.textStyle.size),
        bold: r.textStyle.bold === true,
        color: /^#[0-9a-f]{6}$/i.test(r.textStyle.color ?? '') ? r.textStyle.color.toLowerCase() : this.textStyle.color,
        align: cleanAlign(r.textStyle.align) ?? 'left'
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
      // 絵（canvas）の上に、見えない文字の層（pdf.js の TextLayer。選択・コピー・読み上げ）、その上に注釈の層
      el.innerHTML = `<canvas class="pdf-page__canvas" role="presentation"></canvas><div class="pdf-page__text"></div><div class="pdf-page__layer"><svg class="pdf-page__ink" aria-hidden="true"><g></g></svg></div><span class="pdf-page__num muted">${i} / ${this.doc.numPages}</span>`;
      this.pagesEl.append(el);
      this.pages.push({
        num: i,
        page,
        el,
        canvas: el.querySelector('canvas'),
        text: el.querySelector('.pdf-page__text'),
        textContent: null, // 文字の層のもと（1 回だけ読む）
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
    // スマホ連携（docs/MOBILE.md §6）：スマホで書き込んだら、この画面にも出す。まだファイルに描き込んでいなければ上書き保存する
    this.offPhone = api.on('annotations.changed', ({materialId}) => {
      if (materialId === this.materialId && !this.destroyed) this.syncFromPhone().catch(() => {});
    });
    if (r.stale) this.markDirty();
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

  fail(message) {
    this.pagesEl.innerHTML = `<div class="card"><p>${message.replace(/[&<>]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[c])}</p></div>`;
  }

  /** 字の相対的な幅（全角・半角の違い）。文字列の幅を字ごとに分けるのに使う（text-snap.js） */
  measureChar = (ch) => {
    const ctx = (this.measureCtx ??= document.createElement('canvas').getContext('2d'));
    ctx.font = `100px ${FONT}`;
    return ctx.measureText(ch).width;
  };

  unmount() {
    // 閉じる前の変更もファイルに残す（書きかけ・保存待ちの注釈も含む。文字入れの行は画面があるうちにここで写す。変更がなければ何もしない）
    this.saveFile();
    this.flushAll();
    this.destroyed = true;
    this.offPhone?.();
    clearTimeout(this.pinchTimer);
    for (const off of this.listeners) off();
    this.observer?.disconnect();
    this.barObserver?.disconnect();
    this.sideObserver?.disconnect();
    clearTimeout(this.tuckTimer);
    this.toggleSheet(false);
    this.toggleIndexPad(false);
    this.figEditor?.close();
    this.closeTools();
    this.ring?.remove();
    cancelAnimationFrame(this.coverFrame);
    cancelAnimationFrame(this.inkFrame);
    for (const p of this.pages) p.renderTask?.cancel();
    this.task?.destroy();
    document.title = '大学ノート';
  }
}

/** ビューアを root に開く。戻り値の unmount() で閉じる（保存待ちの注釈はその場で保存する） */
// 関心ごとのメソッドを足す（this は Viewer）
Object.assign(
  Viewer.prototype,
  bookmarksMethods,
  pagesMethods,
  annotationsMethods,
  historyMethods,
  toolsMethods,
  stampsMethods,
  pointerMethods,
  inkMethods,
  maskMethods,
  notesMethods,
  exportMethods,
  keysMethods
);

export function mountViewer(root, opts) {
  const v = new Viewer(root, opts);
  v.start().catch((e) => v.fail(`開けませんでした（${e.message}）`));
  return v;
}
