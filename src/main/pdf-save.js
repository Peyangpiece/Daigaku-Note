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

/** 一時ファイルに書いてから置き換える（途中で落ちても壊れたファイルを残さない）。元のファイルの権限は保つ */
async function replaceFile(file, data) {
  const tmp = path.join(path.dirname(file), `.daigaku-tmp-${process.pid}-${Date.now()}`);
  const mode = (await fsp.stat(file).catch(() => null))?.mode;
  await fsp.writeFile(tmp, data, mode ? {mode} : undefined);
  try {
    await fsp.rename(tmp, file);
  } catch (e) {
    await fsp.rm(tmp, {force: true});
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
export async function overwritePdf({repo, material: m, annotations, images = new Map(), originalsDir}) {
  const cur = await fsp.readFile(m.path).catch(() => {
    throw err('missing', 'PDF を読めませんでした（移動または削除された可能性があります）');
  });
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
    if (!(await fsp.stat(keep).catch(() => null))) {
      await fsp.writeFile(`${keep}.tmp`, src);
      await fsp.rename(`${keep}.tmp`, keep);
    }
  }
  const out = annotations.length
    ? Buffer.from(await exportAnnotatedPdf(src, annotations, {images, markers: 'blue', notes: true}))
    : src;
  const h = sha256(out);
  if (h === m.sha256) return {changed: false, sha256: h, size: out.length};
  await replaceFile(m.path, out);
  repo.updateMaterial(m.id, {sha256: h, size: out.length, base_sha256: annotations.length ? base : null});
  return {changed: true, sha256: h, size: out.length};
}
