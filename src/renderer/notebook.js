// 授業の回のノート（SPEC §8.6）を開く。なければ作る（A4 縦の白紙の PDF。白い紙に青い罫線。横罫・方眼、行の間 6・7 mm）。
// 授業ページの回の付箋の「＋ ノート」（紙を選ぶ）と、PDF の編集画面の「ノート」「横に並べる」（前に選んだ紙）から使う
import {confirmDialog, toast} from './ui-kit.js';
import {navigate, reload, state} from './store.js';

const api = window.daigaku;

// ノートの紙の選び方（このパソコンに覚える。前に選んだものが次の初期値）
export const NOTE_PAPERS = [
  {key: 'ruled-6', type: 'ruled', gap: 6, label: '横罫 6 mm（B 罫）'},
  {key: 'ruled-7', type: 'ruled', gap: 7, label: '横罫 7 mm（A 罫）'},
  {key: 'grid-6', type: 'grid', gap: 6, label: '方眼 6 mm'},
  {key: 'grid-7', type: 'grid', gap: 7, label: '方眼 7 mm'}
];
const PAPER_KEY = 'note.paper';

/** 前に選んだ紙（なければ横罫 6 mm） */
export function notePaper() {
  try {
    const k = localStorage.getItem(PAPER_KEY);
    return NOTE_PAPERS.find((p) => p.key === k) ?? NOTE_PAPERS[0];
  } catch {
    return NOTE_PAPERS[0];
  }
}
export function setNotePaper(key) {
  try {
    localStorage.setItem(PAPER_KEY, key);
  } catch {
    // 覚えられなくても作れる
  }
}

/** 回の日付（M/D（曜））と、ノートの上の欄の言葉（授業・回・題・日付） */
const fmtDate = (d) =>
  d
    ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${'日月火水木金土'[new Date(d + 'T00:00:00').getDay()]}）`
    : '';
export function noteHeading(courseId, roundId) {
  const course = state.data?.courses?.find((c) => c.id === courseId);
  const round = (state.data?.rounds?.[courseId] ?? []).find((r) => r.id === roundId);
  const parts = [course?.name ?? ''];
  // 自分のフォルダは回を分けない（回の「その他」は出さない）
  // 自分で足した付箋は題だけ（第何回・日付は出さない）
  if (round?.user_made && course?.kind !== 'folder') parts.push(round.title_user || '');
  else if (round && course?.kind !== 'folder')
    parts.push(
      round.number > 0 ? `第${round.number}回` : round.title_user || 'その他',
      round.number > 0 ? round.title_user || round.title || '' : '',
      fmtDate(round.date)
    );
  return parts.filter(Boolean).join('　');
}

/**
 * ノートの上の欄に印刷する画像（PNG）：薄い灰色の字（罫線の題の欄の線と同じ色。v0.17.9 までは青）で授業・回・題・日付。PDF に日本語のフォントを入れないよう、画面のフォントで描く
 */
export async function headingPng(text) {
  if (!text) return null;
  const px = 72; // 字の大きさ（画像の px。PDF では 5.2 mm の高さに縮める）
  const font = `500 ${px}px 'Noto Sans JP', sans-serif`;
  await document.fonts.load(font).catch(() => {});
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font;
  c.width = Math.min(6000, Math.ceil(ctx.measureText(text).width) + 8);
  c.height = Math.round(px * 1.35);
  ctx.font = font;
  ctx.fillStyle = '#7f94ad';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 4, c.height / 2);
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** 回のノートがもうあるか（PDF の編集画面の「📓 ノート」「◫ 横に並べる」：なければ紙を選んでから作る） */
export function hasNote(courseId, roundId) {
  return (state.data?.materials?.[courseId] ?? []).some(
    (m) => m.source === 'note' && (m.round_id ?? null) === (roundId ?? null) && m.status === 'ok' && !m.copyOf
  );
}

/** PDF の編集画面から開いたノートの、戻り先の資料（このパソコンの今の窓のあいだだけ覚える） */
export const noteFrom = (noteId) => {
  try {
    return sessionStorage.getItem(`note.from.${noteId}`);
  } catch {
    return null;
  }
};

/** 回のノートを用意する（なければ作る）。戻り：{materialId, created} か null（失敗。知らせは出した） */
async function ensureNote(courseId, roundId, paper = notePaper(), sub = '') {
  const text = noteHeading(courseId, roundId);
  const r = await api['note.open']({
    courseId,
    roundId,
    sub, // 自分のフォルダの付箋（下のフォルダ）のノート
    paper: {type: paper.type, gap: paper.gap},
    header: await headingPng(text),
    headerText: text
  });
  if (r?.error) {
    toast(r.error, {error: true});
    return null;
  }
  if (r.created) {
    await reload(); // 編集画面が授業を見つけられるように、新しいノートを読み直してから開く
    toast(`ノートを作りました（${paper.label}）`);
  }
  return r;
}

/** 回のノートを開く（なければ作る）。from は戻り先の資料の id（PDF の編集画面から開いたとき）。paper は作るときの紙 */
export async function openNotebook(courseId, roundId, {from = null, paper = undefined, sub = ''} = {}) {
  const r = await ensureNote(courseId, roundId, paper, sub);
  if (!r) return;
  try {
    if (from) sessionStorage.setItem(`note.from.${r.materialId}`, from);
    else sessionStorage.removeItem(`note.from.${r.materialId}`);
  } catch {
    // 覚えられなくても開ける（戻るボタンが出ないだけ）
  }
  navigate(`/viewer/${r.materialId}`);
}

/**
 * 回のノートを PDF の右に並べて開く（なければ作る）。同じ窓の中で左に PDF（from）、右にノートを出し、両方に同時に書ける（#/split）
 */
export async function openNotebookSide(courseId, roundId, {paper = undefined, from} = {}) {
  const r = await ensureNote(courseId, roundId, paper);
  if (!r) return;
  openSplit(from, r.materialId);
}

/** 窓の中で PDF（左）とノート（右）を並べる */
export function openSplit(leftId, rightId) {
  if (!leftId || !rightId || leftId === rightId) return;
  navigate(`/split/${leftId}/${rightId}`);
}

/**
 * ノートを削除する（確かめてから）。ファイルはパソコンのゴミ箱へ移し、アプリの中の書き込み・付箋・紙の設定は消す。
 * 書いたものは上書き保存でファイルに描き込まれているので、ゴミ箱から戻せば中身は見られる。戻り：削除したか
 */
export async function removeNote(id, name) {
  const label = String(name ?? 'ノート').replace(/\.pdf$/i, '');
  const ok = await confirmDialog(
    `「${label}」を削除しますか？ ファイルはパソコンのゴミ箱へ移します（書いたものはファイルに描き込まれたまま残ります）。アプリの中の書き込み・付箋は元に戻せません。`,
    {ok: '削除する', danger: true}
  );
  if (!ok) return false;
  const r = await api['material.remove']({materialId: id});
  if (r?.error) {
    toast(r.error, {error: true});
    return false;
  }
  toast('ノートを削除しました（ファイルはパソコンのゴミ箱にあります）');
  await reload();
  return true;
}
