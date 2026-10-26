// PDF の編集画面：書き出しと上書き保存（文字入れの画像）。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
import {toast} from '../../ui-kit.js';
import {inkOn} from '../../../shared/skin.js';
import {MEMO_COLOR, MEMO_SIZE} from '../../../shared/annotation.js';
import {figureUrl} from '../../../shared/figures.js';
import {MEMO_DEPTH, MEMO_LINE, MEMO_PAD, MEMO_TOOTH, MEMO_TOP, tearEdge} from '../../desk-tools.js';
import {api, FILE_SAVE_DELAY, FONT, LINE_HEIGHT, EXPORT_PX_PER_PT, INDEX_OVER} from './shared.js';

export const methods = {
  // ---- 書き出し（§9.7）----
  openExport() {
    this.finishEdit();
    const dialog = this.$('export-dialog');
    dialog.returnValue = ''; // Esc で閉じたときに前回の「書き出す」が残らないように
    if (!dialog.open) dialog.showModal();
  },

  async exportPdf(options) {
    const btn = this.$('export');
    btn.disabled = true;
    try {
      const snaps = this.textSnaps();
      if (!(await this.settle())) return toast('保存できていない注釈があるため書き出せません');
      const r = await api['pdf.export']({materialId: this.materialId, options, texts: await this.textImages(snaps)});
      if (r?.error) toast(r.error);
      else if (r?.ok) toast(`書き出しました：${r.name}`);
    } catch (e) {
      toast(`書き出せませんでした（${e.message}）`);
    } finally {
      btn.disabled = false;
    }
  },

  // ---- ファイルへの上書き保存 ----
  // 注釈を保存するたびに少し待って、注釈を描き込んだ PDF でファイルを上書きする（Finder で開いても注釈が見える）。
  // 元の PDF の写しはメインが取っておくので、アプリの中ではこれまでどおり注釈を編集できる
  markDirty() {
    if (this.fileBlocked) return;
    this.fileDirty = true;
    clearTimeout(this.fileTimer);
    if (this.destroyed) return; // 閉じたあとは、閉じるときに始めた保存が拾う（画面がないので新しくは始めない）
    this.fileTimer = setTimeout(() => !this.destroyed && this.saveFile(), FILE_SAVE_DELAY);
  },

  saveFile({manual = false} = {}) {
    clearTimeout(this.fileTimer);
    if (this.fileSaving) {
      this.fileAgain = true;
      return this.fileSaving;
    }
    if (manual) this.fileBlocked = false; // 手で保存するときは、前に止めた理由をもう一度確かめる
    if (this.fileBlocked) return Promise.resolve();
    this.finishEdit(); // 書きかけの文字入れも保存に回す
    // 文字入れの行は画面のレイアウトから読むので、待つ前（画面を閉じる前）に写しておく
    const snaps = this.textSnaps();
    this.fileSaving = (async () => {
      try {
        if (!(await this.settle())) throw new Error('保存できていない注釈があります');
        if (!this.fileDirty && !manual) return;
        this.fileDirty = false;
        const r = await api['pdf.save']({materialId: this.materialId, texts: await this.textImages(snaps)});
        if (r?.error) {
          // ほかのアプリで変更された・元の写しがないときは、何度も試さず止める（「書き出す…」は使える）
          this.fileBlocked = true;
          throw new Error(r.error);
        }
        if (manual) toast(r.changed ? `${r.name} を上書き保存しました` : `${r.name} は保存済みです`);
      } catch (e) {
        toast(`ファイルに保存できませんでした：${e.message}`, {error: true});
      } finally {
        this.fileSaving = null;
        this.setStatus();
        if (this.fileAgain) {
          this.fileAgain = false;
          if (this.fileDirty) this.saveFile();
        }
      }
    })();
    this.setStatus();
    return this.fileSaving;
  },

  /** 文字入れの写し（行の区切り・大きさ・書式）。画面が消えても PNG を作れるように、その場で読んでおく */
  textSnaps() {
    const out = [];
    for (const a of this.annos.values()) {
      if ((a.kind !== 'text' && a.kind !== 'stamp') || a.removed) continue;
      const p = this.pages[a.page - 1];
      if (!p?.viewport) continue;
      if (a.kind === 'stamp') {
        // 貼りもの：紙は画面の行の区切りのまま、シール・図は画面に出ている画像のまま
        const memo = a.style.type === 'memo';
        out.push({
          a,
          stamp: true,
          lines: memo ? this.textLines(a.el.querySelector('.anno-stamp__text')) : null,
          box: this.toScreen(a.page, a.rect),
          scale: p.viewport.scale,
          style: {...a.style},
          src:
            a.style.type === 'figure'
              ? figureUrl(a.style.ref, a.style.params, a.style.labels ?? null)
              : (a.el.querySelector('img')?.src ?? ''),
          label: a.body,
          shape: a.el.dataset.shape ?? 'cut'
        });
        continue;
      }
      out.push({
        a,
        lines: this.textLines(a.el),
        box: this.toScreen(a.page, a.rect),
        scale: p.viewport.scale,
        style: {...a.style}
      });
    }
    return out;
  },

  async textImages(snaps) {
    const texts = [];
    for (const s of snaps) {
      if (!s.a.id || s.a.removed) continue;
      const png = s.stamp ? await this.stampToPng(s).catch(() => null) : await this.textToPng(s);
      if (png) texts.push({id: s.a.id, png});
    }
    return texts;
  },

  /** 貼りものを PNG にする（288dpi）。紙はちぎり口・罫線・文字を描き、シール・図は画像を描く。描けなければ null */
  async stampToPng({box, scale, style, lines, src, shape, label}) {
    const k = EXPORT_PX_PER_PT;
    const W = Math.max(1, Math.ceil((box.width / scale) * k));
    const H = Math.max(1, Math.ceil((box.height / scale) * k));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (style.type === 'index') {
      // 付箋：ページに重なる所は薄く、残りは濃い色に言葉
      const over = INDEX_OVER * k;
      ctx.fillStyle = style.color;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(0, 0, over, H);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.roundRect(over, 0, W - over, H, [0, 2 * k, 2 * k, 0]);
      ctx.fill();
      const font = `700 ${8 * k}px ${FONT}`;
      await document.fonts.load(font).catch(() => {});
      ctx.font = font;
      ctx.fillStyle = inkOn(style.color);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label ?? '', over + (W - over) / 2, H / 2, W - over - 2 * k);
    } else if (style.type === 'memo') {
      const edge = tearEdge(W, MEMO_DEPTH * k, MEMO_TOOTH * k);
      ctx.beginPath();
      edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fillStyle = style.color ?? MEMO_COLOR;
      ctx.fill();
      ctx.save();
      ctx.clip();
      const size = (style.size ?? MEMO_SIZE) * k;
      const lh = size * MEMO_LINE;
      const top = (MEMO_TOP + MEMO_DEPTH) * k;
      ctx.fillStyle = '#bcd3ea';
      for (let y = top + lh; y < H; y += lh) ctx.fillRect(0, y - k / 2, W, k / 2); // 罫線（画面の 1px にあたる）
      const font = `400 ${size}px ${FONT}`;
      await document.fonts.load(font).catch(() => {});
      ctx.font = font;
      ctx.fillStyle = '#2b2b2b';
      const m = ctx.measureText('あ');
      const base = (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
      (lines ?? []).forEach((line, i) => ctx.fillText(line, MEMO_PAD * k, top + i * lh + base));
      ctx.restore();
    } else {
      if (!src) return null;
      const img = new window.Image();
      img.src = src;
      await img.decode();
      ctx.save();
      ctx.beginPath();
      if (shape === 'circle') ctx.ellipse(W / 2, H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
      else if (shape === 'round') ctx.roundRect(0, 0, W, H, Math.min(W, H) * 0.18);
      else ctx.rect(0, 0, W, H);
      ctx.clip();
      ctx.drawImage(img, 0, 0, W, H);
      ctx.restore();
      if (shape === 'framed') {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = (6 * k) / scale; // 画面の 3px のふち（内側の半分が見える）
        ctx.strokeRect(0, 0, W, H);
      }
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  },

  /** 画面に出ている行の区切りのまま、文字入れを PNG にする（ヒラギノで描く。フォントは PDF に埋め込まない） */
  async textToPng({lines, box, scale, style}) {
    const k = EXPORT_PX_PER_PT;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil((box.width / scale) * k));
    canvas.height = Math.max(1, Math.ceil((box.height / scale) * k));
    const ctx = canvas.getContext('2d');
    const font = `${style.bold ? 700 : 400} ${style.size * k}px ${FONT}`;
    await document.fonts.load(font).catch(() => {});
    ctx.font = font;
    ctx.fillStyle = style.color;
    const m = ctx.measureText('あ');
    const lh = style.size * LINE_HEIGHT * k;
    const base = (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const pad = k / scale; // .anno-text の左の余白 1px
    lines.forEach((line, i) => ctx.fillText(line, pad, i * lh + base));
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  },

  /** 箱の中の文字を、画面で折り返されている行ごとに分ける */
  textLines(el) {
    const lines = [];
    let cur = '',
      lastTop = null;
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.data;
      for (let i = 0; i < t.length; ) {
        const len = t.codePointAt(i) > 0xffff ? 2 : 1;
        const ch = t.slice(i, i + len);
        if (ch === '\n') {
          lines.push(cur);
          cur = '';
          lastTop = null;
        } else {
          range.setStart(n, i);
          range.setEnd(n, i + len);
          const r = range.getClientRects()[0];
          if (r) {
            if (lastTop !== null && r.top > lastTop + r.height * 0.5) {
              lines.push(cur);
              cur = '';
            }
            lastTop = r.top;
          }
          cur += ch;
        }
        i += len;
      }
    }
    lines.push(cur);
    return lines;
  }
};
