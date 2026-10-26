// PDF の編集画面：メモ（付箋）の手書き。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
import {createCapture, encodePoints, strokePath} from '../../../shared/ink.js';
import {NOTE_INK_SCALE} from '../../../shared/annotation.js';
import {NOTE_DEFAULT_PEN, SVG_NS} from './shared.js';

export const methods = {
  // ---- メモの中の手書き：吹き出しの中の SVG に、筆箱のボールペン（持っていなければ黒の 0.5）で書く ----
  notePen() {
    return this.penItem?.type === 'pen' ? this.penItem : NOTE_DEFAULT_PEN;
  },

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
  },

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
};
