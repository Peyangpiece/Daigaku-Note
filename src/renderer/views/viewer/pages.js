// PDF の編集画面：ページの描画と拡大（pdf.js・ピンチ・見えているページだけ描く）。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
import * as pdfjs from '../../../../node_modules/pdfjs-dist/legacy/build/pdf.min.mjs';
import {CSS_UNITS} from '../../desk-tools.js';
import {canvasScale, ZOOMS, clampZoom, PINCH_IDLE, PINCH_SPEED, INDEX_W, INDEX_OVER} from './shared.js';

export const methods = {
  // ---- 表示 ----
  fitZoom() {
    const first = this.pages[0]?.page.getViewport({scale: CSS_UNITS});
    if (!first) return 1;
    // ページの右の端からはみ出す付箋（インデックス）の分も、左右に空けておく（ページは真ん中に置く）
    const avail = this.pagesEl.clientWidth - 32;
    const tab = (INDEX_W - INDEX_OVER) * CSS_UNITS * 2;
    return Math.min(2, Math.max(0.5, Math.floor((avail / (first.width + tab)) * 100) / 100));
  },

  layout(keepAnchor = true) {
    // 拡大率を変えても見ていた場所を保つ
    const anchor = keepAnchor ? this.pages.find((p) => p.el.getBoundingClientRect().bottom > 0) : null;
    const before = anchor?.el.getBoundingClientRect();
    const frac = before && before.height ? -before.top / before.height : 0;
    for (const p of this.pages) {
      p.viewport = p.page.getViewport({scale: this.zoom * CSS_UNITS});
      p.el.style.width = `${Math.floor(p.viewport.width)}px`;
      p.el.style.height = `${Math.floor(p.viewport.height)}px`;
      p.el.style.setProperty('--scale-factor', String(p.viewport.scale)); // pdf.js の文字の層が字の大きさに使う
      p.el.style.setProperty('--total-scale-factor', String(p.viewport.scale));
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
  },

  /** ＋・−のボタンとメニューの「拡大」「縮小」（⌘＋・⌘−）「実際のサイズ」（⌘0）。PDF だけを拡大し、ツールバーや背景は変えない */
  zoomStep(dir) {
    if (!this.pages.length) return;
    if (dir === 'reset') this.setZoom(1, this.viewCenter());
    else if (dir === 'in') this.setZoom(ZOOMS.find((z) => z > this.zoom + 0.001) ?? this.zoom, this.viewCenter());
    else this.setZoom([...ZOOMS].reverse().find((z) => z < this.zoom - 0.001) ?? this.zoom, this.viewCenter());
  },

  /** ＋・−のボタンで拡大・縮小するときの基準：ツールバーより下に見えている範囲の真ん中 */
  viewCenter() {
    const top = this.root.querySelector('.viewer-bar').getBoundingClientRect().bottom;
    return {x: document.documentElement.clientWidth / 2, y: (top + window.innerHeight) / 2};
  },

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
  },

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
  },

  endPinch() {
    const p = this.pinch;
    this.pinch = null;
    if (!p || this.destroyed) return;
    this.pagesEl.style.transform = '';
    this.pagesEl.style.transformOrigin = '';
    if (Math.abs(p.zoom - this.zoom) > 0.001) this.setZoom(p.zoom, p); // 2 本指で動かしただけなら描き直さない
    if (p.dx || p.dy) window.scrollBy(-p.dx, -p.dy); // 指を動かした分だけ、ページも指について動く
  },

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
  },

  onTouchMove(e) {
    const p = this.pinch;
    if (!p?.touch || e.touches.length < 2) return;
    if (e.cancelable) e.preventDefault();
    const [a, b] = e.touches;
    p.zoom = clampZoom((p.start * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)) / p.dist);
    p.dx = (a.clientX + b.clientX) / 2 - p.x;
    p.dy = (a.clientY + b.clientY) / 2 - p.y;
    this.pagesEl.style.transform = `translate(${p.dx}px, ${p.dy}px) scale(${p.zoom / this.zoom})`;
  },

  onTouchEnd(e) {
    if (this.pinch?.touch && e.touches.length < 2) this.endPinch();
  },

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
      d.a.el.classList.remove('is-dragging', 'is-lifted');
      d.a.el.style.left = `${d.left}px`;
      d.a.el.style.top = `${d.top}px`;
      if (d.a.kind === 'mask') this.syncCovers();
    }
  },

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
  },

  async renderPage(p) {
    p.renderTask?.cancel();
    p.rendered = true;
    const vp = p.viewport;
    const dpr = canvasScale(vp, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page__canvas';
    canvas.setAttribute('role', 'presentation'); // 内容は文字の層が読み上げる
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    const task = p.page.render({canvas, viewport: vp, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0]});
    p.renderTask = task;
    try {
      await task.promise;
      if (p.renderTask !== task || this.destroyed) return;
      p.canvas.replaceWith(canvas); // 描き終わってから差し替える（ちらつかない）
      p.canvas = canvas;
      this.renderTextLayer(p, vp).catch((e) => console.warn('文字の層を作れませんでした', e));
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException' && p.renderTask === task) p.rendered = false;
    }
  },

  /**
   * 文字の層（pdf.js の TextLayer）：絵の上に透明な文字を同じ位置に重ねる。選択の道具のときだけマウスが届き、
   * ドラッグで選んでコピーできる。読み上げは常に文字を読める。拡大率が変わるたびに作り直す（絵と同じ）
   */
  async renderTextLayer(p, vp) {
    if (!pdfjs.TextLayer) return;
    p.textContent ??= await p.page.getTextContent();
    if (this.destroyed || p.viewport !== vp) return;
    const div = document.createElement('div');
    div.className = 'pdf-page__text';
    const layer = new pdfjs.TextLayer({textContentSource: p.textContent, container: div, viewport: vp});
    await layer.render();
    if (this.destroyed || p.viewport !== vp) return;
    p.text.replaceWith(div);
    p.text = div;
  }
};
