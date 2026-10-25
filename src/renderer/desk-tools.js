// 筆箱・ポーチ・シール帳・素材（画面の四隅の道具。SPEC §9.9）。PDF の編集画面（views/viewer.js）と、
// クイズ・ホームの机（desk.js）が同じものを使う。四隅の出し入れ、シール帳・素材の並び、運んで貼る動き、
// ポーチの電卓・メモ帳・定規・タイマーをここに置く。貼る先（ページか画面か）と赤シートは、使う側が決める（下の「使う側が決めること」）
import {esc, state, toast} from './app.js';
import {MEMO_COLOR, MEMO_SIZE} from '../shared/annotation.js';
import {BUILTIN_STICKERS, BUILTIN_STICKER_KIND, builtinStickerUrl, isBuiltinSticker} from '../shared/stickers.js';
import {FIGURES, FIGURE_PT_PER_UNIT, FIGURE_SUBJECTS, figureOf, figureUrl} from '../shared/figures.js';
import {evaluate, formatNumber} from '../shared/calc.js';
import {
  TIMER_PRESETS,
  clampMinutes,
  formatClock,
  isDone,
  isRunning,
  newTimer,
  pauseTimer,
  startTimer,
  timerLeft
} from '../shared/timer.js';

const api = window.daigaku;
export const CSS_UNITS = 96 / 72; // 拡大率 100% で紙の実寸（1pt = 4/3 px）
const IS_MAC = /Mac/i.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const key = (...parts) => (IS_MAC ? parts.join('') : parts.join('+'));
export const STICKER_PT = 72; // シール帳のシールを貼るときの幅（pt）
export const MEMO_PT = 150; // メモ帳からちぎった紙の一辺（pt。100% 表示でメモ帳の紙と同じくらい）
export const MEMO_COLORS = [MEMO_COLOR, '#fff3bf', '#ffe3ec', '#e3f2ff', '#e6f6e6'];
// ちぎった紙の寸法（pt。文字の大きさに掛けるものは倍率）。画面と書き出しで同じ値を使う
export const MEMO_PAD = 8; // 左右の余白
export const MEMO_TOP = 12; // 上の余白（ちぎり口の下から）
export const MEMO_LINE = 1.6; // 行の高さ（文字の大きさの倍）
export const MEMO_TOOTH = 8; // ちぎり口のぎざぎざの幅
export const MEMO_DEPTH = 3; // ちぎり口のぎざぎざの深さ
// 定規：画面の px。目盛りは実寸（1 mm = 72 / 25.4 pt × 拡大率）。長さは 15 cm
const RULER_MM = 150;
const RULER_H = 56; // 定規の幅（px）
const RULER_PAD = 12; // 目盛りの 0 の左・150 mm の右の余白（px）
const RULER_SNAP = 28; // ふちの外側、これだけの所から書き始めると、ふちに沿う（px）
const CALC_KEYS = [
  'C',
  '⌫',
  '(',
  ')',
  '÷',
  '7',
  '8',
  '9',
  '√',
  '×',
  '4',
  '5',
  '6',
  '^',
  '−',
  '1',
  '2',
  '3',
  'π',
  '+',
  '0',
  '.',
  '%',
  '='
];
/** ちぎり口（上の辺）のぎざぎざの点。幅 w・深さ d・歯の幅 tooth（同じ単位）。左上から右上へ */
export const tearEdge = (w, d, tooth) => {
  const n = Math.max(2, Math.round(w / tooth));
  return Array.from({length: n + 1}, (_, i) => [(w * i) / n, i % 2 ? 0 : d]);
};
/** ちぎり口のある紙の clip-path（画面の px） */
export const tearClip = (w, d, tooth) =>
  `polygon(${[...tearEdge(w, d, tooth), [w, d], ['100%', '100%'], [0, '100%']]
    .map(
      ([x, y]) =>
        `${typeof x === 'number' ? `${x.toFixed(1)}px` : x} ${typeof y === 'number' ? `${y.toFixed(1)}px` : y}`
    )
    .join(', ')})`;

