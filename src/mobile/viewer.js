// スマホのページ：PDF を見る・書き込む（docs/MOBILE.md §5）。
// 見えるのはパソコンの注釈すべて（文字入れ・ボールペン・マーカー・文字隠し・コメント・貼りもの・付箋）。スマホで書けるのはコメント・マーカー・文字隠しだけ（shared/mobile-kinds.js）。
// 書いたものはその場でパソコンへ送る（パソコンの PDF の画面にもすぐ出る。ファイルへの描き込みはパソコンで開いたとき）
import * as pdfjs from '/m/pdfjs/legacy/build/pdf.min.mjs';
import {call} from './client.js';
import {esc, sheet, toast} from './ui.js';
import {decodePoints, strokePath} from '/m/shared/ink.js';
import {
  DEFAULT_NOTE_COLOR,
  DEFAULT_SIZE,
  INDEX_COLOR,
  MASK_COLOR,
  MEMO_COLOR,
  MEMO_SIZE,
  NOTE_INK_SCALE,
  NOTE_MAX,
  NOTE_SIZE,
  hidesUnderRedSheet
} from '/m/shared/annotation.js';
import {MOBILE_KINDS} from '/m/shared/mobile-kinds.js';
import {textSegments} from '/m/shared/text-runs.js';
import {charEdges, fitToInk, inkFromImage, snapRange, textIn, wordAt} from '/m/shared/text-snap.js';
import {builtinStickerUrl, isBuiltinSticker} from '/m/shared/stickers.js';
import {figureUrl} from '/m/shared/figures.js';
import {inkOn} from '/m/shared/skin.js';

pdfjs.GlobalWorkerOptions.workerSrc = '/m/pdfjs/legacy/build/pdf.worker.min.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_CANVAS_PIXELS = 8 * 1024 * 1024; // 1 ページの絵の画素の上限（iPhone の Safari は大きな canvas を描けない）
const INDEX_OVER = 14; // 付箋（インデックス）がページに重なる幅（pt。パソコンと同じ）
const MARKERS = [
  ['#ffe14d', '黄'],
  ['#ff9ec7', 'ピンク'],
  ['#9be38a', '緑'],
  ['#8fd3ff', '青']
];
const TOOLS = [
  ['view', '見る'],
  ['note', 'コメント'],
  ['line', 'マーカー'],
  ['mask', '隠す'],
  ['erase', '消す']
];
const TOOL_HINT = {
  view: '',
  note: 'コメントを置く所を押してください',
  line: '文字の上を横になぞります（ページを動かすときは「見る」）',
  mask: '隠す文字をなぞります。押すと 1 語（動かすときは「見る」）',
  erase: 'スマホで書けるもの（コメント・マーカー・文字隠し）を押すと消えます'
};
const TOOL_KEY = 'daigaku-note.tool';

/** 行の字の上下（覆う範囲）と、その行をなぞったとみなす上下（パソコンの viewer/shared.js と同じ） */
const lineOf = (items) => ({
  top: Math.min(...items.map((it) => it.top)),
  bottom: Math.max(...items.map((it) => it.bottom)),
  hitTop: Math.min(...items.map((it) => it.hitTop)),
  hitBottom: Math.max(...items.map((it) => it.hitBottom))
});
const isFlat = (d, line) => Math.abs(d.y1 - d.y0) < 12 || (!!line && d.y1 >= line.hitTop && d.y1 <= line.hitBottom);

let measureCtx = null;
/** 字の相対的な幅（全角・半角の違い）。文字列の幅を字ごとに分けるのに使う（text-snap.js） */
const measureChar = (ch) => {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = '100px sans-serif';
  return measureCtx.measureText(ch).width;
};

/**
 * PDF を開く。戻りは後片付け（画面を離れるとき）
 * @param {HTMLElement} app
 * @param {string} materialId
 */
export async function openPdf(app, materialId, {back}) {
  app.innerHTML = '<p class="m-empty">PDF を読み込んでいます…</p>';
  const r = await call('pdf.open', {materialId});
  const v = new PhoneViewer(app, materialId, r, back);
  await v.load();
  return () => v.destroy();
}

