// PDF ビューアと編集（SPEC §9）。アプリ内で開けて編集できるのは PDF だけ。
// 編集は「文字入れ」（フォントはヒラギノ角ゴのみ。サイズ・太字・色を変えられる）と「付箋」（メモ）。
// 元の PDF は変えない（§9.1）。注釈はページ座標（PDF のユーザー空間、左下原点、pt）でメインの DB に保存する。
// ほかの画面と違い、状態が変わるたびに描き直さない（app.js が mount / unmount だけ呼ぶ）。
// pdf.js は互換版（legacy）を使う。通常版は Map.prototype.getOrInsertComputed などの新しい機能を前提にしており、
// Electron の Chromium の版によっては動かない
import * as pdfjs from '../../../node_modules/pdfjs-dist/legacy/build/pdf.min.mjs';

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
    <span class="muted viewer-bar__status" data-v="status" aria-live="polite"></span>
  </div>
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
    } else {
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

  /** PDF 座標 → 画面の位置。箱の左上（PDF では y + h）を基準にする */
  place(a) {
    const vp = this.pages[a.page - 1].viewport;
    if (!vp) return;
    const [vx, vy] = vp.convertToViewportPoint(a.rect.x, a.rect.y + a.rect.h);
    a.el.style.left = `${vx}px`;
    a.el.style.top = `${vy}px`;
    if (a.kind === 'text') {
      a.el.style.fontSize = `${a.style.size * vp.scale}px`;
      a.el.style.maxWidth = `${Math.max(40, vp.width - vx)}px`;
    } else a.el.style.setProperty('--note-size', `${NOTE_SIZE * vp.scale}px`);
  }

  /** 画面の箱の大きさから rect の幅・高さを取り直す。左上は動かさない */
  measure(a) {
    const s = this.pages[a.page - 1].viewport.scale;
    const top = a.rect.y + a.rect.h;
    a.rect.w = a.el.offsetWidth / s;
    a.rect.h = a.el.offsetHeight / s;
    a.rect.y = top - a.rect.h;
  }

  createAt(kind, p, vx, vy) {
    const [x, top] = p.viewport.convertToPdfPoint(vx, vy);
    if (kind === 'text') {
      const style = {...this.textStyle};
      const h = style.size * 1.5;
      const a = this.addAnno({
        key: `k${this.seq++}`,
        id: null,
        page: p.num,
        kind,
        rect: {x, y: top - h, w: 0, h},
        body: '',
        style
      });
      this.select(a);
      this.edit(a);
    } else {
      const half = NOTE_SIZE / 2;
      const a = this.addAnno({
        key: `k${this.seq++}`,
        id: null,
        page: p.num,
        kind,
        rect: {x: x - half, y: top - half, w: NOTE_SIZE, h: NOTE_SIZE},
        body: '',
        style: {color: this.noteColor}
      });
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
    if (!body.trim()) return this.removeAnno(a);
    if (body !== el.innerText) el.textContent = body;
    a.body = body;
    this.measure(a);
    this.scheduleSave(a, 0);
  }

  openNote(a, open) {
    const pop = a.el.querySelector('.anno-note__pop');
    pop.hidden = !open;
    a.el.classList.toggle('is-open', open);
    if (open) pop.querySelector('textarea').focus();
  }

  removeAnno(a) {
    if (a.removed) return;
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
    a.chain = (a.chain ?? Promise.resolve())
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
        this.setStatus();
      });
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
  setTextStyle(patch) {
    const a = this.selected;
    if (a?.kind === 'text') {
      Object.assign(a.style, patch);
      this.applyStyle(a);
      this.place(a);
      if (this.editing !== a) {
        this.measure(a);
        this.scheduleSave(a);
      }
    }
    Object.assign(this.textStyle, patch);
    this.updateBar();
  }

  setNoteColor(color) {
    const a = this.selected;
    if (a?.kind === 'note') {
      a.style.color = color;
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
    });
    const size = this.$('size');
    this.on(size, 'change', () => {
      const v = clampSize(size.value);
      size.value = String(v);
      this.setTextStyle({size: v});
    });
    this.on(this.$('text-custom'), 'input', (e) => this.setTextStyle({color: e.target.value.toLowerCase()}));
    this.on(this.$('note-custom'), 'input', (e) => this.setNoteColor(e.target.value.toLowerCase()));
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
    this.createAt(this.tool, p, e.clientX - box.left, e.clientY - box.top);
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d || d.pointer !== e.pointerId) return;
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    d.a.el.classList.add('is-dragging');
    d.a.el.style.left = `${d.left + dx}px`;
    d.a.el.style.top = `${d.top + dy}px`;
  }

  onPointerUp(e) {
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
      const [x, yTop] = p.viewport.convertToPdfPoint(left, top);
      a.rect.x = x;
      a.rect.y = yTop - a.rect.h;
      this.place(a);
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
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'v') this.setTool('select');
    else if (k === 't') this.setTool('text');
    else if (k === 'm') this.setTool('note');
    else if (e.key === 'Escape') {
      this.select(null);
      this.setTool('select');
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      e.preventDefault();
      this.removeAnno(this.selected);
    } else return;
  }

  unmount() {
    this.flushAll();
    this.destroyed = true;
    for (const off of this.listeners) off();
    this.observer?.disconnect();
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
