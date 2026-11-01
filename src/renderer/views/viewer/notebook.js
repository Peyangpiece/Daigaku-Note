// PDF の編集画面：ノート（SPEC §8.6）・見開き・写真。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
//  - ノート（source が note の資料）：最後のページの右下の外に「＋ ページを追加」「− 最後のページを消す」。
//    足すと下に新しいページが増える（開き直さない。取り消しの履歴・持っているペンもそのまま。v0.14.2）
//  - ノートは、筆箱の最初のペンを持って開く。ツールバーの名前は「授業 第n回 … ノート」。「📄 資料」で同じ回の PDF を開く・横に並べる
//  - 見開き（片開き／両開き）：ツールバーのボタンで 2 ページずつ横に並べる（資料ごとに覚える）
//  - 写真：ツールバーの「写真」・貼り付け（⌘V）・ページへのドラッグで貼る（貼りもの style.type 'photo'）。選ぶと「↻ 回す」
//  - PDF を見ながら、同じ回のノートを「ノート」で開く（ノートからは「← 資料へ」で戻る）
import {noteHeading, noteFrom, openNotebook, openNotebookSide, openSide} from '../../notebook.js';
import {esc, toast, isTyping} from '../../ui-kit.js';
import {navigate, state} from '../../store.js';
import {KIND_OF, itemOf} from '../../../shared/stationery.js';

const api = window.daigaku;
const PHOTO_PX = 2400; // 写真の長い辺（px）。これより大きければ縮める
const PHOTO_SHARE = 0.6; // 貼ったときの大きさ：ページの幅の 6 割（高さは半分）まで
const HINT_KEY = 'note.hinted';

const spreadKey = (id) => `viewer.spread.${id}`;
const isSide = () => document.documentElement.dataset.pane === 'side';

