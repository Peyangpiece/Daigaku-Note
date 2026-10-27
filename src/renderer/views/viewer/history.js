// PDF の編集画面：保存（自動保存・取り消し・やり直し・失敗の再試行）。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
import {toast} from '../../ui-kit.js';
import {api, HISTORY_MAX} from './shared.js';

export const methods = {
  // ---- 保存（§9.1：変更から少し待って自動で保存。注釈ごとに順番を守る）----
  scheduleSave(a, delay = 600) {
    if (a.removed) return;
    clearTimeout(a.timer);
    this.setStatus('saving');
    a.timer = setTimeout(() => this.flush(a), delay);
  },

  flush(a) {
    clearTimeout(a.timer);
    a.timer = null;
    if (a.removed) return;
    this.track(a, async () => {
      if (a.removed) return;
      const r = await api['annotation.save']({
        materialId: this.materialId,
        annotation: {id: a.id ?? null, page: a.page, kind: a.kind, rect: {...a.rect}, body: a.body, style: {...a.style}}
      });
      if (r?.error) throw new Error(r.error);
      a.id = r.annotation.id;
      if (a.removed && !a.removedOnServer) {
        // 保存中に消された
        a.removedOnServer = true;
        await api['annotation.remove']({materialId: this.materialId, annotationId: a.id});
      }
    });
  },

  track(a, fn) {
    this.inflight++;
    this.setStatus('saving');
    const chain = (a.chain = (a.chain ?? Promise.resolve())
      .then(fn)
      .then(
        () => {
          this.failed = false;
          this.markDirty();
        },
        (e) => {
          this.failed = true;
          console.error(e);
          this.saveFailed(a, e);
        }
      )
      .finally(() => {
        this.inflight--;
        this.chains.delete(chain);
        this.setStatus();
      }));
    this.chains.add(chain);
  },

  /** 保存待ち・保存中をすべて終わらせる */
  async settle() {
    this.flushAll();
    while (this.chains.size) await Promise.allSettled([...this.chains]);
    return !this.failed;
  },

  // ---- 取り消し・やり直し（§9.1）。1 手 = ある注釈の「前」と「後」の写し。null は「ない」 ----
  snap(a) {
    if (!a || a.removed) return null;
    return structuredClone({page: a.page, kind: a.kind, rect: a.rect, body: a.body, style: a.style});
  },

  record(key, before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.pushStep({key, before, after});
  },

  /** いくつかの注釈の変更を 1 手にまとめる（消しゴムでひとなぞりに消した線など）。steps は {key, before, after} の並び */
  recordGroup(steps) {
    if (steps.length === 1) return this.record(steps[0].key, steps[0].before, steps[0].after);
    if (steps.length) this.pushStep({group: steps});
  },

  pushStep(step) {
    this.undoStack.push(step);
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
    this.redoStack = [];
    this.updateHistory();
  },

  undo() {
    this.finishEdit();
    this.figEditor?.close();
    const step = this.undoStack.pop();
    if (!step) return;
    for (const st of step.group ? [...step.group].reverse() : [step]) this.restore(st.key, st.before);
    this.redoStack.push(step);
    this.updateHistory();
  },

  redo() {
    this.finishEdit();
    this.figEditor?.close();
    const step = this.redoStack.pop();
    if (!step) return;
    for (const st of step.group ?? [step]) this.restore(st.key, st.after);
    this.undoStack.push(step);
    this.updateHistory();
  },

  /** 注釈を写しの状態に戻す。写しが null なら消し、ない注釈なら作り直す（DB には新しい行として保存） */
  restore(key, snap) {
    let a = this.annos.get(key);
    if (!snap) {
      if (a) this.removeAnno(a, false);
      return;
    }
    const data = structuredClone(snap);
    if (!a) a = this.addAnno({key, id: null, ...data});
    else {
      if (a.page !== data.page) this.mountAnno(a, this.pages[data.page - 1]);
      Object.assign(a, data);
      if (a.kind === 'text') this.renderText(a);
      else if (a.kind === 'note') a.el.querySelector('textarea').value = a.body;
      this.applyStyle(a);
      this.place(a);
    }
    if (a.kind !== 'ink') this.select(a); // ペンの線は選ばない（押しても選べないので）
    this.scheduleSave(a, 0);
  },

  updateHistory() {
    this.$('undo').disabled = !this.undoStack.length;
    this.$('redo').disabled = !this.redoStack.length;
  },

  flushAll() {
    this.finishEdit();
    for (const a of this.annos.values()) if (a.timer) this.flush(a);
  },

  /** 注釈を保存できなかったとき：原因と「もう一度」を知らせる（続けて失敗しても 10 秒に 1 回だけ） */
  saveFailed(a, e) {
    const now = Date.now();
    if (now - (this.failToastAt ?? 0) < 10000) return;
    this.failToastAt = now;
    toast('注釈を保存できませんでした', {
      error: true,
      detail: String(e?.message ?? e),
      action: {label: 'もう一度', run: () => this.retrySaves()}
    });
  },

  /** 保存できなかった注釈をもう一度保存する（右上の「保存できませんでした」を押したときも） */
  retrySaves() {
    this.failed = false;
    for (const x of this.annos.values()) if (!x.removed) this.scheduleSave(x, 0);
    if (this.fileDirty) this.saveFile();
  },

  setStatus(state) {
    const el = this.$('status');
    if (!el) return;
    const pending = state === 'saving' || this.inflight > 0 || [...this.annos.values()].some((a) => a.timer);
    el.textContent = this.failed
      ? '保存できませんでした（押すともう一度）'
      : pending || this.fileSaving || this.fileDirty
        ? '保存中…'
        : this.fileBlocked
          ? 'ファイルには保存していません'
          : this.annos.size || this.saved
            ? '保存しました'
            : '';
    if (!pending && !this.failed) this.saved = true;
    el.classList.toggle('is-error', this.failed);
  }
};
