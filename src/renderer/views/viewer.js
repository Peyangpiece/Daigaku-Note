// PDF ビューアと編集（SPEC §9）。アプリ内で開けて編集できるのは PDF だけ。
// 編集は「文字入れ」（フォントはヒラギノ角ゴのみ。サイズ・太字・色を変えられる）・「付箋」（メモ）・「文字隠し」。
// 文字隠しは水色のマーカー。ふだんは下の文字が読め、赤シートをかぶせたところだけ黒くつぶれて読めなくなる。
//   仕組み：マーカーの水色は赤の成分が 0（#00d2ff）で、ページに「乗算」で重ねる。赤シートも赤（赤だけ通す）を乗算で重ねるので、
//   マーカーの部分は 赤 0 × … = 黒 になる。白い紙は赤に、黒い文字は黒のままになり、本物の赤シートと同じ見え方になる
// 取り消し・やり直し（§9.1：200 手まで。履歴はメモリだけ）。注釈付きの PDF を別のファイルに書き出せる（§9.7）。
// 元の PDF は変えない（§9.1）。注釈はページ座標（PDF のユーザー空間、左下原点、pt）でメインの DB に保存する。
// ほかの画面と違い、状態が変わるたびに描き直さない（app.js が mount / unmount だけ呼ぶ）。
// pdf.js は互換版（legacy）を使う。通常版は Map.prototype.getOrInsertComputed などの新しい機能を前提にしており、
// Electron の Chromium の版によっては動かない
import * as pdfjs from '../../../node_modules/pdfjs-dist/legacy/build/pdf.min.mjs';
import {toast} from '../app.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  '../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).href;

const api = window.daigaku;
const CSS_UNITS = 96 / 72; // 拡大率 100% で紙の実寸
const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
// shared/annotation.js と同じ値（レンダラは shared を読まないので写す）
const SIZE_MIN = 6,
  SIZE_MAX = 72,
  DEFAULT_SIZE = 12,
  NOTE_SIZE = 20;
