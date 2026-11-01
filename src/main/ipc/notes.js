// IPC の窓口：授業の回のノート（note.*）と、PDF・ノートに貼る写真（photo.*）。index.js が register を呼ぶ（SPEC §8.6・§9.3）
import {app} from 'electron';
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {sha256} from '../sync/files.js';
import {annoKey, readBase, replaceFile, originalPath} from '../pdf-save.js';
import {appendNotePage, cleanPaper, createNotePdf, rebuildNotePdf, removeLastNotePage} from '../note-pdf.js';
import {isPng} from '../pdf-export.js';
import {createSerial} from '../serial.js';
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

export function register({handle, ctx, repo, files, folders, getWindow, notifyOthers = () => {}}) {
  const originalsDir = () => path.join(app.getPath('userData'), 'originals');
  const photosDir = () => path.join(app.getPath('userData'), 'photos');
  // ノートの上の欄に印刷する画像（授業・回・題・日付。ノートごと）。足すページにも同じものを印刷する
  const headerFile = (mid) => path.join(app.getPath('userData'), 'notes', `${mid}-head.png`);
  const readHeader = (mid) => fsp.readFile(headerFile(mid)).catch(() => null);
  const changed = () => getWindow()?.webContents.send('state.changed', {});
  const okHeader = (header) =>
    header instanceof Uint8Array && header.length <= 512 * 1024 && isPng(header) ? Buffer.from(header) : null;
  const saveHeader = async (mid, head, text) => {
    if (head) {
      await fsp.mkdir(path.dirname(headerFile(mid)), {recursive: true});
      await replaceFile(headerFile(mid), head);
    }
    repo.setSetting(`note.head.${mid}`, text ?? '');
  };

  // 同じノートのページの足し引き・描き直しは 1 つずつ（パソコンとスマホでほぼ同時に足すと、同じ元の写しから作った後のほうが
  // 先のほうを上書きし、注釈の付け替え先が食い違って書いたものが見えなくなるため）
  const exclusive = ctx.noteSerial ?? createSerial();

  /** 回のノート（なければ null） */
  const noteOf = (courseId, roundId) =>
    repo
      .listMaterials(courseId)
      .find((m) => m.source === 'note' && (m.round_id ?? null) === (roundId ?? null) && m.status === 'ok') ?? null;

  // 回のノートを開く。なければ作る（A4 縦・1 ページ。紙は paper：横罫・方眼、行の間 6・7 mm。header は上の欄に印刷する PNG）。
  // 戻り：{materialId, created}
  handle('note.open', async ({courseId, roundId, paper, header, headerText = ''}) => {
    const course = repo.get('course', id(courseId) ?? bad('この授業は見つかりませんでした')) ?? bad('授業がありません');
    const term = repo.get('term', course.term_id) ?? bad('学期がありません');
    let round = null;
    if (course.kind === 'folder') round = folders.roundOf(course);
    else {
      round = repo.get('round', id(roundId) ?? bad('回が不正です')) ?? bad('回がありません');
      if (round.course_id !== course.id) bad('別の授業の回です');
    }
    // 同じ回のノートを 2 冊作らない（続けて押したとき）
    return exclusive(`open:${course.id}:${round?.id ?? ''}`, async () => {
      const have = noteOf(course.id, round?.id);
      if (have) return {materialId: have.id, created: false};
      const d = cleanPaper(paper);
      const head = okHeader(header);
      const label = !round ? '' : round.number > 0 ? ` 第${round.number}回` : ' その他';
      const bytes = await createNotePdf(d, {title: `${course.name}${label} ノート`, header: head});
      const r = await files.addOwn({term, course, round, name: noteName(round), data: bytes, source: 'note'});
      repo.updateMaterial(r.material.id, {pages: 1});
      repo.setSetting(`note.design.${r.material.id}`, d);
      await saveHeader(r.material.id, head, head ? String(headerText).slice(0, 300) : '');
      changed();
      return {materialId: r.material.id, created: true};
    });
  });

  /** ノートの元の写しを入れ替える：新しい写しを置き、注釈・しおりを付け替える（ファイルへの描き込みは次の上書き保存で） */
  const rebase = async (m, bytes, pages) => {
    const h = sha256(Buffer.from(bytes));
    await fsp.mkdir(originalsDir(), {recursive: true});
    await replaceFile(originalPath(originalsDir(), h), Buffer.from(bytes));
    const old = annoKey(m);
    repo.rekeyAnnotations(old, h);
    repo.updateMaterial(m.id, {base_sha256: h, pages});
    // 前の元の写しは、ほかに使う資料がなければ消す（ページを足し引きするたびに残っていかないように）
    if (old !== h && !repo.shaInUse(old))
      await fsp.rm(originalPath(originalsDir(), old), {force: true}).catch(() => {});
  };
  /** ノートと今の元の写し。足し引きの順番待ち（exclusive）の中で読むので、いつも前の足し引きのあとの写し */
  const noteMaterial = async (materialId) => {
    const m = repo.get('material', id(materialId) ?? bad('ノートが不正です')) ?? bad('ノートがありません');
    if (m.source !== 'note' || !/\.pdf$/i.test(m.path)) bad('ページを足し引きできるのはノートだけです');
    if (m.status !== 'ok') bad('ノートのファイルが見つかりません');
    const base = await readBase(m, originalsDir()).catch(() => bad('ノートを読めませんでした'));
    if (!base.pristine) bad('元のノートの写しが見つからないため、ページを足し引きできません');
    return {m, base: base.bytes};
  };
  const asBytes = (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

  // ノートの最後にページを 1 枚足す（同じ紙・同じ上の欄）。戻り：{pages, bytes}（新しい元の写し。画面は開き直さずに最後のページだけ足す）。
  // 同じノートを開いているほかの窓にも知らせる（note.pages）
  handle('note.addPage', ({materialId}, e) =>
    exclusive(String(materialId), async () => {
      const {m, base} = await noteMaterial(materialId);
      const design = repo.getSetting(`note.design.${m.id}`, null) ?? {};
      const {bytes, pages} = await appendNotePage(base, design, {header: await readHeader(m.id)});
      await rebase(m, bytes, pages);
      changed();
      const out = {pages, bytes: asBytes(bytes)};
      if (e?.sender) notifyOthers(e.sender, 'note.pages', {materialId: m.id, ...out});
      return out;
    })
  );

  // ノートの最後のページを消す（何も書いていない・付箋もない白紙のときだけ。1 ページは残す）。戻り：{pages}
  handle('note.removePage', ({materialId}, e) =>
    exclusive(String(materialId), async () => {
      const {m, base} = await noteMaterial(materialId);
      const r = await removeLastNotePage(base).catch((err) => bad(err.message));
      const last = r.pages + 1; // 消すページの番号
      const key = annoKey(m);
      if (
        repo.listAnnotations(key).some((a) => a.page === last) ||
        repo.listBookmarks(key).some((b) => b.page === last)
      )
        bad('最後のページに書いたもの・付箋があるため消せません');
      await rebase(m, r.bytes, r.pages);
      changed();
      if (e?.sender) notifyOthers(e.sender, 'note.pages', {materialId: m.id, pages: r.pages});
      return {pages: r.pages};
    })
  );

  // 上の欄の字（授業・回・題・日付）が変わっていたら、ノートを同じページ数のまま描き直す（回の題や日付が同期で変わったときなど。
  // 書いたものは注釈なので消えない）。ノートを開くたびにレンダラが今の字で呼ぶ。戻り：{changed: false} か {changed: true, pages, bytes}
  handle('note.setHeader', ({materialId, text, header}) =>
    exclusive(String(materialId), async () => {
      const clean = String(text ?? '').slice(0, 300);
      const head = okHeader(header);
      const m0 = repo.get('material', id(materialId) ?? bad('ノートが不正です')) ?? bad('ノートがありません');
      if (!clean || !head || m0.source !== 'note' || repo.getSetting(`note.head.${m0.id}`, null) === clean)
        return {changed: false};
      const {m, base} = await noteMaterial(materialId);
      const design = repo.getSetting(`note.design.${m.id}`, null) ?? {};
      const {bytes, pages} = await rebuildNotePdf(base, design, {header: head});
      await saveHeader(m.id, head, clean);
      await rebase(m, bytes, pages);
      return {changed: true, pages, bytes: asBytes(bytes)};
    })
  );

  // ノートを消す：ファイルはパソコンのゴミ箱へ（描き込んで保存した中身はそのまま。ゴミ箱から戻せる）。記録・注釈・付箋・元の写し・
  // 上の欄の画像・紙の設定も片付ける。開いているほかの窓（横に並べた窓など）には note.removed を知らせ、閉じさせる
  const removeNote = (mid, from = null) =>
    exclusive(String(mid), async () => {
      const m = repo.get('material', mid) ?? bad('ノートがありません');
      if (m.source !== 'note') bad('ノートではありません');
      const key = annoKey(m);
      // ファイルがもうなければ（Finder で消した・ほかのパソコンへ移したなど）、記録だけ片付ける
      if (m.status === 'ok' && (await fsp.stat(m.path).catch(() => null))) await files.trash(m.path);
      repo.remove('material', m.id);
      if (!repo.shaInUse(key)) {
        repo.removeAnnotationsFor(key);
        await fsp.rm(originalPath(originalsDir(), key), {force: true}).catch(() => {});
      }
      await fsp.rm(headerFile(m.id), {force: true}).catch(() => {});
      repo.removeSetting(`note.design.${m.id}`);
      repo.removeSetting(`note.head.${m.id}`);
      notifyOthers(from, 'note.removed', {materialId: m.id});
      changed();
      return {ok: true};
    });
  ctx.removeNote = removeNote;

  // 資料（ノート・PDF）を横に並べる窓で開く（PDF の編集画面の「横に並べる」。元の窓は左半分、こちらは右半分。main.js の openSideWindow）
  handle('window.openSide', ({materialId}) => {
    const m = repo.get('material', id(materialId) ?? bad('資料が不正です')) ?? bad('資料がありません');
    if (!/\.pdf$/i.test(m.path) || m.source === 'export') bad('横に並べられるのはノートと PDF の資料だけです');
    if (m.status !== 'ok') bad('ファイルが見つかりません');
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
