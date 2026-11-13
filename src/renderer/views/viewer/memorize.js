// PDF の編集画面：暗記モード（SPEC §9.3.3）。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
// 文字隠しのマーカーを全部黒く隠し、1 つずつ「答えを見る → 覚えた／まだ」で進む。終わったら「まだ」だけをもう 1 周できる。
// 覚えたかどうかは注釈に残す（annotation.memorized。ファイルの中身は変えないので、上書き保存はしない）
import {memoOrder, memoRound} from '../../../shared/memorize.js';

const api = window.daigaku;

export const methods = {
  /** 文字隠しのマーカー（消していないもの） */
  ankiMasks() {
    return [...this.annos.values()].filter((a) => a.kind === 'mask' && !a.removed && a.el);
  },

  /** ツールバーの「暗記」：マーカーが 1 つでもあれば押せる */
  updateAnkiButton() {
    const b = this.$('anki');
    if (!b) return;
    const n = this.ankiMasks().length;
    b.hidden = !n && !this.anki;
    b.setAttribute('aria-pressed', String(!!this.anki));
    b.title = n
      ? `暗記モード：文字隠しのマーカー ${n} か所を隠して、1 つずつ確かめる`
      : '暗記モード（文字隠しのマーカーを引くと使えます）';
  },

  startAnki({only = null} = {}) {
    const masks = memoOrder(this.ankiMasks()).filter((a) => !only || only.has(a.key));
    if (!masks.length) return;
    this.select(null);
    this.setTool('select');
    this.toggleSheet(false); // 赤シートはしまう（暗記モードはマーカーを直に隠す）
    this.closeFind();
    this.anki = {round: memoRound(masks.map((a) => a.key)), open: false, total: masks.length};
    this.pagesEl.classList.add('is-anki');
    this.root.querySelector('[data-group="anki"]').hidden = false;
    this.updateBar();
    this.showAnki();
  },

  /** いまの 1 つ（消されていたら飛ばす） */
  ankiCurrent() {
    const m = this.anki;
    if (!m) return null;
    for (;;) {
      const key = m.round.current();
      if (!key) return null;
      const a = this.annos.get(key);
      if (a && !a.removed && a.el) return a;
      m.round.answer(true); // 途中で消されたマーカーは数えない
    }
  },

  showAnki() {
    const m = this.anki;
    if (!m) return;
    for (const a of this.ankiMasks()) a.el.classList.remove('is-anki-current', 'is-anki-open');
    const a = this.ankiCurrent();
    const st = m.round.state;
    const g = this.root.querySelector('[data-group="anki"]');
    const done = !a;
    g.querySelector('[data-v="anki-run"]').hidden = done;
    g.querySelector('[data-v="anki-done"]').hidden = !done;
    if (done) {
      const known = st.known.length,
        unknown = st.unknown.length;
      this.$('anki-result').textContent = `覚えた ${known}・まだ ${unknown}`;
      this.$('anki-again').hidden = !unknown;
      this.$('anki-again').textContent = `「まだ」の ${unknown} か所をもう一度`;
      (unknown ? this.$('anki-again') : this.$('anki-end')).focus();
      return;
    }
    a.el.classList.add('is-anki-current');
    a.el.classList.toggle('is-anki-open', m.open);
    this.$('anki-count').textContent = `${st.index + 1} / ${st.keys.length}`;
    this.$('anki-show').textContent = m.open ? '隠す' : '答えを見る';
    this.$('anki-show').setAttribute('aria-pressed', String(m.open));
    // 見える所へ（ツールバーと下の帯の下）
    const r = a.el.getBoundingClientRect();
    const top = this.root.querySelector('.viewer-bar').getBoundingClientRect().bottom + 70;
    if (r.top < top || r.bottom > window.innerHeight - 80)
      window.scrollBy({top: r.top - top - window.innerHeight / 4, behavior: 'instant'});
  },

  /** 答えを見る・隠す */
  ankiToggle() {
    if (!this.anki || !this.ankiCurrent()) return;
    this.anki.open = !this.anki.open;
    this.showAnki();
  },

  /** 「覚えた」（true）・「まだ」（false）を付けて次へ */
  ankiAnswer(ok) {
    const a = this.ankiCurrent();
    if (!a) return;
    a.memorized = ok;
    // 保存はまとめて待たずに送る（落ちても、覚えたかどうかの記録が 1 つ抜けるだけ）
    if (a.id)
      api['annotation.memorize']({materialId: this.materialId, marks: [{id: a.id, memorized: ok}]}).catch(() => {});
    this.anki.round.answer(ok);
    this.anki.open = false;
    this.showAnki();
  },

  ankiAgain() {
    if (!this.anki) return;
    this.anki.round.again();
    this.anki.open = false;
    this.showAnki();
  },

  endAnki() {
    if (!this.anki) return;
    this.anki = null;
    this.pagesEl.classList.remove('is-anki');
    for (const a of this.ankiMasks()) a.el.classList.remove('is-anki-current', 'is-anki-open');
    this.root.querySelector('[data-group="anki"]').hidden = true;
    this.updateBar();
    this.$('anki')?.focus();
  },

  /** 暗記モードのあいだのキー。受けたら true（ほかのショートカットは効かせない） */
  ankiKey(e) {
    if (!this.anki) return false;
    if (e.metaKey || e.ctrlKey || e.altKey) return false; // ⌘＋／− などはそのまま
    const done = !this.ankiCurrent();
    if (e.key === 'Escape') this.endAnki();
    else if (done)
      return false; // 終わりの帯：ボタンを Enter・Space で押せるように
    else if (e.key === ' ' || e.key === 'Spacebar') this.ankiToggle();
    else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === '1') this.ankiAnswer(true);
    else if (e.key === 'ArrowLeft' || e.key === '2') this.ankiAnswer(false);
    else return false;
    e.preventDefault();
    return true;
  }
};
