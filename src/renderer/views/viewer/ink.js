// PDF の編集画面：ペンの線・マーカー・消しゴム。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
import {snapRange} from '../../../shared/text-snap.js';
import {boundsOf, createCapture, encodePoints, speedPressure, strokePath, touchesStroke} from '../../../shared/ink.js';
import {lineOf, ERASER_PX, SVG_NS} from './shared.js';

export const methods = {
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
  },

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
  },

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
  },

  drawInk() {
    if (this.inkFrame) return;
    this.inkFrame = requestAnimationFrame(() => {
      this.inkFrame = 0;
      const d = this.drawing;
      if (d?.kind !== 'ink') return;
      d.el.setAttribute('d', strokePath([...d.cap.points, ...d.extra], d.item.width, {pressure: d.pressure}));
    });
  },

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
  },

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
  },

  /** マーカーの線の箱（ページの中の px）。文字の行の上なら字の下端に、そうでなければなぞり始めの高さに */
  lineBox(d, x1 = Math.min(d.x0, d.x1), x2 = Math.max(d.x0, d.x1)) {
    const h = Math.max(2, d.item.width * d.p.viewport.scale);
    const mid = d.line ? d.line.bottom : d.y0;
    return {left: x1, top: mid - h / 2, width: x2 - x1, height: h};
  },

  drawLineDraft() {
    const d = this.drawing;
    const b = this.lineBox(d);
    Object.assign(d.el.style, {left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`});
  },

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
  },

  // 消しゴム：なぞったところに触れたペンの線・マーカー・文字隠しを消す。ひとなぞりで消したものは 1 手で取り消せる
  eraserRing() {
    this.ring ??= Object.assign(document.createElement('div'), {className: 'eraser-ring'});
    this.ring.style.setProperty('--r', `${ERASER_PX}px`);
    if (!this.ring.isConnected) this.root.append(this.ring);
    return this.ring;
  },

  moveRing(e) {
    const ring = this.eraserRing();
    ring.style.left = `${e.clientX}px`;
    ring.style.top = `${e.clientY}px`;
  },

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
};
