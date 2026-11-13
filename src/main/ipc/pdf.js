// IPC の窓口：PDF の編集（pdf.*・annotation.*・bookmark.*）。index.js が register を呼ぶ（SPEC §12・DESIGN-M0 §4）
import {dialog, app} from 'electron';
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {sha256} from '../sync/files.js';
import {isPng} from '../pdf-export.js';
import {exportAnnotatedPdfOffThread, warmPdfWorker} from '../pdf-worker.js';
import {annoKey, overwritePdf, readBase} from '../pdf-save.js';
import {annotationToClient, normalizeAnnotation, clampSize} from '../../shared/annotation.js';
import {normalizeBookmark} from '../../shared/bookmark.js';
import {cleanAlign} from '../../shared/text-runs.js';
import {str, id, PDFJS_DIR, PDFJS_ASSET, bad} from './common.js';
import {sendMain} from '../frames.js';
import * as trial from '../trial-note.js';

export function register({handle, ctx, repo, log, getWindow, notifyOthers = () => {}}) {
  // アプリ内の PDF ビューア（SPEC §9）。編集できるのは PDF だけ。中身はバイト列で渡し、パスはレンダラに出さない
  const pdfMaterial = (materialId) => {
    const m = repo.get('material', id(materialId) ?? bad('資料が不正です')) ?? bad('資料がありません');
    if (!/\.pdf$/i.test(m.path)) bad('アプリ内で開けるのは PDF だけです');
    if (m.status !== 'ok') bad('このファイルは見つかりません');
    return m;
  };

  // 上書き保存した PDF の元の写し（注釈はいつもこの写しの上に描く）
  const originalsDir = () => path.join(app.getPath('userData'), 'originals');

  // 試し書き（trial-note.js）：資料の id のかわりに TRIAL_ID で開く。メモリの中だけで扱い、ファイル・DB には残さない
  handle('note.trial', async ({design, name}) => trial.startTrial(design, str(name, 100) || '試し書き'));
  handle('note.trialEnd', () => (trial.endTrial(), {ok: true}));

  handle('pdf.open', async ({materialId}) => {
    if (trial.isTrial(materialId)) return trial.openTrial();
    let m = pdfMaterial(materialId);
    // 上書き保存で PDF を作るスレッドを、書き始める前に作っておく（作る間はメインが少し止まるため。pdf-worker.js）
    setTimeout(warmPdfWorker, 300);
    // 上書き保存したことがあれば、注釈を描き込む前の写しを開く（描き込み済みの上に注釈を重ねて 2 重にしない）
    const base = await readBase(m, originalsDir()).catch(() =>
      bad('ファイルを読めませんでした（移動または削除された可能性があります）')
    );
    // 元の写しがない（別のパソコンへ移した・バックアップから戻したなど）：描き込み済みのファイルを新しい元にする。
    // 前の書き込みはファイルに描き込まれた形で残り、アプリでは動かせなくなる（重ねて 2 重に出さない・上書き保存が止まらない）
    let rebased = false;
    if (!base.pristine && m.base_sha256) {
      log.warn(`元の PDF の写しがありません：${m.name}（描き込み済みのファイルを新しい元にします）`);
      m = repo.updateMaterial(m.id, {base_sha256: null});
      rebased = true;
    }
    const bytes = base.bytes;
    repo.updateMaterial(m.id, {read_at: new Date().toISOString()});
    return {
      material: {id: m.id, name: m.name, course_id: m.course_id, round_id: m.round_id, source: m.source},
      // ノートの紙（{v: 2, type, gap}。前の版のノートは v なし）。「紙を変える…」の今の紙に ✓ を付ける
      paper: m.source === 'note' ? repo.getSetting(`note.design.${m.id}`, null) : null,
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      annotations: repo.listAnnotations(annoKey(m)).map(annotationToClient),
      bookmarks: repo.listBookmarks(annoKey(m)).map(bookmarkToClient),
      rebased,
      // 文字入れの書式（サイズ・太字・色・揃え）：この PDF で最後に使ったもの。初めて開く PDF では同じ授業（フォルダ）で最後に使ったもの
      textStyle:
        repo.getSetting(`viewer.text.${m.id}`, null) ?? repo.getSetting(`viewer.text.course.${m.course_id}`, null),
      // スマホで書き込んだあと、まだファイルに描き込んでいない（開いたら上書き保存する。docs/MOBILE.md §6）
      stale: repo.getSetting('pdf.stale', []).includes(m.id)
    };
  });

  // 文字入れの書式を覚える（PDF ごと。同じ授業の次の PDF の初期値にもなる）
  handle('pdf.textStyle', ({materialId, style}) => {
    if (trial.isTrial(materialId)) return {ok: true};
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
    if (trial.isTrial(materialId)) return {bookmark: trial.saveTrialBookmark(bookmark)};
    const m = pdfMaterial(materialId);
    const bid = bookmark?.id == null ? null : (id(bookmark.id) ?? bad('しおりが不正です'));
    return {bookmark: bookmarkToClient(repo.saveBookmark(annoKey(m), bid, normalizeBookmark(bookmark)))};
  });

  handle('bookmark.remove', ({materialId, bookmarkId}) => {
    if (trial.isTrial(materialId)) return (trial.removeTrialBookmark(bookmarkId), {ok: true});
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

  // 画面（e.senderFrame）から書いたときは、同じ資料を開いているほかの画面にも知らせる（スマホからは mobile/api.js が知らせる）
  handle('annotation.save', ({materialId, annotation}, e) => {
    if (trial.isTrial(materialId)) return {annotation: trial.saveTrialAnnotation(annotation)};
    const m = pdfMaterial(materialId);
    const aid = annotation?.id == null ? null : (id(annotation.id) ?? bad('注釈が不正です'));
    // ノートは消したページに書かない（スマホで消す前の画面のまま書いたときなど）
    if (m.source === 'note' && m.pages && Number(annotation?.page) > m.pages)
      bad('そのページはもうありません（開き直してください）');
    const row = repo.saveAnnotation(annoKey(m), aid, normalizeAnnotation(annotation));
    if (e?.senderFrame) notifyOthers(e.senderFrame, 'annotations.changed', {materialId: m.id, all: true});
    return {annotation: annotationToClient(row)};
  });

  // 注釈の一覧（スマホで書き込んだあと、開いている PDF の画面が取り直す）
  handle('annotation.list', ({materialId}) => {
    if (trial.isTrial(materialId)) return {annotations: trial.trialAnnotations()};
    const m = pdfMaterial(materialId);
    return {annotations: repo.listAnnotations(annoKey(m)).map(annotationToClient)};
  });

  // 暗記モードの記録（覚えた・まだ）。ファイルの中身は変わらないので、上書き保存もほかの画面への知らせもしない
  handle('annotation.memorize', ({materialId, marks}) => {
    if (trial.isTrial(materialId)) return {ok: true};
    const m = pdfMaterial(materialId);
    for (const x of Array.isArray(marks) ? marks.slice(0, 500) : []) {
      const aid = id(x?.id);
      if (aid) repo.setMemorized(annoKey(m), aid, typeof x.memorized === 'boolean' ? x.memorized : null);
    }
    return {ok: true};
  });

  handle('annotation.remove', ({materialId, annotationId}, e) => {
    if (trial.isTrial(materialId)) return (trial.removeTrialAnnotation(annotationId), {ok: true});
    const m = pdfMaterial(materialId);
    repo.removeAnnotation(annoKey(m), id(annotationId) ?? bad('注釈が不正です'));
    if (e?.senderFrame) notifyOthers(e.senderFrame, 'annotations.changed', {materialId: m.id, all: true});
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
  // ノートは、ページの足し引き・描き直しと重ならないよう順番待ちの中で保存する（元の写しが入れ替わる途中に読まない）
  handle('pdf.save', async ({materialId, texts}) => {
    if (trial.isTrial(materialId)) return {ok: true, changed: false, name: '試し書き'}; // 試し書きはファイルに残さない
    const m0 = pdfMaterial(materialId);
    if (m0.source === 'note' && ctx?.noteSerial) return ctx.noteSerial(String(m0.id), () => save(materialId, texts));
    return save(materialId, texts);
  });
  const save = async (materialId, texts) => {
    const m = pdfMaterial(materialId);
    const rows = repo.listAnnotations(annoKey(m)).map(annotationToClient);
    const r = await overwritePdf({
      repo,
      material: m,
      annotations: rows,
      images: textImages(rows, texts),
      originalsDir: originalsDir()
    });
    if (r.changed) sendMain(getWindow()?.webContents, 'state.changed', {});
    const stale = repo.getSetting('pdf.stale', []);
    if (stale.includes(m.id))
      repo.setSetting(
        'pdf.stale',
        stale.filter((x) => x !== m.id)
      );
    return {ok: true, changed: r.changed, name: m.name};
  };

  // 試し書きの書き出し：書いたものを描き込んだ PDF を、選んだ場所に保存する（資料の一覧には入れない）
  const trialBytes = async (options, texts) => {
    const {base, rows, name} = trial.trialForExport();
    const out = await exportAnnotatedPdfOffThread(base, rows, {
      images: textImages(rows, texts),
      markers: options?.markers === 'black' ? 'black' : 'blue',
      notes: options?.notes !== false
    });
    return {out, name};
  };
  const exportTrial = async (options, texts) => {
    const {out, name} = await trialBytes(options, texts);
    const opts = {title: '書き出す', defaultPath: `${name}.pdf`, filters: [{name: 'PDF', extensions: ['pdf']}]};
    const win = getWindow();
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return {canceled: true};
    const file = /\.pdf$/i.test(r.filePath) ? r.filePath : `${r.filePath}.pdf`;
    if (repo.findMaterialByPath(file)) bad('資料のファイルには上書きできません。別の名前にしてください');
    await fsp.writeFile(file, out);
    return {ok: true, name: path.basename(file)};
  };

  // 注釈付きで別名で書き出す（§9.7）。注釈の位置と中身は DB のものを使い、レンダラからは文字入れの画像だけ受け取る
  const exportBytes = async (m, options, texts) => {
    const markers = options?.markers === 'black' ? 'black' : 'blue';
    const notes = options?.notes !== false;
    const rows = repo.listAnnotations(annoKey(m)).map(annotationToClient);
    const images = textImages(rows, texts);
    const base = await readBase(m, originalsDir()).catch(() => bad('元の PDF を読めませんでした'));
    if (!base.pristine) bad('元の PDF の写しが見つからないため書き出せません');
    return exportAnnotatedPdfOffThread(base.bytes, rows, {images, markers, notes});
  };
  // iPad（パソコンと同じ画面。docs/MOBILE.md §8）：保存の窓を出さず、注釈付きの PDF の中身を返す（iPad の側で保存する）
  ctx.pdfExportData = async ({materialId, options, texts}) => {
    if (trial.isTrial(materialId)) {
      const {out, name} = await trialBytes(options, texts);
      return {ok: true, name: `${name}.pdf`, bytes: out};
    }
    const m = pdfMaterial(materialId);
    const out = await exportBytes(m, options, texts);
    return {ok: true, name: `${m.name.replace(/\.pdf$/i, '')}_注釈.pdf`, bytes: out};
  };
  handle('pdf.export', async ({materialId, options, texts}) => {
    if (trial.isTrial(materialId)) return exportTrial(options, texts);
    const m = pdfMaterial(materialId);
    const out = await exportBytes(m, options, texts);
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
      sendMain(win?.webContents, 'state.changed', {});
    }
    return {ok: true, name: path.basename(file)};
  });
}
