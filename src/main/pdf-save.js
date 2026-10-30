// PDF の上書き保存。注釈を描き込んだ PDF で元のファイルを置き換え、Finder（エクスプローラー）で開いても注釈が見えるようにする。
// 注釈はアプリの中でも編集し続けられるよう、元の PDF の写しを userData/originals/<元の SHA-256>.pdf に取っておき、
// 描き込むときはいつもその写しから作る（描き込んだ PDF にもう一度描き込まない）。注釈・しおりは元の SHA-256 に結び付いたまま
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {exportAnnotatedPdf} from './pdf-export.js';
import {sha256} from './sync/files.js';

const err = (code, message) => Object.assign(new Error(message), {code});

/** 注釈・しおりの鍵（元の PDF の SHA-256） */
export const annoKey = (m) => m.base_sha256 || m.sha256;
export const originalPath = (dir, hash) => path.join(dir, `${hash}.pdf`);

const JOURNAL = 'pdf.saving'; // 置き換えている途中の記録（設定）：{資料 id: {to, base}}

/**
 * 一時ファイルに書いて、ディスクへ書き切ってから（fsync）置き換える。途中で落ちても壊れたファイルを残さず、
 * 失敗したら一時ファイルも消す。元のファイルの権限は保つ
 */
export async function replaceFile(file, data) {
  const tmp = path.join(path.dirname(file), `.daigaku-tmp-${process.pid}-${Date.now()}`);
  const mode = (await fsp.stat(file).catch(() => null))?.mode;
  try {
    const fh = await fsp.open(tmp, 'wx', mode ?? 0o644);
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, file);
  } catch (e) {
    await fsp.rm(tmp, {force: true}).catch(() => {});
    throw e;
  }
}

/**
 * 注釈を描く元の PDF。上書き保存したことがあれば取っておいた写し、なければファイルそのもの。
 * 戻り：{bytes, pristine}（pristine が false なら写しがなく、描き込み済みのファイルを返している）
 */
export async function readBase(m, originalsDir) {
  if (m.base_sha256) {
    const b = await fsp.readFile(originalPath(originalsDir, m.base_sha256)).catch(() => null);
    if (b && sha256(b) === m.base_sha256) return {bytes: b, pristine: true};
    return {bytes: await fsp.readFile(m.path), pristine: false};
  }
  return {bytes: await fsp.readFile(m.path), pristine: true};
}

/**
 * 上書き保存。annotations は annotationToClient の形、images は文字入れの PNG（id → bytes）。
 * 注釈がひとつもなければ元の PDF に戻す。戻り：{changed, sha256, size}
 */
export async function overwritePdf({repo, material, annotations, images = new Map(), originalsDir}) {
  let m = material;
  const cur = await fsp.readFile(m.path).catch(() => {
    throw err('missing', 'PDF を読めませんでした（移動または削除された可能性があります）');
  });
  // 前の上書き保存が、ファイルを置き換えたあと記録を直す前に止まっていた（アプリが落ちたなど）：記録を直して続ける。
  // 置き換える前に止まっていたなら、置き換えの記録を捨てるだけ
  const pending = repo.getSetting(JOURNAL, {})?.[m.id];
  if (pending) {
    if (sha256(cur) === pending.to) {
      m = repo.updateMaterial(m.id, {sha256: pending.to, size: cur.length, base_sha256: pending.base});
    }
    journal(repo, m.id, null);
  }
  // 大学ノートの外（プレビューなど）で変えられていたら上書きしない（その変更を消さないため）
  if (sha256(cur) !== m.sha256)
    throw err(
      'conflict',
      'PDF がほかのアプリで変更されたため上書きしませんでした。編集画面の「書き出す…」で別の名前で保存してください'
    );
  const base = annoKey(m);
  let src;
  if (m.base_sha256) {
    src = await fsp.readFile(originalPath(originalsDir, base)).catch(() => null);
    if (!src || sha256(src) !== base) throw err('no-original', '元の PDF の写しが見つからないため上書きできません');
  } else {
    src = cur;
    await fsp.mkdir(originalsDir, {recursive: true});
    const keep = originalPath(originalsDir, base);
    if (!(await fsp.stat(keep).catch(() => null))) await replaceFile(keep, src);
  }
  const out = annotations.length
    ? Buffer.from(await exportAnnotatedPdf(src, annotations, {images, markers: 'blue', notes: true}))
    : src;
  const h = sha256(out);
  if (h === m.sha256) return {changed: false, sha256: h, size: out.length};
  const next = annotations.length ? base : null;
  journal(repo, m.id, {to: h, base: next}); // 置き換えてから記録を直すまでに落ちても、次に直せるように
  try {
    await replaceFile(m.path, out);
  } catch (e) {
    journal(repo, m.id, null); // 置き換えられなかった：ファイルは前のまま
    throw e;
  }
  repo.updateMaterial(m.id, {sha256: h, size: out.length, base_sha256: next});
  journal(repo, m.id, null);
  return {changed: true, sha256: h, size: out.length};
}

function journal(repo, id, entry) {
  const all = {...repo.getSetting(JOURNAL, {})};
  if (entry) all[id] = entry;
  else delete all[id];
  repo.setSetting(JOURNAL, all);
}
