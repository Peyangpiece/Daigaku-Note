// PDF の編集画面：複数選択とコピー・切り取り・貼り付け（v0.27.13）。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
// - 選ぶ：押す（1 つ）・Shift か ⌘（Ctrl）を押しながら押す（足す・外す）・選択の道具でページの空いた所をなぞる（四角で囲む）・⌘A（全部）
// - 選んだものは、まとめて動かす・Delete で消す・コピー（⌘C）・切り取り（⌘X）・貼り付け（⌘V）。取り消しは 1 手にまとめる
// - 扱うのはペンの線（ink）以外の注釈：文字入れ・コメント・貼りもの（シール・図・紙・付箋）・マーカー・文字隠し
// - コピーした中身は OS のクリップボードに入れる（独自の形式と、文字入れ・コメントの本文の文字）。別の PDF・ノート、
//   並べたもう片方の画面にも貼れる。ほかのアプリでコピーした文字を貼ると、新しい文字入れになる
// - 文字を打っている間・PDF の文字を選んでいる間は、ふつうのコピー・貼り付けのまま（横取りしない）
import {isTyping} from '../../ui-kit.js';
import {LINE_HEIGHT} from './shared.js';

/** クリップボードの独自の形式（同じアプリの中だけで読める） */
const MIME = 'application/x-palette-note-annotations';
/** 貼るたびにずらす量（pt）。同じ所に重ならないように */
const PASTE_STEP = 12;
/** 選べる注釈か（ペンの線は押しても選べないので、まとめて選ぶときも除く） */
const pickable = (a) => !!a && !a.removed && a.kind !== 'ink';
/**
 * 最後にこの画面でコピーした中身（OS のクリップボードが独自の形式を残さないときの控え。iPad の一部など）。
 * 貼るときにクリップボードの文字が同じなら、これを使う
 */
let lastClip = null;

