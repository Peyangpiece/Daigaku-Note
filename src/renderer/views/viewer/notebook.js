// PDF の編集画面：ノート（SPEC §8.6）・見開き・写真。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
//  - ノート（source が note の資料）：最後のページの右下の外に「＋ ページを追加」。足すと下に新しいページが増える
//  - 見開き（片開き／両開き）：ツールバーの「見開き」で 2 ページずつ横に並べる（資料ごとに覚える）
//  - 写真：ツールバーの「写真」・貼り付け（⌘V）・ページへのドラッグで貼る（貼りもの style.type 'photo'）
//  - PDF を見ながら、同じ回のノートを「ノート」で開く（ノートからは「← 資料へ」で戻る）
import {openNotebook, openNotebookSide, noteFrom} from '../../notebook.js';
import {toast, isTyping} from '../../ui-kit.js';

const api = window.daigaku;
const PHOTO_PX = 2400; // 写真の長い辺（px）。これより大きければ縮める
const PHOTO_SHARE = 0.6; // 貼ったときの大きさ：ページの幅の 6 割（高さは半分）まで

const spreadKey = (id) => `viewer.spread.${id}`;

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
    this.pagesEl.classList.toggle('is-spread', this.spread);
    const sp = this.$('spread');
    sp.setAttribute('aria-pressed', String(this.spread));
    sp.textContent = this.spread ? '見開き' : '片開き';
    // 同じ回のノート：資料（回に置いたもの）からだけ開ける。ノートでは、開いてきた資料へ戻るボタン
    // 横に並べる窓（pane=side）では、ノートを開くボタン・戻るボタンは出さず、「← 授業へ」は「閉じる」にする
    const side = document.documentElement.dataset.pane === 'side';
    const nb = this.$('notebook');
    nb.hidden = side || this.isNote || !material.round_id;
    this.$('note-side').hidden = nb.hidden;
    if (side) this.$('back').textContent = '閉じる';
    const from = this.isNote && !side ? noteFrom(this.materialId) : null;
    const back = this.$('note-back');
    back.hidden = !from;
    back.dataset.id = from ?? '';
  },

  /** ノートの最後のページの右下の外に「＋ ページを追加」を置く（ページを並べたあと） */
  mountAddPage() {
    this.addPageEl?.remove();
    if (!this.isNote) return;
    const box = document.createElement('div');
    box.className = 'viewer-addpage';
    box.innerHTML =
      '<button type="button" class="btn btn--small" data-v="add-page" title="ノートの最後に白いページを 1 枚足す（下に増えます）">＋ ページを追加</button>';
    this.pagesEl.append(box);
    this.addPageEl = box;
    this.on(box, 'click', (e) => e.target.closest('[data-v="add-page"]') && this.addNotePage());
    this.sizeAddPage();
  },

  /** 「＋ ページを追加」の幅を、ページ（見開きなら 2 ページ）の幅にそろえる（右下に寄せるため） */
  sizeAddPage() {
    if (!this.addPageEl) return;
    const w = this.pages[0]?.el.offsetWidth ?? 0;
    this.addPageEl.style.width = `${w * (this.spread ? 2 : 1)}px`;
  },

  /** ノートにページを足す：書きかけを保存してから、メインで足し、開き直して最後のページを見せる */
  async addNotePage() {
    const btn = this.addPageEl?.querySelector('button');
    if (btn) btn.disabled = true;
    await this.settle();
    const r = await api['note.addPage']({materialId: this.materialId});
    if (r?.error) {
      if (btn) btn.disabled = false;
      return toast(r.error, {error: true});
    }
    toast(`ページを足しました（${r.pages} ページ）`);
    // ファイルへの描き込み直し（足したページも入れる）は、閉じるときの上書き保存に任せる（開き直した画面と保存がぶつからないように）。
    // 開き直した画面は、新しいページ（最後）を見せる
    this.fileDirty = true;
    this.onReload?.({scrollEnd: true});
  },

  /** 片開き・見開きを切り替える（資料ごとに覚える）。ページ幅に合わせている間は合わせ直す */
  toggleSpread() {
    this.spread = !this.spread;
    try {
      localStorage.setItem(spreadKey(this.materialId), this.spread ? '1' : '0');
    } catch {
      // 覚えられなくても切り替えられる
    }
    this.pagesEl.classList.toggle('is-spread', this.spread);
    const sp = this.$('spread');
    sp.setAttribute('aria-pressed', String(this.spread));
    sp.textContent = this.spread ? '見開き' : '片開き';
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

  /** 写真のファイルを縮めて（長い辺 2400 px・JPEG）取っておき、ページに貼る */
  async addPhotoFile(file, at = null) {
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      return toast('この画像は貼れません（JPEG・PNG などの写真を選んでください）', {error: true});
    }
    const k = Math.min(1, PHOTO_PX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // 透明なところ（スクリーンショットなど）は白に
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) return toast('写真を読めませんでした', {error: true});
    const r = await api['photo.add']({bytes: new Uint8Array(await blob.arrayBuffer())});
    if (r?.error) return toast(r.error, {error: true});
    // 大きさ（pt）：ページの幅の 6 割・高さの半分に収まるように、縦横の比を保つ
    const page = (at?.p ?? this.pages[0])?.page.getViewport({scale: 1});
    if (!page) return;
    const s = Math.min((page.width * PHOTO_SHARE) / w, (page.height * 0.5) / h);
    this.placeStamp({type: 'photo', ref: r.id, w: Math.max(24, w * s), h: Math.max(24, h * s)}, at);
  }
};
