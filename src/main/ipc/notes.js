// IPC の窓口：授業の回のノート（note.*）と、PDF・ノートに貼る写真（photo.*）。index.js が register を呼ぶ（SPEC §8.6・§9.3）
import {app} from 'electron';
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {sha256} from '../sync/files.js';
import {annoKey, readBase, replaceFile, originalPath} from '../pdf-save.js';
import {appendNotePage, cleanDesign, createNotePdf} from '../note-pdf.js';
import {id, bad} from './common.js';

/** ノートのファイル名（回ごと。同じ回フォルダの中でも、自分のフォルダの中でも名前が重ならないように回を入れる） */
export function noteName(round) {
  if (!round) return 'ノート.pdf';
  return round.number > 0 ? `ノート 第${round.number}回.pdf` : 'ノート その他.pdf';
}

// 写真：JPEG・PNG（レンダラが長い辺 2400 px までに縮めたもの）。userData/photos/<SHA-256>.<拡張子> に置く
const PHOTO_MAX = 12 * 1024 * 1024;
const photoExt = (b) =>
  b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    ? 'jpg'
    : b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
      ? 'png'
      : null;

export function register({handle, ctx, repo, files, folders, getWindow}) {
  const originalsDir = () => path.join(app.getPath('userData'), 'originals');
  const photosDir = () => path.join(app.getPath('userData'), 'photos');
  const changed = () => getWindow()?.webContents.send('state.changed', {});

  /** 回のノート（なければ null） */
  const noteOf = (courseId, roundId) =>
    repo
      .listMaterials(courseId)
      .find((m) => m.source === 'note' && (m.round_id ?? null) === (roundId ?? null) && m.status === 'ok') ?? null;

  // 回のノートを開く。なければ作る（A4 縦・1 ページ。紙と罫線は今のテンプレートのノートの見た目 design）。戻り：{materialId, created}
  handle('note.open', async ({courseId, roundId, design}) => {
    const course = repo.get('course', id(courseId) ?? bad('この授業は見つかりませんでした')) ?? bad('授業がありません');
    const term = repo.get('term', course.term_id) ?? bad('学期がありません');
    let round = null;
    if (course.kind === 'folder') round = folders.roundOf(course);
    else {
      round = repo.get('round', id(roundId) ?? bad('回が不正です')) ?? bad('回がありません');
      if (round.course_id !== course.id) bad('別の授業の回です');
    }
    const have = noteOf(course.id, round?.id);
    if (have) return {materialId: have.id, created: false};
    const d = cleanDesign(design);
    const label = !round ? '' : round.number > 0 ? ` 第${round.number}回` : ' その他';
    const bytes = await createNotePdf(d, {title: `${course.name}${label} ノート`});
    const r = await files.addOwn({term, course, round, name: noteName(round), data: bytes, source: 'note'});
    repo.updateMaterial(r.material.id, {pages: 1});
    repo.setSetting(`note.design.${r.material.id}`, d);
    changed();
    return {materialId: r.material.id, created: true};
  });

  // ノートの最後にページを 1 枚足す（同じ見た目）。注釈・しおりは新しい元の写しに付け替える。
  // ファイルへの描き込みは、レンダラが開き直したあとの上書き保存（pdf.save）で行う。戻り：{pages}
  handle('note.addPage', async ({materialId}) => {
    const m = repo.get('material', id(materialId) ?? bad('ノートが不正です')) ?? bad('ノートがありません');
    if (m.source !== 'note' || !/\.pdf$/i.test(m.path)) bad('ページを足せるのはノートだけです');
    if (m.status !== 'ok') bad('ノートのファイルが見つかりません');
    const base = await readBase(m, originalsDir()).catch(() => bad('ノートを読めませんでした'));
    if (!base.pristine) bad('元のノートの写しが見つからないため、ページを足せません');
    const design = cleanDesign(repo.getSetting(`note.design.${m.id}`, null) ?? {});
    const {bytes, pages} = await appendNotePage(base.bytes, design);
    const h = sha256(Buffer.from(bytes));
    await fsp.mkdir(originalsDir(), {recursive: true});
    await replaceFile(originalPath(originalsDir(), h), Buffer.from(bytes));
    repo.rekeyAnnotations(annoKey(m), h);
    repo.updateMaterial(m.id, {base_sha256: h, pages});
    changed();
    return {pages};
  });

  // ノートを横に並べる窓で開く（PDF の編集画面の「横に並べる」。元の窓は左半分、ノートは右半分。main.js の openSideWindow）
  handle('window.openSide', ({materialId}) => {
    const m = repo.get('material', id(materialId) ?? bad('ノートが不正です')) ?? bad('ノートがありません');
    if (m.source !== 'note') bad('横に並べられるのはノートだけです');
    if (m.status !== 'ok') bad('ノートのファイルが見つかりません');
    ctx.openSide?.(m.id);
    return {ok: true};
  });

  // 写真を取っておく。戻り：{id}（SHA-256。貼りもの style.ref に入れる）
  handle('photo.add', async ({bytes}) => {
    if (!(bytes instanceof Uint8Array) || !bytes.length) bad('写真が不正です');
    if (bytes.length > PHOTO_MAX) bad('写真が大きすぎます（12 MB まで）');
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ext = photoExt(buf) ?? bad('貼れるのは JPEG・PNG の写真です');
    const h = sha256(buf);
    await fsp.mkdir(photosDir(), {recursive: true});
    const file = path.join(photosDir(), `${h}.${ext}`);
    if (!(await fsp.stat(file).catch(() => null))) await replaceFile(file, buf);
    return {id: h};
  });

  // 写真の中身（data: URL）。戻り：{urls: {id: url}}（見つからないものは入れない）
  handle('photo.data', async ({ids}) => {
    const urls = {};
    for (const pid of Array.isArray(ids) ? ids.slice(0, 200) : []) {
      if (!/^[0-9a-f]{64}$/.test(pid ?? '')) continue;
      for (const [ext, mime] of [
        ['jpg', 'image/jpeg'],
        ['png', 'image/png']
      ]) {
        const b = await fsp.readFile(path.join(photosDir(), `${pid}.${ext}`)).catch(() => null);
        if (b) {
          urls[pid] = `data:${mime};base64,${b.toString('base64')}`;
          break;
        }
      }
    }
    return {urls};
  });
}
