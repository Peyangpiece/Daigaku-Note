// IPC の窓口が共通で使う小さな検査と場所（index.js と各 register から）。副作用なし
import {app} from 'electron';
import path from 'node:path';
import {isUlid} from '../../shared/ids.js';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

export const str = (v, max = 500) => (typeof v === 'string' && v.length <= max ? v : null);
export const id = (v) => (isUlid(v) ? v : null);
export const httpsUrl = (v) => {
  try {
    const u = new URL(String(v));
    return u.protocol === 'https:' || (u.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(u.hostname))
      ? u.toString()
      : null;
  } catch {
    return null;
  }
};
export const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // src/main
export const PDFJS_DIR = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
export const PDFJS_ASSET = {cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm'};
export const loginItem = () => {
  const available = app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');
  return {available, on: available && app.getLoginItemSettings().openAtLogin === true};
};
export const FOLDER_LOOK_PARTS = ['tab', 'card', 'tape', 'badge'];
export const bad = (msg) => {
  throw new Error(msg);
};
export function reviewSummary(quiz) {
  const r = quiz.review();
  return {reviewDue: r.questions.length, reviewNext: r.next};
}
/** id の一覧（最大 max 個。ULID でないものは捨てる） */
export const ids = (list, max = 50) =>
  Array.isArray(list) ? list.slice(0, max).map((x) => id(x) ?? bad('ID が不正です')) : bad('ID の一覧が不正です');
