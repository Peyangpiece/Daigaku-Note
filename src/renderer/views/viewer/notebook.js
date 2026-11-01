// PDF の編集画面：ノート（SPEC §8.6）・見開き・写真。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
//  - ノート（source が note の資料）：最後のページの右下の外に「＋ ページを追加」「− 最後のページを消す」。
//    足すと下に新しいページが増える（開き直さない。取り消しの履歴・持っているペンもそのまま。v0.14.2）
//  - ノートは、筆箱の最初のペンを持って開く。ツールバーの名前は「授業 第n回 … ノート」。「📄 資料」で同じ回の PDF を開く・横に並べる
//  - 見開き（片開き／両開き）：ツールバーのボタンで 2 ページずつ横に並べる（資料ごとに覚える）
//  - 写真：ツールバーの「写真」・貼り付け（⌘V）・ページへのドラッグで貼る（貼りもの style.type 'photo'）。選ぶと「↻ 回す」
//  - PDF を見ながら、同じ回のノートを「ノート」で開く（ノートからは「← 資料へ」で戻る）
import {
  NOTE_PAPERS,
  hasNote,
  headingPng,
  noteFrom,
  noteHeading,
  notePaper,
  openNotebook,
  openNotebookSide,
  openSplit,
  removeNote,
  setNotePaper
} from '../../notebook.js';
import {esc, toast, isTyping} from '../../ui-kit.js';
import {navigate, state} from '../../store.js';
import {KIND_OF, itemOf} from '../../../shared/stationery.js';
import {MOD, key} from './shared.js';

const api = window.daigaku;
const PHOTO_PX = 2400; // 写真の長い辺（px）。これより大きければ縮める
const PHOTO_SHARE = 0.6; // 貼ったときの大きさ：ページの幅の 6 割（高さは半分）まで
const HINT_KEY = 'note.hinted';

