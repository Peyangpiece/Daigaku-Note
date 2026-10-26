// PDF の編集画面：貼りもの（シール・素材・メモ）と付箋インデックス。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
import {esc} from '../../ui-kit.js';
import {MEMO_COLOR, MEMO_SIZE} from '../../../shared/annotation.js';
import {MEMO_PAD} from '../../desk-tools.js';
import {INDEX_W, INDEX_H, INDEX_OVER, INDEX_GAP, INDEX_COLORS} from './shared.js';

export const methods = {
  /** 画面の点の下のページ（なければ null） */
  pageAt(x, y) {
    return (
      this.pages.find((p) => {
        const r = p.el.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      }) ?? null
    );
  },

  /**
   * 貼りものを置く。at（{p, x, y}：ページの左上からの px）がなければ、見ているページの真ん中（続けて押したら少しずつずらす）。
   * 置いたら選択の道具にして選ぶ（すぐ動かせる・大きさを変えられる）。戻りは注釈
   */
  placeStamp(spec, at = null) {
    let p, x, y;
    if (at) ({p, x, y} = at);
    else {
      const c = this.viewCenter();
      const dist = (q) => {
        const r = q.el.getBoundingClientRect();
        return c.y < r.top ? r.top - c.y : c.y > r.bottom ? c.y - r.bottom : 0;
      };
      p = this.pages.length ? this.pages.reduce((a, b) => (dist(b) < dist(a) ? b : a)) : null;
      if (!p) return null;
      const box = p.el.getBoundingClientRect();
      const n = (this.placed = ((this.placed ?? -1) + 1) % 6);
      x = Math.min(Math.max(c.x - box.left, 0), box.width) + n * 14;
      y = Math.min(Math.max(c.y - box.top, 0), box.height) + n * 14;
    }
    const vp = p?.viewport;
    if (!vp) return null;
    const sw = spec.w * vp.scale,
      sh = spec.h * vp.scale;
    // 付箋（インデックス）はページの右の端に、外へはみ出して貼る（ページに重なるのは INDEX_OVER だけ）
    const left =
      spec.type === 'index'
        ? vp.width - INDEX_OVER * vp.scale
        : Math.min(Math.max(x - sw / 2, 0), Math.max(0, vp.width - sw));
    const top = Math.min(
      Math.max(spec.type === 'index' && !at ? this.indexSlot(p) : y - sh / 2, 0),
      Math.max(0, vp.height - sh)
    );
    const style =
      spec.type === 'memo'
        ? {type: 'memo', color: spec.color ?? MEMO_COLOR, size: spec.size ?? MEMO_SIZE}
        : spec.type === 'index'
          ? {type: 'index', color: spec.color}
          : {type: spec.type, ref: spec.ref};
    const a = this.addAnno({
      key: `k${this.seq++}`,
      id: null,
      page: p.num,
      kind: 'stamp',
      rect: this.fromScreen(p.num, {left, top, width: sw, height: sh}),
      body: spec.body ?? '',
      style
    });
    if (spec.type === 'memo') {
      // 書いた文字が紙に収まらなければ、紙を下へ伸ばす
      const need = a.el.querySelector('.anno-stamp__text').scrollHeight + MEMO_PAD * vp.scale;
      if (need > sh) {
        a.rect = this.fromScreen(p.num, {left, top, width: sw, height: Math.min(need, vp.height - top)});
        this.place(a);
      }
    }
    this.record(a.key, null, this.snap(a));
    if (this.tool !== 'select') this.setTool('select');
    this.select(a);
    this.scheduleSave(a, 0);
    return a;
  },

  // ---- 付箋（インデックス）：色を押すと、見ているページの右の端の空いている所に貼る。ドラッグすると離した高さに ----
  toggleIndexPad(on = !this.indexPad) {
    if (!on) {
      this.indexPad?.remove();
      this.indexPad = null;
    } else if (!this.indexPad) {
      this.indexColor ??= INDEX_COLORS[0];
      const colors = INDEX_COLORS.map(
        (c) =>
          `<button type="button" class="index-pad__color" data-index-color="${c}" style="--index: ${c}" title="この色の付箋を貼る（ドラッグすると好きな高さに）" aria-label="付箋を貼る ${c}"></button>`
      ).join('');
      const el = this.floatTool(
        'index-pad',
        '付箋',
        `<label class="index-pad__label">書く言葉（なくても可）<input type="text" maxlength="12" data-index-label placeholder="例：第3章・試験範囲" /></label>
        <div class="index-pad__colors">${colors}</div>
        <p class="index-pad__hint">色を押すと、見ているページの右の端に貼れます。貼った付箋は上下に動かせます</p>
        <div class="index-pad__list" data-index-list></div>`,
        {right: 580, top: 72}, // 付箋：メモ帳の左
        () => this.toggleIndexPad(false)
      );
      el.addEventListener('pointerdown', (e) => {
        const b = e.target.closest('[data-index-color]');
        if (b)
          this.startCarry(e, this.indexSpec(b.dataset.indexColor), {
            ghost: () => this.indexGhost(b.dataset.indexColor)
          });
      });
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-index-color]');
        if (b && e.detail === 0) this.placeStamp(this.indexSpec(b.dataset.indexColor)); // キーボード
        const go = e.target.closest('[data-index-go]');
        if (go) {
          const a = this.annos.get(go.dataset.indexGo);
          if (a) {
            this.jumpTo({
              page: a.page,
              y: Math.max(0, parseFloat(a.el.style.top) / this.pages[a.page - 1].el.offsetHeight - 0.1)
            });
            this.select(a);
          }
        }
      });
      this.indexPad = el;
      this.renderIndexList();
    }
    this.$('index').setAttribute('aria-pressed', String(!!this.indexPad));
  },

  indexSpec(color) {
    const label = (this.indexPad?.querySelector('[data-index-label]').value ?? '').trim().slice(0, 12);
    return {type: 'index', color, body: label, w: INDEX_W, h: INDEX_H};
  },

  indexGhost(color) {
    const scale = this.pages[0]?.viewport?.scale ?? 1;
    const g = document.createElement('div');
    g.className = 'index-ghost';
    g.style.setProperty('--index', color);
    Object.assign(g.style, {width: `${INDEX_W * scale}px`, height: `${INDEX_H * scale}px`});
    return g;
  },

  /** ページの右の端で、上から見て最初に空いている高さ（画面の px） */
  indexSlot(p) {
    const s = p.viewport.scale;
    const h = INDEX_H * s,
      step = (INDEX_H + INDEX_GAP) * s;
    const taken = [...this.annos.values()]
      .filter((a) => a.page === p.num && a.kind === 'stamp' && a.style.type === 'index' && !a.removed)
      .map((a) => parseFloat(a.el.style.top));
    for (let y = 36 * s; y + h <= p.viewport.height; y += step) if (!taken.some((t) => Math.abs(t - y) < h)) return y;
    return 36 * s;
  },

  /** 貼った付箋の一覧（押すとその場所へ） */
  renderIndexList() {
    const list = [...this.annos.values()]
      .filter((a) => a.kind === 'stamp' && a.style.type === 'index' && !a.removed)
      .sort((a, b) => a.page - b.page || parseFloat(a.el.style.top) - parseFloat(b.el.style.top));
    this.indexPad.querySelector('[data-index-list]').innerHTML = list.length
      ? `<strong>貼った付箋</strong>${list
          .map(
            (a) =>
              `<button type="button" class="index-pad__item" data-index-go="${a.key}"><span class="index-pad__chip" style="--index: ${a.style.color}"></span>${esc(a.body || '（言葉なし）')}<span class="muted">${a.page} ページ</span></button>`
          )
          .join('')}`
      : '';
  }
};
