// PDF の編集画面：付箋（ページの右の端から出る色の目印。一覧から押すとその場所へ）。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
// 付箋は貼りもの（stamp・type index）の注釈。v0.12.2 で「しおり」をここにまとめた（しおりは開いたときに付箋へ移す）
import {esc, toast} from '../../ui-kit.js';
import {api, INDEX_W, INDEX_H, INDEX_COLORS} from './shared.js';

const LABEL_MAX = 12; // 付箋に書ける文字数（shared/annotation.js の INDEX_LABEL_MAX）

export const methods = {
  /** ツールバーのすぐ下に見えている場所（ページと、ページの中の高さの割合） */
  currentSpot() {
    const top = this.root.querySelector('.viewer-bar').getBoundingClientRect().bottom + 8;
    const p = this.pages.find((x) => x.el.getBoundingClientRect().bottom > top) ?? this.pages.at(-1);
    const r = p.el.getBoundingClientRect();
    return {page: p.num, y: Math.min(1, Math.max(0, (top - r.top) / r.height))};
  },

  /** 貼ってある付箋（ページ順・上から） */
  fusens() {
    return [...this.annos.values()]
      .filter((a) => a.kind === 'stamp' && a.style.type === 'index' && !a.removed)
      .sort((a, b) => a.page - b.page || parseFloat(a.el.style.top) - parseFloat(b.el.style.top));
  },

  /** 新しい付箋の色：最後に選んだ色。まだなら着せ替えの付箋の色（標準なら赤） */
  fusenColor() {
    const sk = this.skin?.bookmark?.color;
    return (this.indexColor ??= sk && sk !== 'default' ? sk : INDEX_COLORS[0]);
  },

  fusenSpec(color = this.fusenColor(), body = '') {
    return {type: 'index', color, body, w: INDEX_W, h: INDEX_H};
  },

  /** 見ている場所（ツールバーのすぐ下）の高さに、ページの右の端の付箋を貼る。貼ったら名前を書ける */
  addFusen(color) {
    if (!this.pages.length) return;
    const spot = this.currentSpot();
    const p = this.pages[spot.page - 1];
    const h = INDEX_H * p.viewport.scale;
    const a = this.placeStamp(this.fusenSpec(color), {p, x: 0, y: spot.y * p.viewport.height + h / 2});
    if (!a) return;
    this.openBookmarks(true);
    // 付箋の位置が決まってから一覧に並ぶ（applyStamp）。並んだあとで言葉の欄を開く
    requestAnimationFrame(() => {
      this.renderBookmarks();
      this.startRename(a);
    });
  },

  renameFusen(a, name) {
    const clean = String(name).replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
    if (a.removed || clean === a.body) return this.renderBookmarks();
    const before = this.snap(a);
    a.body = clean;
    this.applyStyle(a);
    this.record(a.key, before, this.snap(a));
    this.scheduleSave(a, 0);
    this.renderBookmarks();
  },

  jumpTo(b) {
    const p = this.pages[b.page - 1];
    if (!p) return;
    const bar = this.root.querySelector('.viewer-bar').getBoundingClientRect().bottom;
    const r = p.el.getBoundingClientRect();
    window.scrollTo({top: window.scrollY + r.top + b.y * r.height - bar - 8});
  },

  /** 付箋の場所へ（付箋が少し下に見えるように） */
  jumpToFusen(a) {
    const p = this.pages[a.page - 1];
    if (!p) return;
    this.jumpTo({page: a.page, y: Math.max(0, parseFloat(a.el.style.top) / p.el.offsetHeight - 0.05)});
    this.select(a);
  },

  openBookmarks(open) {
    const panel = this.$('bookmark-panel');
    panel.hidden = !open;
    this.$('bookmarks').setAttribute('aria-expanded', String(open));
    if (open) this.renderBookmarks();
  },

  /** ツールバーの付箋の数と、一覧（開いているとき） */
  renderBookmarks() {
    if (!this.pagesEl) return;
    const list = this.fusens();
    this.$('bookmarks').textContent = list.length ? `付箋（${list.length}）` : '付箋';
    // 閉じている・言葉を書き換えている間は一覧を描き直さない（書いている欄が消えないように）
    if (this.$('bookmark-panel').hidden || this.$('bookmark-list').querySelector('input')) return;
    const color = this.fusenColor();
    this.$('fusen-colors').innerHTML = INDEX_COLORS.map(
      (c) =>
        `<button type="button" class="index-pad__color" data-fusen-color="${c}" style="--index: ${c}" aria-pressed="${c === color}" title="この色にする（ページへドラッグすると、その高さに貼る）" aria-label="付箋の色 ${c}"></button>`
    ).join('');
    this.$('bookmark-list').innerHTML = list.length
      ? list
          .map(
            (a) => `<li class="bookmark-panel__item" data-bm="${esc(a.key)}">
          <span class="index-pad__chip" style="--index: ${esc(a.style.color)}" aria-hidden="true"></span>
          <button type="button" class="bookmark-panel__name" data-bm-action="jump" title="この付箋の場所へ（ダブルクリックで言葉を変える）">${esc(a.body || '（言葉なし）')}</button>
          <span class="muted bookmark-panel__page">p.${a.page}</span>
          <button type="button" class="bookmark-panel__tool" data-bm-action="rename" title="言葉を変える" aria-label="付箋の言葉を変える">✎</button>
          <button type="button" class="bookmark-panel__tool" data-bm-action="remove" title="はがす" aria-label="付箋をはがす">×</button>
        </li>`
          )
          .join('')
      : '<li class="muted bookmark-panel__empty">まだ付箋はありません。「＋ ここに付箋」か ⇧⌘D で、いま見ている場所に貼ります。</li>';
  },

  /** 一覧の中で付箋の言葉を書き換える（Enter で決める・Esc でやめる） */
  startRename(a) {
    const li = this.$('bookmark-list').querySelector(`[data-bm="${a.key}"]`);
    if (!li) return;
    const input = document.createElement('input');
    input.className = 'input bookmark-panel__input';
    input.value = a.body;
    input.maxLength = LABEL_MAX;
    input.placeholder = '例：第3章・試験範囲';
    input.setAttribute('aria-label', '付箋の言葉');
    li.querySelector('.bookmark-panel__name').replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      input.remove(); // 先に外す（renderBookmarks が一覧を描き直せるように）
      if (save) this.renameFusen(a, input.value);
      else this.renderBookmarks();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  },

  /**
   * 前の版のしおりを付箋に移す（同じページ・同じ高さ・同じ名前。色は新しい付箋の色）。移したしおりは消す。
   * 取り消しの履歴には積まない（開いただけで「取り消す」が出ないように）
   */
  async migrateBookmarks(bookmarks) {
    for (const b of bookmarks) {
      const p = this.pages[b.page - 1];
      if (!p || this.destroyed) continue;
      const h = INDEX_H * p.viewport.scale;
      const a = this.placeStamp(this.fusenSpec(this.fusenColor(), String(b.name ?? '').slice(0, LABEL_MAX)), {
        p,
        x: 0,
        y: b.y * p.viewport.height + h / 2
      });
      if (!a) continue;
      this.undoStack.pop(); // placeStamp が積んだ 1 手
      this.updateHistory();
      this.flush(a);
      await a.chain?.catch(() => {});
      if (!a.id) continue; // 付箋を保存できなかった：しおりは残し、次に開いたときにまた移す
      const r = await api['bookmark.remove']({materialId: this.materialId, bookmarkId: b.id});
      if (r?.error) toast(r.error, {error: true});
    }
    if (bookmarks.length) {
      this.setTool('select');
      this.select(null);
      this.renderBookmarks();
    }
  },

  bindBookmarks() {
    const panel = this.$('bookmark-panel');
    const which = (e) => this.annos.get(e.target.closest('[data-bm]')?.dataset.bm);
    this.on(panel, 'click', (e) => {
      const c = e.target.closest('[data-fusen-color]');
      if (c && e.detail === 0) return this.addFusen(c.dataset.fusenColor); // キーボード：その色で貼る
      const btn = e.target.closest('[data-bm-action]');
      const a = btn && which(e);
      if (!a) return;
      if (btn.dataset.bmAction === 'jump') this.jumpToFusen(a);
      else if (btn.dataset.bmAction === 'rename') this.startRename(a);
      else if (btn.dataset.bmAction === 'remove') {
        this.removeAnno(a);
        this.renderBookmarks();
      }
    });
    // 色：押すと次に貼る色になる。ページへドラッグすると、離した高さに貼る
    this.on(panel, 'pointerdown', (e) => {
      const c = e.target.closest('[data-fusen-color]');
      if (!c) return;
      this.startCarry(e, this.fusenSpec(c.dataset.fusenColor), {
        ghost: () => this.indexGhost(c.dataset.fusenColor),
        onTap: () => {
          this.indexColor = c.dataset.fusenColor;
          this.renderBookmarks();
        }
      });
    });
    this.on(panel, 'dblclick', (e) => {
      const a = e.target.closest('[data-bm-action="jump"]') && which(e);
      if (a) this.startRename(a);
    });
    // 一覧の外を押したら閉じる
    this.on(document, 'pointerdown', (e) => {
      if (!panel.hidden && !e.target.closest('.viewer-bar__bookmarks') && !this.carry) this.openBookmarks(false);
      if (!this.$('help-panel').hidden && !e.target.closest('.viewer-bar__help')) this.openHelp(false);
    });
  }
};
