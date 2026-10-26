// PDF の編集画面：キーボード。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
import {isTyping} from '../../ui-kit.js';
import {IS_MAC} from './shared.js';

export const methods = {
  /**
   * キーボード（SPEC §9.5）。ショートカットは ⌘（Windows・Linux は Ctrl）＋キーだけ。1 文字のショートカットはない。
   * 文字を打っている間（入力欄・メモの本文・文字入れの編集中・日本語入力の変換中）は、Esc 以外は何もしない
   */
  onKey(e) {
    const t = e.target;
    if (this.$('export-dialog')?.open) return; // 書き出しの窓が開いている間は効かせない
    if (isTyping(e)) {
      if (e.key === 'Escape' && t.tagName === 'TEXTAREA') {
        const a = this.annoOf(t);
        if (a) this.openNote(a, false);
      }
      return;
    }
    const k = e.key.toLowerCase();
    // ⌘／Ctrl ＋ キー。Mac では Ctrl、Windows では Win キーの組み合わせは使わない
    const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (mod && !e.altKey) {
      const shift = e.shiftKey;
      if (k === 'z' && !shift) this.undo();
      else if ((k === 'z' && shift) || (k === 'y' && !shift)) this.redo();
      else if (k === 'e' && shift) this.openExport();
      else if (k === 'e') this.setTool('eraser');
      else if (k === 's' && !shift) this.saveFile({manual: true});
      else if (k === 't' && !shift) this.setTool('text');
      else if (k === 'm' && !shift) this.setTool('note');
      else if ((k === 'k' && !shift) || (k === 'h' && shift))
        this.useHider(); // ⌘K（前の ⇧⌘H も）
      else if (k === 'b' && !shift) {
        // 太字：文字入れを選んでいる（または文字入れの道具）のときだけ
        if (this.selected?.kind === 'text' || this.tool === 'text')
          this.setTextStyle({bold: !(this.selected?.kind === 'text' ? this.selected.style : this.textStyle).bold});
        else return;
      } else if (k === 'd' && !shift) this.toggleCalc();
      else if (k === 'd' && shift) this.addBookmark();
      else if (k === 'r' && !shift) this.toggleSheet();
      else if (k === '/' || e.key === '?') this.openHelp(this.$('help-panel').hidden);
      else if (/^[1-6]$/.test(e.key) && !shift) this.useSlot(Number(e.key) - 1);
      else return;
      return e.preventDefault();
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      this.openHelp(false);
      this.openCase(false);
      this.openCorner(null);
      this.select(null);
      this.setTool('select');
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      e.preventDefault();
      this.removeAnno(this.selected);
    } else if (e.key === 'Enter' && this.selected && this.annoOf(t) === this.selected) {
      // フォーカスのある注釈で Enter：文字入れは直す、メモは開く（マウスで押したときと同じ）
      const a = this.selected;
      if (a.kind === 'text') {
        e.preventDefault();
        this.edit(a);
      } else if (a.kind === 'note') {
        e.preventDefault();
        this.openNote(a, true);
      }
    }
  }
};
