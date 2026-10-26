// PDF の編集画面：しおり（追加・名前・移動・一覧）。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
import {esc, toast} from '../../ui-kit.js';
import {state} from '../../store.js';
import {bookmarkLook, fixedSticker} from '../../skin.js';
import {api} from './shared.js';

export const methods = {
  // ---- しおり ----
  // 「ここにしおり」はツールバーのすぐ下に見えている場所（ページと、ページの中の高さ）に付ける。名前は「しおり1」「しおり2」…
  // 名前は一覧で変えられる（ダブルクリックか ✎）。ページの右端に小さなリボンを出す
  currentSpot() {
    const top = this.root.querySelector('.viewer-bar').getBoundingClientRect().bottom + 8;
    const p = this.pages.find((x) => x.el.getBoundingClientRect().bottom > top) ?? this.pages.at(-1);
    const r = p.el.getBoundingClientRect();
    return {page: p.num, y: Math.min(1, Math.max(0, (top - r.top) / r.height))};
  },

  async addBookmark() {
    if (!this.pages.length) return;
    const names = this.bookmarks.map((b) => b.name);
    let n = 0;
    for (const s of names) n = Math.max(n, Number(String(s).match(/^しおり\s*(\d+)$/)?.[1] ?? 0));
    const r = await api['bookmark.save']({
      materialId: this.materialId,
      bookmark: {...this.currentSpot(), name: `しおり${n + 1}`}
    });
    if (r?.error) return toast(r.error, {error: true});
    this.bookmarks.push(r.bookmark);
    this.renderBookmarks();
    this.openBookmarks(true);
    toast(`${r.bookmark.name} を付けました`);
  },

  async renameBookmark(b, name) {
    const clean = String(name).replace(/\s+/g, ' ').trim();
    if (!clean || clean === b.name) return this.renderBookmarks();
    const r = await api['bookmark.save']({materialId: this.materialId, bookmark: {...b, name: clean}});
    if (r?.error) toast(r.error, {error: true});
    else Object.assign(b, r.bookmark);
    this.renderBookmarks();
  },

  async removeBookmark(b) {
    const r = await api['bookmark.remove']({materialId: this.materialId, bookmarkId: b.id});
    if (r?.error) return toast(r.error, {error: true});
    this.bookmarks = this.bookmarks.filter((x) => x !== b);
    this.renderBookmarks();
  },

  jumpTo(b) {
    const p = this.pages[b.page - 1];
    if (!p) return;
    const bar = this.root.querySelector('.viewer-bar').getBoundingClientRect().bottom;
    const r = p.el.getBoundingClientRect();
    window.scrollTo({top: window.scrollY + r.top + b.y * r.height - bar - 8});
  },

  openBookmarks(open) {
    const panel = this.$('bookmark-panel');
    panel.hidden = !open;
    this.$('bookmarks').setAttribute('aria-expanded', String(open));
  },

  renderBookmarks() {
    const list = [...this.bookmarks].sort((a, b) => a.page - b.page || a.y - b.y);
    this.$('bookmark-list').innerHTML = list.length
      ? list
          .map(
            (b) => `<li class="bookmark-panel__item" data-bm="${esc(b.id)}">
          <button type="button" class="bookmark-panel__name" data-bm-action="jump" title="${esc(b.name)}へ移る（ダブルクリックで名前を変える）">${esc(b.name)}</button>
          <span class="muted bookmark-panel__page">p.${b.page}</span>
          <button type="button" class="bookmark-panel__tool" data-bm-action="rename" title="名前を変える" aria-label="${esc(b.name)}の名前を変える">✎</button>
          <button type="button" class="bookmark-panel__tool" data-bm-action="remove" title="消す" aria-label="${esc(b.name)}を消す">×</button>
        </li>`
          )
          .join('')
      : '<li class="muted bookmark-panel__empty">まだしおりはありません。「＋ ここにしおり」か B で、いま見ている場所に付けます。</li>';
    this.$('bookmarks').textContent = this.bookmarks.length ? `しおり（${this.bookmarks.length}）` : 'しおり';
    // ページの右端のリボン（位置は割合なので、拡大率を変えても置き直さなくてよい）
    for (const el of this.pagesEl.querySelectorAll('.bookmark-ribbon')) el.remove();
    const look = bookmarkLook(this.skin);
    const sticker = fixedSticker(
      this.skin.stickers.find((st) => st.place === 'bookmark'),
      state.data,
      {x: 0, y: 0.5, base: 28}
    );
    for (const b of list) {
      const p = this.pages[b.page - 1];
      if (!p) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `bookmark-ribbon bm ${look.cls}`;
      el.style.cssText = `${look.style}; top: ${b.y * 100}%`;
      el.title = b.name;
      el.dataset.bm = b.id;
      el.setAttribute('aria-label', `しおり：${b.name}`);
      el.innerHTML = `${sticker}<span class="bookmark-ribbon__text"></span>`;
      el.lastElementChild.textContent = b.name;
      p.el.append(el);
    }
  },

  startRename(b) {
    const li = this.$('bookmark-list').querySelector(`[data-bm="${b.id}"]`);
    if (!li) return;
    const input = document.createElement('input');
    input.className = 'input bookmark-panel__input';
    input.value = b.name;
    input.maxLength = 40;
    input.setAttribute('aria-label', 'しおりの名前');
    li.querySelector('.bookmark-panel__name').replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) this.renameBookmark(b, input.value);
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

  bindBookmarks() {
    const panel = this.$('bookmark-panel');
    const which = (e) => {
      const li = e.target.closest('[data-bm]');
      return li && this.bookmarks.find((b) => b.id === li.dataset.bm);
    };
    this.on(panel, 'click', (e) => {
      const btn = e.target.closest('[data-bm-action]');
      const b = btn && which(e);
      if (!b) return;
      if (btn.dataset.bmAction === 'jump') this.jumpTo(b);
      else if (btn.dataset.bmAction === 'rename') this.startRename(b);
      else if (btn.dataset.bmAction === 'remove') this.removeBookmark(b);
    });
    this.on(panel, 'dblclick', (e) => {
      const b = e.target.closest('[data-bm-action="jump"]') && which(e);
      if (b) this.startRename(b);
    });
    // ページのリボンを押したら、その場所へ
    this.on(this.pagesEl, 'click', (e) => {
      const rib = e.target.closest('.bookmark-ribbon');
      if (!rib) return;
      const b = this.bookmarks.find((x) => x.id === rib.dataset.bm);
      if (b) this.jumpTo(b);
    });
    // 一覧の外を押したら閉じる
    this.on(document, 'pointerdown', (e) => {
      if (!panel.hidden && !e.target.closest('.viewer-bar__bookmarks')) this.openBookmarks(false);
      if (!this.$('help-panel').hidden && !e.target.closest('.viewer-bar__help')) this.openHelp(false);
    });
  }
};
