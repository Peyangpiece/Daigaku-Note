// PDF の編集画面：文字隠し（文字への吸着）と赤シート。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
import * as pdfjs from '../../../../node_modules/pdfjs-dist/legacy/build/pdf.min.mjs';
import {charEdges, fitToInk, inkFromImage, snapRange, textIn, wordAt} from '../text-snap.js';
import {DEFAULT_SIZE} from '../../../shared/annotation.js';
import {lineOf, isFlat, MASK_HEX} from './shared.js';

export const methods = {
  // ---- 文字隠し：文字の上をなぞって水色のマーカーを引く。文字の行に高さを合わせる ----
  startMask(e, p, box) {
    this.select(null);
    p.textPromise ??= this.textItems(p);
    const el = document.createElement('div');
    el.className = 'anno-mask anno-mask--draft';
    el.style.setProperty('--mask', this.maskColor());
    p.layer.append(el);
    const x = e.clientX - box.left,
      y = e.clientY - box.top;
    const d = (this.drawing = {p, el, x0: x, y0: y, x1: x, y1: y, pointer: e.pointerId, line: null});
    // なぞっている行の高さ（文字の上下）。文字が読めたら下書きもその高さにそろえる
    p.textPromise
      .then((raw) => {
        const onLine = this.screenItems(p, raw).filter((it) => y >= it.hitTop && y <= it.hitBottom);
        if (!onLine.length || this.drawing !== d) return;
        d.line = lineOf(onLine);
        this.drawDraft();
      })
      .catch(() => {});
    this.pagesEl.setPointerCapture(e.pointerId);
    this.drawDraft();
  },

  drawDraft() {
    const d = this.drawing;
    const flat = isFlat(d, d.line); // 横になぞっている（行の高さの中なら上下に動いても）
    const h = DEFAULT_SIZE * d.p.viewport.scale;
    const top = flat ? (d.line?.top ?? d.y0 - h / 2) : Math.min(d.y0, d.y1);
    const height = flat ? (d.line ? d.line.bottom - d.line.top : h) : Math.abs(d.y1 - d.y0);
    Object.assign(d.el.style, {
      left: `${Math.min(d.x0, d.x1)}px`,
      top: `${top}px`,
      width: `${Math.abs(d.x1 - d.x0)}px`,
      height: `${height}px`
    });
  },

  /**
   * マーカーの箱（ページの中の px）を、描かれた字に合わせて直す（text-snap.js の fitToInk）。
   * 字の幅は見積もりなので、そのままだと字の右や左が少し見えることがある。ページの絵がまだなければそのまま
   */
  fitMask(p, box, fh, edges = null) {
    const c = p.canvas;
    if (!c?.width) return box;
    const k = c.width / p.viewport.width; // ページの px → canvas の画素
    const m = fh; // 調べる範囲の余白
    const x0 = Math.max(0, box.left - m),
      y0 = Math.max(0, box.top - m);
    const x1 = Math.min(p.viewport.width, box.left + box.width + m),
      y1 = Math.min(p.viewport.height, box.top + box.height + m);
    let img;
    try {
      img = c
        .getContext('2d')
        .getImageData(Math.floor(x0 * k), Math.floor(y0 * k), Math.ceil((x1 - x0) * k), Math.ceil((y1 - y0) * k));
    } catch {
      return box;
    }
    const ink = inkFromImage(img, {x0: Math.floor(x0 * k) / k, y0: Math.floor(y0 * k) / k, scale: k});
    if (!ink) return box;
    const r = fitToInk({left: box.left, right: box.left + box.width, top: box.top, bottom: box.top + box.height}, ink, {
      fh,
      step: 1 / k,
      edges
    });
    return {left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top};
  },

  /**
   * ページの文字列（pdf.js の textContent。画面の座標へは finishMask で直す）。
   * 文字列には全体の幅しかないので、PDF に書かれた字ごとの送り幅（描く命令の字形の幅）を ws に添える。
   * MS P ゴシックのような字ごとに幅の違うフォントでも、字の切れ目が描かれた字とそろう（text-snap.js の charEdges）
   */
  async textItems(p) {
    const [tc, widths] = await Promise.all([p.page.getTextContent(), this.glyphWidths(p.page).catch(() => null)]);
    return tc.items
      .filter((it) => it.str && it.width > 0)
      .map((it) => ({...it, ws: widths && Array.from(it.str, (ch) => widths.get(`${it.fontName}|${ch}`) ?? null)}));
  },

  /** フォントと字ごとの送り幅（1 em = 1000）。描く命令（operator list）の字形から集める */
  async glyphWidths(page) {
    const ops = await page.getOperatorList();
    const out = new Map();
    let font = null;
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === pdfjs.OPS.setFont) font = ops.argsArray[i][0];
      else if (ops.fnArray[i] === pdfjs.OPS.showText)
        for (const g of ops.argsArray[i][0])
          if (g?.unicode && g.width > 0 && !out.has(`${font}|${g.unicode}`)) out.set(`${font}|${g.unicode}`, g.width);
    }
    return out;
  },

  /** 文字列の画面での箱。画面で横書きに見えるものだけ（回転したページでも、見た目が横書きなら使う） */
  screenItems(p, items) {
    const vp = p.viewport;
    return items
      .map((it) => {
        const m = pdfjs.Util.transform(vp.transform, it.transform);
        const run = Math.hypot(m[0], m[1]);
        if (!run || m[0] <= 0 || Math.abs(m[1]) > run * 0.05) return null;
        const fh = Math.hypot(m[2], m[3]); // 文字の高さ（px）
        if (!fh) return null;
        // 覆う範囲は基線から上へ 0.96、下へ 0.22（字の上下をはみ出さずに覆う）。
        // その行をなぞったとみなす範囲は少し広く、基線から上へ 1.05、下へ 0.3
        return {
          str: it.str,
          ws: it.ws,
          left: m[4],
          right: m[4] + it.width * vp.scale,
          top: m[5] - fh * 0.96,
          bottom: m[5] + fh * 0.22,
          hitTop: m[5] - fh * 1.05,
          hitBottom: m[5] + fh * 0.3
        };
      })
      .filter(Boolean);
  },

  /** 今の文字隠しペンの色（筆箱の外で H を押したときなどは水色） */
  maskColor() {
    return this.penItem?.type === 'hider' ? this.penItem.color : MASK_HEX;
  },

  async finishMask() {
    const d = this.drawing;
    this.drawing = null;
    d.el.remove();
    const p = d.p;
    const raw = await p.textPromise.catch(() => []);
    if (this.destroyed) return;
    const items = this.screenItems(p, raw);
    // 画面の座標で考える（左上原点、px）
    let x1 = Math.min(d.x0, d.x1),
      x2 = Math.max(d.x0, d.x1);
    const measure = this.measureChar;
    const pieces = (list, from, to) => textIn(list, from, to, measure);
    let box, hidden;
    const onLine = items.filter((it) => d.y0 >= it.hitTop && d.y0 <= it.hitBottom);
    if (isFlat(d, onLine.length ? lineOf(onLine) : null)) {
      // 横になぞった（指が行の字の高さの中にとどまっていれば、上下に動いても）：なぞり始めの高さにある行に合わせ、
      // 左右の端は字の切れ目に合わせる（字の途中で切らない）。動かさずに押しただけ（ダブルクリックも）なら、その位置の単語を覆う
      let hit = onLine.filter((it) => it.left < x2 && it.right > x1);
      if (x2 - x1 < 2) {
        const it = onLine.find((t) => t.left <= x1 && x1 <= t.right);
        const word = it && wordAt(it, x1, measure);
        if (!word) return;
        hit = [it];
        x1 = word.left;
        x2 = word.right;
      } else if (hit.length) {
        const snapped = snapRange(hit, x1, x2, measure);
        if (snapped) {
          x1 = snapped.left;
          x2 = snapped.right;
          hit = hit.filter((it) => it.left < x2 && it.right > x1);
        }
      }
      if (hit.length) {
        const top = Math.min(...hit.map((it) => it.top));
        const bottom = Math.max(...hit.map((it) => it.bottom));
        // 見積もりの字の切れ目（同じ行の字すべて）。描かれた字のかたまりを字ごとにまとめるのに使う
        const edges = [...new Set(onLine.flatMap((it) => charEdges(it, measure)))].sort((a, b) => a - b);
        box = this.fitMask(p, {left: x1, top, width: x2 - x1, height: bottom - top}, (bottom - top) / 1.18, edges);
        hidden = pieces(hit, box.left, box.left + box.width);
      } else {
        const h = DEFAULT_SIZE * p.viewport.scale;
        box = {left: x1, top: d.y0 - h / 2, width: x2 - x1, height: h};
      }
    } else {
      // 斜め・縦になぞった：囲んだ四角そのまま
      const y1 = Math.min(d.y0, d.y1),
        y2 = Math.max(d.y0, d.y1);
      box = {left: x1, top: y1, width: x2 - x1, height: y2 - y1};
      hidden = pieces(
        items.filter((it) => {
          const mid = (it.top + it.bottom) / 2;
          return mid >= y1 && mid <= y2 && it.left < x2 && it.right > x1;
        }),
        x1,
        x2
      );
    }
    if (box.width < 2 || box.height < 2) return;
    const a = this.addAnno({
      key: `k${this.seq++}`,
      id: null,
      page: p.num,
      kind: 'mask',
      rect: this.fromScreen(p.num, box),
      body: (hidden ?? '').slice(0, 2000),
      style: this.maskColor() === MASK_HEX ? {} : {color: this.maskColor()}
    });
    this.record(a.key, null, this.snap(a));
    this.scheduleSave(a, 0);
  },

  /**
   * 赤シートとマーカーの重なりだけ、マーカーの黒い覆いを見せる（clip-path で切り抜く）。
   * 赤シートは乗算で重ねており、水色のマーカーは理屈では黒くなるが、字のふちや色によっては形が透けることがあるため、
   * 重なった部分は不透明の黒で確実に隠す。シートを動かしたとき・大きさを変えたとき・スクロールしたときに呼ぶ
   */
  syncCovers() {
    if (this.coverFrame) return;
    this.coverFrame = requestAnimationFrame(() => {
      this.coverFrame = 0;
      const sr = this.sheet?.getBoundingClientRect();
      for (const a of this.annos.values()) {
        if ((a.kind === 'text' || a.kind === 'ink') && a.el.dataset.red) {
          this.hideRed(a, sr);
          continue;
        }
        if (a.kind !== 'mask') continue;
        const cover = a.el.firstElementChild;
        const r = a.el.getBoundingClientRect();
        const left = sr ? Math.max(sr.left, r.left) - r.left : 0;
        const top = sr ? Math.max(sr.top, r.top) - r.top : 0;
        const right = sr ? r.right - Math.min(sr.right, r.right) : 0;
        const bottom = sr ? r.bottom - Math.min(sr.bottom, r.bottom) : 0;
        const on = sr && left + right < r.width && top + bottom < r.height;
        cover.style.display = on ? 'block' : 'none';
        if (on) cover.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
      }
    });
  },

  /**
   * 赤く見える文字入れ・ペンの線のうち、赤シートの下に入った部分だけを見えなくする（本物の赤シートの下では赤い字が消える）。
   * 全体の四角から、シートと重なる四角を穴にした clip-path（evenodd）をかける。文字入れは画面 px、ペンの線は PDF の座標（path の座標系）で
   */
  hideRed(a, sr) {
    const el = a.el;
    const r = el.getBoundingClientRect();
    const over = sr && sr.left < r.right && sr.right > r.left && sr.top < r.bottom && sr.bottom > r.top;
    if (!over) {
      el.style.clipPath = '';
      return;
    }
    const poly = (x0, y0, x1, y1, hx0, hy0, hx1, hy1) =>
      `polygon(evenodd, ${x0}px ${y0}px, ${x1}px ${y0}px, ${x1}px ${y1}px, ${x0}px ${y1}px, ${x0}px ${y0}px, ${hx0}px ${hy0}px, ${hx1}px ${hy0}px, ${hx1}px ${hy1}px, ${hx0}px ${hy1}px, ${hx0}px ${hy0}px)`;
    if (a.kind === 'text') {
      const hx0 = Math.max(sr.left, r.left) - r.left,
        hy0 = Math.max(sr.top, r.top) - r.top,
        hx1 = Math.min(sr.right, r.right) - r.left,
        hy1 = Math.min(sr.bottom, r.bottom) - r.top;
      el.style.clipPath = poly(-4, -4, r.width + 4, r.height + 4, hx0, hy0, hx1, hy1);
      return;
    }
    // ペンの線：clip-path の座標は path の座標系（PDF の pt。基準の箱は線の囲み）
    const p = this.pages[a.page - 1];
    const pr = p.el.getBoundingClientRect();
    const [ax, ay] = p.viewport.convertToPdfPoint(sr.left - pr.left, sr.top - pr.top);
    const [bx, by] = p.viewport.convertToPdfPoint(sr.right - pr.left, sr.bottom - pr.top);
    const box = el.getBBox();
    const hx0 = Math.min(ax, bx) - box.x,
      hx1 = Math.max(ax, bx) - box.x,
      hy0 = Math.min(ay, by) - box.y,
      hy1 = Math.max(ay, by) - box.y;
    el.style.clipPath = poly(-8, -8, box.width + 8, box.height + 8, hx0, hy0, hx1, hy1);
  },

  // ---- 赤シート：画面の上に置く赤い下敷き。ドラッグで動かし、右下の角で大きさを変える ----
  toggleSheet(on = !this.sheet) {
    if (!on) {
      this.sheet?.remove();
      this.sheet = null;
      for (const a of this.annos.values()) if (a.el.dataset?.red) a.el.style.clipPath = '';
    } else if (!this.sheet) {
      const el = document.createElement('div');
      el.className = 'red-sheet';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', '赤シート');
      el.innerHTML = '<span class="red-sheet__label">赤シート</span>';
      const first = this.pages[0]?.el.getBoundingClientRect();
      const width = Math.min(first?.width ?? 600, window.innerWidth - 40);
      Object.assign(el.style, {
        left: `${Math.max(20, first?.left ?? 20)}px`,
        top: `${Math.round(window.innerHeight * 0.45)}px`,
        width: `${width}px`,
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
          this.syncCovers();
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
      this.sheet = el;
      this.sheetResize = new ResizeObserver(() => this.syncCovers());
      this.sheetResize.observe(el);
    }
    if (!this.sheet) {
      this.sheetResize?.disconnect();
      this.sheetResize = null;
    }
    this.syncCovers();
    this.$('sheet').setAttribute('aria-pressed', String(!!this.sheet));
  }
};
