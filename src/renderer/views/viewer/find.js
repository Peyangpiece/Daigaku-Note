// PDF の編集画面：PDF の中の文字を探す（⌘F）。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
// pdf.js の文字（getTextContent）をページごとにつなげて探す。空白は無視し、全角・半角と大文字・小文字の違いも無視する（NFKC）。
// 見つけた所は、文字の位置から四角を出してページの上に印を付ける（今の 1 つは濃く）。文字の層が描けていないページでも探せる
const MAX_HITS = 2000;
const norm = (c) => c.normalize('NFKC').toLowerCase();

/** ページの文字を 1 本の列にする：見えている文字 1 つずつに、どの文字のかたまり（item）の何文字目かを持たせる */
export function pageChars(textContent) {
  const chars = [];
  textContent.items.forEach((it, item) => {
    const str = it.str ?? '';
    for (let i = 0; i < str.length; i++) {
      for (const c of norm(str[i])) if (!/\s/.test(c)) chars.push({c, item, i});
    }
  });
  return chars;
}

/** 見つけた所（文字の並びの start〜end）を、item ごとの四角（PDF の座標）にする */
export function rectsOf(textContent, chars, start, end) {
  const by = new Map();
  for (let k = start; k < end; k++) {
    const {item, i} = chars[k];
    const r = by.get(item) ?? {from: i, to: i + 1};
    r.from = Math.min(r.from, i);
    r.to = Math.max(r.to, i + 1);
    by.set(item, r);
  }
  return [...by.entries()].map(([item, {from, to}]) => {
    const it = textContent.items[item];
    const [a, b, , d, e, f] = it.transform;
    const len = Math.max(1, it.str.length);
    const w = it.width || Math.hypot(a, b) * len;
    const h = it.height || Math.hypot(b, d) || Math.abs(d) || 10;
    return [e + (w * from) / len, f - h * 0.2, e + (w * to) / len, f + h];
  });
}

/** PDF の座標の四角 → 画面（ページの中の px）の四角 [x1, y1, x2, y2]（pdf.js の viewport は点ごとに変える） */
function toView(vp, [x1, y1, x2, y2]) {
  const [a, b] = vp.convertToViewportPoint(x1, y1);
  const [c, d] = vp.convertToViewportPoint(x2, y2);
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

export const methods = {
  openFind() {
    const g = this.root.querySelector('[data-group="find"]');
    g.hidden = false;
    this.updateBar();
    const q = this.$('find-q');
    q.focus();
    q.select();
    if (!this.findBound) {
      this.findBound = true;
      let timer = 0;
      this.on(q, 'input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => this.runFind(q.value), 200);
      });
      this.on(q, 'keydown', (e) => {
        if (e.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          this.findStep(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.closeFind();
        }
      });
    }
  },

  closeFind() {
    this.root.querySelector('[data-group="find"]').hidden = true;
    this.find = null;
    this.drawFind();
    this.$('find-count').textContent = '';
    this.updateBar();
  },

  /** 全ページから探す（文字はページごとに 1 回だけ読む。文字の層と同じものを使う） */
  async runFind(query) {
    const q = [...norm(String(query ?? ''))].filter((c) => !/\s/.test(c)).join('');
    const token = (this.findToken = (this.findToken ?? 0) + 1);
    if (!q) {
      this.find = null;
      this.$('find-count').textContent = '';
      return this.drawFind();
    }
    const hits = [];
    for (const p of this.pages) {
      p.textContent ??= await p.page.getTextContent();
      if (this.destroyed || token !== this.findToken) return;
      p.findChars ??= pageChars(p.textContent);
      const s = p.findChars.map((x) => x.c).join('');
      for (let at = s.indexOf(q); at >= 0 && hits.length < MAX_HITS; at = s.indexOf(q, at + 1))
        hits.push({page: p.num, rects: rectsOf(p.textContent, p.findChars, at, at + q.length)});
    }
    // 今見ている場所より後ろの、いちばん近いものから
    const here = this.currentSpot?.().page ?? 1;
    this.find = {
      hits,
      index: Math.max(
        0,
        hits.findIndex((h) => h.page >= here)
      )
    };
    this.showFind();
  },

  findStep(dir) {
    const f = this.find;
    if (!f?.hits.length) return this.runFind(this.$('find-q').value);
    f.index = (f.index + dir + f.hits.length) % f.hits.length;
    this.showFind();
  },

  showFind() {
    const f = this.find;
    this.$('find-count').textContent = !f
      ? ''
      : f.hits.length
        ? `${f.index + 1} / ${f.hits.length}${f.hits.length >= MAX_HITS ? '+' : ''}`
        : '見つかりません';
    this.drawFind();
    const hit = f?.hits[f.index];
    const p = hit && this.pages[hit.page - 1];
    if (!p) return;
    // 見つけた所が見えるように（ツールバーと下の帯の下、画面の上から 3 分の 1 あたりへ）
    const [x1, y1] = toView(p.viewport, hit.rects[0]);
    const r = p.el.getBoundingClientRect();
    const y = r.top + y1;
    const top = this.root.querySelector('.viewer-bar').getBoundingClientRect().bottom + 60;
    if (y < top || y > window.innerHeight - 60) window.scrollBy(0, y - top - window.innerHeight / 4);
    const x = r.left + x1;
    if (x < 0 || x > window.innerWidth - 40) window.scrollBy(x - window.innerWidth / 3, 0);
  },

  /** 見つけた所の印：ページの上に四角を置く（今の 1 つは濃く）。拡大率が変わったら描き直す */
  drawFind() {
    for (const el of this.root.querySelectorAll('.find-hit')) el.remove();
    const f = this.find;
    if (!f?.hits.length) return;
    f.hits.forEach((h, k) => {
      const p = this.pages[h.page - 1];
      if (!p?.viewport) return;
      for (const rect of h.rects) {
        const [x1, y1, x2, y2] = toView(p.viewport, rect);
        const el = document.createElement('span');
        el.className = `find-hit${k === f.index ? ' is-current' : ''}`;
        Object.assign(el.style, {
          left: `${x1}px`,
          top: `${y1}px`,
          width: `${x2 - x1}px`,
          height: `${y2 - y1}px`
        });
        p.el.append(el);
      }
    });
  }
};