export const POUCH_ART = {
  sheet:
    '<svg viewBox="0 0 56 40" aria-hidden="true"><rect x="8" y="5" width="40" height="30" rx="3" fill="#e60000" opacity="0.88"/><rect x="13" y="10" width="14" height="3" rx="1.5" fill="#fff" opacity="0.8"/></svg>',
  calc:
    '<svg viewBox="0 0 56 40" aria-hidden="true"><rect x="14" y="2" width="28" height="36" rx="4" fill="#3b4252"/><rect x="17.5" y="5.5" width="21" height="8" rx="1.5" fill="#cfe3d2"/><g fill="#d8dee9">' +
    [0, 1, 2]
      .flatMap((r) => [0, 1, 2].map((c) => `<rect x="${18 + c * 7}" y="${17 + r * 7}" width="5" height="5" rx="1"/>`))
      .join('') +
    '</g></svg>',
  memo: '<svg viewBox="0 0 56 40" aria-hidden="true"><rect x="11" y="6" width="34" height="31" rx="1.5" fill="#fffdf6" stroke="#c9c6bd"/><rect x="11" y="4" width="34" height="6" rx="1.5" fill="#8b6f47"/><path d="M15 17H41M15 23H41M15 29H41" stroke="#bcd3ea" stroke-width="1.2"/></svg>',
  ruler:
    '<svg viewBox="0 0 56 40" aria-hidden="true"><g transform="rotate(-18 28 20)"><rect x="2" y="13" width="52" height="14" rx="2" fill="#dbeefa" stroke="#7aa7c7"/><path d="M6 13v5M11 13v3M16 13v5M21 13v3M26 13v5M31 13v3M36 13v5M41 13v3M46 13v5M51 13v3" stroke="#2f4f66" stroke-width="1"/></g></svg>',
  index:
    '<svg viewBox="0 0 56 40" aria-hidden="true"><rect x="8" y="5" width="30" height="30" rx="1" fill="#fff" stroke="#c9c6bd"/><rect x="26" y="8" width="22" height="7" rx="1.5" fill="#f28b82"/><rect x="26" y="17" width="22" height="7" rx="1.5" fill="#aecbfa"/><rect x="26" y="26" width="22" height="7" rx="1.5" fill="#ccff90"/></svg>',
  timer:
    '<svg viewBox="0 0 56 40" aria-hidden="true"><circle cx="28" cy="22" r="14" fill="#fff" stroke="#3b4252" stroke-width="2.5"/><rect x="25" y="3" width="6" height="4" rx="1" fill="#3b4252"/><path d="M28 22V13" stroke="#e5484d" stroke-width="2.5" stroke-linecap="round"/><path d="M28 22L34 26" stroke="#3b4252" stroke-width="2" stroke-linecap="round"/></svg>'
};

/**
 * 四隅のうち、ポーチ・シール帳・素材の HTML（筆箱は使う側が作る）。index：ポーチに付箋（インデックス）を入れるか（PDF のページだけ）
 */
export const cornersHtml = ({index = false} = {}) => `
  <aside class="corner corner--pouch is-tucked" data-corner="pouch" aria-label="ポーチ">
    <button type="button" class="corner__tab" data-corner-tab="pouch" aria-expanded="false" title="ポーチを出す（マウスを画面の右下の端へ・右端から左へなでる）" aria-label="ポーチを出す"><span>ポーチ</span></button>
    <div class="corner__head"><strong>ポーチ</strong></div>
    <div class="pouch__items">
      <button type="button" class="pouch__item" data-v="sheet" aria-pressed="false" title="赤シートを出す・しまう（${key(MOD, 'R')}）。赤い字が消え、マーカーのところが黒く隠れます">${POUCH_ART.sheet}<span>赤シート</span></button>
      <button type="button" class="pouch__item" data-v="calc" aria-pressed="false" title="電卓を出す・しまう">${POUCH_ART.calc}<span>電卓</span></button>
      <button type="button" class="pouch__item" data-v="memo" aria-pressed="false" title="メモ帳を出す・しまう。書いてちぎると、ページに貼れます">${POUCH_ART.memo}<span>メモ帳</span></button>
      <button type="button" class="pouch__item" data-v="ruler" aria-pressed="false" title="定規を出す・しまう。ふちのすぐ外からボールペンで書くと、まっすぐな線になります">${POUCH_ART.ruler}<span>定規</span></button>
${index ? `<button type="button" class="pouch__item" data-v="index" aria-pressed="false" title="付箋を出す・しまう。ページの端に貼る色の目印です">${POUCH_ART.index}<span>付箋</span></button>` : ''}
      <button type="button" class="pouch__item" data-v="timer" aria-pressed="false" title="タイマーを出す・しまう">${POUCH_ART.timer}<span>タイマー</span><small class="pouch__badge" data-v="timer-badge" hidden></small></button>
    </div>
  </aside>
  <aside class="corner corner--seal is-tucked" data-corner="seal" aria-label="シール帳">
    <button type="button" class="corner__tab" data-corner-tab="seal" aria-expanded="false" title="シール帳を出す（マウスを画面の左上の端へ・左端から右へなでる）" aria-label="シール帳を出す"><span>シール帳</span></button>
    <div class="corner__head"><strong>シール帳</strong></div>
    <div class="corner__tabs" data-v="seal-tabs" role="tablist" aria-label="シールの種類"></div>
    <div class="corner__grid corner__grid--seal" data-v="seal-grid"></div>
    <p class="corner__hint">押すと見ているページの真ん中に、ドラッグするとページの好きな所に貼れます</p>
  </aside>
  <aside class="corner corner--sozai is-tucked" data-corner="sozai" aria-label="素材">
    <button type="button" class="corner__tab" data-corner-tab="sozai" aria-expanded="false" title="素材を出す（マウスを画面の左下の端へ・左端から右へなでる）" aria-label="素材を出す"><span>素材</span></button>
    <div class="corner__head"><strong>素材</strong><span class="muted">授業でよく使う図</span></div>
    <div class="corner__tabs" data-v="sozai-tabs" role="tablist" aria-label="教科"></div>
    <div class="corner__grid corner__grid--sozai" data-v="sozai-grid"></div>
    <p class="corner__hint">押すと見ているページの真ん中に、ドラッグするとページの好きな所に貼れます。ペンで上に書き込めます</p>
  </aside>`;

