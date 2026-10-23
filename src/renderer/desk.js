// クイズ・ホームの机（SPEC §9.10）：編集画面と同じ四隅の道具（筆箱・ポーチ・シール帳・素材。desk-tools.js）を、
// PDF のない画面でも使う。筆箱のペンで書いた線・貼ったシールや図・ちぎった紙は、画面の上の透明な「下書き」の層に置く。
// 下書きは保存しない（画面を移ると消える。クイズの計算・ちょっとした書き込み用）。
// - クイズ（#/quiz…・#/review…）：四隅のつまみを出す。ホーム（#/）：つまみは出さず、マウスを画面の端へ動かすか、
//   端からなでると出る
// - ペンを持っている間は下書きの層が指・マウスを受ける（下のボタンは押せない）。もう一度押す・Esc・「ペンを置く」で置く
// - 下書きの線と貼りものは、ページと一緒にスクロールする（文書の座標で持つ）
// - 赤シート（ポーチ・⌘R）：赤を乗算で重ねる。赤い字は消え、文字隠しペンの線は黒くなる
import {isTyping, state} from './app.js';
import {CSS_UNITS, DeskTools, MEMO_DEPTH, MEMO_TOOTH, cornersHtml, tearClip} from './desk-tools.js';
import {TYPE_LABEL, heldPen, itemOf, stationeryState, toolArt} from '../shared/stationery.js';
import {createCapture, strokePath, touchesStroke} from '../shared/ink.js';
import {figureUrl} from '../shared/figures.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ERASER_PX = 12;
const IS_MAC = /Mac/i.test(navigator.platform);
/** 下書きでの線の太さ（px）と重ね方。マーカー・文字隠しペンは太く、乗算で重ねる（下の字が読める） */
const strokeLook = (item) =>
  item.type === 'pen'
    ? {width: item.width * CSS_UNITS, blend: false}
    : {width: Math.max(10, item.width * CSS_UNITS * 2.4), blend: true};

const FUDE = `
  <aside class="fude-side is-tucked" data-v="side" data-corner="fude" aria-label="筆箱">
    <button type="button" class="fude-side__tab" data-corner-tab="fude" aria-expanded="false" title="筆箱を出す（マウスを画面の右上の端へ・右端から左へなでる）" aria-label="筆箱を出す"><span>筆箱</span></button>
    <div class="fude-side__head"><strong>筆箱</strong><span class="muted">画面に下書き（保存しません）</span></div>
    <div class="fude-side__case" data-v="slots" role="group" aria-label="筆箱のペン"></div>
    <button type="button" class="fude-side__eraser" data-desk-tool="eraser" aria-pressed="false" title="消しゴム：下書きの線をなぞって消す">
      <svg viewBox="0 0 64 28" aria-hidden="true"><rect x="2" y="5" width="40" height="18" rx="3" fill="#fbfbf8" stroke="#c9c6bd"/><rect x="26" y="4" width="36" height="20" rx="2" fill="#2f6fb5"/><rect x="30" y="9" width="28" height="10" rx="1" fill="#fff" opacity="0.9"/></svg>
      <span>消しゴム</span>
    </button>
    <div class="desk__clear"><button type="button" class="btn btn--small" data-desk-clear title="下書きの線・貼ったものを全部消す">下書きを全部消す</button></div>
  </aside>`;

class Desk extends DeskTools {
  constructor() {
    const root = document.createElement('div');
    root.className = 'desk';
    root.hidden = true;
    super(root);
    root.innerHTML = `<div class="desk-scratch" data-v="scratch"><svg class="desk-scratch__ink" aria-hidden="true"></svg></div>
      ${FUDE}${cornersHtml()}
      <div class="desk-holding" data-v="holding" hidden><span data-v="holding-name"></span><button type="button" class="btn btn--small" data-desk-put title="ペンを置く（Esc）">ペンを置く</button></div>`;
    document.body.append(root);
    this.scratch = this.$('scratch');
    this.inkSvg = root.querySelector('.desk-scratch__ink');
    this.strokes = []; // {el, points, width}
    this.held = null; // 持っている道具：{item, i} か 'eraser'
    this.route = null;
    this.active = false;
  }

