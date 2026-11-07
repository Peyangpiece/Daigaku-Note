// ノートの試し書き（docs/SPEC-NOTEBOOK.md §2）：ショップのノート・マイノートの紙を、本物の PDF の編集画面で開いて書ける。
// 紙の PDF と書いたもの（注釈・付箋）はメモリの中だけに持ち、ファイルにも DB にも残さない（試し書きを閉じる・次の試し書きを始めると消える）。
// 編集画面は資料の id のかわりに TRIAL_ID で開き、ipc/pdf.js・ipc/notes.js はこの id のときだけここへ回す
import {ulid} from '../shared/ids.js';
import {annotationToClient, normalizeAnnotation} from '../shared/annotation.js';
import {normalizeBookmark} from '../shared/bookmark.js';
import {appendNotePage, cleanPaper, createNotePdf, rebuildNotePdf, removeLastNotePage} from './note-pdf.js';

export const TRIAL_ID = 'trial';
export const isTrial = (materialId) => materialId === TRIAL_ID;

let t = null; // {name, design, base, pages, annos: Map(id → 行), books: Map(id → しおり)}

const asBytes = (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const need = () => {
  if (!t) throw new Error('試し書きを開き直してください');
  return t;
};
const bookToClient = ({id, page, y, name}) => ({id, page, y, name});

/** 試し書きを始める（前の試し書きは捨てる）。design は v3 の紙の設定 */
export async function startTrial(design, name) {
  const d = cleanPaper({...(design && typeof design === 'object' ? design : {}), v: 3});
  const base = await createNotePdf(d, {title: String(name ?? '試し書き').slice(0, 100)});
  t = {name: String(name ?? '試し書き').slice(0, 100), design: d, base, pages: 1, annos: new Map(), books: new Map()};
  return {ok: true};
}

export function endTrial() {
  t = null;
}

/** pdf.open と同じ形 */
export function openTrial() {
  const s = need();
  return {
    material: {id: TRIAL_ID, name: s.name, course_id: null, round_id: null, source: 'note', trial: true},
    paper: s.design,
    bytes: asBytes(s.base),
    annotations: [...s.annos.values()].map(annotationToClient),
    bookmarks: [...s.books.values()].map(bookToClient),
    rebased: false,
    textStyle: null,
    stale: false
  };
}

export function trialAnnotations() {
  return [...need().annos.values()].map(annotationToClient);
}

export function saveTrialAnnotation(annotation) {
  const s = need();
  const row = normalizeAnnotation(annotation, {pageCount: s.pages});
  const id = annotation?.id;
  if (id != null) {
    const cur = s.annos.get(id);
    if (!cur) throw new Error('注釈がありません');
    const next = {...cur, ...row};
    s.annos.set(id, next);
    return annotationToClient(next);
  }
  const z = Math.max(0, ...[...s.annos.values()].filter((a) => a.page === row.page).map((a) => a.z)) + 1;
  const next = {id: ulid(), z, ...row};
  s.annos.set(next.id, next);
  return annotationToClient(next);
}

export function removeTrialAnnotation(id) {
  need().annos.delete(id);
}

export function saveTrialBookmark(bookmark) {
  const s = need();
  const row = normalizeBookmark(bookmark, {pages: s.pages});
  const id = bookmark?.id ?? ulid();
  if (bookmark?.id != null && !s.books.has(id)) throw new Error('付箋がありません');
  s.books.set(id, {id, ...row});
  return bookToClient(s.books.get(id));
}

export function removeTrialBookmark(id) {
  need().books.delete(id);
}

/** ページを足す。戻り {pages, bytes} */
export async function addTrialPage() {
  const s = need();
  const r = await appendNotePage(s.base, s.design);
  s.base = r.bytes;
  s.pages = r.pages;
  return {pages: r.pages, bytes: asBytes(r.bytes)};
}

/** 最後のページを消す（書いたもの・付箋があれば消さない）。戻り {pages} */
export async function removeTrialPage() {
  const s = need();
  const last = s.pages;
  if ([...s.annos.values()].some((a) => a.page === last) || [...s.books.values()].some((b) => b.page === last))
    throw new Error('最後のページに書いたもの・付箋があるため消せません');
  const r = await removeLastNotePage(s.base);
  s.base = r.bytes;
  s.pages = r.pages;
  return {pages: r.pages};
}

/** 紙を変える。戻り {pages, bytes, paper} */
export async function setTrialPaper(paper) {
  const s = need();
  const d = cleanPaper(paper);
  const r = await rebuildNotePdf(s.base, d);
  s.base = r.bytes;
  s.design = d;
  return {pages: r.pages, bytes: asBytes(r.bytes), paper: d};
}

/** 書き出し（注釈を描き込んだ PDF を作る）に使う元の紙と注釈 */
export function trialForExport() {
  const s = need();
  return {base: s.base, rows: [...s.annos.values()].map(annotationToClient), name: s.name};
}