const spreadKey = (id) => `viewer.spread.${id}`;
// 窓の中に並べた画面（#/split の左右の iframe。app.js の pane=embed）
const isSide = () => document.documentElement.dataset.pane === 'embed';

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
    // 窓の中に並べた画面（pane=embed）では、ノートを開くボタン・戻るボタン・資料のメニューは出さず、「← 授業へ」は「閉じる」（並べるのをやめて、もう片方だけにする）にする
    const side = isSide();
    const nb = this.$('notebook');
    nb.hidden = side || this.isNote || !material.round_id;
    this.$('note-side').hidden = nb.hidden;
    this.$('note-pdfs').hidden = side || !this.isNote || !this.roundPdfs().length;
    if (side) {
      this.$('back').textContent = '閉じる';
      this.$('back').title = '並べるのをやめる（もう片方を窓いっぱいに出す）';
    }
    const from = this.isNote && !side ? noteFrom(this.materialId) : null;
    const back = this.$('note-back');
    back.hidden = !from;
    back.dataset.id = from ?? '';
  },

  /** ノートの名前（ツールバー・窓の題）：「経済学原論　第3回　…　ノート」。ノートでなければ・分からなければ null（ファイルの名前のまま） */
  noteName() {
    const m = this.material;
    if (!this.isNote || !m?.course_id) return null;
    const head = noteHeading(m.course_id, m.round_id);
    return head ? `${head}　ノート` : null;
  },

  /**
   * ノートの上の欄の字が今の授業・回・題・日付と違えば、メインでノートを描き直す（回の題や日付が同期で変わったとき）。
   * ページを並べる前に呼ぶ。戻り：描き直した元の写し（bytes）か null（そのまま）
   */
  async refreshNoteHeader() {
    const m = this.material;
    if (!this.isNote || !m?.course_id) return null;
    const text = noteHeading(m.course_id, m.round_id);
    if (!text) return null;
    try {
      const r = await api['note.setHeader']({materialId: this.materialId, text, header: await headingPng(text)});
      return r?.changed ? r.bytes : null;
    } catch {
      return null; // 描き直せなくても、前の欄のまま開ける
    }
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
        `ノートはペンを持って開きます。ページは右下の「＋ ページを追加」で下に増やせます。写真は貼り付け（${key(MOD, 'V')}）やドラッグでも貼れます`,
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

  /**
   * ツールバーのボタンの下に小さなメニューを出す（「📄 資料」・ノートの紙を選ぶ）。html はメニューの中身、onPick(押したボタン)。
   * 外を押す・Esc で閉じる（Esc はメニューだけ閉じ、持っている道具はそのまま）
   */
  openBarMenu(btn, label, html, onPick) {
    this.closeBarMenu();
    const menu = document.createElement('div');
    menu.className = 'card-menu viewer-pdfmenu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);
    menu.innerHTML = html;
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    const {width, height} = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
    // 下に入りきらなければ、ボタンの上に出す（ノートの最後のページの下の「紙を変える…」など）
    const below = r.bottom + 4 + height <= window.innerHeight - 8;
    menu.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - height - 4)}px`;
    menu.querySelector('button')?.focus();
    this.barMenu = menu;
    this.barMenuFor = btn;
    menu.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.closeBarMenu();
      onPick(b);
    };
    const off = (e) => {
      if (e.type === 'keydown') {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        e.preventDefault();
        this.closeBarMenu();
      } else if (!menu.contains(e.target) && !btn.contains(e.target)) this.closeBarMenu();
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', off, true);
      document.addEventListener('keydown', off, true);
    });
    this.offBarMenu = () => {
      document.removeEventListener('pointerdown', off, true);
      document.removeEventListener('keydown', off, true);
    };
  },
  closeBarMenu() {
    this.offBarMenu?.();
    this.offBarMenu = null;
    this.barMenu?.remove();
    this.barMenu = null;
    this.barMenuFor = null;
  },
  /** ツールバーのボタンでメニューを開く・同じボタンをもう一度押すと閉じる */
  toggleBarMenu(btn, open) {
    if (this.barMenu && this.barMenuFor === btn) this.closeBarMenu();
    else open();
  },

  /** 「📄 資料」：同じ回の PDF を開く・横に並べる */
  openPdfMenu(btn) {
    const list = this.roundPdfs();
    if (!list.length) return toast('この回には PDF の資料がありません');
    const html = list
      .map(
        (x) =>
          `<div class="viewer-pdfmenu__row"><span class="viewer-pdfmenu__name" title="${esc(x.name)}">${esc(x.name)}</span>` +
          `<button type="button" role="menuitem" data-pdf-open="${x.id}">開く</button>` +
          `<button type="button" role="menuitem" data-pdf-side="${x.id}" title="同じ窓の中で、PDF を左・このノートを右に並べて開く（両方に同時に書けます）">◫ 横に並べる</button></div>`
      )
      .join('');
    this.openBarMenu(btn, '同じ回の資料', html, async (b) => {
      await this.settle();
      if (b.dataset.pdfOpen) navigate(`/viewer/${b.dataset.pdfOpen}`);
      else if (b.dataset.pdfSide) openSplit(b.dataset.pdfSide, this.materialId);
    });
  },

  /**
   * 同じ回のノートを開く・横に並べる（「📓 ノート」「◫ 横に並べる」）。まだノートがなければ、授業画面の「＋ ノート」と同じく紙を選んでから作る
   * （選んだ紙は次の初期値）。あれば、すぐ開く
   */
  roundNote(btn, side) {
    const {course_id: courseId, round_id: roundId} = this.material;
    const go = async (paper) => {
      await this.settle();
      if (side) await openNotebookSide(courseId, roundId, {paper, from: this.materialId});
      else await openNotebook(courseId, roundId, {from: this.materialId, paper});
    };
    if (hasNote(courseId, roundId)) return go(undefined);
    const cur = notePaper().key;
    const html = NOTE_PAPERS.map(
      (p) =>
        `<button type="button" role="menuitem" data-paper="${p.key}">${p.key === cur ? '✓ ' : '　 '}${esc(p.label)}</button>`
    ).join('');
    this.toggleBarMenu(btn, () =>
      this.openBarMenu(btn, 'ノートの紙', html, (b) => {
        setNotePaper(b.dataset.paper);
        go(NOTE_PAPERS.find((p) => p.key === b.dataset.paper));
      })
    );
  },

  /** ノートの最後のページの右下の外に「＋ ページを追加」（2 ページ以上なら「− 最後のページを消す」も）を置く（ページを並べたあと） */
  mountAddPage() {
    this.addPageBox?.remove();
    if (!this.isNote) return;
    const box = document.createElement('div');
    box.className = 'viewer-addpage';
    box.innerHTML =
      '<button type="button" class="btn btn--small btn--quiet viewer-addpage__paper" data-v="note-paper" aria-haspopup="menu" title="このノートの紙（横罫・方眼、行の間）を変える。書いたものはそのまま">紙を変える…</button>' +
      '<button type="button" class="btn btn--small btn--quiet viewer-addpage__delete" data-v="delete-note" title="このノートを削除する（ファイルはパソコンのゴミ箱へ）">ノートを削除…</button>' +
      '<button type="button" class="btn btn--small btn--quiet" data-v="remove-page" title="最後のページを消す（何も書いていない白紙のときだけ。↶ で戻せます）">− 最後のページを消す</button>' +
      '<button type="button" class="btn btn--small" data-v="add-page" title="ノートの最後に白いページを 1 枚足す（下に増えます。↶ で取り消せます）">＋ ページを追加</button>';
    this.pagesEl.append(box);
    this.addPageBox = box;
    this.on(box, 'click', (e) => {
      const v = e.target.closest('[data-v]')?.dataset.v;
      if (v === 'add-page') this.addNotePage();
      else if (v === 'remove-page') this.removeNotePage();
      else if (v === 'delete-note') this.deleteNote();
      else if (v === 'note-paper') {
        const b = e.target.closest('[data-v]');
        this.toggleBarMenu(b, () => this.openPaperMenu(b));
      }
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
   * record：取り消しの履歴に積む（↶ で消せる）。取り消し・やり直しから呼ぶときは false。戻り：足せたか
   */
  async addNotePage({record = true, auto = false} = {}) {
    if (this.pageBusy) return false;
    this.pageBusy = true;
    this.busyAddPage(true);
    try {
      await this.settle();
      const r = await api['note.addPage']({materialId: this.materialId});
      if (r?.error) {
        toast(r.error, {error: true});
        return false;
      }
      const last = await this.appendNotePages(r.bytes, r.pages);
      if (!last) return false;
      if (record) this.pushStep({notePage: 'add'});
      // 書いている途中に足したとき（auto）は、見ている場所を動かさない
      if (auto) toast(`下のほうまで書いたので、ページを足しました（${this.pages.length} ページ。↶ で取り消せます）`);
      else {
        last.el.scrollIntoView({block: 'center', behavior: 'smooth'});
        toast(`ページを足しました（${this.pages.length} ページ）`);
      }
      return true;
    } catch (e) {
      toast(`ページを足せませんでした（${e.message}）`, {error: true});
      return false;
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

  /** ノートの最後のページの下のほう（下から 12%）まで書いたら、次の白いページを足す（ペンの線を書き終えたとき。viewer/ink.js） */
  autoNotePage(a) {
    if (!this.isNote || this.pageBusy || a?.page !== this.pages.length || !a.rect) return;
    const h = this.pages.at(-1).page.getViewport({scale: 1}).height;
    if (a.rect.y <= h * 0.12) this.addNotePage({auto: true});
  },

  /** 「紙を変える…」：横罫・方眼、行の間 6・7 mm から選ぶ（今の紙に ✓）。書いたものはそのまま */
  openPaperMenu(btn) {
    const cur = this.notePaperNow?.v === 2 ? `${this.notePaperNow.type}-${this.notePaperNow.gap}` : null;
    const html =
      (cur ? '' : '<p class="viewer-pdfmenu__note">いまは前の版の紙（テンプレートの見た目）です</p>') +
      NOTE_PAPERS.map(
        (p) =>
          `<button type="button" role="menuitem" data-paper="${p.key}">${p.key === cur ? '✓ ' : '　 '}${esc(p.label)}</button>`
      ).join('');
    this.openBarMenu(btn, 'ノートの紙を変える', html, (b) => {
      if (b.dataset.paper && b.dataset.paper !== cur)
        this.changeNotePaper(NOTE_PAPERS.find((p) => p.key === b.dataset.paper));
    });
  },

  /** ノートの紙を変える：メインで描き直し、画面のページの絵を入れ替える（書いたもの・取り消しの履歴・ペンはそのまま） */
  async changeNotePaper(paper) {
    if (!paper || this.pageBusy) return;
    this.pageBusy = true;
    this.busyAddPage(true);
    try {
      await this.settle();
      const r = await api['note.setPaper']({materialId: this.materialId, paper: {type: paper.type, gap: paper.gap}});
      if (r?.error) return toast(r.error, {error: true});
      await this.replaceNoteDoc(r.bytes, r.pages);
      this.notePaperNow = r.paper;
      toast(`紙を「${paper.label}」に変えました`);
    } catch (e) {
      toast(`紙を変えられませんでした（${e.message}）`, {error: true});
    } finally {
      this.pageBusy = false;
      if (!this.destroyed) this.busyAddPage(false);
    }
  },

  /** 描き直したノート（bytes。全部で pages ページ）に、画面のページの絵を入れ替える（並びと書いたものはそのまま） */
  async replaceNoteDoc(bytes, pages) {
    if (this.destroyed) return;
    const task = this.loadDoc(bytes);
    (this.noteTasks ??= []).push(task);
    const doc = await task.promise;
    if (this.destroyed) return;
    if (pages < this.pages.length) this.dropNotePages(pages);
    for (const p of this.pages) {
      if (p.num > doc.numPages) break;
      p.renderTask?.cancel();
      p.page = await doc.getPage(p.num);
      p.textContent = null;
      p.findChars = null;
      this.sizePage(p);
    }
    if (pages > this.pages.length) await this.appendNotePages(bytes, pages);
    this.markDirty();
  },

  /** 画面のページを n ページまで減らす（最後から） */
  dropNotePages(n) {
    while (this.pages.length > Math.max(1, n)) {
      const p = this.pages.pop();
      this.observer?.unobserve(p.el);
      p.renderTask?.cancel();
      p.el.remove();
    }
    this.numberPages();
    this.sizeAddPage();
  },

  /**
   * ほかの窓・スマホでノートのページを足し引きしたとき（note.pages）：開いているこの画面もそろえる。
   * 足したときは新しい元の写し（bytes）が来る。消したときは pages だけ
   */
  bindNotePages() {
    const off = api.on?.('note.pages', ({materialId, pages, bytes, replace = false, paper = null}) => {
      if (materialId !== this.materialId || !this.isNote || this.destroyed || this.pageBusy) return;
      if (replace && bytes) {
        if (paper) this.notePaperNow = paper;
        this.replaceNoteDoc(bytes, pages).catch(() => {});
      } else if (bytes && pages > this.pages.length)
        this.appendNotePages(bytes, pages)
          .then((last) => last && toast(`ほかの所でページが足されました（${this.pages.length} ページ）`))
          .catch(() => {});
      else if (pages < this.pages.length) {
        this.dropNotePages(pages);
        this.dropStepsAfter(pages);
        this.markDirty();
      }
    });
    if (off) this.listeners.push(off);
  },

  /**
   * ノートの最後のページを消す（何も書いていない・付箋もない白紙のときだけ。1 ページは残す）。
   * record：取り消しの履歴に積む（↶ で白いページが戻る）。取り消しから呼ぶときは false（後ろのやり直しの手は捨てない）。戻り：消せたか
   */
  async removeNotePage({record = true} = {}) {
    if (this.pageBusy || this.pages.length < 2) return false;
    const n = this.pages.length;
    if ([...this.annos.values()].some((a) => !a.removed && a.page === n)) {
      toast('最後のページに書いたもの・貼ったものがあるため消せません（先に消してください）', {error: true});
      return false;
    }
    this.pageBusy = true;
    this.busyAddPage(true);
    try {
      await this.settle();
      const r = await api['note.removePage']({materialId: this.materialId});
      if (r?.error) {
        toast(r.error, {error: true});
        return false;
      }
      if (this.destroyed) return false;
      this.dropNotePages(r.pages);
      if (record) {
        this.dropStepsAfter(r.pages);
        this.pushStep({notePage: 'remove'});
      }
      this.markDirty();
      toast(`最後のページを消しました（${this.pages.length} ページ）`);
      return true;
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

  /**
   * 取り消し・やり直しのページの足し引き（history.js）：dir は 'undo' か 'redo'。
   * 足した手を取り消す＝最後のページを消す、消した手を取り消す＝白いページを足す。戻り：できたか
   */
  async replayNotePage(step, dir) {
    const add = (step.notePage === 'add') === (dir === 'redo');
    return add ? this.addNotePage({record: false}) : this.removeNotePage({record: false});
  },

  /**
   * このノートを削除する（確かめてから）。先に書いたものをファイルに描き込んで保存し、削除したら授業の画面へ戻る
   * （横に並べた窓なら閉じる）。ほかの窓で同じノートを開いていれば、その窓も閉じる（note.removed）
   */
  async deleteNote() {
    if (!this.isNote || this.pageBusy) return;
    await this.settle();
    await this.saveFile();
    this.fileBlocked = true; // 消している間・消したあとに上書き保存しない
    const ok = await removeNote(this.materialId, this.material?.name);
    if (!ok) {
      this.fileBlocked = false;
      return;
    }
    this.fileDirty = false;
    this.onBack();
  },

  /** ほかの窓・授業の画面でこのノートが削除されたとき：保存を止めて閉じる */
  bindNoteRemoved() {
    const off = api.on?.('note.removed', ({materialId}) => {
      if (materialId !== this.materialId || this.destroyed) return;
      this.fileBlocked = true;
      this.fileDirty = false;
      toast('このノートは削除されました');
      this.onBack();
    });
    if (off) this.listeners.push(off);
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
