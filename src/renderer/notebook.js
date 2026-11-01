// 授業の回のノート（SPEC §8.6）を開く。なければ作る（A4 縦の白紙の PDF。紙と罫線は今のテンプレートのノートの見た目）。
// 授業ページの回の付箋の「＋ ノート」と、PDF の編集画面の「ノート」から使う
import {toast} from './ui-kit.js';
import {navigate, reload, state} from './store.js';
import {skinOf} from './skin.js';

const api = window.daigaku;

/** 今のテンプレートのノートの見た目（紙・線が「はじめの色」なら default のまま渡す。メインで明るい表示の色にする） */
export function noteDesign() {
  const n = skinOf(state.data).note;
  return {type: n.type, paper: n.paper, line: n.line, gap: n.gap, margin: n.margin};
}

/** PDF の編集画面から開いたノートの、戻り先の資料（このパソコンの今の窓のあいだだけ覚える） */
export const noteFrom = (noteId) => {
  try {
    return sessionStorage.getItem(`note.from.${noteId}`);
  } catch {
    return null;
  }
};

/** 回のノートを開く（なければ作る）。from は戻り先の資料の id（PDF の編集画面から開いたとき） */
export async function openNotebook(courseId, roundId, {from = null} = {}) {
  const r = await api['note.open']({courseId, roundId, design: noteDesign()});
  if (r?.error) return toast(r.error, {error: true});
  try {
    if (from) sessionStorage.setItem(`note.from.${r.materialId}`, from);
    else sessionStorage.removeItem(`note.from.${r.materialId}`);
  } catch {
    // 覚えられなくても開ける（戻るボタンが出ないだけ）
  }
  if (r.created) {
    await reload(); // 編集画面が授業を見つけられるように、新しいノートを読み直してから開く
    toast('ノートを作りました（A4 縦。紙と罫線は今のテンプレートのもの）');
  }
  navigate(`/viewer/${r.materialId}`);
}

/**
 * 回のノートを横に並べる窓で開く（なければ作る）。元の窓は画面の左半分、ノートは右半分になり、両方に同時に書ける
 */
export async function openNotebookSide(courseId, roundId) {
  const r = await api['note.open']({courseId, roundId, design: noteDesign()});
  if (r?.error) return toast(r.error, {error: true});
  if (r.created) await reload();
  const w = await api['window.openSide']({materialId: r.materialId});
  if (w?.error) toast(w.error, {error: true});
}