/**
 * 四隅の道具の土台。使う側（PDF の編集画面・クイズとホームの机）はこれを継いで、次を決める：
 * - root（道具を入れる要素）・data-v の付いた四隅の HTML（cornersHtml と筆箱）
 * - placeStamp(spec)：貼りもの（シール・図・ちぎった紙）を見ているところに貼る。戻りは {el}（なければ null）
 * - dropStamp(spec, px, py, cx, cy)：運んで離した点（px, py）に、影の真ん中（cx, cy）を合わせて貼る。貼れたら true
 * - stampScale()：貼りもの・定規の目盛りの倍率（1pt あたりの px）
 * - busy()：書いている・動かしているなど、マウスを端へ寄せても四隅を出さないとき
 * - keepCorner()：出している隅をしまわないとき（筆箱のペンの入れ替えを開いているなど）
 * - onCornerClose(name)・cancelPointer()：隅をしまうとき・端からなでて出すときに、使う側の片付け
 */
export class DeskTools {
  constructor(root) {
    this.root = root;
    this.listeners = [];
    this.corner = null; // 出している四隅（fude・pouch・seal・sozai）
    this.stickerUrls = new Map(); // 取り込んだシールの画像（id → Promise<data: URL>）
    this.memoColor = MEMO_COLORS[0];
    this.memoDraft = '';
  }
  $(name) {
    return this.root.querySelector(`[data-v="${name}"]`);
  }
  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.listeners.push(() => target.removeEventListener(type, fn, opts));
  }
  // ---- 使う側が決めること（ここでは何もしない） ----
  placeStamp() {
    return null;
  }
  dropStamp() {
    return false;
  }
  stampScale() {
    return CSS_UNITS;
  }
  busy() {
    return !!this.carry;
  }
  keepCorner() {
    return false;
  }
  onCornerClose() {}
  cancelPointer() {}
  /** ポーチの道具を出す・しまう。扱ったら true */
  pouchAction(v) {
    const act = {
      calc: () => this.toggleCalc(),
      memo: () => this.toggleMemo(),
      ruler: () => this.toggleRuler(),
      timer: () => this.toggleTimer()
    }[v];
    if (!act) return false;
    act();
    this.tuckSoon();
    return true;
  }
  /** 道具をすべて片付ける（画面を閉じるとき） */
  closeTools() {
    this.toggleCalc(false);
    this.toggleMemo(false);
    this.toggleRuler(false);
    this.toggleTimer(false, {stop: true});
    this.carry?.off();
    clearTimeout(this.tuckTimer);
    for (const off of this.listeners) off();
    this.listeners = [];
  }

  /** 筆箱を出す（true）・しまう（false） */
  openSide(open) {
    this.openCorner(open ? 'fude' : null);
  }

  /** 四隅の 1 つ（fude・pouch・seal・sozai）を出す。null ですべてしまう。1 つ出すとほかはしまう */
  openCorner(name) {
    clearTimeout(this.tuckTimer);
    if (this.corner === name) return;
    this.onCornerClose(this.corner);
    this.corner = name;
    this.cornerEntered = false; // 出したあと一度でも中でマウスを動かしたか（動かしてから離れたらしまう）
    this.cornerAt = window.performance.now();
    this.root.toggleAttribute('data-corner-open', !!name); // 出している間は、ほかのつまみを隠す（箱の下からはみ出さない）
    for (const el of this.root.querySelectorAll('[data-corner]')) {
      const on = el.dataset.corner === name;
      el.classList.toggle('is-tucked', !on);
      el.querySelector('[data-corner-tab]').setAttribute('aria-expanded', String(on));
    }
    if (name === 'seal') this.renderSeal();
    else if (name === 'sozai' && !this.$('sozai-grid').childElementCount) this.renderSozai();
  }

  tuckSoon() {
    clearTimeout(this.tuckTimer);
    this.tuckTimer = setTimeout(() => !this.destroyed && this.openCorner(null), 350);
  }

  bindSide() {
    const EDGE = 10; // 画面の端から何 px でマウスを寄せたとみなすか
    // 画面の端のどこか：右の上半分は筆箱、右の下半分はポーチ、左の上半分はシール帳、左の下半分は素材
    const cornerAt = (side, y) =>
      side === 'right'
        ? y < window.innerHeight / 2
          ? 'fude'
          : 'pouch'
        : y < window.innerHeight / 2
          ? 'seal'
          : 'sozai';
    const inCorner = (e) => !!e.target.closest?.('[data-corner]');
    // マウス：端へ寄せたら出し、出したものから離れたらしまう
    this.on(document, 'pointermove', (e) => {
      if (e.pointerType !== 'mouse' || this.busy() || this.corner) return;
      if (e.clientX >= document.documentElement.clientWidth - EDGE) this.openCorner(cornerAt('right', e.clientY));
      else if (e.clientX <= EDGE) this.openCorner(cornerAt('left', e.clientY));
    });
    for (const el of this.root.querySelectorAll('[data-corner]')) {
      // 出したとき、マウスはつまみ（端）にあって、まだ中に入っていないことが多い。出てくる動き（0.28 秒）の途中で
      // 箱がマウスの下を通り過ぎても入ったことにしない。止まった箱の中でマウスを動かし、そこから離れたときだけしまう
      this.on(el, 'pointerleave', (e) => {
        if (e.pointerType !== 'mouse' || this.corner !== el.dataset.corner || this.carry || !this.cornerEntered) return;
        if (!this.keepCorner()) this.tuckSoon();
      });
      this.on(el, 'pointermove', (e) => {
        clearTimeout(this.tuckTimer);
        if (
          e.pointerType === 'mouse' &&
          this.corner === el.dataset.corner &&
          window.performance.now() - this.cornerAt > 320
        )
          this.cornerEntered = true;
      });
    }
    // 指・ペン：画面の端から内側へなでたら出す。出したものの外を押したらしまう
    this.on(
      document,
      'pointerdown',
      (e) => {
        if (e.pointerType === 'mouse') {
          if (this.corner && !inCorner(e)) this.openCorner(null);
          return;
        }
        const w = document.documentElement.clientWidth;
        const side = e.clientX >= w - 24 ? 'right' : e.clientX <= 24 ? 'left' : null;
        if (side && !inCorner(e)) this.edge = {pointer: e.pointerId, x: e.clientX, y: e.clientY, side};
        else if (this.corner && !inCorner(e)) this.openCorner(null);
      },
      {capture: true}
    );
    this.on(document, 'pointermove', (e) => {
      const g = this.edge;
      if (!g || g.pointer !== e.pointerId) return;
      const inward = g.side === 'right' ? g.x - e.clientX : e.clientX - g.x;
      if (inward > 30 && Math.abs(e.clientY - g.y) < 60) {
        this.edge = null;
        this.cancelPointer(); // 書きかけの線にしない
        this.openCorner(cornerAt(g.side, g.y));
      }
    });
    const endEdge = (e) => this.edge?.pointer === e.pointerId && (this.edge = null);
    this.on(document, 'pointerup', endEdge);
    this.on(document, 'pointercancel', endEdge);
    // シール帳・素材：押すと見ているページの真ん中に、ドラッグすると離した所に貼る
    for (const name of ['seal', 'sozai'])
      this.on(this.root.querySelector(`[data-corner="${name}"]`), 'pointerdown', (e) => {
        const item = e.target.closest('[data-seal], [data-figure]');
        if (item) this.startCarry(e, this.itemSpec(item));
      });
  }

  // ---- シール帳・素材（§9.9）----
  renderSeal(tab = this.sealTab ?? 'mark') {
    const mine = state.data?.skin?.stickers ?? [];
    if (tab === 'mine' && !mine.length) tab = 'mark';
    this.sealTab = tab;
    const tabs = [
      ['mark', BUILTIN_STICKER_KIND.mark],
      ['deco', BUILTIN_STICKER_KIND.deco],
      ...(mine.length ? [['mine', '自分の画像']] : [])
    ];
    this.$('seal-tabs').innerHTML = tabs
      .map(
        ([v, l]) => `<button type="button" role="tab" data-seal-tab="${v}" aria-selected="${v === tab}">${l}</button>`
      )
      .join('');
    const items =
      tab === 'mine'
        ? mine.map((x) => ({id: x.id, name: '自分の画像', shape: x.shape ?? 'cut'}))
        : BUILTIN_STICKERS.filter((x) => x.kind === tab).map((x) => ({id: x.id, name: x.name, shape: 'cut'}));
    const grid = this.$('seal-grid');
    grid.innerHTML = items
      .map(
        (it) =>
          `<button type="button" class="corner__item" data-seal="${esc(it.id)}" title="${esc(it.name)}"><img class="sticker--${esc(it.shape)}" alt="${esc(it.name)}" draggable="false" /></button>`
      )
      .join('');
    for (const b of grid.querySelectorAll('[data-seal]'))
      this.stickerSrc(b.dataset.seal).then((url) => url && (b.firstElementChild.src = url));
  }

  renderSozai(subject = this.sozaiSubject ?? FIGURE_SUBJECTS[0]) {
    this.sozaiSubject = subject;
    this.$('sozai-tabs').innerHTML = FIGURE_SUBJECTS.map(
      (v) =>
        `<button type="button" role="tab" data-sozai-tab="${esc(v)}" aria-selected="${v === subject}">${esc(v)}</button>`
    ).join('');
    this.$('sozai-grid').innerHTML = FIGURES.filter((f) => f.subject === subject)
      .map(
        (f) =>
          `<button type="button" class="corner__item" data-figure="${f.id}" title="${esc(f.name)}"><img src="${figureUrl(f.id)}" alt="" draggable="false" /><span>${esc(f.name)}</span></button>`
      )
      .join('');
  }

  /** シール帳・素材の 1 つから、貼るものの中身と大きさ（pt）を作る */
  itemSpec(item) {
    if (item.dataset.figure) {
      const f = figureOf(item.dataset.figure);
      return {type: 'figure', ref: f.id, w: f.w * FIGURE_PT_PER_UNIT, h: f.h * FIGURE_PT_PER_UNIT};
    }
    const img = item.querySelector('img');
    const ratio = img?.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
    return {type: 'sticker', ref: item.dataset.seal, w: STICKER_PT, h: Math.round(STICKER_PT * ratio * 100) / 100};
  }

  /**
   * 押したものをページへ運ぶ。動かすと影（ghost）が指について来て、ページの上で離すとそこに貼る。
   * 動かさずに離したら onTap（なければ見ているページの真ん中に貼る）。ページの外で離したら onCancel
   * opts：ghost（影を作る関数。なければ貼りものの見本）・dx・dy（影の左上から押した点まで。なければ真ん中）・onLift（動かし始めた）
   */
  startCarry(e, spec, opts = {}) {
    if (e.button !== 0 || this.carry) return;
    e.preventDefault();
    const c = {pointer: e.pointerId, x: e.clientX, y: e.clientY, ghost: null};
    const move = (ev) => {
      if (ev.pointerId !== c.pointer) return;
      if (!c.ghost) {
        if (Math.hypot(ev.clientX - c.x, ev.clientY - c.y) < 6) return;
        c.ghost = opts.ghost?.() ?? this.stampGhost(spec);
        c.ghost.classList.add('carry-ghost');
        this.root.append(c.ghost);
        opts.onLift?.();
        if (this.corner === 'seal' || this.corner === 'sozai') this.openCorner(null); // 貼る所を見せる
      }
      c.ghost.style.left = `${ev.clientX - (opts.dx ?? c.ghost.offsetWidth / 2)}px`;
      c.ghost.style.top = `${ev.clientY - (opts.dy ?? c.ghost.offsetHeight / 2)}px`;
    };
    const up = (ev) => {
      if (ev.pointerId !== c.pointer) return;
      const g = c.ghost?.getBoundingClientRect(); // 影を外す（off）前に、置く場所を読む
      c.off();
      if (!c.ghost) {
        if (ev.type === 'pointerup') (opts.onTap ?? (() => this.placeStamp(spec)))();
        return;
      }
      const ok =
        ev.type === 'pointerup' &&
        this.dropStamp(spec, ev.clientX, ev.clientY, g.left + g.width / 2, g.top + g.height / 2);
      if (!ok) opts.onCancel?.();
    };
    c.off = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      c.ghost?.remove();
      if (this.carry === c) this.carry = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this.carry = c;
  }

  /** 運んでいる間の影：いまの拡大率で貼ったときと同じ大きさの見本 */
  stampGhost(spec) {
    const scale = this.stampScale();
    const img = document.createElement('img');
    img.alt = '';
    img.src = spec.type === 'figure' ? figureUrl(spec.ref) : '';
    if (spec.type === 'sticker') this.stickerSrc(spec.ref).then((url) => (img.src = url));
    Object.assign(img.style, {width: `${spec.w * scale}px`, height: `${spec.h * scale}px`});
    return img;
  }

  // ---- ポーチ：電卓・メモ帳（§9.9）。画面に浮かぶ小さな窓。上の帯をつかんで動かす ----
  /** 浮かぶ窓を作る。right・bottom は最初の位置（画面の右下から） */
  floatTool(cls, label, inner, {right, bottom, top}, onClose) {
    const el = document.createElement('div');
    el.className = `float-tool ${cls}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', label);
    el.innerHTML = `<div class="float-tool__head"><strong>${label}</strong><button type="button" class="float-tool__close" data-float-close aria-label="${label}をしまう" title="しまう">×</button></div>${inner}`;
    Object.assign(el.style, {right: `${right}px`, ...(top != null ? {top: `${top}px`} : {bottom: `${bottom}px`})});
    el.querySelector('[data-float-close]').addEventListener('click', onClose);
    el.querySelector('.float-tool__head').addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left,
        dy = e.clientY - r.top;
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const w = document.documentElement.clientWidth;
        Object.assign(el.style, {
          right: '',
          bottom: '',
          left: `${Math.min(Math.max(ev.clientX - dx, 8 - r.width / 2), w - r.width / 2)}px`,
          top: `${Math.min(Math.max(ev.clientY - dy, 0), window.innerHeight - 40)}px`
        });
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
    return el;
  }

  toggleCalc(on = !this.calc) {
    if (!on) {
      this.calc?.remove();
      this.calc = null;
    } else if (!this.calc) {
      const keys = CALC_KEYS.map(
        (k) =>
          `<button type="button" class="calc__key${/[0-9.π]/.test(k) ? ' is-num' : k === '=' ? ' is-eq' : k === 'C' || k === '⌫' ? ' is-clear' : ''}" data-calc="${k}">${k}</button>`
      ).join('');
      const el = this.floatTool(
        'calc',
        '電卓',
        `<div class="calc__screen"><div class="calc__prev" data-calc-prev aria-live="polite"></div><input class="calc__input" data-calc-input spellcheck="false" autocomplete="off" aria-label="式（キーボードでも打てます。Enter で計算）" /></div><div class="calc__keys">${keys}</div>`,
        {right: 300, bottom: 16}, // 電卓：ポーチの左下
        () => this.toggleCalc(false)
      );
      const input = el.querySelector('[data-calc-input]');
      const prev = el.querySelector('[data-calc-prev]');
      const run = () => {
        const expr = input.value.trim();
        if (!expr) return;
        try {
          const v = formatNumber(evaluate(expr));
          prev.textContent = `${expr} =`;
          prev.classList.remove('is-error');
          input.value = v;
        } catch (err) {
          prev.textContent = err.message;
          prev.classList.add('is-error');
        }
      };
      el.addEventListener('pointerdown', (e) => e.target.closest('[data-calc]') && e.preventDefault()); // 式の欄のカーソルを保つ
      el.addEventListener('click', (e) => {
        const k = e.target.closest('[data-calc]')?.dataset.calc;
        if (!k) return;
        if (k === '=') run();
        else if (k === 'C') {
          input.value = '';
          prev.textContent = '';
        } else if (k === '⌫') {
          const a = input.selectionStart ?? input.value.length,
            b = input.selectionEnd ?? a;
          input.setRangeText('', a === b ? Math.max(0, a - 1) : a, b, 'end');
        } else {
          const a = input.selectionStart ?? input.value.length;
          input.setRangeText(k, a, input.selectionEnd ?? a, 'end');
        }
        input.focus();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          run();
        }
      });
      this.calc = el;
      input.focus();
    }
    this.$('calc').setAttribute('aria-pressed', String(!!this.calc));
  }

  toggleMemo(on = !this.memo) {
    if (!on) {
      this.memo?.remove();
      this.memo = null;
    } else if (!this.memo) {
      const colors = MEMO_COLORS.map(
        (c) =>
          `<button type="button" class="swatch" data-memo-color="${c}" style="--swatch: ${c}" aria-pressed="${c === this.memoColor}" aria-label="紙の色 ${c}" title="紙の色"></button>`
      ).join('');
      const el = this.floatTool(
        'memo-pad',
        'メモ帳',
        `<div class="memo-pad__block">
          <div class="memo-pad__glue" data-memo-grip title="ここを持って引っぱるとちぎれます（ページの上で離すとそこに貼れます）"></div>
          <div class="memo-pad__sheet" style="--memo: ${this.memoColor}">
            <div class="memo-pad__perf" data-memo-grip title="ここを持って引っぱるとちぎれます（ページの上で離すとそこに貼れます）"></div>
            <textarea maxlength="2000" placeholder="書いてからちぎると、ページに貼れます（白紙のままちぎって、ペンで書き込むこともできます）"></textarea>
          </div>
        </div>
        <div class="memo-pad__foot"><span class="swatches">${colors}</span><button type="button" class="btn btn--small btn--primary" data-memo-tear title="いちばん上の紙をちぎって、見ているページに貼る">ちぎる</button></div>`,
        {right: 300, top: 72}, // メモ帳：ポーチの左上
        () => this.toggleMemo(false)
      );
      const ta = el.querySelector('textarea');
      ta.value = this.memoDraft;
      ta.addEventListener('input', () => (this.memoDraft = ta.value));
      el.addEventListener('click', (e) => {
        const c = e.target.closest('[data-memo-color]')?.dataset.memoColor;
        if (c) {
          this.memoColor = c;
          el.querySelector('.memo-pad__sheet').style.setProperty('--memo', c);
          for (const b of el.querySelectorAll('[data-memo-color]'))
            b.setAttribute('aria-pressed', String(b.dataset.memoColor === c));
        } else if (e.target.closest('[data-memo-tear]')) this.tearMemo();
      });
      // 紙の上の帯（ミシン目・のり）を持って引っぱると、ちぎって運ぶ
      el.querySelector('.memo-pad__block').addEventListener('pointerdown', (e) => {
        if (!e.target.closest('[data-memo-grip]')) return;
        const sheet = el.querySelector('.memo-pad__sheet');
        const r = sheet.getBoundingClientRect();
        const spec = this.memoSpec();
        this.startCarry(e, spec, {
          ghost: () => this.memoGhost(sheet),
          dx: e.clientX - r.left,
          dy: Math.max(0, e.clientY - r.top),
          onLift: () => this.clearMemo(),
          onCancel: () => {
            // ページの外で離した：ちぎらずに戻す
            ta.value = this.memoDraft = spec.body;
          },
          onTap: () => ta.focus()
        });
      });
      this.memo = el;
      ta.focus();
    }
    this.$('memo').setAttribute('aria-pressed', String(!!this.memo));
  }

  // ---- 定規：ページの上に置く透明な定規。ドラッグで動かし、右の端のつまみで回す（15° ごとに吸い付く）。ダブルクリックで水平に ----
  toggleRuler(on = !this.ruler) {
    if (!on) {
      this.ruler?.el.remove();
      this.ruler = null;
    } else if (!this.ruler) {
      const el = document.createElement('div');
      el.className = 'ruler';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', '定規');
      el.innerHTML =
        '<svg class="ruler__ticks" aria-hidden="true"></svg><span class="ruler__angle" aria-hidden="true"></span><button type="button" class="ruler__turn" title="回す（15° ごとに止まります。ダブルクリックで水平に）" aria-label="定規を回す">↻</button>';
      this.root.append(el);
      const w = document.documentElement.clientWidth;
      this.ruler = {el, cx: w / 2, cy: window.innerHeight * 0.62, angle: 0, len: 0};
      el.addEventListener('pointerdown', (e) => this.dragRuler(e));
      el.addEventListener('dblclick', () => {
        this.ruler.angle = 0;
        this.drawRuler();
      });
      this.drawRuler();
    }
    this.$('ruler').setAttribute('aria-pressed', String(!!this.ruler));
  }

  /** 目盛りと位置・向きを描く（拡大率が変わったら描き直す。目盛りはページの実寸） */
  drawRuler() {
    const r = this.ruler;
    const scale = this.stampScale();
    const mm = (72 / 25.4) * scale;
    r.len = RULER_MM * mm + RULER_PAD * 2;
    const ticks = [];
    for (let i = 0; i <= RULER_MM; i++) {
      const x = (RULER_PAD + i * mm).toFixed(2);
      const h = i % 10 === 0 ? 14 : i % 5 === 0 ? 10 : 6;
      ticks.push(`<path d="M${x} 0V${h}"/>`);
      if (i % 10 === 0) ticks.push(`<text x="${x}" y="26">${i / 10}</text>`);
    }
    const svg = r.el.querySelector('.ruler__ticks');
    svg.setAttribute('viewBox', `0 0 ${r.len.toFixed(2)} ${RULER_H}`);
    svg.innerHTML = ticks.join('');
    Object.assign(r.el.style, {
      left: `${r.cx - r.len / 2}px`,
      top: `${r.cy - RULER_H / 2}px`,
      width: `${r.len}px`,
      height: `${RULER_H}px`,
      transform: `rotate(${r.angle}deg)`
    });
    r.el.querySelector('.ruler__angle').textContent = `${Math.round(((r.angle % 360) + 360) % 360)}°`;
  }

  dragRuler(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = this.ruler;
    const turn = !!e.target.closest('.ruler__turn');
    r.el.setPointerCapture(e.pointerId);
    r.el.classList.toggle('is-turning', turn);
    const sx = e.clientX - r.cx,
      sy = e.clientY - r.cy;
    const move = (ev) => {
      if (turn) {
        let a = (Math.atan2(ev.clientY - r.cy, ev.clientX - r.cx) * 180) / Math.PI;
        const near = Math.round(a / 15) * 15;
        if (Math.abs(a - near) < 3) a = near; // 15° ごとに吸い付く
        r.angle = a;
      } else {
        r.cx = ev.clientX - sx;
        r.cy = ev.clientY - sy;
      }
      this.drawRuler();
    };
    const up = () => {
      r.el.classList.remove('is-turning');
      r.el.removeEventListener('pointermove', move);
      r.el.removeEventListener('pointerup', up);
      r.el.removeEventListener('pointercancel', up);
    };
    r.el.addEventListener('pointermove', move);
    r.el.addEventListener('pointerup', up);
    r.el.addEventListener('pointercancel', up);
  }

  /**
   * 画面の点が定規のふちのすぐ外（RULER_SNAP 以内）なら、そのふちの線（点と向き）。なければ null。
   * 定規の向き u、ふちの外向き n。ふちの長さの範囲（少しはみ出しても可）だけ
   */
  rulerEdgeAt(x, y) {
    const r = this.ruler;
    if (!r) return null;
    const a = (r.angle * Math.PI) / 180;
    const u = [Math.cos(a), Math.sin(a)],
      n = [-Math.sin(a), Math.cos(a)];
    const dx = x - r.cx,
      dy = y - r.cy;
    const t = dx * u[0] + dy * u[1],
      s = dx * n[0] + dy * n[1];
    if (Math.abs(t) > r.len / 2 + 8) return null;
    const out = Math.abs(s) - RULER_H / 2;
    if (out < -2 || out > RULER_SNAP) return null;
    const side = Math.sign(s) || 1;
    return {x: r.cx + n[0] * side * (RULER_H / 2), y: r.cy + n[1] * side * (RULER_H / 2), u};
  }

  /** 書いている線が定規に沿うとき、点をふちの線の上へ移す */
  onRule(d, x, y) {
    const e = d.rule;
    if (!e) return [x, y];
    const t = (x - e.x) * e.u[0] + (y - e.y) * e.u[1];
    return [e.x + e.u[0] * t, e.y + e.u[1] * t];
  }

  // ---- タイマー：時間を選んで「開始」。時間になると音を鳴らして知らせる。窓をしまっても動き続け、ポーチに残りを出す ----
  toggleTimer(on = !this.timerEl, {stop = false} = {}) {
    if (!on) {
      this.timerEl?.remove();
      this.timerEl = null;
      if (stop) {
        this.stopTick();
        this.timer = null;
      }
    } else if (!this.timerEl) {
      this.timer ??= newTimer(TIMER_PRESETS[2] * 60000);
      const presets = TIMER_PRESETS.map(
        (m) => `<button type="button" class="timer__preset" data-timer-min="${m}">${m} 分</button>`
      ).join('');
      const el = this.floatTool(
        'timer',
        'タイマー',
        `<div class="timer__face"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="timer__track"/><circle cx="60" cy="60" r="52" class="timer__ring" data-timer-ring pathLength="1"/></svg><output class="timer__clock" data-timer-clock aria-live="off"></output></div>
        <div class="timer__presets">${presets}<label class="timer__custom"><input type="number" min="1" max="180" data-timer-custom aria-label="分を入れる" placeholder="分" /></label></div>
        <div class="timer__foot"><button type="button" class="btn btn--small" data-timer-reset>リセット</button><button type="button" class="btn btn--small btn--primary" data-timer-go></button></div>`,
        {right: 580, bottom: 16}, // タイマー：電卓の左
        () => this.toggleTimer(false)
      );
      el.addEventListener('click', (e) => {
        const m = e.target.closest('[data-timer-min]')?.dataset.timerMin;
        if (m) this.setTimer(Number(m));
        else if (e.target.closest('[data-timer-go]'))
          this.timer = isRunning(this.timer) ? pauseTimer(this.timer, Date.now()) : startTimer(this.timer, Date.now());
        else if (e.target.closest('[data-timer-reset]')) this.timer = newTimer(this.timer.total);
        else return;
        this.tickTimer();
      });
      el.querySelector('[data-timer-custom]').addEventListener('change', (e) => {
        const m = clampMinutes(e.target.value);
        if (m) this.setTimer(m);
        e.target.value = '';
        this.tickTimer();
      });
      this.timerEl = el;
      this.tickTimer();
    }
    this.$('timer').setAttribute('aria-pressed', String(!!this.timerEl));
    if (stop || !this.timerEl) this.tickTimer();
  }

  setTimer(min) {
    this.timer = newTimer(min * 60000);
  }

  stopTick() {
    clearInterval(this.timerTick);
    this.timerTick = 0;
  }

  /** 表示を今の残りに合わせる。時間になったら鳴らす */
  tickTimer() {
    const t = this.timer;
    const badge = this.$('timer-badge');
    if (!t) {
      if (badge) badge.hidden = true;
      return this.stopTick();
    }
    const now = Date.now();
    if (isDone(t, now)) {
      this.timer = newTimer(t.total);
      this.timer.left = 0;
      this.chime();
      toast('タイマー：時間です');
      this.timerEl?.classList.add('is-done');
      setTimeout(() => this.timerEl?.classList.remove('is-done'), 2400);
    }
    const cur = this.timer;
    const left = timerLeft(cur, now);
    const running = isRunning(cur);
    if (badge) {
      badge.hidden = !running || !!this.timerEl;
      badge.textContent = formatClock(left);
    }
    // 動いている間か窓を出している間だけ、0.25 秒ごとに描き直す
    if (!running && !this.timerEl) return this.stopTick();
    if (!this.timerTick) this.timerTick = setInterval(() => this.tickTimer(), 250);
    const el = this.timerEl;
    if (!el) return;
    el.querySelector('[data-timer-clock]').textContent = formatClock(left);
    el.querySelector('[data-timer-ring]').style.strokeDashoffset = String(1 - left / cur.total);
    el.querySelector('[data-timer-go]').textContent = running
      ? '一時停止'
      : left < cur.total && left > 0
        ? '再開'
        : '開始';
    for (const b of el.querySelectorAll('[data-timer-min]'))
      b.setAttribute('aria-pressed', String(Number(b.dataset.timerMin) * 60000 === cur.total));
    el.classList.toggle('is-running', running);
  }

  /** 時間になった音（短く 3 回） */
  chime() {
    try {
      const ctx = new window.AudioContext();
      for (let i = 0; i < 3; i++) {
        const o = ctx.createOscillator(),
          g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.35);
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.35 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.35 + 0.25);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.35);
        o.stop(ctx.currentTime + i * 0.35 + 0.26);
      }
      setTimeout(() => ctx.close(), 1500);
    } catch {
      // 音を出せない環境では知らせだけ
    }
  }

  /** いまメモ帳に書いてある紙の中身（貼るもの） */
  memoSpec() {
    const body = (this.memo?.querySelector('textarea').value ?? '').replace(/\s+$/, '');
    return {type: 'memo', body, color: this.memoColor, size: MEMO_SIZE, w: MEMO_PT, h: MEMO_PT};
  }

  /** ちぎった紙の影（いまの紙の写し。上の辺はぎざぎざ） */
  memoGhost(sheet) {
    const r = sheet.getBoundingClientRect();
    const g = document.createElement('div');
    g.className = 'memo-ghost';
    g.style.setProperty('--memo', this.memoColor);
    Object.assign(g.style, {left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`});
    g.style.clipPath = tearClip(r.width, 4, 10);
    g.textContent = this.memo?.querySelector('textarea').value ?? '';
    return g;
  }

  /** 新しい紙にする（ちぎったあと） */
  clearMemo() {
    if (!this.memo) return;
    const ta = this.memo.querySelector('textarea');
    ta.value = this.memoDraft = '';
    const sheet = this.memo.querySelector('.memo-pad__sheet');
    sheet.classList.remove('is-fresh');
    void sheet.offsetWidth;
    sheet.classList.add('is-fresh');
  }

  /** 「ちぎる」：いちばん上の紙をちぎって、見ているページに貼る（紙が飛んでいって貼られる） */
  tearMemo() {
    if (!this.memo) return;
    const sheet = this.memo.querySelector('.memo-pad__sheet');
    const spec = this.memoSpec();
    const ghost = this.memoGhost(sheet);
    ghost.classList.add('carry-ghost');
    this.root.append(ghost);
    const from = ghost.getBoundingClientRect();
    this.clearMemo();
    const a = this.placeStamp(spec);
    if (!a || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return ghost.remove();
    a.el.style.visibility = 'hidden';
    const to = a.el.getBoundingClientRect();
    ghost
      .animate(
        [
          {transform: 'none'},
          {transform: 'translate(6px, -16px) rotate(-5deg)', offset: 0.3},
          {
            transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`
          }
        ],
        {duration: 560, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)'}
      )
      .finished.catch(() => {})
      .finally(() => {
        ghost.remove();
        a.el.style.visibility = '';
      });
  }

  /** シールの画像（data: URL）。取り込んだ画像はメインからもらい、覚えておく */
  stickerSrc(id) {
    if (isBuiltinSticker(id)) return Promise.resolve(builtinStickerUrl(id));
    if (!this.stickerUrls.has(id))
      this.stickerUrls.set(
        id,
        api['sticker.data']({ids: [id]}).then(
          (r) => r?.data?.[id] ?? '',
          () => ''
        )
      );
    return this.stickerUrls.get(id);
  }
}
