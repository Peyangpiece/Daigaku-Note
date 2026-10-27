// PDF の編集画面：注釈の中心（追加・配置・選択・編集・削除）。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
import {state} from '../../store.js';
import {inkOn} from '../../../shared/skin.js';
import {decodePoints, strokePath} from '../../../shared/ink.js';
import {MEMO_COLOR, MEMO_SIZE, NOTE_INK_SCALE, NOTE_SIZE, hidesUnderRedSheet} from '../../../shared/annotation.js';
import {BUILTIN_STICKERS, isBuiltinSticker} from '../../../shared/stickers.js';
import {figureOf} from '../../../shared/figures.js';
import {openFigureEditor, renderFigure} from '../../figure-view.js';
import {MEMO_DEPTH, MEMO_LINE, MEMO_PAD, MEMO_TOOTH, MEMO_TOP, tearClip} from '../../desk-tools.js';
import {cleanRuns, fromSegments, paintRuns, textSegments} from '../../../shared/text-runs.js';
import {MOBILE_KINDS} from '../../../shared/mobile-kinds.js';
import {api, LINE_HEIGHT, MASK_HEX, INDEX_OVER, SVG_NS} from './shared.js';

// ---- 文字入れの中身（部分の色）：画面では色の切れ目ごとに span（.anno-text__run）。色を変えた所は data-c に色 ----
/** 箱の中の文字を、色の切れ目ごとに読む（打っている間にできた改行・div も本文の改行として数える） */
function readSegments(root) {
  const segs = [];
  let all = '';
  const push = (t, c) => {
    if (!t) return;
    all += t;
    const last = segs.at(-1);
    if (last && last.c === c) last.t += t;
    else segs.push({t, c});
  };
  const walk = (node, c) => {
    for (const n of node.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) push(n.data, c);
      else if (n.nodeName === 'BR') push('\n', c);
      else if (n.nodeType === Node.ELEMENT_NODE) {
        if ((n.nodeName === 'DIV' || n.nodeName === 'P') && all && !all.endsWith('\n')) push('\n', c);
        walk(n, n.dataset?.c ?? c);
      }
    }
  };
  walk(root, null);
  return segs;
}
/** 箱の頭から (node, offset) までの文字数（readSegments と同じ数え方） */
function offsetIn(el, node, offset) {
  const r = document.createRange();
  r.setStart(el, 0);
  r.setEnd(node, offset);
  return readSegments(r.cloneContents()).reduce((n, s) => n + s.t.length, 0);
}
/** i 文字目の位置（描き直した箱の中の文字のノードと位置） */
function pointAt(el, i) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last = null;
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (i <= n.data.length) return [n, i];
    i -= n.data.length;
    last = n;
  }
  return last ? [last, last.data.length] : [el, el.childNodes.length];
}