class PhoneViewer {
  constructor(app, materialId, r, back) {
    this.app = app;
    this.materialId = materialId;
    this.r = r;
    this.back = back;
    this.pages = [];
    this.annos = new Map(); // id → 注釈
    this.tool = 'view';
    this.marker = {color: MARKERS[0][0], width: 2.5};
    this.sheetEl = null;
    this.drawing = null;
    this.offs = [];
    this.destroyed = false;
    this.stickers = new Map(); // 取り込んだシールの id → data URL
  }

  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.offs.push(() => target.removeEventListener(type, fn, opts));
  }

  async load() {
    const {material, bytes} = this.r;
    this.app.innerHTML = `
      <div class="m-viewer">
        <header class="m-head m-head--viewer">
          <button class="m-btn" data-v="back" aria-label="戻る">←</button>
          <h1 class="m-viewer__title">${esc(material.name.replace(/\.pdf$/i, ''))}</h1>
          <button class="m-btn" data-v="marks">付箋</button>
          <button class="m-btn" data-v="sheet" aria-pressed="false">赤シート</button>
        </header>
        <div class="m-pages" data-tool="view"></div>
        <span class="m-pageno" data-v="pageno" aria-live="polite"></span>
        <div class="m-dock">
          <div class="m-markers" data-v="markers" hidden>
            ${MARKERS.map(([c, name]) => `<button class="m-swatch" style="--sw: ${c}" data-color="${c}" aria-label="${name}"></button>`).join('')}
            <button class="m-btn m-btn--small" data-v="thick" aria-pressed="false">太く</button>
          </div>
          <p class="m-viewer__hint" data-v="hint" hidden></p>
          <nav class="m-tools" aria-label="道具">
            ${TOOLS.map(([id, label]) => `<button class="m-tool" data-tool="${id}" aria-pressed="${id === 'view'}">${label}</button>`).join('')}
          </nav>
        </div>
      </div>`;
    this.root = this.app.querySelector('.m-viewer');
    this.pagesEl = this.root.querySelector('.m-pages');
    this.$ = (k) => this.root.querySelector(`[data-v="${k}"]`);
    this.$('back').onclick = () => this.back();
    this.$('sheet').onclick = () => this.toggleSheet();
    if (this.$('marks')) this.$('marks').onclick = () => this.openBookmarks();
    for (const b of this.root.querySelectorAll('.m-tool')) b.onclick = () => this.setTool(b.dataset.tool);
    for (const b of this.root.querySelectorAll('.m-swatch')) b.onclick = () => this.setMarker({color: b.dataset.color});
    this.$('thick').onclick = () => this.setMarker({width: this.marker.width === 5 ? 2.5 : 5});
    this.setMarker({});

    this.task = pdfjs.getDocument({
      data: bytes,
      cMapUrl: '/m/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/m/pdfjs/standard_fonts/',
      wasmUrl: '/m/pdfjs/wasm/',
      isEvalSupported: false,
      enableXfa: false
    });
    this.doc = await this.task.promise;
    if (this.destroyed) return;
    const first = await this.doc.getPage(1);
    const width = this.pagesEl.clientWidth - 16;
    this.scale = Math.max(0.3, width / first.getViewport({scale: 1}).width);
    for (let n = 1; n <= this.doc.numPages; n++) {
      const page = n === 1 ? first : await this.doc.getPage(n);
      if (this.destroyed) return;
      this.addPage(n, page);
    }
    for (const a of this.r.annotations ?? []) this.addAnno(a);
    this.loadStickers();
    this.observe();
    this.bindPointer();
    let t = null;
    try {
      t = localStorage.getItem(TOOL_KEY);
    } catch {
      t = null;
    }
    if (t && TOOLS.some(([id]) => id === t)) this.setTool(t);
    // パソコンで書いた分を取り直す：スマホに戻ってきたとき・開いている間は 30 秒ごと
    this.on(document, 'visibilitychange', () => document.visibilityState === 'visible' && this.refresh());
    this.poll = setInterval(() => document.visibilityState === 'visible' && this.refresh(), 30000);
    this.on(window, 'scroll', () => this.onScroll(), {passive: true});
    // 指で拡大したら、その細かさで描き直す
    if (window.visualViewport)
      this.on(window.visualViewport, 'resize', () => {
        clearTimeout(this.zoomTimer);
        this.zoomTimer = setTimeout(() => this.rerender(), 300);
      });
    this.onScroll();
  }

  // ---- ページ ----
  addPage(num, page) {
    const viewport = page.getViewport({scale: this.scale});
    const el = document.createElement('div');
    el.className = 'm-page';
    el.dataset.page = String(num);
    el.style.width = `${Math.floor(viewport.width)}px`;
    el.style.height = `${Math.floor(viewport.height)}px`;
    el.innerHTML = `<canvas class="m-page__canvas"></canvas><div class="m-page__layer"><svg class="m-page__ink" width="100%" height="100%"><g></g></svg></div>`;
    const ink = el.querySelector('g');
    ink.setAttribute('transform', `matrix(${viewport.transform.join(',')})`);
    this.pagesEl.append(el);
    this.pages.push({
      num,
      page,
      viewport,
      el,
      canvas: el.querySelector('canvas'),
      layer: el.querySelector('.m-page__layer'),
      ink,
      rendered: 0,
      visible: false
    });
  }

  observe() {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const p = this.pages[Number(e.target.dataset.page) - 1];
          p.visible = e.isIntersecting;
          if (p.visible) this.renderPage(p);
          else this.release(p);
        }
      },
      {rootMargin: '150% 0px'}
    );
    for (const p of this.pages) this.observer.observe(p.el);
  }

  /** 描く細かさ：画面の画素の細かさ × 指で拡大した倍率（3 倍まで）。大きすぎるページは落とす */
  pixelRatio(p) {
    const want = Math.min(3, (window.devicePixelRatio || 1) * (window.visualViewport?.scale ?? 1));
    const px = p.viewport.width * p.viewport.height;
    return Math.min(want, Math.sqrt(MAX_CANVAS_PIXELS / px));
  }

  async renderPage(p) {
    const k = this.pixelRatio(p);
    if (p.rendered && Math.abs(p.rendered - k) < 0.05) return;
    p.renderTask?.cancel();
    const canvas = document.createElement('canvas');
    canvas.className = 'm-page__canvas';
    canvas.width = Math.floor(p.viewport.width * k);
    canvas.height = Math.floor(p.viewport.height * k);
    const task = (p.renderTask = p.page.render({
      canvasContext: canvas.getContext('2d'),
      viewport: p.viewport,
      transform: k !== 1 ? [k, 0, 0, k, 0, 0] : null
    }));
    try {
      await task.promise;
    } catch {
      return; // 描き直しで取り消した
    }
    if (this.destroyed || p.renderTask !== task) return;
    p.renderTask = null;
    // 描き終わってから入れ替える（描いている間に白くならない）
    p.canvas.replaceWith(canvas);
    p.canvas.width = 0; // 古い絵の画素を手放す
    p.canvas = canvas;
    p.rendered = k;
  }

  /** 遠くへ離れたページの絵を手放す（スマホの画素の上限に当たらないように） */
  release(p) {
    p.renderTask?.cancel();
    p.renderTask = null;
    if (!p.rendered) return;
    p.canvas.width = 0;
    p.canvas.height = 0;
    p.rendered = 0;
  }

  rerender() {
    for (const p of this.pages) if (p.visible) this.renderPage(p);
  }

  onScroll() {
    const mid = window.innerHeight / 2;
    const p = this.pages.find((x) => x.el.getBoundingClientRect().bottom > mid) ?? this.pages.at(-1);
    if (p) this.$('pageno').textContent = `${p.num} / ${this.pages.length}`;
    if (this.sheetEl) this.syncCovers();
  }

  // ---- 座標 ----
  toScreen(page, r) {
    const vp = this.pages[page - 1].viewport;
    const [ax, ay] = vp.convertToViewportPoint(r.x, r.y);
    const [bx, by] = vp.convertToViewportPoint(r.x + r.w, r.y + r.h);
    return {left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay)};
  }

  fromScreen(page, s) {
    const vp = this.pages[page - 1].viewport;
    const [ax, ay] = vp.convertToPdfPoint(s.left, s.top);
    const [bx, by] = vp.convertToPdfPoint(s.left + s.width, s.top + s.height);
    const round = (x) => Math.round(x * 100) / 100;
    return {
      x: round(Math.min(ax, bx)),
      y: round(Math.min(ay, by)),
      w: round(Math.abs(bx - ax)),
      h: round(Math.abs(by - ay))
    };
  }

  // ---- 注釈を描く ----
  addAnno(a) {
    const p = this.pages[a.page - 1];
    if (!p) return null;
    a = {...a, style: a.style ?? {}, body: a.body ?? ''};
    if (a.kind === 'ink') {
      a.el = document.createElementNS(SVG_NS, 'path');
      a.el.setAttribute('fill', a.style.color);
      a.el.setAttribute(
        'd',
        strokePath(decodePoints(a.body) ?? [], a.style.width, {pressure: a.style.pressure !== false})
      );
      if (hidesUnderRedSheet(a.style.color)) a.el.dataset.red = '1';
      p.ink.append(a.el);
      this.annos.set(a.id, a);
      return a;
    }
    const el = document.createElement('div');
    el.className = `m-a m-a--${a.kind}`;
    el.dataset.id = a.id;
    el.dataset.kind = a.kind;
    const s = this.toScreen(a.page, a.rect);
    Object.assign(el.style, {left: `${s.left}px`, top: `${s.top}px`});
    const sz = () => Object.assign(el.style, {width: `${s.width}px`, height: `${s.height}px`});
    if (a.kind === 'text') {
      el.style.fontSize = `${(a.style.size ?? DEFAULT_SIZE) * this.scale}px`;
      el.style.fontWeight = a.style.bold ? '700' : '400';
      el.style.color = a.style.color;
      el.style.textAlign = a.style.align ?? '';
      el.style.maxWidth = `${Math.max(40, p.viewport.width - s.left)}px`;
      for (const {t, c} of textSegments(a.body, a.style.runs)) {
        const span = document.createElement('span');
        span.className = 'm-a__run';
        if (c) span.style.color = c;
        if (hidesUnderRedSheet(c ?? a.style.color)) span.dataset.red = '1';
        span.textContent = t;
        el.append(span);
      }
    } else if (a.kind === 'line') {
      sz();
      el.style.setProperty('--line', a.style.color);
    } else if (a.kind === 'mask') {
      sz();
      el.style.setProperty('--mask', a.style.color ?? MASK_COLOR);
      el.innerHTML = '<span class="m-a__cover"></span>';
    } else if (a.kind === 'note') {
      el.style.setProperty('--note', a.style.color ?? DEFAULT_NOTE_COLOR);
      el.style.setProperty('--note-size', `${NOTE_SIZE * this.scale}px`);
      el.innerHTML = `<button class="m-a__note" aria-label="メモ"></button>`;
      el.firstElementChild.onclick = () => this.tool !== 'erase' && this.openNote(a);
    } else if (a.kind === 'stamp') {
      sz();
      this.fillStamp(a, el);
    }
    a.el = el;
    // 文字入れ・貼りものはマーカーやメモの下（パソコンと同じ重なり）
    if (a.kind === 'text' || a.kind === 'stamp') p.layer.insertBefore(el, p.layer.firstChild);
    else p.layer.append(el);
    this.annos.set(a.id, a);
    if (this.sheetEl) this.syncCovers();
    return a;
  }

  fillStamp(a, el) {
    const {type, ref} = a.style;
    el.classList.add(`m-a--${type}`);
    if (type === 'memo') {
      const size = (a.style.size ?? MEMO_SIZE) * this.scale;
      el.style.setProperty('--memo', a.style.color ?? MEMO_COLOR);
      el.style.setProperty('--memo-font', `${size}px`);
      el.style.setProperty('--memo-lh', `${size * 1.6}px`);
      el.innerHTML = '<div class="m-a__memo"></div>';
      el.firstElementChild.textContent = a.body;
    } else if (type === 'index') {
      const color = a.style.color ?? INDEX_COLOR;
      el.style.setProperty('--index', color);
      el.style.setProperty('--index-ink', inkOn(color));
      el.style.setProperty('--index-over', `${INDEX_OVER * this.scale}px`);
      el.style.setProperty('--index-font', `${8 * this.scale}px`);
      el.innerHTML = '<span class="m-a__tab"></span>';
      el.firstElementChild.textContent = a.body;
    } else {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.className = 'm-a__img';
      if (type === 'figure') img.src = figureUrl(ref, a.style.params ?? null, a.style.labels ?? null);
      else if (isBuiltinSticker(ref)) img.src = builtinStickerUrl(ref);
      else if (this.stickers.has(ref)) img.src = this.stickers.get(ref);
      el.append(img);
    }
  }

  /** 取り込んだシールの画像をまとめて読む */
  async loadStickers() {
    const ids = [
      ...new Set(
        [...this.annos.values()]
          .filter((a) => a.kind === 'stamp' && a.style.type === 'sticker' && !isBuiltinSticker(a.style.ref))
          .map((a) => a.style.ref)
          .filter((id) => !this.stickers.has(id))
      )
    ];
    if (!ids.length) return;
    const {data} = await call('sticker.data', {ids}).catch(() => ({data: {}}));
    for (const [id, url] of Object.entries(data ?? {})) this.stickers.set(id, url);
    for (const a of this.annos.values())
      if (a.kind === 'stamp' && this.stickers.has(a.style.ref)) {
        const img = a.el.querySelector('img');
        if (img && !img.src) img.src = this.stickers.get(a.style.ref);
      }
  }

  removeAnnoEl(a) {
    a.el?.remove();
    this.annos.delete(a.id);
  }

  /** パソコンで書いた分を取り直す（書いている途中・メモを開いている間はしない） */
  async refresh() {
    if (this.destroyed || this.drawing || this.noteOpen || this.busy) return;
    let list;
    try {
      ({annotations: list} = await call('annotation.list', {materialId: this.materialId}));
    } catch {
      return; // 届かないときは次の機会に
    }
    if (this.destroyed || this.drawing || this.noteOpen) return;
    const seen = new Set();
    for (const row of list) {
      seen.add(row.id);
      const old = this.annos.get(row.id);
      if (old && same(old, row)) continue;
      if (old) this.removeAnnoEl(old);
      this.addAnno(row);
    }
    for (const a of [...this.annos.values()]) if (!seen.has(a.id)) this.removeAnnoEl(a);
    this.loadStickers();
  }

  // ---- 道具 ----
  setTool(tool) {
    this.tool = tool;
    this.pagesEl.dataset.tool = tool;
    for (const b of this.root.querySelectorAll('.m-tool'))
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    this.$('markers').hidden = tool !== 'line';
    const hint = this.$('hint');
    hint.textContent = TOOL_HINT[tool];
    hint.hidden = !TOOL_HINT[tool];
    try {
      localStorage.setItem(TOOL_KEY, tool);
    } catch {
      // 覚えられなくてもよい
    }
  }

  setMarker(patch) {
    Object.assign(this.marker, patch);
    for (const b of this.root.querySelectorAll('.m-swatch'))
      b.setAttribute('aria-pressed', String(b.dataset.color === this.marker.color));
    this.$('thick').setAttribute('aria-pressed', String(this.marker.width === 5));
  }

  pageAt(e) {
    const el = e.target.closest?.('.m-page');
    return el ? this.pages[Number(el.dataset.page) - 1] : null;
  }

  bindPointer() {
    const pe = this.pagesEl;
    this.on(pe, 'pointerdown', (e) => {
      if (!e.isPrimary || this.tool === 'view') return;
      const p = this.pageAt(e);
      if (!p) return;
      const box = p.el.getBoundingClientRect();
      const x = e.clientX - box.left,
        y = e.clientY - box.top;
      if (this.tool === 'line' || this.tool === 'mask') {
        e.preventDefault();
        this.startDraw(e, p, x, y);
      } else this.tap = {id: e.pointerId, p, x, y, sx: e.clientX, sy: e.clientY, target: e.target};
    });
    this.on(pe, 'pointermove', (e) => {
      const d = this.drawing;
      if (d?.pointer === e.pointerId) {
        const box = d.p.el.getBoundingClientRect();
        d.x1 = e.clientX - box.left;
        d.y1 = e.clientY - box.top;
        this.drawDraft();
      } else if (this.tap?.id === e.pointerId && Math.hypot(e.clientX - this.tap.sx, e.clientY - this.tap.sy) > 10)
        this.tap = null;
    });
    const end = (e, cancel) => {
      if (this.drawing?.pointer === e.pointerId) {
        if (cancel) {
          this.drawing.el.remove();
          this.drawing = null;
        } else this.finishDraw();
      }
      const t = this.tap;
      if (t?.id === e.pointerId) {
        this.tap = null;
        if (!cancel) this.onTap(t);
      }
    };
    this.on(pe, 'pointerup', (e) => end(e, false));
    this.on(pe, 'pointercancel', (e) => end(e, true));
  }

  onTap(t) {
    if (this.tool === 'note') return this.createNote(t.p, t.x, t.y);
    if (this.tool === 'erase') {
      const el = t.target.closest?.('.m-a');
      const a = el && this.annos.get(el.dataset.id);
      if (!a) return;
      if (!MOBILE_KINDS.includes(a.kind)) return toast('この書き込みはパソコンで消してください');
      this.erase(a);
    }
  }

  // ---- マーカー・文字隠し：なぞる ----
  startDraw(e, p, x, y) {
    p.textPromise ??= this.textItems(p.page).catch(() => []);
    const el = document.createElement('div');
    el.className = `m-a m-a--${this.tool} m-a--draft`;
    if (this.tool === 'line') el.style.setProperty('--line', this.marker.color);
    p.layer.append(el);
    const d = (this.drawing = {kind: this.tool, p, el, x0: x, y0: y, x1: x, y1: y, pointer: e.pointerId, line: null});
    p.textPromise.then((raw) => {
      if (this.drawing !== d) return;
      const onLine = this.screenItems(p, raw).filter((it) => y >= it.hitTop && y <= it.hitBottom);
      if (onLine.length) d.line = lineOf(onLine);
      this.drawDraft();
    });
    this.pagesEl.setPointerCapture?.(e.pointerId);
    this.drawDraft();
  }

  lineBox(d, x1 = Math.min(d.x0, d.x1), x2 = Math.max(d.x0, d.x1)) {
    const h = Math.max(2, this.marker.width * this.scale);
    const mid = d.line ? d.line.bottom : d.y0;
    return {left: x1, top: mid - h / 2, width: x2 - x1, height: h};
  }

  drawDraft() {
    const d = this.drawing;
    let b;
    if (d.kind === 'line') b = this.lineBox(d);
    else {
      const flat = isFlat(d, d.line);
      const h = DEFAULT_SIZE * this.scale;
      b = {
        left: Math.min(d.x0, d.x1),
        top: flat ? (d.line?.top ?? d.y0 - h / 2) : Math.min(d.y0, d.y1),
        width: Math.abs(d.x1 - d.x0),
        height: flat ? (d.line ? d.line.bottom - d.line.top : h) : Math.abs(d.y1 - d.y0)
      };
    }
    Object.assign(d.el.style, {left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`});
  }

  async finishDraw() {
    const d = this.drawing;
    this.drawing = null;
    const raw = await d.p.textPromise;
    d.el.remove();
    if (this.destroyed) return;
    const made = d.kind === 'line' ? this.lineFrom(d, raw) : this.maskFrom(d, raw);
    if (made) await this.save(made);
  }

  lineFrom(d, raw) {
    let x1 = Math.min(d.x0, d.x1),
      x2 = Math.max(d.x0, d.x1);
    if (x2 - x1 < 3) return null;
    // 文字の行の上なら、端を字の切れ目に合わせる（字の途中で切らない）
    const onLine = this.screenItems(d.p, raw).filter((it) => d.y0 >= it.hitTop && d.y0 <= it.hitBottom);
    if (onLine.length) {
      d.line = lineOf(onLine);
      const hit = onLine.filter((it) => it.left < x2 && it.right > x1);
      const snapped = hit.length && snapRange(hit, x1, x2, measureChar);
      if (snapped) {
        x1 = snapped.left;
        x2 = snapped.right;
      }
    }
    return {
      kind: 'line',
      page: d.p.num,
      rect: this.fromScreen(d.p.num, this.lineBox(d, x1, x2)),
      body: '',
      style: {color: this.marker.color, width: this.marker.width}
    };
  }

  /** 文字隠し：パソコン（viewer/mask.js の finishMask）と同じ合わせ方 */
  maskFrom(d, raw) {
    const p = d.p;
    const items = this.screenItems(p, raw);
    let x1 = Math.min(d.x0, d.x1),
      x2 = Math.max(d.x0, d.x1);
    const pieces = (list, from, to) => textIn(list, from, to, measureChar);
    let box, hidden;
    const onLine = items.filter((it) => d.y0 >= it.hitTop && d.y0 <= it.hitBottom);
    if (isFlat(d, onLine.length ? lineOf(onLine) : null)) {
      let hit = onLine.filter((it) => it.left < x2 && it.right > x1);
      if (x2 - x1 < 4) {
        // 押しただけ：その位置の単語
        const it = onLine.find((t) => t.left <= x1 && x1 <= t.right);
        const word = it && wordAt(it, x1, measureChar);
        if (!word) return null;
        hit = [it];
        x1 = word.left;
        x2 = word.right;
      } else if (hit.length) {
        const snapped = snapRange(hit, x1, x2, measureChar);
        if (snapped) {
          x1 = snapped.left;
          x2 = snapped.right;
          hit = hit.filter((it) => it.left < x2 && it.right > x1);
        }
      }
      if (hit.length) {
        const top = Math.min(...hit.map((it) => it.top));
        const bottom = Math.max(...hit.map((it) => it.bottom));
        const edges = [...new Set(onLine.flatMap((it) => charEdges(it, measureChar)))].sort((a, b) => a - b);
        box = this.fitMask(p, {left: x1, top, width: x2 - x1, height: bottom - top}, (bottom - top) / 1.18, edges);
        hidden = pieces(hit, box.left, box.left + box.width);
      } else {
        const h = DEFAULT_SIZE * this.scale;
        box = {left: x1, top: d.y0 - h / 2, width: x2 - x1, height: h};
      }
    } else {
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
    if (box.width < 2 || box.height < 2) return null;
    return {
      kind: 'mask',
      page: p.num,
      rect: this.fromScreen(p.num, box),
      body: (hidden ?? '').slice(0, 2000),
      style: {}
    };
  }

  /** マーカーの箱を、描かれた字に合わせて直す（text-snap.js の fitToInk）。ページの絵がまだなければそのまま */
  fitMask(p, box, fh, edges) {
    const c = p.canvas;
    if (!c?.width) return box;
    const k = c.width / p.viewport.width;
    const x0 = Math.max(0, box.left - fh),
      y0 = Math.max(0, box.top - fh);
    const x1 = Math.min(p.viewport.width, box.left + box.width + fh),
      y1 = Math.min(p.viewport.height, box.top + box.height + fh);
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

  /** ページの文字列と、字ごとの送り幅（パソコンの viewer/mask.js の textItems と同じ） */
  async textItems(page) {
    const [tc, widths] = await Promise.all([page.getTextContent(), glyphWidths(page).catch(() => null)]);
    return tc.items
      .filter((it) => it.str && it.width > 0)
      .map((it) => ({...it, ws: widths && Array.from(it.str, (ch) => widths.get(`${it.fontName}|${ch}`) ?? null)}));
  }

  /** 文字列の画面での箱（横書きに見えるものだけ） */
  screenItems(p, items) {
    const vp = p.viewport;
    return items
      .map((it) => {
        const m = pdfjs.Util.transform(vp.transform, it.transform);
        const run = Math.hypot(m[0], m[1]);
        if (!run || m[0] <= 0 || Math.abs(m[1]) > run * 0.05) return null;
        const fh = Math.hypot(m[2], m[3]);
        if (!fh) return null;
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

  // ---- 送る・消す ----
  /** 新しい注釈をパソコンへ送って、返ってきた形で描く */
  async save(anno) {
    this.busy = true;
    try {
      const {annotation} = await call('annotation.save', {materialId: this.materialId, annotation: anno});
      if (!this.destroyed) this.addAnno(annotation);
      return annotation;
    } catch (e) {
      toast(e.message, {error: true});
      return null;
    } finally {
      this.busy = false;
    }
  }

  async erase(a) {
    this.busy = true;
    try {
      await call('annotation.remove', {materialId: this.materialId, annotationId: a.id});
      this.removeAnnoEl(a);
      const {id: _id, el: _el, z: _z, ...again} = a;
      toast('消しました', {action: {label: '元に戻す', run: () => this.save(again)}});
    } catch (e) {
      toast(e.message, {error: true});
    } finally {
      this.busy = false;
    }
  }

  // ---- メモ ----
  async createNote(p, x, y) {
    const n = NOTE_SIZE * this.scale;
    const a = await this.save({
      kind: 'note',
      page: p.num,
      rect: this.fromScreen(p.num, {left: x - n / 2, top: y - n / 2, width: n, height: n}),
      body: '',
      style: {color: DEFAULT_NOTE_COLOR}
    });
    if (a) this.openNote(this.annos.get(a.id), {fresh: true});
  }

  async openNote(a, {fresh = false} = {}) {
    if (!a) return;
    this.noteOpen = true;
    let typed = a.body;
    const strokes = Array.isArray(a.style.ink) ? a.style.ink : [];
    const result = await sheet(
      `<h2 class="m-sheet__title">コメント</h2>
       <textarea class="m-note__text" maxlength="${NOTE_MAX}" rows="6" placeholder="コメントを書く"></textarea>
       ${strokes.length ? '<svg class="m-note__ink" aria-label="パソコンで書いた手書き"></svg>' : ''}
       <div class="m-row"><button class="m-btn" data-v="del">削除</button><button class="m-btn m-btn--primary" data-v="ok">閉じる</button></div>`,
      (el, close) => {
        const ta = el.querySelector('textarea');
        ta.value = a.body;
        const svg = el.querySelector('.m-note__ink');
        if (svg) {
          let w = 0,
            h = 0;
          for (const s of strokes) {
            const pts = decodePoints(s.p) ?? [];
            for (const [px, py] of pts) {
              w = Math.max(w, px);
              h = Math.max(h, py);
            }
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('fill', s.c);
            path.setAttribute('d', strokePath(pts, s.w * NOTE_INK_SCALE, {pressure: s.pressure !== false}));
            svg.append(path);
          }
          svg.setAttribute('viewBox', `0 0 ${w + 8} ${h + 8}`);
        }
        if (fresh) setTimeout(() => ta.focus(), 50);
        el.querySelector('[data-v="ok"]').onclick = () => close({body: ta.value});
        el.querySelector('[data-v="del"]').onclick = () => close({remove: true});
        ta.oninput = () => (typed = ta.value);
      }
    );
    this.noteOpen = false;
    if (this.destroyed) return;
    // 外を押して閉じたとき（result が null）も、書いた分は残す
    const body = result ? result.body : typed;
    if (result?.remove || (fresh && !(body ?? '').trim() && !strokes.length)) {
      if (result?.remove) return this.erase(a);
      // 何も書かずに閉じた新しいメモは消す（取り消しは出さない）
      await call('annotation.remove', {materialId: this.materialId, annotationId: a.id}).catch(() => {});
      return this.removeAnnoEl(a);
    }
    if (body === a.body) return;
    const {el: _el, z: _z, ...rest} = a;
    try {
      const {annotation} = await call('annotation.save', {
        materialId: this.materialId,
        annotation: {...rest, body}
      });
      this.removeAnnoEl(a);
      this.addAnno(annotation);
      toast('コメントをパソコンへ送りました');
    } catch (e) {
      toast(e.message, {error: true});
    }
  }

  // ---- 付箋：ページの端の目印の一覧（押すとその場所へ）。前の版のしおりで、まだパソコンで付箋に移していないものも並べる ----
  async openBookmarks() {
    const tabs = [...this.annos.values()]
      .filter((a) => a.kind === 'stamp' && a.style.type === 'index' && this.pages[a.page - 1])
      .map((a) => ({
        name: a.body,
        page: a.page,
        y: this.toScreen(a.page, a.rect).top / this.pages[a.page - 1].viewport.height,
        color: a.style.color
      }));
    const list = [...tabs, ...(this.r.bookmarks ?? [])].sort((a, b) => a.page - b.page || a.y - b.y);
    const pick = await sheet(
      `<h2 class="m-sheet__title">付箋</h2>${
        list.length
          ? `<ul class="m-list">${list
              .map(
                (b, i) =>
                  `<li><button class="m-item" data-i="${i}"><span class="m-dot" style="--c: ${esc(b.color ?? '#f28b82')}"></span>${esc(b.name || '（言葉なし）')}<span class="m-sub">p.${b.page}</span></button></li>`
              )
              .join('')}</ul>`
          : '<p class="m-muted">付箋はまだありません。パソコンの PDF の画面で貼れます。</p>'
      }`,
      (el, close) => {
        for (const b of el.querySelectorAll('[data-i]')) b.onclick = () => close(list[Number(b.dataset.i)]);
      }
    );
    const p = pick && this.pages[pick.page - 1];
    if (!p) return;
    const top = p.el.getBoundingClientRect().top + window.scrollY + pick.y * p.el.offsetHeight - 80;
    window.scrollTo({top: Math.max(0, top)});
  }

  // ---- 赤シート：画面の上の赤い下敷き。指で動かし、下のつまみで高さを変える ----
  toggleSheet(on = !this.sheetEl) {
    if (!on) {
      this.sheetEl?.remove();
      this.sheetEl = null;
      for (const a of this.annos.values()) {
        if (a.el?.style) a.el.style.clipPath = '';
        if (a.kind === 'text') for (const s of a.el.querySelectorAll('.m-a__run')) s.style.clipPath = '';
        if (a.kind === 'mask') a.el.firstElementChild.style.display = 'none';
      }
    } else if (!this.sheetEl) {
      const el = document.createElement('div');
      el.className = 'm-redsheet';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', '赤シート');
      el.innerHTML = '<span class="m-redsheet__grip" aria-label="高さを変える"></span>';
      Object.assign(el.style, {top: `${Math.round(window.innerHeight * 0.4)}px`, height: '150px'});
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const r = el.getBoundingClientRect();
        const resize = e.target.classList.contains('m-redsheet__grip');
        const sy = e.clientY,
          top0 = r.top,
          h0 = r.height;
        const move = (ev) => {
          const dy = ev.clientY - sy;
          if (resize) el.style.height = `${Math.max(40, h0 + dy)}px`;
          else el.style.top = `${Math.min(window.innerHeight - 40, Math.max(0, top0 + dy))}px`;
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
      document.body.append(el);
      this.sheetEl = el;
    }
    this.$('sheet').setAttribute('aria-pressed', String(!!this.sheetEl));
    this.syncCovers();
  }

  /**
   * 赤シートの下に入った所：文字隠しは黒い覆いを見せ、赤く見える文字入れ・ボールペンは見えなくする（パソコンの viewer/mask.js と同じ）
   */
  syncCovers() {
    if (this.coverFrame) return;
    this.coverFrame = requestAnimationFrame(() => {
      this.coverFrame = 0;
      const sr = this.sheetEl?.getBoundingClientRect();
      if (!sr) return;
      const overOf = (r) => sr.left < r.right && sr.right > r.left && sr.top < r.bottom && sr.bottom > r.top;
      const poly = (x0, y0, x1, y1, hx0, hy0, hx1, hy1) =>
        `polygon(evenodd, ${x0}px ${y0}px, ${x1}px ${y0}px, ${x1}px ${y1}px, ${x0}px ${y1}px, ${x0}px ${y0}px, ${hx0}px ${hy0}px, ${hx1}px ${hy0}px, ${hx1}px ${hy1}px, ${hx0}px ${hy1}px, ${hx0}px ${hy0}px)`;
      for (const a of this.annos.values()) {
        if (a.kind === 'mask') {
          const cover = a.el.firstElementChild;
          const r = a.el.getBoundingClientRect();
          if (!overOf(r)) {
            cover.style.display = 'none';
            continue;
          }
          const left = Math.max(sr.left, r.left) - r.left,
            top = Math.max(sr.top, r.top) - r.top,
            right = r.right - Math.min(sr.right, r.right),
            bottom = r.bottom - Math.min(sr.bottom, r.bottom);
          cover.style.display = 'block';
          cover.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
        } else if (a.kind === 'text') {
          for (const s of a.el.querySelectorAll('.m-a__run[data-red]')) {
            const r = s.getBoundingClientRect();
            if (!overOf(r)) {
              s.style.clipPath = '';
              continue;
            }
            const hx0 = Math.max(sr.left, r.left) - r.left,
              hy0 = Math.max(sr.top, r.top) - r.top,
              hx1 = Math.min(sr.right, r.right) - r.left,
              hy1 = Math.min(sr.bottom, r.bottom) - r.top;
            s.style.clipPath = poly(-4, -4, r.width + 4, r.height + 4, hx0, hy0, hx1, hy1);
          }
        } else if (a.kind === 'ink' && a.el.dataset.red) {
          if (!overOf(a.el.getBoundingClientRect())) {
            a.el.style.clipPath = '';
            continue;
          }
          // clip-path の座標は path の座標系（PDF の pt。基準の箱は線の囲み）
          const p = this.pages[a.page - 1];
          const pr = p.el.getBoundingClientRect();
          const [ax, ay] = p.viewport.convertToPdfPoint(sr.left - pr.left, sr.top - pr.top);
          const [bx, by] = p.viewport.convertToPdfPoint(sr.right - pr.left, sr.bottom - pr.top);
          const box = a.el.getBBox();
          a.el.style.clipPath = poly(
            -8,
            -8,
            box.width + 8,
            box.height + 8,
            Math.min(ax, bx) - box.x,
            Math.min(ay, by) - box.y,
            Math.max(ax, bx) - box.x,
            Math.max(ay, by) - box.y
          );
        }
      }
    });
  }

  destroy() {
    this.destroyed = true;
    for (const off of this.offs) off();
    clearInterval(this.poll);
    clearTimeout(this.zoomTimer);
    cancelAnimationFrame(this.coverFrame);
    this.observer?.disconnect();
    this.toggleSheet(false);
    for (const p of this.pages) {
      p.renderTask?.cancel();
      p.canvas.width = 0;
    }
    this.task?.destroy();
  }
}

/** パソコンの注釈が変わっていないか（位置・中身・見た目） */
const same = (a, b) =>
  a.page === b.page &&
  a.kind === b.kind &&
  a.body === (b.body ?? '') &&
  JSON.stringify(a.rect) === JSON.stringify(b.rect) &&
  JSON.stringify(a.style) === JSON.stringify(b.style ?? {});

/** フォントと字ごとの送り幅（1 em = 1000）。描く命令の字形から集める */
async function glyphWidths(page) {
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