export const methods = {
  /** 選んでいる注釈（選んだ順） */
  pickedList() {
    return [...(this.picked ?? [])].filter(pickable);
  },

  /** 足す・外す（Shift か ⌘ を押しながら押したとき）。外したら、最後に選んだものを主に */
  togglePick(a) {
    if (!pickable(a)) return;
    this.picked ??= new Set();
    if (this.picked.has(a)) {
      this.picked.delete(a);
      a.el.classList.remove('is-selected');
      this.selected = this.pickedList().at(-1) ?? null;
    } else {
      this.picked.add(a);
      a.el.classList.add('is-selected');
      this.selected = a;
    }
    this.updateBar();
  },

  /** いくつかをまとめて選ぶ。add が真なら、いま選んでいるものに足す */
  pickMany(list, {add = false} = {}) {
    if (!add) this.select(null);
    this.picked ??= new Set();
    for (const a of list.filter(pickable)) {
      this.picked.add(a);
      a.el.classList.add('is-selected');
      this.selected = a;
    }
    this.updateBar();
  },

  /** ⌘A：この PDF の注釈を全部選ぶ（ペンの線を除く） */
  pickAll() {
    this.finishEdit();
    this.pickMany([...this.annos.values()]);
    const n = this.pickedList().length;
    if (n) this.announce?.(`${n} 個を選びました`);
  },

  // ---- 四角で囲んで選ぶ（選択の道具で、ページの空いた所をなぞる）----
  startMarquee(e, p) {
    e.preventDefault();
    const el = document.createElement('div');
    el.className = 'pick-marquee';
    p.el.append(el);
    const box = p.el.getBoundingClientRect();
    this.marquee = {
      pointer: e.pointerId,
      p,
      el,
      x0: e.clientX - box.left,
      y0: e.clientY - box.top,
      x1: e.clientX - box.left,
      y1: e.clientY - box.top,
      add: e.shiftKey || e.metaKey || e.ctrlKey
    };
    try {
      this.pagesEl.setPointerCapture(e.pointerId);
    } catch {
      // 指がもう離れていた
    }
    this.drawMarquee();
  },

  moveMarquee(e) {
    const m = this.marquee;
    const box = m.p.el.getBoundingClientRect();
    m.x1 = Math.min(Math.max(e.clientX - box.left, 0), box.width);
    m.y1 = Math.min(Math.max(e.clientY - box.top, 0), box.height);
    this.drawMarquee();
  },

  drawMarquee() {
    const m = this.marquee;
    Object.assign(m.el.style, {
      left: `${Math.min(m.x0, m.x1)}px`,
      top: `${Math.min(m.y0, m.y1)}px`,
      width: `${Math.abs(m.x1 - m.x0)}px`,
      height: `${Math.abs(m.y1 - m.y0)}px`
    });
  },

  /** 離した：囲んだ四角に重なる注釈を選ぶ。ほとんど動かさずに離したら、ただのクリック（選ぶのをやめる） */
  endMarquee() {
    const m = this.marquee;
    this.marquee = null;
    m.el.remove();
    const w = Math.abs(m.x1 - m.x0),
      h = Math.abs(m.y1 - m.y0);
    if (w < 4 && h < 4) {
      if (!m.add) this.select(null);
      return;
    }
    const box = m.p.el.getBoundingClientRect();
    const r = {
      left: box.left + Math.min(m.x0, m.x1),
      top: box.top + Math.min(m.y0, m.y1),
      right: box.left + Math.max(m.x0, m.x1),
      bottom: box.top + Math.max(m.y0, m.y1)
    };
    const hits = [...this.annos.values()].filter((a) => {
      if (!pickable(a) || a.page !== m.p.num) return false;
      const b = a.el.getBoundingClientRect();
      return b.right >= r.left && b.left <= r.right && b.bottom >= r.top && b.top <= r.bottom;
    });
    this.pickMany(hits, {add: m.add});
    if (hits.length) this.announce?.(`${hits.length} 個を選びました`);
  },

  // ---- コピー・切り取り・貼り付け（document の copy・cut・paste。⌘C・⌘X・⌘V も、メニューの「編集」も同じ）----
  /** 横取りしてよいか：文字を打っていない・PDF の文字を選んでいない */
  clipFree(e) {
    if (this.destroyed || this.editing || isTyping(e)) return false;
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed && String(sel).trim()) return false; // PDF の文字のコピーは、ふつうに
    return true;
  },

  /** コピー（cut が真なら切り取り：コピーしてから消す） */
  onCopy(e, cut = false) {
    if (!this.clipFree(e)) return;
    const list = this.pickedList();
    if (!list.length) return;
    e.preventDefault();
    const items = list.map((a) => this.snap(a));
    const json = JSON.stringify({
      v: 1,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from: this.materialId,
      items
    });
    // ほかのアプリへ貼ると、文字入れ・コメント・紙の本文が文字で入る
    const text = list
      .map((a) => (a.kind === 'text' || a.kind === 'note' || a.style?.type === 'memo' ? a.body : ''))
      .filter((t) => t?.trim())
      .join('\n');
    e.clipboardData?.setData(MIME, json);
    e.clipboardData?.setData('text/plain', text);
    lastClip = {json, text};
    if (cut) {
      this.recordGroup(list.map((a) => ({key: a.key, before: this.snap(a), after: null})));
      for (const a of list) this.removeAnno(a, false);
      this.announce?.(`${list.length} 個を切り取りました`);
    } else this.announce?.(`${list.length} 個をコピーしました`);
  },

  onPaste(e) {
    if (!this.clipFree(e)) return;
    const cd = e.clipboardData;
    if (!cd) return;
    // 写真（画像のファイル）は、写真を貼る処理に任せる（viewer/notebook.js）
    if ([...(cd.files ?? [])].some((f) => f.type.startsWith('image/'))) return;
    const text = cd.getData('text/plain') ?? '';
    let json = cd.getData(MIME);
    if (!json && lastClip && lastClip.text === text) json = lastClip.json;
    if (json) {
      let clip = null;
      try {
        clip = JSON.parse(json);
      } catch {
        clip = null;
      }
      if (clip?.v === 1 && Array.isArray(clip.items) && clip.items.length) {
        e.preventDefault();
        return void this.pasteItems(clip);
      }
    }
    if (text.trim()) {
      e.preventDefault();
      this.pasteText(text);
    }
  },

  /** 見ているページ（画面の真ん中に近いページ） */
  viewPage() {
    const c = this.viewCenter();
    const dist = (q) => {
      const r = q.el.getBoundingClientRect();
      return c.y < r.top ? r.top - c.y : c.y > r.bottom ? c.y - r.bottom : 0;
    };
    return this.pages.length ? this.pages.reduce((a, b) => (dist(b) < dist(a) ? b : a)) : null;
  },

  /**
   * コピーした注釈を、見ているページに貼る。元と同じ PDF の同じページなら、貼るたびに少しずつずらす（重ならないように）。
   * ほかのページ・ほかの PDF なら、元と同じ位置に（はみ出すならページの中へ寄せる）。全部をまとめて 1 手で取り消せる
   */
  pasteItems(clip) {
    this.finishEdit();
    const p = this.viewPage();
    if (!p) return;
    const vp = p.viewport;
    const same = clip.from === this.materialId && clip.items.every((it) => it.page === p.num);
    this.pasteN = this.lastPasteId === `${clip.id}:${p.num}` ? (this.pasteN ?? 0) + 1 : same ? 1 : 0;
    this.lastPasteId = `${clip.id}:${p.num}`;
    // 画面の位置（このページの大きさで）
    const boxes = clip.items.map((it) => this.toScreen(p.num, it.rect));
    const step = PASTE_STEP * vp.scale * this.pasteN;
    const left = Math.min(...boxes.map((b) => b.left)) + step;
    const top = Math.min(...boxes.map((b) => b.top)) + step;
    const right = Math.max(...boxes.map((b) => b.left + b.width)) + step;
    const bottom = Math.max(...boxes.map((b) => b.top + b.height)) + step;
    // まとめてページの中へ寄せる（並びは保つ）
    const dx = right > vp.width ? Math.max(-left, vp.width - right) : left < 0 ? -left : 0;
    const dy = bottom > vp.height ? Math.max(-top, vp.height - bottom) : top < 0 ? -top : 0;
    const made = clip.items.map((it, i) => {
      const b = boxes[i];
      const a = this.addAnno({
        key: `k${this.seq++}`,
        id: null,
        page: p.num,
        kind: it.kind,
        rect: this.fromScreen(p.num, {
          left: b.left + step + dx,
          top: b.top + step + dy,
          width: b.width,
          height: b.height
        }),
        body: it.body ?? '',
        style: structuredClone(it.style ?? {})
      });
      this.scheduleSave(a, 0);
      return a;
    });
    this.recordGroup(made.map((a) => ({key: a.key, before: null, after: this.snap(a)})));
    if (made.some((a) => a.kind === 'stamp' && a.style.type === 'index')) this.renderBookmarks?.();
    if (made.some((a) => a.kind === 'mask')) this.syncCovers?.();
    this.setTool?.('select');
    this.pickMany(made);
    this.announce?.(`${made.length} 個を貼り付けました`);
  },

  /** ほかのアプリでコピーした文字：見ているページの真ん中に、新しい文字入れとして置く */
  pasteText(text) {
    this.finishEdit();
    const p = this.viewPage();
    if (!p) return;
    const body = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').slice(0, 2000);
    const vp = p.viewport;
    const c = this.viewCenter();
    const box = p.el.getBoundingClientRect();
    const style = {...this.textStyle};
    const h = style.size * LINE_HEIGHT * vp.scale;
    const x = Math.min(Math.max(c.x - box.left, 0), vp.width - 8);
    const y = Math.min(Math.max(c.y - box.top, 0), vp.height - h);
    const a = this.addAnno({
      key: `k${this.seq++}`,
      id: null,
      page: p.num,
      kind: 'text',
      rect: this.fromScreen(p.num, {left: x, top: y, width: 0, height: h}),
      body,
      style
    });
    this.measure(a); // 打ち終わったときと同じく、中身に合わせた大きさを覚える
    this.record(a.key, null, this.snap(a));
    this.scheduleSave(a, 0);
    this.setTool?.('select');
    this.select(a);
  }
};
