// ノートの試し書き（docs/SPEC-NOTEBOOK.md §2）：ショップのノートの詳細ページと、マイノートの調節の画面の「試し書き」から、
// その紙を本物の PDF の編集画面で開く（筆箱のペン・マーカー・文字・付箋・写真・拡大縮小など、編集画面でできることはすべてできる）。
// 紙と書いたものはメインのメモリの中だけに持ち、保存しない（main/trial-note.js）。閉じると開いてきた画面へ戻る
import {toast} from '../ui-kit.js';
import {navigate} from '../store.js';

const api = window.daigaku;
export const TRIAL_ID = 'trial';
const BACK_KEY = 'nb.trial.back';

/** 試し書きを開く。title は編集画面に出す名前 */
export async function openNoteTry(design, title) {
  const r = await api['note.trial']({design, name: `試し書き：${title}`});
  if (r?.error) return toast(r.error, {error: true});
  try {
    sessionStorage.setItem(BACK_KEY, location.hash.replace(/^#/, '') || '/');
  } catch {
    // 覚えられなければ、閉じたらホームへ戻る
  }
  navigate(`/viewer/${TRIAL_ID}`);
}

/** 試し書きを閉じる：メモリの紙と書いたものを捨てて、開いてきた画面へ戻る */
export function closeNoteTry() {
  api['note.trialEnd']({}).catch(() => {});
  let back = '/';
  try {
    back = sessionStorage.getItem(BACK_KEY) || '/';
  } catch {
    back = '/';
  }
  navigate(back);
}
