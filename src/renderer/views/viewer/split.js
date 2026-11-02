// PDF の編集画面：PDF とノートを窓の中に並べたとき（#/split。app.js の mountSplit）の、左右の画面のつなぎ。
// Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）。左右はそれぞれ iframe の中の編集画面で、親の画面を通して知らせ合う。
//  - 道具は窓全体で 1 そろい：シール帳・素材は窓の左の端（左の画面）だけ、筆箱・ポーチは窓の右の端（右の画面）だけに出す。
//    左右の分かれ目には四隅の道具を出さない
//  - 持っている道具（ペン・マーカー・消しゴム・文字・コメントなど）は左右で同じ（片方で持ち替えたら、もう片方も）
//  - シール・素材を押して貼る・ポーチの赤シートと定規は、最後に触った側（ページや道具の帯を押した・キーを打った側）に
//  - 運んでいる貼りものは、左右の分かれ目をまたいで、もう片方のページにも貼れる（影は親の画面が窓全体に描く）
//  - 並べるのをやめるとき・ほかの画面へ移るときは、親に頼まれて書きかけを保存してから閉じる（見ていた場所も覚える）
//  - ポーチの道具も 1 そろい：赤シート・定規は左右どちらか 1 つだけ。電卓・メモ帳・タイマーはポーチのある右に出し、
//    帯を持って分かれ目の向こうへ動かすと、もう片方の画面へ移る（式・書きかけ・タイマーの残りもそのまま）
import {KIND_OF, itemOf} from '../../../shared/stationery.js';