export const methods = {
  /** pdf.open の結果を受けて、ノート・見開き・戻る先のボタンを用意する（ページを並べる前に呼ぶ） */
  setupNotebook(material) {
    this.material = material;
    this.isNote = material.source === 'note';
    try {
      this.spread = localStorage.getItem(spreadKey(this.materialId)) === '1';
    } catch {
      this.spread = false;
    }
    this.showSpread();
    // 同じ回のノート：資料（回に置いたもの）からだけ開ける。ノートでは、開いてきた資料へ戻るボタンと、同じ回の資料のメニュー
    // 横に並べる窓（pane=side）では、ノートを開くボタン・戻るボタンは出さず、「← 授業へ」は「閉じる」にする
    const side = isSide();
    const nb = this.$('notebook');
    nb.hidden = side || this.isNote || !material.round_id;
    this.$('note-side').hidden = nb.hidden;
    this.$('note-pdfs').hidden = side || !this.isNote || !this.roundPdfs().length;
    if (side) this.$('back').textContent = '閉じる';
    const from = this.isNote && !side ? noteFrom(this.materialId) : null;
    const back = this.$('note-back');
    back.hidden = !from;
    back.dataset.id = from ?? '';
  },

  /** ノートの名前（ツールバー・窓の題）：「経済学原論　第3回　…　ノート」。分からなければファイルの名前のまま */
  noteName() {
    const m = this.material;
    const head = m?.course_id ? noteHeading(m.course_id, m.round_id) : '';
    return head ? `${head}　ノート` : null;
  },

  /** ページを並べたあと：ノートなら、最初のペンを持つ・初めてなら使い方を知らせる */
  startNote() {
    if (!this.isNote) return;
    const i = (this.st?.slots ?? []).findIndex((id) => KIND_OF[itemOf(id)?.type] === 'ink');
    if (i >= 0) this.useSlot(i);
    let seen = true;
    try {
      seen = localStorage.getItem(HINT_KEY) === '1';
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // 覚えられなければ毎回は出さない
    }
    if (!seen)
      toast(
        'ノートはペンを持って開きます。ページは右下の「＋ ページを追加」で下に増やせます。写真は貼り付け（⌘V）やドラッグでも貼れます',
        {action: {label: 'わかった', run: () => {}}} // 読めるように少し長く出す
      );
  },

  /** 同じ回に置いた PDF（ノート・書き出したものは除く） */
  roundPdfs() {
    const m = this.material;
    if (!m?.course_id) return [];
    return (state.data?.materials?.[m.course_id] ?? []).filter(
      (x) =>
        !x.copyOf &&
        x.id !== m.id &&
        (x.round_id ?? null) === (m.round_id ?? null) &&
        x.status === 'ok' &&
        /\.pdf$/i.test(x.path ?? x.name ?? '') &&
        !['note', 'export'].includes(x.source)
    );
  },

  /** 「📄 資料」：同じ回の PDF を開く・横に並べる（小さなメニュー） */
  openPdfMenu(btn) {
    this.closePdfMenu();
    const list = this.roundPdfs();
    if (!list.length) return toast('この回には PDF の資料がありません');
    const menu = document.createElement('div');
    menu.className = 'card-menu viewer-pdfmenu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '同じ回の資料');
    menu.innerHTML = list
      .map(
        (x) =>
          `<div class="viewer-pdfmenu__row"><span class="viewer-pdfmenu__name" title="${esc(x.name)}">${esc(x.name)}</span>` +
          `<button type="button" role="menuitem" data-pdf-open="${x.id}">開く</button>` +
          `<button type="button" role="menuitem" data-pdf-side="${x.id}" title="ノートの横に並べて開く（両方に同時に書けます）">◫ 横に並べる</button></div>`
      )
      .join('');
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    const {width} = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
    menu.style.top = `${r.bottom + 4}px`;
    menu.querySelector('button')?.focus();
    this.pdfMenu = menu;
    menu.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.closePdfMenu();
      await this.settle();
      if (b.dataset.pdfOpen) navigate(`/viewer/${b.dataset.pdfOpen}`);
      else if (b.dataset.pdfSide) openSide(b.dataset.pdfSide);
    };
    // 外を押す・Esc で閉じる
    const off = (e) => {
      if (e.type === 'keydown') {
        if (e.key !== 'Escape') return;
        e.stopPropagation(); // メニューだけ閉じる（持っている道具はそのまま）
        e.preventDefault();
        this.closePdfMenu();
      } else if (!menu.contains(e.target) && !btn.contains(e.target)) this.closePdfMenu();
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', off, true);
      document.addEventListener('keydown', off, true);
    });
    this.offPdfMenu = () => {
      document.removeEventListener('pointerdown', off, true);
      document.removeEventListener('keydown', off, true);
    };
  },
  closePdfMenu() {
    this.offPdfMenu?.();
    this.offPdfMenu = null;
    this.pdfMenu?.remove();
    this.pdfMenu = null;
  },

  /** ノートの最後のページの右下の外に「＋ ページを追加」（2 ページ以上なら「− 最後のページを消す」も）を置く（ページを並べたあと） */
  mountAddPage() {
    this.addPageBox?.remove();
    if (!this.isNote) return;
    const box = document.createElement('div');
    box.className = 'viewer-addpage';
    box.innerHTML =
      '<button type="button" class="btn btn--small btn--quiet" data-v="remove-page" title="最後のページを消す（何も書いていない白紙のときだけ）">− 最後のページを消す</button>' +
      '<button type="button" class="btn btn--small" data-v="add-page" title="ノートの最後に白いページを 1 枚足す（下に増えます）">＋ ページを追加</button>';
    this.pagesEl.append(box);
    this.addPageBox = box;
    this.on(box, 'click', (e) => {
      const v = e.target.closest('[data-v]')?.dataset.v;
      if (v === 'add-page') this.addNotePage();
      else if (v === 'remove-page') this.removeNotePage();
    });
    this.sizeAddPage();
  },

  /** 「＋ ページを追加」の幅を、ページ（見開きなら 2 ページ）の幅にそろえる（右下に寄せるため）。消すボタンは 2 ページ以上のとき */
  sizeAddPage() {
    if (!this.addPageBox) return;
    const w = this.pages[0]?.el.offsetWidth ?? 0;
    this.addPageBox.style.width = `${w * (this.spread ? 2 : 1)}px`;
    this.addPageBox.querySelector('[data-v="remove-page"]').hidden = this.pages.length < 2;
  },

  /** 足し引きのあいだはボタンを押せないようにする */
  busyAddPage(on) {
    for (const b of this.addPageBox?.querySelectorAll('button') ?? []) b.disabled = on;
  },

  /**
   * ノートにページを足す：書きかけを保存してから、メインで足し、足したページだけ画面に並べる（開き直さない）。
   * 足したページの PDF（新しい元の写し）を pdf.js で読み、そのページだけ使う
   */
  async addNotePage() {
    if (this.pageBusy) return;
    this.pageBusy = true;
    this.busyAddPage(true);
    try {
      await this.settle();
      const r = await api['note.addPage']({materialId: this.materialId});
      if (r?.error) return toast(r.error, {error: true});
      const last = await this.appendNotePages(r.bytes, r.pages);
      if (!last) return;
      last.el.scrollIntoView({block: 'center', behavior: 'smooth'});
      toast(`ページを足しました（${this.pages.length} ページ）`);
    } catch (e) {
      toast(`ページを足せませんでした（${e.message}）`, {error: true});
    } finally {
      this.pageBusy = false;
      if (!this.destroyed) this.busyAddPage(false);
    }
  },

  /** 新しい元の写し（bytes。全部で pages ページ）から、まだ並べていないページを画面に足す。戻り：最後に足したページ（なければ null） */
  async appendNotePages(bytes, pages) {
    if (this.destroyed || pages <= this.pages.length) return null;
    const task = this.loadDoc(bytes);
    (this.noteTasks ??= []).push(task);
    const doc = await task.promise;
    let last = null;
    for (let i = this.pages.length + 1; i <= Math.min(pages, doc.numPages); i++) {
      const page = await doc.getPage(i);
      if (this.destroyed || this.pages.length >= i) return null;
      last = this.makePage(i, page);
      this.sizePage(last);
      this.observer?.observe(last.el);
    }
    this.sizeAddPage();
    this.markDirty(); // ファイルにも新しいページを入れる（注釈を描き込んだ上書き保存）
    return last;
  },

  /** スマホでノートにページを足したとき：開いているこの画面にも足す */
  bindNotePages() {
    const off = api.on?.('note.pages', ({materialId, pages, bytes}) => {
      if (materialId !== this.materialId || !this.isNote || this.destroyed || this.pageBusy) return;
      this.appendNotePages(bytes, pages)
        .then((last) => last && toast(`スマホでページが足されました（${this.pages.length} ページ）`))
        .catch(() => {});
    });
    if (off) this.listeners.push(off);
  },

  /** ノートの最後のページを消す（何も書いていない・付箋もない白紙のときだけ。1 ページは残す） */
  async removeNotePage() {
    if (this.pageBusy || this.pages.length < 2) return;
    const n = this.pages.length;
    if ([...this.annos.values()].some((a) => !a.removed && a.page === n))
      return toast('最後のページに書いたもの・貼ったものがあるため消せません（先に消してください）', {error: true});
    this.pageBusy = true;
    this.busyAddPage(true);
    try {
      await this.settle();
      const r = await api['note.removePage']({materialId: this.materialId});
      if (r?.error) return toast(r.error, {error: true});
      if (this.destroyed) return;
      while (this.pages.length > r.pages) {
        const p = this.pages.pop();
        this.observer?.unobserve(p.el);
        p.renderTask?.cancel();
        p.el.remove();
      }
      this.dropStepsAfter(r.pages);
      this.numberPages();
      this.sizeAddPage();
      this.markDirty();
      toast(`最後のページを消しました（${this.pages.length} ページ）`);
    } finally {
      this.pageBusy = false;
      if (!this.destroyed) this.busyAddPage(false);
    }
  },

  /** 消したページ（page より後ろ）の注釈に触る取り消し・やり直しは、もうできないので捨てる */
  dropStepsAfter(page) {
    const on = (st) => [st.before, st.after].some((s) => s && s.page > page);
    const keep = (step) => !(step.group ?? [step]).some(on);
    this.undoStack = (this.undoStack ?? []).filter(keep);
    this.redoStack = (this.redoStack ?? []).filter(keep);
    this.updateHistory();
  },

  /** 片開き・見開きのボタン：今の状態を絵（▯・▯▯）で出し、押すとどうなるかを題に書く */
  showSpread() {
    this.pagesEl.classList.toggle('is-spread', this.spread);
    const sp = this.$('spread');
    sp.setAttribute('aria-pressed', String(this.spread));
    sp.textContent = this.spread ? '▯▯ 見開き' : '▯ 片開き';
    sp.title = this.spread
      ? 'いまは見開き（2 ページずつ横に並べる）。押すと片開き（1 ページずつ）'
      : 'いまは片開き（1 ページずつ）。押すと見開き（2 ページずつ横に並べる）';
    sp.setAttribute('aria-label', sp.title);
  },

  /** 片開き・見開きを切り替える（資料ごとに覚える）。ページ幅に合わせている間は合わせ直す */
  toggleSpread() {
    this.spread = !this.spread;
    try {
      localStorage.setItem(spreadKey(this.materialId), this.spread ? '1' : '0');
    } catch {
      // 覚えられなくても切り替えられる
    }
    this.showSpread();
    if (this.fitting) this.fitWidth();
    else this.layout();
  },

  /** 同じ回のノートを横に並べる窓で開く（なければ作る）。この窓は左半分、ノートは右半分になり、両方に同時に書ける */
  async openRoundNoteSide() {
    await this.settle();
    await openNotebookSide(this.material.course_id, this.material.round_id);
  },

  /** 同じ回のノートを開く（なければ作る）。ノートからは「← 資料へ」でこの資料に戻れる */
  async openRoundNote() {
    await this.settle();
    await openNotebook(this.material.course_id, this.material.round_id, {from: this.materialId});
  },

  // ---- 写真 ----
  /** 写真の画像（data: URL）。メインからもらい、覚えておく */
  photoSrc(id) {
    this.photoUrls ??= new Map();
    if (!this.photoUrls.has(id))
      this.photoUrls.set(
        id,
        api['photo.data']({ids: [id]}).then(
          (r) => r?.urls?.[id] ?? '',
          () => ''
        )
      );
    return this.photoUrls.get(id);
  },

  /** 写真を貼る用意：ツールバーのボタン（ファイルを選ぶ）・貼り付け（⌘V）・ページへのドラッグ */
  bindPhotos() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/gif';
    input.multiple = true;
    input.hidden = true;
    this.root.append(input);
    this.photoInput = input;
    this.on(input, 'change', async () => {
      for (const f of [...input.files]) await this.addPhotoFile(f);
      input.value = '';
    });
    this.on(document, 'paste', (e) => {
      if (this.destroyed || isTyping(e.target) || this.editing) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      files.reduce((p, f) => p.then(() => this.addPhotoFile(f)), Promise.resolve());
    });
    this.on(this.pagesEl, 'dragover', (e) => {
      if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file' && i.type.startsWith('image/'))) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    this.on(this.pagesEl, 'drop', (e) => {
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      const p = this.pageAt(e.clientX, e.clientY);
      const at = p
        ? {p, x: e.clientX - p.el.getBoundingClientRect().left, y: e.clientY - p.el.getBoundingClientRect().top}
        : null;
      files.reduce((q, f, i) => q.then(() => this.addPhotoFile(f, i ? null : at)), Promise.resolve());
    });
  },

  /** 画像を JPEG にして取っておく（長い辺 2400 px まで。turn が 1 なら右へ 90° 回す）。戻り：{id, w, h} か null（知らせは出した） */
  async storePhoto(source, turn = 0) {
    const k = Math.min(1, PHOTO_PX / Math.max(source.width, source.height));
    const sw = Math.max(1, Math.round(source.width * k));
    const sh = Math.max(1, Math.round(source.height * k));
    const [w, h] = turn ? [sh, sw] : [sw, sh];
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // 透明なところ（スクリーンショットなど）は白に
    ctx.fillRect(0, 0, w, h);
    if (turn) {
      ctx.translate(w, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.drawImage(source, 0, 0, sw, sh);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) {
      toast('写真を読めませんでした', {error: true});
      return null;
    }
    const r = await api['photo.add']({bytes: new Uint8Array(await blob.arrayBuffer())});
    if (r?.error) {
      toast(r.error, {error: true});
      return null;
    }
    return {id: r.id, w, h};
  },

  /** 写真のファイルを縮めて（長い辺 2400 px・JPEG）取っておき、ページに貼る */
  async addPhotoFile(file, at = null) {
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      return toast('この画像は貼れません（JPEG・PNG などの写真を選んでください）', {error: true});
    }
    const r = await this.storePhoto(bmp);
    bmp.close?.();
    if (!r) return;
    // 大きさ（pt）：ページの幅の 6 割・高さの半分に収まるように、縦横の比を保つ
    const page = (at?.p ?? this.pages[0])?.page.getViewport({scale: 1});
    if (!page) return;
    const s = Math.min((page.width * PHOTO_SHARE) / r.w, (page.height * 0.5) / r.h);
    this.placeStamp({type: 'photo', ref: r.id, w: Math.max(24, r.w * s), h: Math.max(24, r.h * s)}, at);
  },

  /** 選んでいる写真を右へ 90° 回す（新しい写真として取っておき、真ん中を保って縦と横を入れ替える。取り消せる） */
  async rotatePhoto() {
    const a = this.selected;
    if (a?.kind !== 'stamp' || a.style?.type !== 'photo' || this.photoTurning) return;
    this.photoTurning = true;
    try {
      const url = await this.photoSrc(a.style.ref);
      if (!url) return toast('写真が見つかりません', {error: true});
      const img = new Image();
      img.src = url;
      await img.decode();
      const r = await this.storePhoto(img, 1);
      if (!r || a.removed || this.destroyed) return;
      const before = this.snap(a);
      const {x, y, w, h} = a.rect;
      a.rect = {x: x + (w - h) / 2, y: y + (h - w) / 2, w: h, h: w};
      a.style = {...a.style, ref: r.id};
      this.applyStyle(a);
      this.place(a);
      this.record(a.key, before, this.snap(a));
      this.scheduleSave(a, 0);
    } catch (e) {
      toast(`写真を回せませんでした（${e.message}）`, {error: true});
    } finally {
      this.photoTurning = false;
    }
  }
};
