// IPC の窓口：PDF の編集（pdf.*・annotation.*・bookmark.*）。index.js が register を呼ぶ（SPEC §12・DESIGN-M0 §4）
import {dialog, app} from 'electron';
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {sha256} from '../sync/files.js';
import {exportAnnotatedPdf, isPng} from '../pdf-export.js';
import {annoKey, overwritePdf, readBase} from '../pdf-save.js';
import {annotationToClient, normalizeAnnotation, clampSize} from '../../shared/annotation.js';
import {normalizeBookmark} from '../../shared/bookmark.js';
import {cleanAlign} from '../../shared/text-runs.js';
import {str, id, PDFJS_DIR, PDFJS_ASSET, bad} from './common.js';

export function register({handle, repo, log, getWindow}) {
  // アプリ内の PDF ビューア（SPEC §9）。編集できるのは PDF だけ。中身はバイト列で渡し、パスはレンダラに出さない
  const pdfMaterial = (materialId) => {
    const m = repo.get('material', id(materialId) ?? bad('資料が不正です')) ?? bad('資料がありません');
    if (!/\.pdf$/i.test(m.path)) bad('アプリ内で開けるのは PDF だけです');
    if (m.status !== 'ok') bad('このファイルは見つかりません');
    return m;
  };

  // 上書き保存した PDF の元の写し（注釈はいつもこの写しの上に描く）
  const originalsDir = () => path.join(app.getPath('userData'), 'originals');

  handle('pdf.open', async ({materialId}) => {
    const m = pdfMaterial(materialId);
    // 上書き保存したことがあれば、注釈を描き込む前の写しを開く（描き込み済みの上に注釈を重ねて 2 重にしない）
    const base = await readBase(m, originalsDir()).catch(() =>
      bad('ファイルを読めませんでした（移動または削除された可能性があります）')
    );
    if (!base.pristine) log.warn(`元の PDF の写しがありません：${m.name}（描き込み済みのファイルを開きます）`);
    const bytes = base.bytes;
    repo.updateMaterial(m.id, {read_at: new Date().toISOString()});
    return {
      material: {id: m.id, name: m.name, course_id: m.course_id, round_id: m.round_id},
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      annotations: repo.listAnnotations(annoKey(m)).map(annotationToClient),
      bookmarks: repo.listBookmarks(annoKey(m)).map(bookmarkToClient),
      // 文字入れの書式（サイズ・太字・色・揃え）：この PDF で最後に使ったもの。初めて開く PDF では同じ授業（フォルダ）で最後に使ったもの
      textStyle:
        repo.getSetting(`viewer.text.${m.id}`, null) ?? repo.getSetting(`viewer.text.course.${m.course_id}`, null)
    };
  });

  // 文字入れの書式を覚える（PDF ごと。同じ授業の次の PDF の初期値にもなる）
  handle('pdf.textStyle', ({materialId, style}) => {
    const m = pdfMaterial(materialId);
    const s = style && typeof style === 'object' ? style : bad('書式が不正です');
    const clean = {
      size: clampSize(s.size),
      bold: s.bold === true,
      color: typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : '#2b2b2b',
      align: cleanAlign(s.align) ?? 'left'
    };
    repo.setSetting(`viewer.text.${m.id}`, clean);
    repo.setSetting(`viewer.text.course.${m.course_id}`, clean);
    return {ok: true};
  });

  // しおり（名前・ページ・位置）。追加・名前の変更・移動は同じ窓口（id がなければ追加）
  const bookmarkToClient = ({id: bid, page, y, name}) => ({id: bid, page, y, name});

  handle('bookmark.save', ({materialId, bookmark}) => {
    const m = pdfMaterial(materialId);
    const bid = bookmark?.id == null ? null : (id(bookmark.id) ?? bad('しおりが不正です'));
    return {bookmark: bookmarkToClient(repo.saveBookmark(annoKey(m), bid, normalizeBookmark(bookmark)))};
  });

  handle('bookmark.remove', ({materialId, bookmarkId}) => {
    const m = pdfMaterial(materialId);
    repo.removeBookmark(annoKey(m), id(bookmarkId) ?? bad('しおりが不正です'));
    return {ok: true};
  });

  handle('pdf.asset', async ({kind, filename}) => {
    const dir = PDFJS_ASSET[kind] ?? bad('種類が不正です');
    const name = str(filename, 100);
    if (!name || !/^[\w.+-]+$/.test(name) || name.startsWith('.')) bad('ファイル名が不正です');
    const buf = await fsp.readFile(path.join(PDFJS_DIR, dir, name));
    return {bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)};
  });

  handle('annotation.save', ({materialId, annotation}) => {
    const m = pdfMaterial(materialId);
    const aid = annotation?.id == null ? null : (id(annotation.id) ?? bad('注釈が不正です'));
    const row = repo.saveAnnotation(annoKey(m), aid, normalizeAnnotation(annotation));
    return {annotation: annotationToClient(row)};
  });

  handle('annotation.remove', ({materialId, annotationId}) => {
    const m = pdfMaterial(materialId);
    repo.removeAnnotation(annoKey(m), id(annotationId) ?? bad('注釈が不正です'));
    return {ok: true};
  });

  // 文字入れ・貼りものの画像（レンダラが描いた PNG）。DB にある文字入れ・貼りものの分だけ受け取る
  const textImages = (rows, texts) => {
    const textIds = new Set(rows.filter((r) => r.kind === 'text' || r.kind === 'stamp').map((r) => r.id));
    const images = new Map();
    let total = 0;
    for (const t of Array.isArray(texts) ? texts : []) {
      const tid = id(t?.id);
      if (!tid || !textIds.has(tid)) continue;
      if (!isPng(t.png)) bad('文字入れの画像が不正です');
      total += t.png.length;
      if (total > 200 * 1024 * 1024) bad('文字入れが多すぎて書き出せません');
      images.set(tid, t.png);
    }
    return images;
  };

  // 上書き保存：注釈を描き込んだ PDF でファイルを置き換える（Finder で開いても注釈が見える）。元の写しはアプリの中に取っておく
  handle('pdf.save', async ({materialId, texts}) => {
    const m = pdfMaterial(materialId);
    const rows = repo.listAnnotations(annoKey(m)).map(annotationToClient);
    const r = await overwritePdf({
      repo,
      material: m,
      annotations: rows,
      images: textImages(rows, texts),
      originalsDir: originalsDir()
    });
    if (r.changed) getWindow()?.webContents.send('state.changed', {});
    return {ok: true, changed: r.changed, name: m.name};
  });

  // 注釈付きで別名で書き出す（§9.7）。注釈の位置と中身は DB のものを使い、レンダラからは文字入れの画像だけ受け取る
  handle('pdf.export', async ({materialId, options, texts}) => {
    const m = pdfMaterial(materialId);
    const markers = options?.markers === 'black' ? 'black' : 'blue';
    const notes = options?.notes !== false;
    const rows = repo.listAnnotations(annoKey(m)).map(annotationToClient);
    const images = textImages(rows, texts);
    const base = await readBase(m, originalsDir()).catch(() => bad('元の PDF を読めませんでした'));
    if (!base.pristine) bad('元の PDF の写しが見つからないため書き出せません');
    const src = base.bytes;
    const out = Buffer.from(await exportAnnotatedPdf(src, rows, {images, markers, notes}));
    const dir = path.dirname(m.path);
    const opts = {
      title: '注釈付きで書き出す',
      defaultPath: path.join(dir, `${m.name.replace(/\.pdf$/i, '')}_注釈.pdf`),
      filters: [{name: 'PDF', extensions: ['pdf']}]
    };
    const win = getWindow();
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return {canceled: true};
    const file = /\.pdf$/i.test(r.filePath) ? r.filePath : `${r.filePath}.pdf`;
    if (path.resolve(file) === path.resolve(m.path)) bad('元の PDF には上書きできません。別の名前にしてください');
    const taken = repo.findMaterialByPath(file);
    if (taken && taken.source !== 'export') bad('資料のファイルには上書きできません。別の名前にしてください');
    await fsp.writeFile(file, out);
    // 元の資料と同じ回フォルダに置いたときは、授業画面の一覧にも出す（注釈の対象にはしない）
    if (path.dirname(path.resolve(file)) === path.resolve(dir)) {
      const h = sha256(out);
      if (taken) repo.updateMaterial(taken.id, {sha256: h, size: out.length});
      else if (!repo.findMaterialByHash(m.course_id, h))
        repo.createMaterial({
          course_id: m.course_id,
          round_id: m.round_id,
          round_from: 'user',
          name: path.basename(file),
          path: file,
          sha256: h,
          size: out.length,
          mime: 'application/pdf',
          source: 'export',
          status: 'ok',
          read_at: new Date().toISOString()
        });
      win?.webContents.send('state.changed', {});
    }
    return {ok: true, name: path.basename(file)};
  });
}