export const methods = {
  // ---- 注釈 ----
  addAnno(a) {
    const p = this.pages[a.page - 1];
    if (a.kind === 'ink') {
      // ペンの線：ページの SVG に path を足す（押しても選ばれない。消しゴムで消す）
      a.points = decodePoints(a.body) ?? [];
      a.el = document.createElementNS(SVG_NS, 'path');
      a.el.dataset.key = a.key;
      p.ink.append(a.el);
      this.annos.set(a.key, a);
      this.applyStyle(a);
      return a;
    }
    const el = document.createElement('div');
    el.dataset.key = a.key;
    if (a.kind === 'line') {
      el.className = 'anno-line';
      el.title = 'マーカー';
    } else if (a.kind === 'text') {
      el.className = 'anno-text';
    } else if (a.kind === 'stamp') {
      // 貼りもの：シール・素材の図は画像、ちぎった紙は文字。右下のつまみで大きさを変える（選んでいるときだけ見える）
      el.className = `anno-stamp anno-stamp--${a.style.type}`;
      el.innerHTML =
        a.style.type === 'memo'
          ? '<div class="anno-stamp__memo"><div class="anno-stamp__text"></div></div><span class="anno-stamp__grip" aria-hidden="true"></span>'
          : a.style.type === 'index'
            ? '<span class="anno-stamp__tab"></span>'
            : a.style.type === 'figure'
              ? '<div class="anno-stamp__fig"></div><span class="anno-stamp__grip" aria-hidden="true"></span>'
              : '<img class="anno-stamp__img" alt="" draggable="false" /><span class="anno-stamp__grip" aria-hidden="true"></span>';
    } else if (a.kind === 'mask') {
      el.className = 'anno-mask';
      el.title = '文字隠し';
      // 赤シートがかぶったところだけ見せる黒い覆い（syncCovers が切り抜く）。下の文字を確実に読めなくする
      el.innerHTML = '<span class="anno-mask__cover"></span>';
    } else {
      el.className = 'anno-note';
      el.innerHTML = `<button type="button" class="anno-note__icon" aria-label="メモ"></button>
        <div class="anno-note__pop" hidden>
          <textarea maxlength="5000" placeholder="メモを書く"></textarea>
          <div class="anno-note__draw" title="筆箱のボールペンで手書きできます（ペンを持っていなければ黒の 0.5）"><svg class="anno-note__ink" aria-label="手書き"></svg></div>
          <div class="anno-note__foot"><button type="button" class="btn btn--small" data-note="clear-ink" hidden>手書きを消す</button><button type="button" class="btn btn--small" data-note="delete">削除</button><button type="button" class="btn btn--small" data-note="close">閉じる</button></div>
        </div>`;
      this.bindNoteInk(a, el.querySelector('.anno-note__ink'));
      this.watchNoteSize(a, el.querySelector('.anno-note__pop'));
      const ta = el.querySelector('textarea');
      ta.value = a.body;
      ta.addEventListener('input', () => {
        a.body = ta.value;
        this.noteTitle(a);
        this.scheduleSave(a);
      });
      // 本文の書き換えは、書き始めから書き終わりまでを 1 手として取り消せる
      ta.addEventListener('focus', () => (a.bodyBefore = this.snap(a)));
      ta.addEventListener('blur', () => {
        if (a.bodyBefore) this.record(a.key, a.bodyBefore, this.snap(a));
        a.bodyBefore = null;
      });
    }
    // キーボードでも選べる（Tab で順に。Enter で文字を直す／メモを開く。Delete で消す）。メモは中のボタンが受けるので外側には付けない
    if (a.kind !== 'note') {
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      if (a.kind === 'text') el.setAttribute('aria-label', `文字入れ：${a.body.slice(0, 40)}`);
    }
    a.el = el;
    if (a.kind === 'text') this.renderText(a);
    this.mountAnno(a, p);
    this.annos.set(a.key, a);
    this.applyStyle(a);
    this.place(a);
    return a;
  },

  /**
   * 注釈の要素をページに入れる。貼りもの・文字入れはペンの線の下（上から線を書き込める。文字入れは貼りものの上）、ほかは上
   */
  mountAnno(a, p) {
    const svg = p.ink.ownerSVGElement;
    if (a.kind === 'ink') p.ink.append(a.el);
    else if (a.kind === 'stamp') p.layer.insertBefore(a.el, p.layer.querySelector(':scope > .anno-text') ?? svg);
    else if (a.kind === 'text') p.layer.insertBefore(a.el, svg);
    else p.layer.append(a.el);
  },

  /** 文字入れの中身を描き直す（本文と部分の色から）。色の切れ目ごとに span。赤シートで消える色の所は data-red */
  renderText(a) {
    const frag = document.createDocumentFragment();
    for (const {t, c} of textSegments(a.body, a.style.runs)) {
      const s = document.createElement('span');
      s.className = 'anno-text__run';
      if (c) {
        s.dataset.c = c;
        s.style.color = c;
      }
      s.textContent = t;
      frag.append(s);
    }
    a.el.replaceChildren(frag);
    this.markRed(a);
  },

  /** 赤く見える色の所（箱の色・部分の色）に印。赤シートの下に入ると見えなくする（syncCovers） */
  markRed(a) {
    const baseRed = hidesUnderRedSheet(a.style.color);
    let any = false;
    for (const s of a.el.querySelectorAll('.anno-text__run')) {
      const red = s.dataset.c ? hidesUnderRedSheet(s.dataset.c) : baseRed;
      if (red) s.dataset.red = '1';
      else {
        delete s.dataset.red;
        s.style.clipPath = '';
      }
      any ||= red;
    }
    return any || baseRed;
  },

  /** 編集中の箱の中で選んでいる範囲（文字の位置 {s, e}）。箱の外なら null */
  textSel(a) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!a.el.contains(r.startContainer) || !a.el.contains(r.endContainer)) return null;
    return {s: offsetIn(a.el, r.startContainer, r.startOffset), e: offsetIn(a.el, r.endContainer, r.endOffset)};
  },

  /** 箱の中の範囲を選び直す（描き直したあと） */
  setTextSel(a, {s, e}) {
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(...pointAt(a.el, s));
    r.setEnd(...pointAt(a.el, e));
    sel.removeAllRanges();
    sel.addRange(r);
  },

  /** 打っている箱の中身を本文と部分の色に読み直す（末尾の改行は残す。位置がずれないように） */
  readEditing(a) {
    const {body, runs} = fromSegments(readSegments(a.el), a.style.color);
    a.body = body;
    a.style = {...a.style, runs};
    if (!runs.length) delete a.style.runs;
  },

  /** 編集中に選んだ文字だけ色を変える。選んでいなければ false（箱ごとの色にする） */
  paintSelection(a, color) {
    const sel = this.textSel(a) ?? a.sel;
    if (!sel || sel.s === sel.e) return false;
    const [s, e] = [Math.min(sel.s, sel.e), Math.max(sel.s, sel.e)];
    this.readEditing(a);
    const runs = paintRuns(a.style.runs, s, e, color, a.style.color, a.body.length);
    a.style = {...a.style, runs};
    if (!runs.length) delete a.style.runs;
    this.renderText(a);
    this.applyStyle(a);
    a.sel = {s, e};
    if (document.activeElement === a.el) this.setTextSel(a, a.sel);
    return true;
  },

  /** 書式の欄（サイズ・色の選び皿）から、打っていた箱へ戻る（選んでいた範囲もそのまま） */
  refocusText() {
    const a = this.editing;
    if (!a || document.activeElement === a.el) return;
    a.el.focus();
    if (a.sel) this.setTextSel(a, a.sel);
  },

  applyStyle(a) {
    if (a.kind === 'ink') {
      a.points = decodePoints(a.body) ?? a.points ?? [];
      a.el.setAttribute('fill', a.style.color);
      a.el.setAttribute('d', strokePath(a.points, a.style.width, {pressure: a.style.pressure !== false}));
    } else if (a.kind === 'line') a.el.style.setProperty('--line', a.style.color);
    else if (a.kind === 'mask') a.el.style.setProperty('--mask', a.style.color ?? MASK_HEX);
    else if (a.kind === 'text') {
      a.el.style.fontWeight = a.style.bold ? '700' : '400';
      a.el.style.color = a.style.color;
      a.el.style.textAlign = a.style.align ?? '';
    } else if (a.kind === 'note') {
      a.el.style.setProperty('--note', a.style.color);
      this.noteTitle(a);
      this.applyNotePop(a);
    } else if (a.kind === 'stamp') this.applyStamp(a);
    // 赤く見える色の文字入れ・ペンの線は、赤シートの下に入ると見えなくなる（本物の赤シートと同じ）。syncCovers が隠す
    if (a.kind === 'text' || a.kind === 'ink') {
      const red = a.kind === 'text' ? this.markRed(a) : hidesUnderRedSheet(a.style.color);
      if (red) a.el.dataset.red = '1';
      else {
        delete a.el.dataset.red;
        a.el.style.clipPath = '';
      }
      if (this.sheet) this.syncCovers();
    }
  },

  /** 貼りものの中身：シールの画像（取り込んだ画像は届いてから）・図・ちぎった紙の文字と色 */
  applyStamp(a) {
    const {type, ref} = a.style;
    if (type === 'index') {
      a.el.style.setProperty('--index', a.style.color);
      a.el.style.setProperty('--index-ink', inkOn(a.style.color));
      a.el.querySelector('.anno-stamp__tab').textContent = a.body;
      a.el.setAttribute('aria-label', `付箋：${a.body || '（言葉なし）'}`);
      queueMicrotask(() => this.indexPad && this.renderIndexList()); // 位置（place）が決まってから並べる
      return;
    }
    if (type === 'memo') {
      a.el.style.setProperty('--memo', a.style.color ?? MEMO_COLOR);
      a.el.querySelector('.anno-stamp__text').textContent = a.body;
      a.el.setAttribute('aria-label', `メモ帳の紙：${a.body.slice(0, 40) || '（白紙）'}`);
      return;
    }
    if (type === 'figure') {
      // 図：SVG の上に文字の層（書き換えられる）。決め事（水の量・グラフの式など）も style に持つ
      if (!a.el.querySelector('.fig.is-editing')) renderFigure(a.el.querySelector('.anno-stamp__fig'), a.style);
      a.el.setAttribute('aria-label', `素材：${figureOf(ref)?.name ?? '図'}（押すと書き換え）`);
      return;
    }
    const img = a.el.querySelector('img');
    const shape = isBuiltinSticker(ref)
      ? 'cut'
      : ((state.data?.skin?.stickers ?? []).find((x) => x.id === ref)?.shape ?? 'cut');
    img.className = `anno-stamp__img sticker--${shape}`;
    a.el.dataset.shape = shape;
    a.el.setAttribute('aria-label', `シール：${BUILTIN_STICKERS.find((x) => x.id === ref)?.name ?? '自分の画像'}`);
    this.stickerSrc(ref).then((url) => {
      if (url && a.style.ref === ref) img.src = url;
    });
  },

  /** メモの吹き出し：大きさ（style.w・h）と中の手書き（style.ink）を画面に当てる */
  applyNotePop(a) {
    const pop = a.el.querySelector('.anno-note__pop');
    if (!pop) return;
    pop.style.width = a.style.w ? `${a.style.w}px` : '';
    pop.style.height = a.style.h ? `${a.style.h}px` : '';
    const svg = pop.querySelector('.anno-note__ink');
    const strokes = Array.isArray(a.style.ink) ? a.style.ink : [];
    svg.innerHTML = '';
    for (const s of strokes) {
      const points = decodePoints(s.p) ?? [];
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('fill', s.c);
      path.setAttribute('d', strokePath(points, s.w * NOTE_INK_SCALE, {pressure: s.pressure !== false}));
      svg.append(path);
    }
    pop.querySelector('[data-note="clear-ink"]').hidden = !strokes.length;
  },

  noteTitle(a) {
    const head = a.body.trim().slice(0, 80);
    a.el.querySelector('.anno-note__icon').title = head
      ? head + (a.body.trim().length > 80 ? '…' : '')
      : 'メモ（押すと開きます）';
  },

  /**
   * PDF の四角 → 画面の四角（ページの左上からの px）。ページに回転（/Rotate）があっても合うように、
   * 2 つの角を変換して小さいほう・大きいほうを取る。印刷の「横向き」で作った PDF は 90 度回転していることが多い
   */
  toScreen(page, r) {
    const vp = this.pages[page - 1].viewport;
    const [ax, ay] = vp.convertToViewportPoint(r.x, r.y);
    const [bx, by] = vp.convertToViewportPoint(r.x + r.w, r.y + r.h);
    return {left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay)};
  },

  /** 画面の四角 → PDF の四角（左下と幅・高さ） */
  fromScreen(page, s) {
    const vp = this.pages[page - 1].viewport;
    const [ax, ay] = vp.convertToPdfPoint(s.left, s.top);
    const [bx, by] = vp.convertToPdfPoint(s.left + s.width, s.top + s.height);
    return {x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay)};
  },

  /** PDF 座標 → 画面の位置 */
  place(a) {
    const vp = this.pages[a.page - 1].viewport;
    if (!vp || a.kind === 'ink') return; // ペンの線はページの g の変換で合う
    const s = this.toScreen(a.page, a.rect);
    a.el.style.left = `${s.left}px`;
    a.el.style.top = `${s.top}px`;
    if (a.kind === 'text') {
      a.el.style.fontSize = `${a.style.size * vp.scale}px`;
      a.el.style.maxWidth = `${Math.max(40, vp.width - s.left)}px`;
    } else if (a.kind === 'mask' || a.kind === 'line' || a.kind === 'stamp') {
      a.el.style.width = `${s.width}px`;
      a.el.style.height = `${s.height}px`;
      if (a.kind === 'mask') this.syncCovers();
      if (a.kind === 'stamp' && a.style.type === 'memo') this.placeMemo(a, s.width, vp.scale);
      if (a.kind === 'stamp' && a.style.type === 'index') {
        a.el.style.setProperty('--index-over', `${INDEX_OVER * vp.scale}px`);
        a.el.style.setProperty('--index-font', `${8 * vp.scale}px`);
      }
    } else a.el.style.setProperty('--note-size', `${NOTE_SIZE * vp.scale}px`);
  },

  /** ちぎった紙の文字の大きさ・余白・罫線・ちぎり口を、拡大率に合わせる（寸法は pt。書き出しと同じ） */
  placeMemo(a, width, scale) {
    const size = (a.style.size ?? MEMO_SIZE) * scale;
    const st = a.el.style;
    st.setProperty('--memo-font', `${size}px`);
    st.setProperty('--memo-lh', `${size * MEMO_LINE}px`);
    st.setProperty('--memo-pad', `${MEMO_PAD * scale}px`);
    st.setProperty('--memo-top', `${(MEMO_TOP + MEMO_DEPTH) * scale}px`);
    a.el.firstElementChild.style.clipPath = tearClip(width, MEMO_DEPTH * scale, MEMO_TOOTH * scale);
  },

  /** 画面の箱（左上と大きさ）から rect を取り直す */
  measure(a) {
    a.rect = this.fromScreen(a.page, {
      left: parseFloat(a.el.style.left),
      top: parseFloat(a.el.style.top),
      width: a.el.offsetWidth,
      height: a.el.offsetHeight
    });
  },

  createAt(kind, p, vx, vy) {
    const scale = p.viewport.scale;
    if (kind === 'text') {
      const style = {...this.textStyle};
      // 押した点に文字カーソルが来るように置く：1 行目の高さの真ん中を押した点に、左の余白（1px）ぶん左へずらす
      const h = style.size * LINE_HEIGHT * scale;
      const a = this.addAnno({
        key: `k${this.seq++}`,
        id: null,
        page: p.num,
        kind,
        rect: this.fromScreen(p.num, {left: vx - 1, top: vy - h / 2, width: 0, height: h}),
        body: '',
        style
      });
      a.fresh = true; // 取り消すと「置く前」に戻る
      this.select(a);
      this.edit(a);
    } else {
      const n = NOTE_SIZE * scale;
      const a = this.addAnno({
        key: `k${this.seq++}`,
        id: null,
        page: p.num,
        kind,
        rect: this.fromScreen(p.num, {left: vx - n / 2, top: vy - n / 2, width: n, height: n}),
        body: '',
        style: {color: this.noteColor}
      });
      this.record(a.key, null, this.snap(a));
      this.select(a);
      this.scheduleSave(a, 0);
      this.openNote(a, true);
    }
  },

  select(a) {
    if (this.selected === a) return;
    this.selected?.el.classList.remove('is-selected');
    this.selected = a;
    a?.el.classList.add('is-selected');
    this.updateBar();
  },

  edit(a) {
    if (this.editing === a) return;
    this.finishEdit();
    this.editing = a;
    a.editBefore = a.fresh ? null : this.snap(a);
    a.fresh = false;
    const el = a.el;
    el.contentEditable = 'plaintext-only';
    el.classList.add('is-editing');
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    a.sel = null;
    // 打ち終わるのは、箱の外を押したとき・Esc・ほかの道具に替えたときだけ。窓がほかのアプリに移った・書式の欄（サイズ・色の選び皿）を
    // 使ったときにフォーカスが外れても、打っている途中のまま（戻ると続けて打てる）
    a.onBlur = (e) => {
      if (!document.hasFocus() || e.relatedTarget?.closest?.('[data-group="text"]')) return;
      this.finishEdit();
    };
    a.onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.finishEdit();
        el.blur();
      }
    };
    // 選んでいる範囲を覚えておく（色の選び皿を開くと、箱の中の選択が見えなくなるため）
    a.onSel = () => {
      const r = this.textSel(a);
      if (r) a.sel = r;
    };
    el.addEventListener('blur', a.onBlur);
    el.addEventListener('keydown', a.onKey);
    document.addEventListener('selectionchange', a.onSel);
  },

  finishEdit() {
    const a = this.editing;
    if (!a) return;
    this.editing = null;
    const el = a.el;
    el.removeEventListener('blur', a.onBlur);
    el.removeEventListener('keydown', a.onKey);
    document.removeEventListener('selectionchange', a.onSel);
    a.sel = null;
    el.contentEditable = 'false';
    el.classList.remove('is-editing');
    this.readEditing(a);
    const body = a.body.replace(/\n+$/, '').slice(0, 2000);
    if (!body.trim()) {
      this.removeAnno(a, false);
      return this.record(a.key, a.editBefore, null);
    }
    a.body = body;
    const runs = cleanRuns(a.style.runs, body.length, a.style.color);
    a.style = {...a.style, runs};
    if (!runs.length) delete a.style.runs;
    this.renderText(a);
    this.applyStyle(a);
    this.measure(a);
    this.record(a.key, a.editBefore, this.snap(a));
    this.scheduleSave(a, 0);
  },

  openNote(a, open) {
    const pop = a.el.querySelector('.anno-note__pop');
    pop.hidden = !open;
    a.el.classList.toggle('is-open', open);
    if (open) pop.querySelector('textarea').focus();
  },

  /** 注釈を消す。record が真なら取り消しの履歴に積む */
  removeAnno(a, record = true) {
    if (a.removed) return;
    if (record) this.record(a.key, this.snap(a), null);
    a.removed = true;
    clearTimeout(a.timer);
    a.el.remove();
    this.annos.delete(a.key);
    if (this.selected === a) this.select(null);
    if (this.editing === a) this.editing = null;
    if (a.kind === 'stamp' && a.style.type === 'index' && this.indexPad) this.renderIndexList();
    // 同じ注釈の保存と消去は 1 本の鎖で順に行う。保存中に消されたときは flush の末尾が先に消すので、removedOnServer で 2 回送らない
    if (a.id || a.chain)
      this.track(a, async () => {
        if (!a.id || a.removedOnServer) return;
        a.removedOnServer = true;
        await api['annotation.remove']({materialId: this.materialId, annotationId: a.id});
      });
    this.updateBar();
  },

  /**
   * スマホで書き込んだ（メモ・マーカー・文字隠し）あと、DB の注釈と画面をそろえる。消えたものは消し、増えたものは足し、
   * 変わったものは直す。取り消しの履歴には積まない（スマホでの操作なので）。そのあとファイルを上書き保存する
   */
  async syncFromPhone() {
    const r = await api['annotation.list']({materialId: this.materialId});
    if (this.destroyed || r?.error) return;
    const rows = new Map(r.annotations.filter((x) => MOBILE_KINDS.includes(x.kind)).map((x) => [x.id, x]));
    for (const a of [...this.annos.values()]) {
      if (!a.id || !MOBILE_KINDS.includes(a.kind) || a.timer) continue; // 保存待ちのものは画面のほうが新しい
      const row = rows.get(a.id);
      rows.delete(a.id);
      if (!row) {
        a.removedOnServer = true; // もう DB にない（スマホで消した）
        this.removeAnno(a, false);
      } else if (
        JSON.stringify([row.page, row.rect, row.body, row.style]) !== JSON.stringify([a.page, a.rect, a.body, a.style])
      ) {
        if (a.page !== row.page) this.mountAnno(a, this.pages[row.page - 1]);
        Object.assign(a, {page: row.page, rect: row.rect, body: row.body, style: row.style});
        if (a.kind === 'note') a.el.querySelector('textarea').value = a.body;
        this.applyStyle(a);
        this.place(a);
      }
    }
    for (const row of rows.values())
      if (row.page >= 1 && row.page <= this.pages.length) this.addAnno({...row, key: `k${this.seq++}`});
    this.markDirty();
  },

  annoOf(target) {
    const el = target.closest?.('[data-key]');
    return el ? this.annos.get(el.dataset.key) : null;
  },

  /** 図を書き換える（決め事・文字）。閉じたときに、書き換え全体を取り消しの 1 手にする */
  editFigure(a, focus = null) {
    this.figEditor?.close();
    const before = this.snap(a);
    this.figEditor = openFigureEditor({
      host: this.root,
      el: a.el.querySelector('.anno-stamp__fig'),
      style: a.style,
      focus,
      onChange: (st) => {
        a.style = st;
        this.scheduleSave(a);
      },
      // ます・目盛りの数を変えたら、貼った大きさも同じ割合で（1 ますの大きさは変えない。ページからははみ出さない）
      onResize: (kx, ky) => {
        const p = this.pages[a.page - 1];
        const b = this.toScreen(a.page, a.rect);
        const width = Math.min(b.width * kx, p.viewport.width - b.left),
          height = Math.min(b.height * ky, p.viewport.height - b.top);
        a.rect = this.fromScreen(a.page, {left: b.left, top: b.top, width, height});
        this.place(a);
      },
      onClose: (st) => {
        this.figEditor = null;
        if (a.removed) return;
        a.style = st;
        this.record(a.key, before, this.snap(a));
        this.scheduleSave(a, 0);
      }
    });
  }
};
