// IPC の窓口：資料・同期・自分のフォルダ（material.*・sync.run・folder.*）。index.js が register を呼ぶ（SPEC §12・DESIGN-M0 §4）
import {dialog, shell} from 'electron';
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {isOpenable} from '../sync/files.js';
import {str, id, bad} from './common.js';

export function register({handle, repo, jobs, files, log, folders, getWindow}) {
  handle('sync.run', async ({connectionId, courseId, full}) => {
    if (courseId && repo.get('course', id(courseId) ?? bad('この授業は見つかりませんでした'))?.kind === 'folder')
      return folders.scan(courseId);
    const payload = {};
    if (connectionId) payload.connectionId = id(connectionId) ?? bad('接続が不正です');
    if (courseId) payload.courseId = id(courseId) ?? bad('この授業は見つかりませんでした');
    if (full === true) payload.full = true;
    payload.kind = courseId ? 'course' : 'manual';
    return {jobId: jobs.enqueue('sync', payload).id};
  });

  handle('material.open', async ({materialId}) => {
    const m = repo.get('material', id(materialId) ?? bad('資料が不正です')) ?? bad('資料がありません');
    if (!isOpenable(m.path)) bad('この種類のファイルはアプリから開きません');
    repo.updateMaterial(m.id, {read_at: new Date().toISOString()});
    const err = await shell.openPath(m.path);
    return err ? {error: err} : {ok: true};
  });

  handle('material.reveal', ({materialId}) => {
    const m = repo.get('material', id(materialId) ?? bad('資料が不正です')) ?? bad('資料がありません');
    shell.showItemInFolder(m.path);
    return {ok: true};
  });

  // 資料を別の回へ移す。roundId が null なら「自分の付箋」へ。すぐ動かす（同期の列に並べると、長い同期のあいだ待たされる）
  handle('material.move', async ({materialId, roundId}) => {
    const m = repo.get('material', id(materialId) ?? bad('資料が不正です')) ?? bad('資料がありません');
    const r =
      roundId === null ? null : (repo.get('round', id(roundId) ?? bad('回が不正です')) ?? bad('回がありません'));
    if (r && r.course_id !== m.course_id) bad('別の授業の回には移せません');
    if (repo.get('course', m.course_id)?.kind === 'folder')
      bad('自分のフォルダの中では移せません（Finder で動かしてください）');
    if ((r?.id ?? null) === m.round_id) return {ok: true};
    if (m.status !== 'ok') bad('ファイルが見つからないため移せません');
    const course = repo.get('course', m.course_id);
    const term = repo.get('term', course.term_id);
    await files.relocate({term, course, material: m, round: r});
    return {ok: true};
  });

  // 自分のファイルを授業に入れる。最初は「自分の付箋」（roundId を渡せばその回）に置く。
  // ファイルの場所はレンダラから受け取らない：「ファイルを追加」はメインで選ぶ窓を開き、ドラッグは中身（バイト列）と名前だけを受け取る
  const MAX_UPLOAD = 300 * 1024 * 1024;

  const placeFor = (courseId, roundId) => {
    const course = repo.get('course', id(courseId) ?? bad('この授業は見つかりませんでした')) ?? bad('授業がありません');
    const term = repo.get('term', course.term_id) ?? bad('学期がありません');
    if (course.kind === 'folder') return {course, term, round: folders.roundOf(course)}; // フォルダの中にコピーする
    const round = roundId ? (repo.get('round', id(roundId) ?? bad('回が不正です')) ?? bad('回がありません')) : null;
    if (round && round.course_id !== course.id) bad('別の授業の回には入れられません');
    return {course, term, round};
  };

  const addAll = async (place, items) => {
    const out = {added: 0, dup: [], failed: []};
    for (const {name, read} of items) {
      try {
        const r = await files.addOwn({...place, name, data: await read()});
        if (r.result === 'dup') {
          const where = r.material.round_id ? repo.get('round', r.material.round_id) : null;
          out.dup.push({
            name,
            where:
              place.course.kind === 'folder'
                ? 'このフォルダ'
                : where
                  ? where.number === 0
                    ? where.title_user || 'その他'
                    : `第${where.number}回`
                  : '「振り分け前」'
          });
        } else out.added++;
      } catch (e) {
        log.warn(`ファイルを入れられませんでした: ${name}（${e.message}）`);
        out.failed.push({name, message: e.message});
      }
    }
    return out;
  };

  handle('material.upload', async ({courseId, roundId = null}) => {
    const place = placeFor(courseId, roundId);
    const r = await dialog.showOpenDialog({
      title: `${place.course.name} に入れるファイル`,
      properties: ['openFile', 'multiSelections']
    });
    if (r.canceled || !r.filePaths.length) return {added: 0, dup: [], failed: [], canceled: true};
    const items = [];
    for (const p of r.filePaths) {
      const st = await fsp.stat(p);
      if (st.size > MAX_UPLOAD) bad(`${path.basename(p)} は大きすぎます（300MB まで）`);
      items.push({name: path.basename(p), read: () => fsp.readFile(p)});
    }
    return addAll(place, items);
  });

  handle('material.uploadData', async ({courseId, roundId = null, files: list}) => {
    const place = placeFor(courseId, roundId);
    if (!Array.isArray(list) || !list.length || list.length > 50) bad('ファイルが不正です');
    const items = list.map((f) => {
      const name = str(f?.name, 255) ?? bad('ファイル名が不正です');
      const data =
        f?.data instanceof Uint8Array
          ? f.data
          : f?.data instanceof ArrayBuffer
            ? new Uint8Array(f.data)
            : bad('ファイルの中身が不正です');
      if (data.byteLength > MAX_UPLOAD) bad(`${name} は大きすぎます（300MB まで）`);
      return {name, read: async () => Buffer.from(data.buffer, data.byteOffset, data.byteLength)};
    });
    return addAll(place, items);
  });

  // 自分で入れた資料を外す（ファイルは OS のゴミ箱へ）。LMS から取った資料は外さない（次の同期でまた取ってくるため）
  handle('material.remove', async ({materialId}) => {
    const m = repo.get('material', id(materialId) ?? bad('資料が不正です')) ?? bad('資料がありません');
    if (m.source === 'folder') bad('パソコンのフォルダにあるファイルは、Finder（エクスプローラー）で消してください');
    if (m.source !== 'upload') bad('LMS から取った資料は外せません');
    if (m.status === 'ok') await files.trash(m.path);
    repo.remove('material', m.id);
    return {ok: true};
  });

  // 自分のフォルダ：作る（保存先の中に新しく）・パソコンのフォルダを登録する（選ぶ窓はメインで開く。パスは受け取らない）。
  // 登録は、選んだフォルダを 1 つ（each なし）か、中のフォルダを 1 つずつ（each。授業ごとのフォルダが入ったフォルダ）
  handle('folder.create', async ({name, scope, mode, each = false}) => {
    if (!['term', 'always'].includes(scope)) bad('フォルダの種類が不正です');
    if (mode === 'new') {
      const course = await folders.create({name: str(name, 200) ?? bad('フォルダの名前を入れてください'), scope, mode});
      return {courseId: course.id};
    }
    if (mode !== 'link') bad('フォルダの作り方が不正です');
    const win = getWindow();
    const opts = {
      title: each ? '授業ごとのフォルダが入っているフォルダ' : '大学ノートに登録するフォルダ',
      properties: ['openDirectory']
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths.length) return {canceled: true};
    if (each === true) {
      const out = await folders.importCourses(r.filePaths[0], {scope});
      return {each: true, added: out.added.map((c) => c.name), failed: out.failed};
    }
    const course = await folders.create({name: str(name, 200) ?? '', scope, mode, dir: r.filePaths[0]});
    const scanned = await folders.scan(course.id);
    return {courseId: course.id, ...scanned};
  });

  handle('folder.scan', async ({courseId}) => folders.scan(id(courseId) ?? bad('このフォルダは見つかりませんでした')));

  // 自分のフォルダの中の下のフォルダ（付箋 1 枚）の名前を変える：パソコンのフォルダの名前を変えて、読み直す（中身の記録は SHA-256 で付いていく）
  handle('folder.renameSub', async ({courseId, sub, name}) => {
    const c = folders.folderCourse(id(courseId) ?? bad('このフォルダは見つかりませんでした'));
    return {
      ok: true,
      ...(await folders.renameSub(
        c.id,
        str(sub, 1000) ?? bad('このフォルダは見つかりませんでした'),
        str(name, 200) ?? ''
      ))
    };
  });

  handle('folder.reveal', async ({courseId}) => {
    const c = folders.folderCourse(id(courseId) ?? bad('このフォルダは見つかりませんでした'));
    const e = await shell.openPath(c.dir);
    if (e) bad(`フォルダを開けませんでした（${e}）`);
    return {ok: true};
  });

  handle('folder.update', async ({courseId, name, scope}) => {
    let c = folders.folderCourse(id(courseId) ?? bad('このフォルダは見つかりませんでした'));
    const patch = {};
    if (name !== undefined) c = await folders.rename(c.id, str(name, 200) ?? ''); // パソコンのフォルダの名前も変える
    if (scope !== undefined) {
      if (!['term', 'always'].includes(scope)) bad('フォルダの種類が不正です');
      patch.scope = scope;
      // 今学期のフォルダにするときは、いまの学期に付け直す（前の学期のフォルダを今学期へ戻すとき）
      if (scope === 'term') patch.term_id = folders.termNow()?.id ?? c.term_id;
    }
    return {course: repo.updateCourse(c.id, patch)};
  });
}