  /** 画面が変わるたびに呼ぶ（app.js）。クイズ・ホームでだけ出す。違う画面へ移ったら下書きは消す */
  setRoute(route) {
    const mode = route === '/' ? 'home' : route.startsWith('/quiz') || route.startsWith('/review') ? 'quiz' : null;
    if (route !== this.route) this.clearScratch();
    this.route = route;
    if (!mode) return this.deactivate();
    this.root.dataset.mode = mode;
    if (!this.active) this.activate();
    this.sizeScratch();
  }
  activate() {
    this.active = true;
    this.root.hidden = false;
    this.st = stationeryState(state.data?.stationery);
    this.renderSlots();
    this.bindSide();
    const onClick = (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.cornerTab) return this.openCorner(t.dataset.cornerTab);
      if (t.dataset.seal || t.dataset.figure) return e.detail === 0 && this.placeStamp(this.itemSpec(t));
      if (t.dataset.sealTab) return this.renderSeal(t.dataset.sealTab);
      if (t.dataset.sozaiTab) return this.renderSozai(t.dataset.sozaiTab);
      if (this.pouchAction(t.dataset.v)) return;
      if (t.dataset.v === 'sheet') {
        this.toggleSheet();
        return this.tuckSoon();
      }
      if (t.dataset.slot !== undefined) {
        this.hold(this.held?.i === Number(t.dataset.slot) ? null : Number(t.dataset.slot));
        return this.tuckSoon();
      }
      if (t.dataset.deskTool === 'eraser') {
        this.hold(this.held === 'eraser' ? null : 'eraser');
        return this.tuckSoon();
      }
      if (t.dataset.deskClear !== undefined) return this.clearScratch();
      if (t.dataset.deskPut !== undefined) return this.hold(null);
    };
    this.on(this.root, 'click', onClick);
    this.on(this.scratch, 'pointerdown', (e) => this.onDown(e));
    this.on(document, 'keydown', (e) => {
      if (isTyping(e)) return;
      const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        this.toggleSheet();
      } else if (e.key === 'Escape' && (this.held || this.corner)) {
        this.hold(null);
        this.openCorner(null);
      }
    });
    this.on(window, 'resize', () => this.sizeScratch());
    this.resizeObs = new ResizeObserver(() => this.sizeScratch());
    this.resizeObs.observe(document.body);
  }
  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.hold(null);
    this.openCorner(null);
    this.toggleSheet(false);
    this.closeTools();
    this.resizeObs?.disconnect();
    this.root.hidden = true;
  }

  // ---- 筆箱：筆箱の 6 本を並べ、押すと持つ（もう一度押すと置く） ----
  renderSlots() {
    const kase = itemOf(this.st.caseId);
    const side = this.$('side');
    side.style.setProperty('--case-base', kase.base);
    side.style.setProperty('--case-trim', kase.trim);
    this.$('slots').innerHTML = this.st.slots
      .map((id, i) => {
        const it = itemOf(id);
        if (!it)
          return `<button type="button" class="fude-side__pen is-empty" disabled aria-label="${i + 1} 本目：空き"><span class="fude-side__num">${i + 1}</span></button>`;
        const held = heldPen(it, this.st.refills?.[it.id]);
        return `<button type="button" class="fude-side__pen" data-slot="${i}" title="${it.name}（${TYPE_LABEL[it.type]}）" aria-pressed="false" style="--ink: ${held.color}"><span class="fude-side__num">${i + 1}</span>${toolArt(it, {label: false})}</button>`;
      })
      .join('');
  }
  /** 道具を持つ：i 本目のペン、'eraser'（消しゴム）、null（置く） */
  hold(what) {
    if (typeof what === 'number') {
      const it = itemOf(this.st.slots[what]);
      this.held = it ? {item: heldPen(it, this.st.refills?.[it.id]), i: what} : null;
    } else this.held = what;
    for (const b of this.root.querySelectorAll('[data-slot]'))
      b.setAttribute('aria-pressed', String(this.held?.i === Number(b.dataset.slot)));
    this.root.querySelector('[data-desk-tool="eraser"]').setAttribute('aria-pressed', String(this.held === 'eraser'));
    this.root.classList.toggle('is-holding', !!this.held);
    this.$('side').style.setProperty('--current', this.held?.item?.color ?? 'transparent');
    this.$('holding').hidden = !this.held;
    this.$('holding-name').textContent =
      this.held === 'eraser' ? '消しゴムを持っています' : this.held ? `${this.held.item.name}で下書きしています` : '';
  }

  // ---- 下書き ----
  /** 下書きの層を文書の大きさに合わせる（スクロールしても線がずれない） */
  sizeScratch() {
    const el = document.scrollingElement;
    this.scratch.style.width = `${el.scrollWidth}px`;
    this.scratch.style.height = `${el.scrollHeight}px`;
  }
  clearScratch() {
    for (const s of this.strokes) s.el.remove();
    this.strokes = [];
    for (const el of this.scratch.querySelectorAll('.desk-stamp')) el.remove();
  }
  busy() {
    return !!(this.drawing || this.carry);
  }
  onDown(e) {
    if (!this.held || e.button !== 0 || e.target.closest('.desk-stamp')) return;
    e.preventDefault();
    this.scratch.setPointerCapture(e.pointerId);
    const x0 = window.scrollX,
      y0 = window.scrollY;
    const at = (ev) => {
      const [cx, cy] = this.drawing?.rule
        ? this.onRule(this.drawing, ev.clientX, ev.clientY)
        : [ev.clientX, ev.clientY];
      return [cx + x0, cy + y0];
    };
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      for (const c of ev.getCoalescedEvents?.() ?? [ev]) this.drawAt(c, at);
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      this.scratch.removeEventListener('pointermove', move);
      this.scratch.removeEventListener('pointerup', up);
      this.scratch.removeEventListener('pointercancel', up);
      const d = this.drawing;
      this.drawing = null;
      if (d?.kind === 'ink') {
        const points = d.cap.finish(...at(ev), ev.pressure > 0 ? ev.pressure : 0.5);
        if (points.length) {
          d.el.setAttribute('d', strokePath(points, d.width, {pressure: d.pressure}));
          this.strokes.push({el: d.el, points, width: d.width});
        } else d.el.remove();
      }
    };
    if (this.held === 'eraser') this.drawing = {kind: 'eraser'};
    else {
      const look = strokeLook(this.held.item);
      const el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('fill', this.held.item.color);
      if (look.blend) el.classList.add('is-marker');
      this.inkSvg.append(el);
      this.drawing = {
        kind: 'ink',
        el,
        width: look.width,
        pressure: e.pointerType === 'pen' && this.held.item.type === 'pen',
        cap: createCapture({minGap: 0.3, streamline: e.pointerType === 'pen' ? 0.2 : 0.4}),
        rule: this.held.item.type === 'pen' ? this.rulerEdgeAt(e.clientX, e.clientY) : null
      };
    }
    this.drawAt(e, at);
    this.scratch.addEventListener('pointermove', move);
    this.scratch.addEventListener('pointerup', up);
    this.scratch.addEventListener('pointercancel', up);
  }
  drawAt(ev, at) {
    const d = this.drawing;
    if (!d) return;
    const [x, y] = at(ev);
    if (d.kind === 'eraser') {
      for (const s of [...this.strokes])
        if (touchesStroke(s.points, s.width, x, y, ERASER_PX)) {
          s.el.remove();
          this.strokes.splice(this.strokes.indexOf(s), 1);
        }
      return;
    }
    d.cap.add(x, y, d.pressure ? (ev.pressure > 0 ? ev.pressure : 0.5) : 0.5);
    d.el.setAttribute('d', strokePath(d.cap.points, d.width, {pressure: d.pressure}));
  }

  // ---- 貼りもの（下書きの層に置く。ドラッグで動かし、× で外す） ----
  placeStamp(spec) {
    return this.putStamp(spec, window.innerWidth / 2, window.innerHeight / 2);
  }
  dropStamp(spec, px, py, cx, cy) {
    this.putStamp(spec, cx, cy);
    return true;
  }
  /** 画面の点（cx, cy）を真ん中にして貼る。戻りは {el} */
  putStamp(spec, cx, cy) {
    const w = spec.w * CSS_UNITS,
      h = spec.h * CSS_UNITS;
    const el = document.createElement('div');
    el.className = `desk-stamp desk-stamp--${spec.type}`;
    Object.assign(el.style, {
      left: `${cx - w / 2 + window.scrollX}px`,
      top: `${cy - h / 2 + window.scrollY}px`,
      width: `${w}px`,
      height: `${h}px`
    });
    if (spec.type === 'memo') {
      el.style.setProperty('--memo', spec.color);
      el.innerHTML = '<div class="desk-stamp__memo"></div>';
      el.firstElementChild.textContent = spec.body;
      el.firstElementChild.style.clipPath = tearClip(w, MEMO_DEPTH * CSS_UNITS, MEMO_TOOTH * CSS_UNITS);
    } else {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      if (spec.type === 'figure') img.src = figureUrl(spec.ref);
      else this.stickerSrc(spec.ref).then((url) => (img.src = url));
      el.append(img);
    }
    el.insertAdjacentHTML(
      'beforeend',
      '<button type="button" class="desk-stamp__remove" aria-label="外す" title="外す">×</button>'
    );
    el.querySelector('.desk-stamp__remove').addEventListener('click', () => el.remove());
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const sx = e.clientX - parseFloat(el.style.left),
        sy = e.clientY - parseFloat(el.style.top);
      const move = (ev) => {
        el.style.left = `${ev.clientX - sx}px`;
        el.style.top = `${ev.clientY - sy}px`;
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    this.scratch.append(el);
    return {el};
  }

  // ---- 赤シート：画面の上に赤を乗算で重ねる。ドラッグで動かし、右下で大きさを変える ----
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
      Object.assign(el.style, {
        left: `${Math.round(window.innerWidth * 0.2)}px`,
        top: `${Math.round(window.innerHeight * 0.45)}px`,
        width: `${Math.round(window.innerWidth * 0.6)}px`,
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
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      });
      this.root.append(el);
      this.sheet = el;
    }
    this.$('sheet').setAttribute('aria-pressed', String(!!this.sheet));
  }
}

let desk = null;
/** 画面が変わったら呼ぶ（app.js の render）。クイズ・ホームで机を出し、ほかの画面ではしまう */
export function deskRoute(route) {
  if (!desk) {
    if (route !== '/' && !route.startsWith('/quiz') && !route.startsWith('/review')) return;
    desk = new Desk();
  }
  desk.setRoute(route);
}
