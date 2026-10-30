// PDF の編集画面：メモ（付箋）の手書き。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
// メモの本文の欄は 1 つ。持っている道具で書き方が変わる：筆箱のペンなら手書き、消しゴムなら手書きの線を消す、ほかは文字を打つ。
// 手書きは文字の上に重なる

const NOTE_ERASE_R = 8; // 消しゴムの大きさ（吹き出しの px）
import {createCapture, decodePoints, encodePoints, strokePath, touchesStroke} from '../../../shared/ink.js';
import {NOTE_INK_SCALE} from '../../../shared/annotation.js';
import {NOTE_DEFAULT_PEN, SVG_NS} from './shared.js';

export const methods = {
  /** メモの書き方を、持っている道具に合わせる：筆箱のペン（ink）なら手書き、消しゴムなら手書きを消す、ほかは文字を打つ */
  setNoteMode(a) {
    const pop = a.el.querySelector('.anno-note__pop');
    pop.dataset.mode = this.tool === 'ink' ? 'pen' : this.tool === 'eraser' ? 'erase' : 'text';
    if (pop.dataset.mode !== 'text' && pop.contains(document.activeElement)) document.activeElement.blur();
  },

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
    // 消しゴム：なぞったところに触れた線を消す。ひとなぞりで消した分は 1 手で取り消せる
    let erasing = null;
    const eraseAt = (ev) => {
      const box = svg.getBoundingClientRect();
      const x = ev.clientX - box.left,
        y = ev.clientY - box.top;
      const ink = a.style.ink ?? [];
      const keep = ink.filter(
        (st) => !touchesStroke(decodePoints(st.p) ?? [], st.w * NOTE_INK_SCALE, x, y, NOTE_ERASE_R)
      );
      if (keep.length === ink.length) return;
      a.style = {...a.style, ink: keep};
      if (!keep.length) delete a.style.ink;
      this.applyNotePop(a);
    };
    const mode = () => svg.closest('.anno-note__pop')?.dataset.mode;
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      this.finishEdit();
      if (mode() === 'erase') {
        erasing = {pointer: e.pointerId, before: this.snap(a)};
        svg.setPointerCapture(e.pointerId);
        eraseAt(e);
        return;
      }
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
      if (erasing?.pointer === e.pointerId) {
        e.stopPropagation();
        for (const ev of e.getCoalescedEvents?.() ?? [e]) eraseAt(ev);
        return;
      }
      if (!d || e.pointerId !== d.pointer) return;
      e.stopPropagation();
      for (const ev of e.getCoalescedEvents?.() ?? [e]) {
        const [x, y, pr] = point(ev, d.box, d.pressure);
        d.cap.add(x, y, pr);
      }
      draw();
    });
    const finish = (e) => {
      if (erasing?.pointer === e.pointerId) {
        e.stopPropagation();
        const {before} = erasing;
        erasing = null;
        if ((before.style.ink?.length ?? 0) === (a.style.ink?.length ?? 0)) return;
        this.record(a.key, before, this.snap(a));
        this.scheduleSave(a, 0);
        return;
      }
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