const PEN_TOOLS = ['ink', 'line', 'mask'];
const IS_MAC = /Mac/.test(navigator.platform);
const isUndoKey = (e) =>
  (IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && ['z', 'y'].includes(e.key.toLowerCase());
const SPOT_MAX_AGE = 2 * 3600 * 1000; // 見ていた場所を覚えておく長さ
const POUCH = ['sheet', 'ruler', 'calc', 'memo', 'timer'];
const FLOATS = {calc: 'calc', 'memo-pad': 'memo', timer: 'timer'}; // 浮かぶ窓の class → ポーチの道具
const SEAL_HINT =
  '押すと最後に触った側（上に色の線が出ている側）のページの真ん中に、ドラッグすると好きな所に貼れます（左右の分かれ目をまたいでも貼れます）';

export const methods = {
  /** 並べた画面なら用意する（start の始めに呼ぶ）。左右は URL の side（left・right） */
  setupSplit() {
    const q = new URLSearchParams(location.search);
    const side = q.get('pane') === 'embed' && window.parent !== window ? q.get('side') : null;
    this.splitSide = side === 'left' || side === 'right' ? side : null;
    if (!this.splitSide) return;
    document.documentElement.dataset.splitSide = this.splitSide;
    this.splitActive = this.splitSide === 'left';
    this.remotePouch = {}; // もう片方に出ているポーチの道具（ポーチの押した印・1 そろいにするため）
    for (const h of this.root.querySelectorAll(
      '[data-corner="seal"] .corner__hint, [data-corner="sozai"] .corner__hint'
    ))
      h.textContent = SEAL_HINT;
    this.on(window, 'message', (e) => {
      if (e.source !== window.parent || this.destroyed) return;
      const d = e.data ?? {};
      if (d.type === 'split-active-is') this.splitActive = d.side === this.splitSide;
      else if (d.type === 'split-do') this.doSplit(d);
      else if (d.type === 'split-leave') this.leaveSplit();
      else if (d.type === 'split-spot') this.saveSpot(); // 並べ替える前に、見ている場所を覚える
    });
    // 触った側を親に知らせる（四隅の道具・浮かぶ道具を押したときは数えない：そこから貼る先は、その前に触った側）
    const touch = (e) => {
      if (e.target?.closest?.('[data-corner], .float-tool')) return;
      // 取り消す・やり直す（⌘Z・⇧⌘Z・⌘Y）は最後に触った側を変えない（その側の操作を取り消すため。onKey が回す）
      if (e.type === 'keydown' && isUndoKey(e)) return;
      if (!this.splitActive) {
        this.splitActive = true; // 親の返事を待たずに（貼り付け ⌘V はキーのすぐあと）
        this.postSplit({type: 'split-active'});
      }
    };
    this.on(window, 'pointerdown', touch, true);
    this.on(window, 'keydown', touch, true);
  },

  /** 画面の端から四隅の道具を出してよいか（DeskTools を上書き）：並べたときは窓の端の側だけ。分かれ目の側は出さない */
  edgeAllowed(side) {
    return !this.splitSide || this.splitSide === side;
  },

  postSplit(msg) {
    window.parent.postMessage(msg, '*');
  },

  /** 並べていて、もう片方が最後に触った側か（貼る先・赤シート・定規をそちらへ回す） */
  splitOther() {
    return !!this.splitSide && !this.splitActive;
  },

  /** もう片方の画面にしてもらう（親が回す）。what：place・drop・pouch・tool */
  relaySplit(msg) {
    this.postSplit({...msg, type: 'split-relay'});
    // 貼ったもの・出したものがもう片方の画面へ行ったことを、読み上げにも伝える（目で見る印は上の色の線）
    const where = this.splitSide === 'left' ? '右' : '左';
    const said = {
      place: `${where}の画面のページに貼りました`,
      drop: `${where}の画面のページに貼りました`,
      undo: `${where}の画面の操作を取り消しました`,
      redo: `${where}の画面の操作をやり直しました`
    }[msg.what];
    if (said) this.announce(said);
  },

  /** 読み上げにだけ伝える（画面には出さない） */
  announce(text) {
    let el = this.root.querySelector('[data-v="split-live"]');
    if (!el) {
      el = document.createElement('div');
      el.className = 'sr-only';
      el.dataset.v = 'split-live';
      el.setAttribute('aria-live', 'polite');
      this.root.append(el);
    }
    el.textContent = '';
    requestAnimationFrame(() => (el.textContent = text));
  },

  /** 取り消す・やり直す：並べていて最後に触ったのがもう片方なら、そちらで（貼ったシールなどは、そちらの画面の操作）。回したら true */
  routeUndo(what) {
    if (!this.splitOther()) return false;
    this.relaySplit({what});
    return true;
  },

  /** もう片方から回ってきたこと */
  doSplit(d) {
    if (d.what === 'tool') this.applyRemoteTool(d.state);
    else if (d.what === 'tool-ask') this.syncTool();
    else if (d.what === 'place') this.placeStamp(d.spec);
    else if (d.what === 'drop') this.dropStamp(d.spec, d.px, d.py, d.cx, d.cy);
    else if (d.what === 'undo') this.undo();
    else if (d.what === 'redo') this.redo();
    else if (d.what === 'pouch') this.togglePouchHere(d.v);
    else if (d.what === 'pouch-state') {
      this.remotePouch[d.v] = d.on;
      // 赤シート・定規は 1 つだけ：もう片方で出したら、こちらのはしまう
      if (d.on && d.v === 'sheet' && this.sheet) this.toggleSheet(false);
      if (d.on && d.v === 'ruler' && this.ruler) this.toggleRuler(false);
      this.markPouch(d.v);
    } else if (d.what === 'float') this.receiveFloat(d);
  },

  /** 持っている道具を、もう片方にも知らせる（setTool のたびに。もう片方から来たものは送り返さない） */
  syncTool() {
    if (!this.splitSide || this.applyingTool || !this.toolSyncReady) return;
    const pen = PEN_TOOLS.includes(this.tool) ? this.penItem : null;
    this.relaySplit({
      what: 'tool',
      state: {tool: this.tool, penId: pen?.id ?? null, refill: pen?.refill?.id ?? null, slot: this.slot ?? null}
    });
  },

  applyRemoteTool(state) {
    if (!state) return;
    this.applyingTool = true;
    try {
      const item = state.penId ? itemOf(state.penId) : null;
      if (item && PEN_TOOLS.includes(state.tool) && KIND_OF[item.type] === state.tool) {
        if (state.refill) this.st = {...this.st, refills: {...this.st.refills, [item.id]: state.refill}};
        this.usePen(item, state.slot);
      } else if (!PEN_TOOLS.includes(state.tool)) this.setTool(state.tool);
    } finally {
      // setTool がもう片方へ知らせるのは次の小さな待ち（queueMicrotask）なので、それが済んでから外す（送り返さない）
      queueMicrotask(() => (this.applyingTool = false));
    }
  },

  /** 開き終わったら道具をそろえ始める：もう片方に今の道具を聞く（先に開いていた側が答える） */
  startToolSync() {
    if (!this.splitSide) return;
    this.toolSyncReady = true;
    // 自分の道具の知らせ（ノートが最初のペンを持った：setTool の小さな待ち）を先に送ってから聞く（返事で上書きされないように）
    queueMicrotask(() => !this.destroyed && this.relaySplit({what: 'tool-ask'}));
  },

  /**
   * ポーチの道具を出す・しまう（ポーチを押したとき・⌘R・⌘D）。並べたときは 1 そろいになるように振り分ける。回したら true
   * - もう片方に出ていれば、もう片方でしまう
   * - 赤シート・定規は最後に触った側に、電卓・メモ帳・タイマーはポーチのある右の画面に出す
   */
  routePouch(v) {
    if (!this.splitSide || !POUCH.includes(v) || this.pouchHere(v)) return false;
    const there =
      this.remotePouch[v] || (['sheet', 'ruler'].includes(v) ? this.splitOther() : this.splitSide === 'left');
    if (!there) return false;
    this.relaySplit({what: 'pouch', v});
    this.tuckSoon();
    return true;
  },

  /** この画面にポーチの道具が出ているか */
  pouchHere(v) {
    return !!{sheet: this.sheet, ruler: this.ruler, calc: this.calc, memo: this.memo, timer: this.timerEl}[v];
  },

  /** ポーチの道具をこの画面で出す・しまう（もう片方から頼まれたとき） */
  togglePouchHere(v) {
    if (v === 'sheet') this.toggleSheet();
    else if (v === 'ruler') this.toggleRuler();
    else if (v === 'calc') this.toggleCalc();
    else if (v === 'memo') this.toggleMemo();
    else if (v === 'timer') this.toggleTimer();
  },

  /** ポーチの道具を出した・しまった（各道具の toggle の終わりに呼ぶ。DeskTools から）：もう片方に知らせ、押した印を左右合わせて付ける */
  splitPouchState(v) {
    if (!this.splitSide) return;
    this.relaySplit({what: 'pouch-state', v, on: this.pouchHere(v)});
    this.markPouch(v);
  },

  /** ポーチの押した印：この画面か、もう片方に出ていれば押した印 */
  markPouch(v) {
    this.$(v)?.setAttribute('aria-pressed', String(this.pouchHere(v) || !!this.remotePouch?.[v]));
  },

  /**
   * 浮かぶ窓（電卓・メモ帳・タイマー）を帯を持って動かし終えたとき（DeskTools の floatTool から）：真ん中が分かれ目の向こうに
   * 出ていたら、もう片方の画面へ移す（式・書きかけ・タイマーの残りもそのまま）
   */
  floatMoved(el) {
    if (!this.splitSide) return;
    const kind = Object.entries(FLOATS).find(([cls]) => el.classList.contains(cls))?.[1];
    if (!kind) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const out = this.splitSide === 'left' ? cx >= document.documentElement.clientWidth - 4 : cx <= 12;
    if (!out) return;
    const state =
      kind === 'calc'
        ? {
            input: el.querySelector('[data-calc-input]')?.value ?? '',
            prev: el.querySelector('[data-calc-prev]')?.textContent ?? ''
          }
        : kind === 'memo'
          ? {draft: this.memoDraft, color: this.memoColor}
          : {timer: this.timer};
    if (kind === 'calc') this.toggleCalc(false);
    else if (kind === 'memo') this.toggleMemo(false);
    else this.toggleTimer(false, {stop: true}); // タイマーは移った先で動かす（2 つで鳴らさない）
    // 移った先では、分かれ目のすぐ向こうに同じ高さで出す
    this.relaySplit({
      what: 'float',
      kind,
      state,
      x: this.splitSide === 'left' ? r.width : -r.width,
      y: r.top,
      w: r.width
    });
  },

  /** もう片方から移ってきた浮かぶ窓を出す */
  receiveFloat(d) {
    const {kind, state = {}} = d;
    if (kind === 'memo') {
      this.memoDraft = state.draft ?? '';
      if (state.color) this.memoColor = state.color;
      if (!this.memo) this.toggleMemo(true);
    } else if (kind === 'calc') {
      if (!this.calc) this.toggleCalc(true);
      const input = this.calc?.querySelector('[data-calc-input]');
      if (input) input.value = state.input ?? '';
      const prev = this.calc?.querySelector('[data-calc-prev]');
      if (prev) prev.textContent = state.prev ?? '';
    } else if (kind === 'timer') {
      if (state.timer) this.timer = state.timer;
      if (!this.timerEl) this.toggleTimer(true);
      this.tickTimer();
    }
    const el = kind === 'calc' ? this.calc : kind === 'memo' ? this.memo : this.timerEl;
    if (!el) return;
    // 分かれ目の側の端に寄せて出す（親が直した x はこの画面の中の位置。はみ出さないように収める）
    const w = el.getBoundingClientRect().width || d.w || 260;
    const left = this.splitSide === 'left' ? document.documentElement.clientWidth - w - 8 : 8;
    Object.assign(el.style, {
      right: '',
      bottom: '',
      left: `${left}px`,
      top: `${Math.max(0, Math.min(d.y ?? 72, window.innerHeight - 40))}px`
    });
  },

  /** 見ている場所（ページと高さ）を覚える（並べる・並べるのをやめるときに開き直しても、同じ所から見られるように） */
  saveSpot() {
    if (!this.pages?.length) return;
    try {
      localStorage.setItem(`viewer.spot.${this.materialId}`, JSON.stringify({...this.currentSpot(), t: Date.now()}));
      // 古くなった場所は片付ける（資料ごとに増えていかないように）
      const now = Date.now();
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k?.startsWith('viewer.spot.')) continue;
        let t = 0;
        try {
          t = JSON.parse(localStorage.getItem(k))?.t ?? 0;
        } catch {
          t = 0;
        }
        if (now - t > SPOT_MAX_AGE) localStorage.removeItem(k);
      }
    } catch {
      // 覚えられなくても開ける（はじめから見る）
    }
  },

  /** 覚えておいた場所へ（開いて 2 時間以内に覚えたものだけ）。ページを並べて大きさを決めたあとに呼ぶ */
  restoreSpot() {
    let s = null;
    try {
      s = JSON.parse(localStorage.getItem(`viewer.spot.${this.materialId}`) ?? 'null');
    } catch {
      s = null;
    }
    if (!s || Date.now() - (s.t ?? 0) > SPOT_MAX_AGE) return;
    const p = this.pages[Math.min(this.pages.length, Math.max(1, s.page)) - 1];
    if (!p) return;
    const top = this.root.querySelector('.viewer-bar').getBoundingClientRect().bottom + 8;
    const r = p.el.getBoundingClientRect();
    window.scrollTo({top: window.scrollY + r.top + (s.y ?? 0) * r.height - top});
  },

  /** 運んで離した点が、この画面の外（左右の分かれ目の向こう）なら、もう片方に貼ってもらう。回したら true */
  dropAcross(spec, px, py, cx, cy) {
    if (!this.splitSide) return false;
    const out = this.splitSide === 'left' ? px >= window.innerWidth : px < 0;
    if (!out) return false;
    this.relaySplit({what: 'drop', spec, px, py, cx, cy});
    return true;
  },

  /** 運んでいる影を、親の画面が窓全体に描く（左右の分かれ目をまたいでも見えるように）。phase：lift・move・end */
  splitGhost(phase, ghost) {
    if (!this.splitSide) return;
    if (phase === 'lift') {
      ghost.style.opacity = '0'; // この画面の中の影は見せない（親の影と 2 重にしない）
      const send = () =>
        this.postSplit({type: 'split-ghost', phase: 'lift', html: ghost.outerHTML.replace(/opacity:\s*0;?/, '')});
      // 画像は読み込めてから送る（シールの画像はあとから入る。src がないうちは complete でも空のまま）
      const ready = ghost.tagName !== 'IMG' || (ghost.getAttribute('src') && ghost.complete && ghost.naturalWidth);
      if (ready) send();
      else ghost.addEventListener('load', send, {once: true});
    } else if (phase === 'move') {
      const r = ghost.getBoundingClientRect();
      this.postSplit({type: 'split-ghost', phase: 'move', x: r.left, y: r.top, w: r.width, h: r.height});
    } else this.postSplit({type: 'split-ghost', phase: 'end'});
  },

  /** 親に頼まれて、書きかけ（打っている文字・保存待ち）を保存し、ファイルにも描き込んでから知らせる */
  async leaveSplit() {
    try {
      this.saveSpot();
      this.finishEdit();
      await this.settle();
      await this.saveFile();
    } catch {
      // 保存できなくても閉じる（知らせは保存の側で出している）
    } finally {
      this.postSplit({type: 'split-left'});
    }
  }
};
