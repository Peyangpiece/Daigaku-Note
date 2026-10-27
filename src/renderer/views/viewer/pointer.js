// PDF の編集画面：ポインタの振り分け（押す・動かす・離す）。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
import {DRAW_TOOLS} from './shared.js';
import {figureSize, growsWithSize} from '../../../shared/figures.js';
import {growFigure, renderFigure} from '../../figure-view.js';

/** 点が要素の箱（ふちの外側の当たり判定は含まない）の中か */
const inBox = (el, e) => {
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
};

export const methods = {
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
    // 文字を打っている間は、ほかの操作をしない：箱の中はカーソル・範囲選択、箱のすぐそば（少しはみ出した所）は打つのを続け、
    // それより外を押したら打ち終わるだけ（線・新しい文字入れ・選択などは始めない）
    if (this.editing) {
      const ed = this.editing.el;
      if (ed.contains(e.target) && inBox(ed, e)) return;
      e.preventDefault();
      // 箱のふち（外側の当たり判定）を押した：打ち終わって動かす
      if (ed.contains(e.target)) {
        const a = this.editing;
        this.finishEdit();
        if (!a.removed) this.grabText(e, a);
        return;
      }
      const r = ed.getBoundingClientRect();
      const near =
        e.clientX > r.left - 12 && e.clientX < r.right + 12 && e.clientY > r.top - 8 && e.clientY < r.bottom + 8;
      if (near) return void ed.focus();
      return void this.finishEdit();
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
    // 文字入れは、選択の道具と文字入れの道具のときだけ選んで動かす（文字隠し・メモのときは上に重ねて置ける）
    if (a?.kind === 'text' && this.tool !== 'select' && this.tool !== 'text') a = null;
    // 文字入れの道具で文字入れを押したとき：文字の上なら、そのまま打つ（押した所にカーソル。なぞると範囲選択）。
    // ふち（箱の外側の当たり判定）なら、押してそのまま動かす。選択の道具では、箱のどこを押しても動かす（打たない）
    if (a?.kind === 'text' && this.tool === 'text') {
      if (inBox(a.el, e)) {
        this.select(a);
        this.edit(a); // カーソルはブラウザが押した所に置く（preventDefault しない）
        return;
      }
      e.preventDefault();
      return this.grabText(e, a);
    }
    if (a) {
      e.preventDefault();
      const wasSelected = this.selected === a;
      this.select(a);
      this.drag = {
        a,
        wasSelected, // 選んであった図をもう一度押したら、書き換える
        curve: !!e.target.closest('[data-curve]'), // グラフの曲線を押したら、式を入れる
        before: this.snap(a),
        x: e.clientX,
        y: e.clientY,
        left: parseFloat(a.el.style.left),
        top: parseFloat(a.el.style.top),
        // 貼りものの右下のつまみ：大きさを変える
        resize: a.kind === 'stamp' && !!e.target.closest('.anno-stamp__grip'),
        width: a.el.offsetWidth,
        height: a.el.offsetHeight,
        style: a.style, // 伸びる図（表・数直線・座標平面）は、伸ばしたらます・目盛りを増やす
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
  },

  /** 文字入れのふちを押した：そのまま動かす（押してすぐでも、長押ししてからでも） */
  grabText(e, a) {
    this.select(a);
    a.el.classList.add('is-lifted');
    this.drag = {
      a,
      before: this.snap(a),
      x: e.clientX,
      y: e.clientY,
      left: parseFloat(a.el.style.left),
      top: parseFloat(a.el.style.top),
      width: a.el.offsetWidth,
      height: a.el.offsetHeight,
      style: a.style,
      moved: false,
      lifted: true, // ふちを押して離しても打ち始めない
      pointer: e.pointerId
    };
    try {
      this.pagesEl.setPointerCapture(e.pointerId);
    } catch {
      // 指がもう離れていた
    }
  },

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
    if (d.resize && d.a.style.type === 'figure' && growsWithSize(d.a.style.ref)) {
      // 表・数直線・座標平面：縦に伸ばすと縦の、横に伸ばすと横のます・目盛りが増える（1 ますの大きさは変えない）
      const unit = d.width / figureSize(d.style.ref, d.style.params).w;
      const g = growFigure(d.style, unit, Math.max(16, d.width + dx), Math.max(16, d.height + dy));
      d.a.style = g.style;
      d.a.el.style.width = `${g.w}px`;
      d.a.el.style.height = `${g.h}px`;
      renderFigure(d.a.el.querySelector('.anno-stamp__fig'), g.style);
      this.showGrowTip(d.a.el, g.style);
      return;
    }
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
  },

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
    a.el.classList.remove('is-dragging', 'is-lifted');
    this.showGrowTip(null);
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
    else if (a.kind === 'text' && this.tool === 'text' && !d.lifted) this.edit(a);
    else if (a.kind === 'stamp' && a.style.type === 'figure' && (d.wasSelected || d.curve) && !d.resize)
      this.editFigure(a, d.curve ? 'formula' : null);
  }
};