const FONT = "'Hiragino Kaku Gothic ProN', 'Hiragino Sans', sans-serif"; // notebook.css の .anno-text と同じ
const LINE_HEIGHT = 1.4; // notebook.css の .anno-text と同じ
const EXPORT_PX_PER_PT = 4; // 書き出す文字入れの画像の細かさ（1pt = 4px、288dpi）
const HISTORY_MAX = 200;
const TEXT_COLORS = ['#2b2b2b', '#d93025', '#1a73e8', '#188038', '#e37400', '#9334e6', '#c2185b', '#ffffff'];
// 付箋は 6 色（tokens.css の --c1〜--c6 の明るい側の値）。既定は授業の色
const NOTE_COLORS = ['#f6c445', '#f28b82', '#7fd1ae', '#8ab4f8', '#c58af9', '#ffab70'];
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
      <button type="button" data-tool="select" title="選択・移動（V）">選択</button>
      <button type="button" data-tool="text" title="文字入れ（T）">文字</button>
      <button type="button" data-tool="note" title="付箋（M）">付箋</button>
      <button type="button" data-tool="mask" title="文字隠し：文字の上をなぞって水色のマーカーを引く（H）">文字隠し</button>
    </div>
    <button type="button" class="viewer-bar__sheet" data-v="sheet" aria-pressed="false" title="赤シートを出す・しまう（R）。マーカーのところだけ黒く隠れます">赤シート</button>
    <div class="viewer-bar__history">
      <button type="button" data-v="undo" disabled title="取り消す（Ctrl/⌘+Z）" aria-label="取り消す">↶</button>
      <button type="button" data-v="redo" disabled title="やり直す（Shift+Ctrl/⌘+Z）" aria-label="やり直す">↷</button>
    </div>
    <div class="viewer-bar__group" data-group="text" hidden>
      <span class="viewer-bar__font" title="文字入れのフォントはヒラギノ角ゴです">ヒラギノ角ゴ</span>
      <label class="viewer-bar__size">サイズ<input type="number" data-v="size" min="${SIZE_MIN}" max="${SIZE_MAX}" step="0.5" />pt</label>
      <button type="button" class="viewer-bar__bold" data-v="bold" aria-pressed="false" title="太字">B</button>
      <span class="swatches">${swatches(TEXT_COLORS, 'text-color')}</span>
      <input type="color" data-v="text-custom" title="ほかの色" aria-label="文字のほかの色" />
    </div>
    <div class="viewer-bar__group" data-group="note" hidden>
      <span class="muted">付箋の色</span>
      <span class="swatches">${swatches(NOTE_COLORS, 'note-color')}</span>
      <input type="color" data-v="note-custom" title="ほかの色" aria-label="付箋のほかの色" />
    </div>
    <button type="button" class="btn btn--small" data-v="delete" disabled title="選んだ注釈を消す（Delete）">削除</button>
    <span class="viewer-bar__spacer"></span>
    <div class="viewer-bar__zoom">
      <button type="button" data-v="zoom-out" aria-label="縮小">−</button>
      <span data-v="zoom-label">100%</span>
      <button type="button" data-v="zoom-in" aria-label="拡大">＋</button>
      <button type="button" data-v="fit" title="幅に合わせる">幅</button>
    </div>
    <button type="button" class="btn btn--small" data-v="export" title="注釈を描き込んだ PDF を別のファイルに作る（Ctrl/⌘+E）">書き出し</button>
    <span class="muted viewer-bar__status" data-v="status" aria-live="polite"></span>
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
      <label><input type="checkbox" name="notes" checked /> 付箋を PDF のメモ（注釈）として入れる</label>
      <div class="export-dialog__foot">
        <button type="submit" class="btn" value="cancel">やめる</button>
        <button type="submit" class="btn btn--primary" value="ok">書き出す…</button>
      </div>
    </form>
  </dialog>
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
    this.noteColor =
      COURSE_HEX[course?.color] && NOTE_COLORS.includes(COURSE_HEX[course.color])
        ? COURSE_HEX[course.color]
        : NOTE_COLORS[0];
    this.listeners = [];
    this.chains = new Set(); // 保存中の処理（書き出しの前に待つ）
    this.undoStack = [];
    this.redoStack = [];
    this.sheet = null;
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
    this.pagesEl = this.$('pages');
    this.bindBar();
    this.bindPages();
    this.setTool('select');
    const r = await api['pdf.open']({materialId: this.materialId});
    if (this.destroyed) return;
    if (r?.error) return this.fail(r.error);
    this.$('name').textContent = r.material.name;
    this.$('name').title = r.material.name;
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
    for (let i = 1; i <= this.doc.numPages; i++) {
      const page = await this.doc.getPage(i);
      if (this.destroyed) return;
      const el = document.createElement('div');
      el.className = 'pdf-page';
      el.dataset.page = String(i);
      el.innerHTML = `<canvas class="pdf-page__canvas"></canvas><div class="pdf-page__layer"></div><span class="pdf-page__num muted">${i} / ${this.doc.numPages}</span>`;
      this.pagesEl.append(el);
      this.pages.push({
        num: i,
        page,
        el,
        canvas: el.querySelector('canvas'),
        layer: el.querySelector('.pdf-page__layer'),
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
    this.updateBar();
  }

  fail(message) {
    this.pagesEl.innerHTML = `<div class="card"><p>${message.replace(/[&<>]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[c])}</p></div>`;
  }

  // ---- 表示 ----
  fitZoom() {
    const first = this.pages[0]?.page.getViewport({scale: CSS_UNITS});
    if (!first) return 1;
    const avail = this.pagesEl.clientWidth - 32;
    return Math.min(2, Math.max(0.5, Math.floor((avail / first.width) * 100) / 100));
  }

  layout() {
    // 拡大率を変えても見ていた場所を保つ
    const anchor = this.pages.find((p) => p.el.getBoundingClientRect().bottom > 0);
    const before = anchor?.el.getBoundingClientRect();
    const frac = before && before.height ? -before.top / before.height : 0;
    for (const p of this.pages) {
      p.viewport = p.page.getViewport({scale: this.zoom * CSS_UNITS});
      p.el.style.width = `${Math.floor(p.viewport.width)}px`;
      p.el.style.height = `${Math.floor(p.viewport.height)}px`;
      p.rendered = false;
      if (p.visible) this.renderPage(p);
    }
    for (const a of this.annos.values()) this.place(a);
    this.$('zoom-label').textContent = `${Math.round(this.zoom * 100)}%`;
    if (anchor && frac > 0) {
      const top = anchor.el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({top: top + frac * anchor.el.offsetHeight});
    }
  }

  setZoom(z) {
    this.zoom = Math.min(4, Math.max(0.25, z));
    this.layout();
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
    const dpr = window.devicePixelRatio || 1;
    const vp = p.viewport;
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
    const el = document.createElement('div');
    el.dataset.key = a.key;
    if (a.kind === 'text') {
      el.className = 'anno-text';
      el.textContent = a.body;
    } else if (a.kind === 'mask') {
      el.className = 'anno-mask';
      el.title = '文字隠し';
      // 赤シートがかぶったところだけ見せる黒い覆い（syncCovers が切り抜く）。下の文字を確実に読めなくする
      el.innerHTML = '<span class="anno-mask__cover"></span>';
    } else {
      el.className = 'anno-note';
      el.innerHTML = `<button type="button" class="anno-note__icon" aria-label="付箋"></button>
        <div class="anno-note__pop" hidden>
          <textarea maxlength="5000" placeholder="メモを書く"></textarea>
          <div class="anno-note__foot"><button type="button" class="btn btn--small" data-note="delete">削除</button><button type="button" class="btn btn--small" data-note="close">閉じる</button></div>
        </div>`;
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
    a.el = el;
    p.layer.append(el);
    this.annos.set(a.key, a);
    this.applyStyle(a);
    this.place(a);
    return a;
  }

  applyStyle(a) {
    if (a.kind === 'text') {
      a.el.style.fontWeight = a.style.bold ? '700' : '400';
      a.el.style.color = a.style.color;
    } else if (a.kind === 'note') {
      a.el.style.setProperty('--note', a.style.color);
      this.noteTitle(a);
    }
  }

  noteTitle(a) {
    const head = a.body.trim().slice(0, 80);
    a.el.querySelector('.anno-note__icon').title = head
      ? head + (a.body.trim().length > 80 ? '…' : '')
      : '付箋（押すと開きます）';
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
    if (!vp) return;
    const s = this.toScreen(a.page, a.rect);
    a.el.style.left = `${s.left}px`;
    a.el.style.top = `${s.top}px`;
    if (a.kind === 'text') {
      a.el.style.fontSize = `${a.style.size * vp.scale}px`;
      a.el.style.maxWidth = `${Math.max(40, vp.width - s.left)}px`;
    } else if (a.kind === 'mask') {
      a.el.style.width = `${s.width}px`;
      a.el.style.height = `${s.height}px`;
      this.syncCovers();
    } else a.el.style.setProperty('--note-size', `${NOTE_SIZE * vp.scale}px`);
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
    if (a.id || a.chain)
      this.track(
        a,
        async () => a.id && (await api['annotation.remove']({materialId: this.materialId, annotationId: a.id}))
      );
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
      if (a.removed) await api['annotation.remove']({materialId: this.materialId, annotationId: a.id}); // 保存中に消された
    });
  }

  track(a, fn) {
    this.inflight++;
    this.setStatus('saving');
    const chain = (a.chain = (a.chain ?? Promise.resolve())
      .then(fn)
      .then(
        () => (this.failed = false),
        (e) => {
          this.failed = true;
          console.error(e);
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
    this.undoStack.push({key, before, after});
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
    this.redoStack = [];
    this.updateHistory();
  }

  undo() {
    this.finishEdit();
    const step = this.undoStack.pop();
    if (!step) return;
    this.restore(step.key, step.before);
    this.redoStack.push(step);
    this.updateHistory();
  }

  redo() {
    this.finishEdit();
    const step = this.redoStack.pop();
    if (!step) return;
    this.restore(step.key, step.after);
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
      if (a.page !== data.page) this.pages[data.page - 1].layer.append(a.el);
      Object.assign(a, data);
      if (a.kind === 'text') a.el.textContent = a.body;
      else if (a.kind === 'note') a.el.querySelector('textarea').value = a.body;
      this.applyStyle(a);
      this.place(a);
    }
    this.select(a);
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

  setStatus(state) {
    const el = this.$('status');
    if (!el) return;
    const pending = state === 'saving' || this.inflight > 0 || [...this.annos.values()].some((a) => a.timer);
    el.textContent = this.failed
      ? '保存できませんでした'
      : pending
        ? '保存中…'
        : this.annos.size || this.saved
          ? '保存しました'
          : '';
    if (!pending && !this.failed) this.saved = true;
    el.classList.toggle('is-error', this.failed);
  }

  // ---- 操作 ----
  setTool(tool) {
    this.tool = tool;
    if (tool !== 'select') {
      this.finishEdit();
      if (this.selected && this.selected.kind !== tool) this.select(null);
    }
    this.pagesEl.dataset.tool = tool;
    for (const b of this.root.querySelectorAll('[data-tool]'))
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    this.updateBar();
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
    this.updateBar();
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
    this.$('delete').disabled = !a;
  }

  bindBar() {
    const bar = this.root.querySelector('.viewer-bar');
    // ツールバーを押しても文字入れの編集を終わらせない（書式を変えながら打てるように）
    this.on(bar, 'pointerdown', (e) => {
      if (this.editing && e.target.closest('button, .swatch')) e.preventDefault();
    });
    this.on(bar, 'click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.tool) this.setTool(t.dataset.tool);
      else if (t.dataset.textColor) this.setTextStyle({color: t.dataset.textColor});
      else if (t.dataset.noteColor) this.setNoteColor(t.dataset.noteColor);
      else if (t.dataset.v === 'bold')
        this.setTextStyle({bold: !(this.selected?.kind === 'text' ? this.selected.style : this.textStyle).bold});
      else if (t.dataset.v === 'delete' && this.selected) this.removeAnno(this.selected);
      else if (t.dataset.v === 'zoom-in') this.setZoom(ZOOMS.find((z) => z > this.zoom + 0.001) ?? this.zoom);
      else if (t.dataset.v === 'zoom-out')
        this.setZoom([...ZOOMS].reverse().find((z) => z < this.zoom - 0.001) ?? this.zoom);
      else if (t.dataset.v === 'fit') this.setZoom(this.fitZoom());
      else if (t.dataset.v === 'back') this.onBack();
      else if (t.dataset.v === 'undo') this.undo();
      else if (t.dataset.v === 'redo') this.redo();
      else if (t.dataset.v === 'sheet') this.toggleSheet();
      else if (t.dataset.v === 'export') this.openExport();
    });
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
    this.on(el, 'pointerdown', (e) => this.onPointerDown(e));
    this.on(el, 'pointermove', (e) => this.onPointerMove(e));
    this.on(el, 'pointerup', (e) => this.onPointerUp(e));
    this.on(el, 'dblclick', (e) => {
      const a = this.annoOf(e.target);
      if (a?.kind === 'text') this.edit(a);
    });
    this.on(el, 'click', (e) => {
      const btn = e.target.closest('[data-note]');
      const a = btn && this.annoOf(btn);
      if (!a) return;
      if (btn.dataset.note === 'delete') this.removeAnno(a);
      else this.openNote(a, false);
    });
    this.on(document, 'keydown', (e) => this.onKey(e));
    this.on(window, 'beforeunload', () => this.flushAll());
    this.on(window, 'scroll', () => this.sheet && this.syncCovers(), {passive: true});
  }

  annoOf(target) {
    const el = target.closest?.('[data-key]');
    return el ? this.annos.get(el.dataset.key) : null;
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.anno-note__pop')) return; // 付箋の本文は普通に打てる
    const a = this.annoOf(e.target);
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
    this.createAt(this.tool, p, e.clientX - box.left, e.clientY - box.top);
  }

  // ---- 文字隠し：文字の上をなぞって水色のマーカーを引く。文字の行に高さを合わせる ----
  startMask(e, p, box) {
    this.select(null);
    p.textPromise ??= this.textItems(p);
    const el = document.createElement('div');
    el.className = 'anno-mask anno-mask--draft';
    p.layer.append(el);
    const x = e.clientX - box.left,
      y = e.clientY - box.top;
    this.drawing = {p, el, x0: x, y0: y, x1: x, y1: y, pointer: e.pointerId};
    this.pagesEl.setPointerCapture(e.pointerId);
    this.drawDraft();
  }

  drawDraft() {
    const d = this.drawing;
    const h = Math.max(Math.abs(d.y1 - d.y0), DEFAULT_SIZE * d.p.viewport.scale);
    const top = Math.abs(d.y1 - d.y0) < 12 ? d.y0 - h / 2 : Math.min(d.y0, d.y1);
    Object.assign(d.el.style, {
      left: `${Math.min(d.x0, d.x1)}px`,
      top: `${top}px`,
      width: `${Math.abs(d.x1 - d.x0)}px`,
      height: `${Math.abs(d.y1 - d.y0) < 12 ? h : Math.abs(d.y1 - d.y0)}px`
    });
  }

  /** ページの文字列（pdf.js の textContent。画面の座標へは finishMask で直す） */
  async textItems(p) {
    const tc = await p.page.getTextContent();
    return tc.items.filter((it) => it.str && it.width > 0);
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
    const pieces = (list, from, to) =>
      list
        .slice()
        .sort((a, b) => a.top - b.top || a.left - b.left)
        .map((it) => {
          const n = it.str.length,
            w = it.right - it.left;
          const s = Math.max(0, Math.floor(((from - it.left) / w) * n));
          const e = Math.min(n, Math.ceil(((to - it.left) / w) * n));
          return it.str.slice(s, e);
        })
        .join('');
    let box, hidden;
    if (Math.abs(d.y1 - d.y0) < 12) {
      // 横になぞった：なぞり始めの高さにある行に合わせる。動かさずに押しただけなら、その語の上
      const onLine = items.filter((it) => d.y0 >= it.hitTop && d.y0 <= it.hitBottom);
      const hit = onLine.filter((it) => it.left < x2 && it.right > x1);
      if (x2 - x1 < 2) {
        const word = onLine.find((it) => it.left <= x1 && x1 <= it.right);
        if (!word) return;
        hit.splice(0, hit.length, word);
        x1 = word.left;
        x2 = word.right;
      }
      if (hit.length) {
        const top = Math.min(...hit.map((it) => it.top));
        const bottom = Math.max(...hit.map((it) => it.bottom));
        box = {left: x1, top, width: x2 - x1, height: bottom - top};
        hidden = pieces(hit, x1, x2);
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
      style: {}
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

  // ---- 赤シート：画面の上に置く赤い下敷き。ドラッグで動かし、右下の角で大きさを変える ----
  toggleSheet(on = !this.sheet) {
    if (!on) {
      this.sheet?.remove();
      this.sheet = null;
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
      if (!(await this.settle())) return toast('保存できていない注釈があるため書き出せません');
      const texts = [];
      for (const a of this.annos.values())
        if (a.kind === 'text' && a.id) texts.push({id: a.id, png: await this.textToPng(a)});
      const r = await api['pdf.export']({materialId: this.materialId, options, texts});
      if (r?.error) toast(r.error);
      else if (r?.ok) toast(`書き出しました：${r.name}`);
    } catch (e) {
      toast(`書き出せませんでした（${e.message}）`);
    } finally {
      btn.disabled = false;
    }
  }

  /** 画面に出ている行の区切りのまま、文字入れを PNG にする（ヒラギノで描く。フォントは PDF に埋め込まない） */
  async textToPng(a) {
    const k = EXPORT_PX_PER_PT;
    const scale = this.pages[a.page - 1].viewport.scale;
    const box = this.toScreen(a.page, a.rect);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil((box.width / scale) * k));
    canvas.height = Math.max(1, Math.ceil((box.height / scale) * k));
    const ctx = canvas.getContext('2d');
    const font = `${a.style.bold ? 700 : 400} ${a.style.size * k}px ${FONT}`;
    await document.fonts.load(font).catch(() => {});
    ctx.font = font;
    ctx.fillStyle = a.style.color;
    const m = ctx.measureText('あ');
    const lh = a.style.size * LINE_HEIGHT * k;
    const base = (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const pad = k / scale; // .anno-text の左の余白 1px
    this.textLines(a.el).forEach((line, i) => ctx.fillText(line, pad, i * lh + base));
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
    d.a.el.style.left = `${d.left + dx}px`;
    d.a.el.style.top = `${d.top + dy}px`;
    if (d.a.kind === 'mask') this.syncCovers();
  }

  onPointerUp(e) {
    if (this.drawing?.pointer === e.pointerId) return void this.finishMask();
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
      const {width, height} = this.toScreen(a.page, a.rect);
      a.rect = this.fromScreen(a.page, {left, top, width, height});
      this.place(a);
      this.record(a.key, d.before, this.snap(a));
      this.scheduleSave(a, 0);
    } else if (a.kind === 'note') this.openNote(a, a.el.querySelector('.anno-note__pop').hidden);
    else if (a.kind === 'text' && this.tool === 'text') this.edit(a);
  }

  onKey(e) {
    const t = e.target;
    const typing = t.closest?.('input, textarea, [contenteditable="plaintext-only"], [contenteditable="true"]');
    if (typing) {
      if (e.key === 'Escape' && t.tagName === 'TEXTAREA') {
        const a = this.annoOf(t);
        if (a) this.openNote(a, false);
      }
      return;
    }
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      if (k === 'z' && !e.shiftKey) this.undo();
      else if ((k === 'z' && e.shiftKey) || k === 'y') this.redo();
      else if (k === 'e') this.openExport();
      else return;
      return e.preventDefault();
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (k === 'v') this.setTool('select');
    else if (k === 't') this.setTool('text');
    else if (k === 'm') this.setTool('note');
    else if (k === 'h') this.setTool('mask');
    else if (k === 'r') this.toggleSheet();
    else if (e.key === 'Escape') {
      this.select(null);
      this.setTool('select');
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      e.preventDefault();
      this.removeAnno(this.selected);
    }
  }

  unmount() {
    this.flushAll();
    this.destroyed = true;
    for (const off of this.listeners) off();
    this.observer?.disconnect();
    this.toggleSheet(false);
    cancelAnimationFrame(this.coverFrame);
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
