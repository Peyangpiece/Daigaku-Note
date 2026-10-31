// PDF の編集画面：道具とペン・筆箱・ツールバー。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
import {esc, toast} from '../../ui-kit.js';
import {navigate, state} from '../../store.js';
import {
  DEFAULT_HIDER,
  KIND_OF,
  TYPE_LABEL,
  TOOL_TYPES,
  heldPen,
  itemOf,
  nextRefill,
  toolArt
} from '../../../shared/stationery.js';
import {api, clampSize} from './shared.js';
import {dressCase} from '../../model3d.js';

const PIN_MIN_WIDTH = 1100; // これより狭い窓では、開いたままにしない（PDF が小さくなりすぎる）

export const methods = {
  // ---- 操作 ----
  setTool(tool) {
    this.tool = tool;
    if (!['ink', 'line', 'mask'].includes(tool)) this.slot = null;
    if (tool !== 'select') {
      this.finishEdit();
      if (this.selected && this.selected.kind !== tool) this.select(null);
    }
    this.pagesEl.dataset.tool = tool;
    for (const b of this.root.querySelectorAll('[data-tool]'))
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    for (const b of this.root.querySelectorAll('[data-slot]'))
      b.setAttribute('aria-pressed', String(this.slot !== null && Number(b.dataset.slot) === this.slot));
    if (tool !== 'eraser') this.ring?.remove();
    // しまった筆箱のつまみに、今持っているペンの色を出す
    const pen = ['ink', 'line', 'mask'].includes(tool) ? this.penItem?.color : tool === 'eraser' ? '#2f6fb5' : null;
    this.$('side')?.style.setProperty('--current', pen ?? 'transparent');
    // 開いているメモの書き方も、持った道具に合わせる
    for (const a of this.annos.values())
      if (a.kind === 'note' && a.el.classList.contains('is-open')) this.setNoteMode(a);
    this.updateBar();
  },

  // ---- 筆箱を開いたままにする（窓が広いときだけ。PDF は筆箱の分だけ左に寄せ、ページ幅に合わせ直す）----
  pinCase(on) {
    this.casePinned = !!on;
    try {
      localStorage.setItem('viewer.casePinned', on ? '1' : '');
    } catch {
      // 覚えられなくても使える
    }
    this.applyPin();
  },
  applyPin() {
    const active = !!this.casePinned && window.innerWidth >= PIN_MIN_WIDTH;
    this.pinnedCorner = active ? 'fude' : null; // desk-tools の openCorner が、しまわない
    this.root.classList.toggle('viewer--pinned', active);
    this.$('pin').setAttribute('aria-pressed', String(!!this.casePinned));
    this.$('pin').hidden = window.innerWidth < PIN_MIN_WIDTH;
    const side = this.$('side');
    if (active) side.classList.remove('is-tucked');
    else if (this.corner !== 'fude') side.classList.add('is-tucked');
    // 開いたままの筆箱の下にポーチのつまみを置く（重ならないように）
    if (active)
      requestAnimationFrame(() =>
        this.root.style.setProperty(
          '--pouch-top',
          `${Math.max(window.innerHeight / 2, side.getBoundingClientRect().bottom + 16)}px`
        )
      );
  },

  // ---- 筆箱（§9.8）----
  /** 筆箱の i 本目（null なら筆箱の外の品）のペンを持つ */
  usePen(item, i = null) {
    if (!item) return;
    this.penItem = heldPen(item, this.st.refills?.[item.id]); // 多機能ペンは選んだ芯の色・太さ

    this.slot = i;
    this.setTool(KIND_OF[item.type]);
    this.slot = i; // setTool が外したのを戻す
    for (const b of this.root.querySelectorAll('[data-slot]'))
      b.setAttribute('aria-pressed', String(i !== null && Number(b.dataset.slot) === i));
  },

  /** 筆箱の i 本目を持つ（空なら何もしない）。持っている多機能ペンをもう一度押すと、次の芯に回す（回転式） */
  useSlot(i) {
    const item = itemOf(this.st.slots[i]);
    if (!item) return;
    if (item.refills && this.slot === i && this.tool === KIND_OF[item.type]) {
      const next = nextRefill(item, this.penItem?.refill?.id);
      this.pickRefill(next);
      toast(`${item.name}：${heldPen(item, next).refill.name}に回しました`);
    } else this.usePen(item, i);
  },

  /** 持っている多機能ペンの芯を選ぶ（設定に残す） */
  async pickRefill(rid) {
    const item = itemOf(this.penItem?.id);
    if (!item?.refills || !item.refills.some((r) => r.id === rid)) return;
    this.st = {...this.st, refills: {...this.st.refills, [item.id]: rid}};
    if (state.data) state.data.stationery = this.st;
    this.usePen(item, this.slot);
    this.renderSlots();
    const r = await api['stationery.arrange']({refills: {[item.id]: rid}});
    if (r?.error) return toast(r.error, {error: true});
    this.st = r.stationery;
    if (state.data) state.data.stationery = r.stationery;
  },

  /** 文字隠しペン（⌘K。前の ⇧⌘H も）：筆箱の中の最初の文字隠しペン。なければ水色。持っていればしまう */
  useHider() {
    if (this.tool === 'mask') return this.setTool('select'); // 持っているときにもう一度押すと、しまう（選択の道具に戻る）
    const i = this.st.slots.findIndex((id) => itemOf(id)?.type === 'hider');
    if (i >= 0) this.useSlot(i);
    else this.usePen(itemOf(DEFAULT_HIDER));
  },

  renderSlots() {
    const box = this.$('slots');
    const kase = itemOf(this.st.caseId);
    this.$('side').style.setProperty('--case-base', kase.base);
    this.$('side').style.setProperty('--case-trim', kase.trim);
    this.$('case-name').textContent = kase.name;
    box.innerHTML = this.st.slots
      .map((id, i) => {
        const it = itemOf(id);
        if (!it)
          return `<button type="button" class="fude-side__pen is-empty" data-slot="${i}" disabled title="空き（「ペンを入れ替える」で入れる）" aria-label="${i + 1} 本目：空き"><span class="fude-side__num">${i + 1}</span></button>`;
        const held = heldPen(it, this.st.refills?.[it.id]);
        const tip = held.refill
          ? `${it.name}（${held.refill.name}・キー ${i + 1}。もう一度押すと次の芯）`
          : `${it.name}（${TYPE_LABEL[it.type]}・キー ${i + 1}）`;
        return `<button type="button" class="fude-side__pen" data-slot="${i}" title="${tip}" aria-label="${tip}" aria-pressed="false" style="--ink: ${held.color}"><span class="fude-side__num">${i + 1}</span>${toolArt(it, {label: false})}</button>`;
      })
      .join('');
    dressCase(this.$('side'), box, kase); // 横のペンケースを、選んでいるケースの 3D の材質で描く
    // 使っていたペンが筆箱から出たら、選択に戻す
    if (this.slot !== null && this.st.slots[this.slot] !== this.penItem?.id) this.setTool('select');
    else this.setTool(this.tool);
  },

  openCase(open) {
    const panel = this.$('case-panel');
    panel.hidden = !open;
    this.$('case').setAttribute('aria-expanded', String(open));
    if (!open) return;
    const at = this.slot ?? Math.max(0, this.st.slots.indexOf(null));
    const groups = TOOL_TYPES.map((type) => {
      const items = this.st.owned.map(itemOf).filter((it) => it?.type === type);
      return `<div class="case-panel__group"><span class="muted">${TYPE_LABEL[type]}</span>
        ${items
          .map((it) => {
            const where = this.st.slots.indexOf(it.id);
            return `<button type="button" class="case-panel__item${where >= 0 ? ' is-in' : ''}" data-case-item="${it.id}" title="${it.name}${where >= 0 ? `（${where + 1} 本目）` : ''}">${toolArt(it, {label: false})}<span>${it.name}</span></button>`;
          })
          .join('')}</div>`;
    });
    panel.innerHTML = `<div class="case-panel__head"><strong>筆箱</strong><span class="muted">押したペンを ${at + 1} 本目に入れて持ちます</span></div>
      ${groups.join('')}
      <div class="case-panel__foot"><button type="button" class="btn btn--small" data-case-go>筆箱を整理する・ショップへ →</button></div>`;
    panel.dataset.at = String(at);
  },

  /** 筆箱の外のペンを、at 本目に入れて持つ（入っていたペンは出す）。もう入っていればそのまま持つ */
  async putInCase(id, at) {
    const now = this.st.slots.indexOf(id);
    if (now >= 0) return this.useSlot(now);
    const slots = [...this.st.slots];
    slots[at] = id;
    const r = await api['stationery.arrange']({slots});
    if (r?.error) return toast(r.error, {error: true});
    this.st = r.stationery;
    if (state.data) state.data.stationery = r.stationery;
    this.renderSlots();
    this.useSlot(at);
  },

  bindCase() {
    const panel = this.$('case-panel');
    this.on(panel, 'click', (e) => {
      const item = e.target.closest('[data-case-item]');
      if (item) {
        this.openCase(false);
        return void this.putInCase(item.dataset.caseItem, Number(panel.dataset.at ?? 0));
      }
      if (e.target.closest('[data-case-go]')) {
        this.openCase(false);
        navigate('/fudebako');
      }
    });
    this.on(document, 'pointerdown', (e) => {
      if (!panel.hidden && !e.target.closest('.fude-side__swap')) this.openCase(false);
    });
  },

  /**
   * 選んだ注釈に書式を当てる。何も選んでいなければ次に置く注釈の書式にする。
   * 色：打っている途中で文字を選んでいれば、その文字だけ（箱の色は変えない）。箱を選んでいるときは箱ごと（部分の色も消す）
   */
  setTextStyle(patch, record = true) {
    const a = this.selected;
    if (a?.kind === 'text' && 'color' in patch && this.editing === a && this.paintSelection(a, patch.color))
      return this.updateBar();
    if (a?.kind === 'text') {
      const before = this.snap(a);
      a.style = {...a.style, ...patch};
      if ('color' in patch && this.editing !== a && a.style.runs) {
        delete a.style.runs;
        this.renderText(a);
      }
      this.applyStyle(a);
      this.place(a);
      if (this.editing !== a) {
        this.measure(a);
        if (record) this.record(a.key, before, this.snap(a));
        this.scheduleSave(a);
      }
    }
    Object.assign(this.textStyle, patch);
    this.rememberTextStyle();
    this.updateBar();
  },

  /** 文字入れの書式を覚える（少し待ってまとめて。この PDF と同じ授業の次の PDF の初期値になる） */
  rememberTextStyle() {
    clearTimeout(this.textStyleTimer);
    this.textStyleTimer = setTimeout(() => {
      api['pdf.textStyle']({materialId: this.materialId, style: {...this.textStyle}}).catch(() => {});
    }, 500);
  },

  setNoteColor(color, record = true) {
    const a = this.selected;
    if (a?.kind === 'note') {
      const before = this.snap(a);
      a.style.color = color;
      if (record) this.record(a.key, before, this.snap(a));
      this.applyStyle(a);
      this.scheduleSave(a);
    }
    this.noteColor = color;
    this.updateBar();
  },

  updateBar() {
    const a = this.selected;
    const textOn = this.tool === 'text' || a?.kind === 'text';
    const noteOn = this.tool === 'note' || a?.kind === 'note';
    this.root.querySelector('[data-group="text"]').hidden = !textOn;
    this.root.querySelector('[data-group="note"]').hidden = !noteOn;
    const ts = a?.kind === 'text' ? a.style : this.textStyle;
    const size = this.$('size');
    if (document.activeElement !== size) size.value = String(ts.size);
    this.$('bold').setAttribute('aria-pressed', String(ts.bold));
    for (const b of this.root.querySelectorAll('[data-align]'))
      b.setAttribute('aria-pressed', String(b.dataset.align === (ts.align ?? 'left')));
    for (const b of this.root.querySelectorAll('[data-text-color]'))
      b.setAttribute('aria-pressed', String(b.dataset.textColor === ts.color));
    this.$('text-custom').value = ts.color;
    const nc = a?.kind === 'note' ? a.style.color : this.noteColor;
    for (const b of this.root.querySelectorAll('[data-note-color]'))
      b.setAttribute('aria-pressed', String(b.dataset.noteColor === nc));
    this.$('note-custom').value = nc;
    // 多機能ペンを持っているとき：芯の切り替え
    const rg = this.root.querySelector('[data-group="refill"]');
    const multi = this.tool === 'ink' && this.penItem?.refills ? this.penItem : null;
    rg.hidden = !multi;
    if (multi) {
      const cur = multi.refill?.id;
      const html =
        `<span class="viewer-bar__refills-name">${esc(multi.name)}</span>` +
        multi.refills
          .map(
            (r) =>
              `<button type="button" class="viewer-bar__refill" data-refill="${r.id}" aria-pressed="${r.id === cur}" style="--swatch: ${r.color}" title="${esc(r.name)} ${r.mm} mm">${esc(r.name)}</button>`
          )
          .join('');
      if (rg.innerHTML !== html) rg.innerHTML = html;
    }
    this.$('delete').hidden = !a; // 選んでいるときだけ出す（ツールバーを 1 行に収める）
    // 持っている道具（ペン・マーカー・文字隠し・消しゴム）：筆箱を閉じていても分かるように、ツールバーに札で出す
    const held = this.$('held');
    const pen = ['ink', 'line', 'mask'].includes(this.tool) ? this.penItem : null;
    held.hidden = !pen && this.tool !== 'eraser';
    if (!held.hidden) {
      const name = pen ? `${pen.name}${pen.refill ? `・${pen.refill.name}` : ''}` : '消しゴム';
      this.$('held-name').textContent = name;
      held.style.setProperty('--held', pen ? pen.color : '#2f6fb5');
      held.setAttribute('aria-label', `持っている道具：${name}（押すと選択に戻る）`);
    }
    // 下の帯：文字・コメントの書式、多機能ペンの芯、検索。どれもなければしまう（ツールバーは 1 段のまま）
    const sub = this.$('sub');
    sub.hidden = [...sub.querySelectorAll('[data-group]')].every((g) => g.hidden);
  },

  bindBar() {
    const bar = this.root.querySelector('.viewer-bar');
    // ツールバーは窓に固定なので、ページの上にツールバーの高さ（2 行に折り返したときも）＋余白を空ける
    // 下の帯（文字・コメントの書式・検索）が出たときも同じ。帯が出入りしても見ている場所が動かないよう、増えた分だけスクロールする
    const subEl = this.$('sub');
    this.barObserver = new ResizeObserver(() => {
      const top = this.pagesEl.parentElement.getBoundingClientRect().top + window.scrollY; // ページの並びの親の上端（紙の上の余白の下）
      const h = bar.offsetHeight + (subEl.hidden ? 0 : subEl.offsetHeight);
      const before = parseFloat(this.pagesEl.style.marginTop) || 0;
      const next = Math.max(0, h + 24 - top);
      this.pagesEl.style.marginTop = `${next}px`;
      this.root.style.setProperty('--bar-h', `${bar.offsetHeight}px`);
      if (window.scrollY > 0 && next !== before) window.scrollBy(0, next - before);
    });
    this.barObserver.observe(bar);
    this.barObserver.observe(subEl);
    // ツールバーを押しても文字入れの編集を終わらせない（書式を変えながら打てるように）
    this.on(bar, 'pointerdown', (e) => {
      // 文字入れの編集中・メモの本文を打っている間は、ツールバーを押してもフォーカスを奪わない（続けて打てる）
      const inNote = document.activeElement?.closest?.('.anno-note__pop');
      if ((this.editing || inNote) && e.target.closest('button, .swatch')) e.preventDefault();
    });
    // 四隅の上の 2 つ（筆箱・シール帳）が見えている場所：ツールバーの下から
    this.sideObserver = new ResizeObserver(() => {
      const bottom = subEl.hidden ? bar.getBoundingClientRect().bottom : subEl.getBoundingClientRect().bottom;
      this.root.style.setProperty('--corner-top', `${bottom + 16}px`);
    });
    this.sideObserver.observe(bar);
    this.sideObserver.observe(subEl);
    const onClick = (e) => {
      const t = e.target.closest('button');
      if (!t || t.closest('.case-panel')) return;
      const fromSide = !!t.closest('.fude-side');
      if (t.dataset.cornerTab) return this.openCorner(t.dataset.cornerTab);
      // シール帳・素材の 1 つ：押す・ドラッグは startCarry が受ける。ここに来るのはキーボード（Enter・Space）のとき
      if (t.dataset.seal || t.dataset.figure) return e.detail === 0 && this.placeStamp(this.itemSpec(t));
      if (t.dataset.sealTab) return this.renderSeal(t.dataset.sealTab);
      if (t.dataset.sozaiTab) return this.renderSozai(t.dataset.sozaiTab);
      // ポーチから出したら、少し見せてからしまう（筆箱のペンと同じ）
      if (this.pouchAction(t.dataset.v)) return;
      if (t.dataset.tool) this.setTool(t.dataset.tool);
      else if (t.dataset.refill) this.pickRefill(t.dataset.refill);
      else if (t.dataset.slot !== undefined) this.useSlot(Number(t.dataset.slot));
      else if (t.dataset.v === 'case') this.openCase(this.$('case-panel').hidden);
      else if (t.dataset.textColor) this.setTextStyle({color: t.dataset.textColor});
      else if (t.dataset.noteColor) this.setNoteColor(t.dataset.noteColor);
      else if (t.dataset.v === 'bold')
        this.setTextStyle({bold: !(this.selected?.kind === 'text' ? this.selected.style : this.textStyle).bold});
      else if (t.dataset.align) this.setTextStyle({align: t.dataset.align});
      else if (t.dataset.v === 'delete' && this.selected) this.removeAnno(this.selected);
      else if (t.dataset.v === 'held') this.setTool('select');
      else if (t.dataset.v === 'find') this.openFind();
      else if (t.dataset.v === 'find-next') this.findStep(1);
      else if (t.dataset.v === 'find-prev') this.findStep(-1);
      else if (t.dataset.v === 'find-close') this.closeFind();
      else if (t.dataset.v === 'pin') this.pinCase(!this.casePinned);
      else if (t.dataset.v === 'zoom-in') this.zoomStep('in');
      else if (t.dataset.v === 'zoom-out') this.zoomStep('out');
      else if (t.dataset.v === 'fit') this.fitWidth();
      else if (t.dataset.v === 'back') this.onBack();
      else if (t.dataset.v === 'bookmarks') this.openBookmarks(this.$('bookmark-panel').hidden);
      else if (t.dataset.v === 'bookmark-add') this.addFusen();
      else if (t.dataset.v === 'undo') this.undo();
      else if (t.dataset.v === 'redo') this.redo();
      else if (t.dataset.v === 'sheet') {
        this.toggleSheet();
        this.tuckSoon();
      } else if (t.dataset.v === 'status') this.failed && this.retrySaves();
      else if (t.dataset.v === 'export') this.openExport();
      else if (t.dataset.v === 'help') this.openHelp(this.$('help-panel').hidden);
      // 筆箱からペン（消しゴム）を持ったら、少し見せてから画面の外へしまう
      if (fromSide && (t.dataset.slot !== undefined || t.dataset.tool === 'eraser')) this.tuckSoon();
    };
    this.on(bar, 'click', onClick);
    const sub = this.$('sub');
    this.on(sub, 'click', onClick);
    this.on(sub, 'pointerdown', (e) => {
      const inNote = document.activeElement?.closest?.('.anno-note__pop');
      if ((this.editing || inNote) && e.target.closest('button, .swatch')) e.preventDefault();
    });
    for (const el of this.root.querySelectorAll('[data-corner]')) {
      this.on(el, 'click', onClick);
      this.on(el, 'pointerdown', (e) => {
        if (this.editing && e.target.closest('button')) e.preventDefault();
      });
    }
    // ページ番号を入れて移る。スクロールしたら今のページを出す
    const page = this.$('page');
    const goPage = () => {
      const n = Math.min(this.pages.length, Math.max(1, Math.round(Number(page.value) || 1)));
      page.value = String(n);
      this.jumpTo({page: n, y: 0});
    };
    this.on(page, 'change', goPage);
    this.on(page, 'keydown', (e) => e.key === 'Enter' && goPage());
    this.on(window, 'scroll', () => this.showPage(), {passive: true});
    const size = this.$('size');
    this.on(size, 'change', () => {
      const v = clampSize(size.value);
      size.value = String(v);
      this.setTextStyle({size: v});
      this.refocusText();
    });
    this.on(size, 'keydown', (e) => e.key === 'Escape' && this.refocusText());
    // 色の選び皿は動かしている間ずっと input が来るので、選び終わり（change）で 1 手にまとめる
    const pickStart = () => {
      if (!this.pick && this.selected && this.editing !== this.selected)
        this.pick = {key: this.selected.key, before: this.snap(this.selected)};
    };
    const pickEnd = () => {
      const pk = this.pick;
      this.pick = null;
      if (pk) this.record(pk.key, pk.before, this.snap(this.annos.get(pk.key)));
      this.refocusText(); // 打っている途中なら、箱へ戻って続けて打てる
    };
    this.on(this.$('text-custom'), 'input', (e) => {
      pickStart();
      this.setTextStyle({color: e.target.value.toLowerCase()}, false);
    });
    this.on(this.$('note-custom'), 'input', (e) => {
      pickStart();
      this.setNoteColor(e.target.value.toLowerCase(), false);
    });
    this.on(this.$('text-custom'), 'change', pickEnd);
    this.on(this.$('note-custom'), 'change', pickEnd);
    const dialog = this.$('export-dialog');
    this.on(dialog, 'close', () => {
      if (dialog.returnValue === 'ok') {
        const f = dialog.querySelector('form');
        this.exportPdf({markers: f.markers.value, notes: f.notes.checked});
      }
    });
  },

  bindPages() {
    const el = this.pagesEl;
    this.on(window, 'wheel', (e) => this.onWheel(e), {passive: false});
    this.on(el, 'pointerdown', (e) => this.onPointerDown(e));
    this.on(el, 'pointermove', (e) => this.onPointerMove(e));
    this.on(el, 'pointerup', (e) => this.onPointerUp(e));
    this.on(el, 'pointercancel', (e) => {
      if ([this.drawing, this.drag, this.tap, this.pan].some((t) => t?.pointer === e.pointerId)) this.cancelPointer();
    });
    // 画面に触れている指（ページの外で離したときも数え落とさないよう window で受ける）
    this.touchIds = new Set();
    const lift = (e) => this.touchIds.delete(e.pointerId);
    this.on(window, 'pointerup', lift);
    this.on(window, 'pointercancel', lift);
    this.on(el, 'touchstart', (e) => this.onTouchStart(e), {passive: false});
    this.on(el, 'touchmove', (e) => this.onTouchMove(e), {passive: false});
    this.on(el, 'touchend', (e) => this.onTouchEnd(e));
    this.on(el, 'touchcancel', (e) => this.onTouchEnd(e));
    this.on(el, 'dblclick', (e) => {
      const a = this.annoOf(e.target);
      // 文字入れはダブルクリックでは打ち始めない（文字入れの道具では 1 回押すと打てる。選択の道具では動かすだけ）
      if (a?.kind === 'stamp' && a.style.type === 'figure' && !this.figEditor) this.editFigure(a);
    });
    // 図を右クリック：書き換える（座標平面は、描く式の種類から選ぶ）
    this.on(el, 'contextmenu', (e) => {
      const a = this.annoOf(e.target);
      if (a?.kind !== 'stamp' || a.style.type !== 'figure') return;
      e.preventDefault();
      this.select(a);
      this.editFigure(a, 'formula');
    });
    this.on(el, 'click', (e) => {
      const btn = e.target.closest('[data-note]');
      const a = btn && this.annoOf(btn);
      if (!a) return;
      if (btn.dataset.note === 'delete') this.removeAnno(a);
      else this.openNote(a, false);
    });
    this.on(document, 'keydown', (e) => this.onKey(e));
    // Tab で注釈にフォーカスが来たら、押したときと同じく選ぶ（メモは中のアイコンのボタンに来る）
    this.on(el, 'focusin', (e) => {
      const a = this.annoOf(e.target);
      if (a && a !== this.editing) this.select(a);
    });
    this.on(window, 'beforeunload', () => this.flushAll());
    this.on(window, 'scroll', () => this.sheet && this.syncCovers(), {passive: true});
  }
};
