// PDF の編集画面：PDF とノートを窓の中に並べたとき（#/split。app.js の mountSplit）の、左右の画面のつなぎ。
// Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）。左右はそれぞれ iframe の中の編集画面で、親の画面を通して知らせ合う。
//  - 道具は窓全体で 1 そろい：シール帳・素材は窓の左の端（左の画面）だけ、筆箱・ポーチは窓の右の端（右の画面）だけに出す。
//    左右の分かれ目には四隅の道具を出さない
//  - 持っている道具（ペン・マーカー・消しゴム・文字・コメントなど）は左右で同じ（片方で持ち替えたら、もう片方も）
//  - シール・素材を押して貼る・ポーチの赤シートと定規は、最後に触った側（ページや道具の帯を押した・キーを打った側）に
//  - 運んでいる貼りものは、左右の分かれ目をまたいで、もう片方のページにも貼れる（影は親の画面が窓全体に描く）
//  - 並べるのをやめるとき・ほかの画面へ移るときは、親に頼まれて書きかけを保存してから閉じる
import {KIND_OF, itemOf} from '../../../shared/stationery.js';

const PEN_TOOLS = ['ink', 'line', 'mask'];

export const methods = {
  /** 並べた画面なら用意する（start の始めに呼ぶ）。左右は URL の side（left・right） */
  setupSplit() {
    const q = new URLSearchParams(location.search);
    const side = q.get('pane') === 'embed' && window.parent !== window ? q.get('side') : null;
    this.splitSide = side === 'left' || side === 'right' ? side : null;
    if (!this.splitSide) return;
    document.documentElement.dataset.splitSide = this.splitSide;
    this.splitActive = this.splitSide === 'left';
    this.on(window, 'message', (e) => {
      if (e.source !== window.parent || this.destroyed) return;
      const d = e.data ?? {};
      if (d.type === 'split-active-is') this.splitActive = d.side === this.splitSide;
      else if (d.type === 'split-do') this.doSplit(d);
      else if (d.type === 'split-leave') this.leaveSplit();
    });
    // 触った側を親に知らせる（四隅の道具・浮かぶ道具を押したときは数えない：そこから貼る先は、その前に触った側）
    const touch = (e) => {
      if (e.target?.closest?.('[data-corner], .float-tool')) return;
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
  },

  /** もう片方から回ってきたこと */
  doSplit(d) {
    if (d.what === 'tool') this.applyRemoteTool(d.state);
    else if (d.what === 'tool-ask') this.syncTool();
    else if (d.what === 'place') this.placeStamp(d.spec);
    else if (d.what === 'drop') this.dropStamp(d.spec, d.px, d.py, d.cx, d.cy);
    else if (d.what === 'pouch') {
      if (d.v === 'sheet') this.toggleSheet();
      else if (d.v === 'ruler') this.toggleRuler();
    }
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

  /** ポーチの赤シート・定規：最後に触った側がもう片方なら、そちらで出す。回したら true */
  routePouch(v) {
    if (!['sheet', 'ruler'].includes(v) || !this.splitOther()) return false;
    this.relaySplit({what: 'pouch', v});
    this.tuckSoon();
    return true;
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
