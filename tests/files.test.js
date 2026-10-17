import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, rm, rename, unlink, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/main/db/db.js';
import {Repo} from '../src/main/db/repo.js';
import {FileManager, filenameFromDisposition, filenameFromUrl, sha256} from '../src/main/sync/files.js';

async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dn-files-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  const term = repo.upsertTerm({id: '2026-fall', label: '秋学期', year: 2026, folder: '2026_秋学期', start_date: '2026-10-01', end_date: '2027-03-31', rounds: 15});
  const conn = repo.createConnection({kind: 'api', connector_id: 'moodle', label: 'Moodle', base_url: 'https://lms.example.ac.jp'});
  const course = repo.createCourse({term_id: term.id, connection_id: conn.id, lms_id: '1', name: '管理会計Ⅱ', folder_name: '管理会計Ⅱ'});
  const r2 = repo.createRound({course_id: course.id, number: 2, title: '原価企画', folder_name: '第02回_原価企画'});
  const r3 = repo.createRound({course_id: course.id, number: 3, title: '原価維持', folder_name: '第03回_原価維持'});
  const r0 = repo.createRound({course_id: course.id, number: 0, title: null, folder_name: 'その他'});
  const trashed = [];
  const files = new FileManager({repo, root: () => path.join(root, '大学ノート'), trash: async (f) => trashed.push(f) && unlink(f)});
  return {root, repo, term, course, r2, r3, r0, files, trashed};
}

const fetchOf = (table) => async (ref) => {
  const e = table[ref.url];
  if (!e) return {ok: false, status: 404, contentType: '', body: Buffer.alloc(0)};
  return {ok: true, status: 200, contentType: e.type ?? 'application/pdf', disposition: e.disposition ?? '', body: Buffer.from(e.body)};
};

test('ファイル名の取り出し', () => {
  assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''%E7%AC%AC3%E5%9B%9E.pdf"), '第3回.pdf');
  assert.equal(filenameFromDisposition('attachment; filename="a b.pdf"'), 'a b.pdf');
  assert.equal(filenameFromDisposition(''), '');
  assert.equal(filenameFromUrl('https://x/pluginfile.php/1/mod_resource/content/1/%E8%B3%87%E6%96%99.pdf?forcedownload=1'), '資料.pdf');
  assert.equal(filenameFromUrl('https://x/file/3/'), '');
});

test('取り込み：新規・同じ URL・同じ中身・同名で別の中身・HTML 応答・新しい版', async (t) => {
  const {root, repo, term, course, r2, files} = await setup(t);
  const table = {
    'https://lms/file/1': {body: 'pdf one', disposition: "attachment; filename*=UTF-8''%E7%AC%AC2%E5%9B%9E%20%E8%B3%87%E6%96%99.pdf"},
    'https://lms/file/2': {body: 'pdf one'},
    'https://lms/file/3': {body: 'pdf three'},
    'https://lms/file/4': {body: '<html>login</html>', type: 'text/html; charset=utf-8'}
  };
  const fetchFile = fetchOf(table);
  const dir = path.join(root, '大学ノート', '2026_秋学期', '管理会計Ⅱ', '第02回_原価企画');

  const a = await files.ingest({term, course, round: r2, fileRef: {url: 'https://lms/file/1'}, fetchFile});
  assert.equal(a.result, 'saved');
  assert.deepEqual(await readdir(dir), ['第2回 資料.pdf']);
  assert.equal(a.material.sha256, sha256(Buffer.from('pdf one')));
  assert.equal(a.material.round_from, 'lms');

  assert.equal((await files.ingest({term, course, round: r2, fileRef: {url: 'https://lms/file/1'}, fetchFile})).result, 'skip', '同じ URL は取りに行かない');
  assert.equal((await files.ingest({term, course, round: r2, fileRef: {url: 'https://lms/file/2', name: 'copy.pdf'}, fetchFile})).result, 'dup', '同じ中身は保存しない');

  const c = await files.ingest({term, course, round: r2, fileRef: {url: 'https://lms/file/3', name: '第2回 資料.pdf'}, fetchFile});
  assert.equal(c.result, 'saved');
  assert.equal(c.material.name, '第2回 資料 (2).pdf', '同名で中身が違えば (2)');

  const d = await files.ingest({term, course, round: r2, fileRef: {url: 'https://lms/file/4', name: 'x.pdf'}, fetchFile});
  assert.equal(d.result, 'failed');
  assert.equal(d.reason, 'download');
  assert.equal((await files.ingest({term, course, round: r2, fileRef: {url: 'https://lms/none', name: 'x.pdf'}, fetchFile})).result, 'failed');

  // 自分で消した資料はダウンロードし直さない
  await unlink(path.join(dir, '第2回 資料.pdf'));
  assert.equal((await files.ingest({term, course, round: r2, fileRef: {url: 'https://lms/file/1'}, fetchFile})).result, 'skip');

  // LMS 側で更新された（modified が新しい）→ 新しい版
  table['https://lms/file/1'] = {body: 'pdf one v2'};
  const e = await files.ingest({term, course, round: r2, fileRef: {url: 'https://lms/file/1', name: '第2回 資料.pdf', modified: '2026-10-20T00:00:00Z'}, fetchFile});
  assert.equal(e.result, 'updated');
  assert.equal(e.material.version, 2);
  assert.equal(e.material.name, '第2回 資料 (v2).pdf');
  assert.equal(repo.listMaterials(course.id).length, 3);
  assert.equal((await readdir(dir)).filter((f) => f.startsWith('.')).length, 0, '一時ファイルが残らない');
});

test('回の移動・名前変更の追跡・複製の整理', async (t) => {
  const {root, repo, term, course, r2, r3, r0, files, trashed} = await setup(t);
  const fetchFile = fetchOf({'https://lms/file/1': {body: 'A'}, 'https://lms/file/2': {body: 'B'}, 'https://lms/file/3': {body: 'A'}});
  const base = path.join(root, '大学ノート', '2026_秋学期', '管理会計Ⅱ');
  const a = (await files.ingest({term, course, round: r0, fileRef: {url: 'https://lms/file/1', name: 'a.pdf'}, fetchFile})).material;
  const b = (await files.ingest({term, course, round: r2, fileRef: {url: 'https://lms/file/2', name: 'b.pdf'}, fetchFile})).material;

  // ドラッグで「その他」→ 第 2 回
  const moved = await files.relocate({term, course, material: a, round: r2});
  assert.equal(moved.path, path.join(base, '第02回_原価企画', 'a.pdf'));
  assert.equal(moved.round_from, 'user');
  assert.deepEqual((await readdir(path.join(base, 'その他'))).length, 0);

  // 本人が Finder で b.pdf を第 3 回に移し、名前も変えた
  await mkdir(path.join(base, '第03回_原価維持'), {recursive: true});
  await rename(b.path, path.join(base, '第03回_原価維持', 'renamed.pdf'));
  const changes = await files.reconcileFiles({term, course, rounds: [r0, r2, r3]});
  assert.deepEqual(changes.map((c) => c.change), ['moved-round']);
  const b2 = repo.get('material', b.id);
  assert.equal(b2.round_id, r3.id);
  assert.equal(b2.name, 'renamed.pdf');
  assert.equal(b2.round_from, 'user');

  // 消したら missing、戻したら ok
  await unlink(b2.path);
  assert.deepEqual((await files.reconcileFiles({term, course, rounds: [r0, r2, r3]})).map((c) => c.change), ['missing']);
  assert.equal(repo.get('material', b.id).status, 'missing');
  await writeFile(b2.path, 'B');
  assert.deepEqual((await files.reconcileFiles({term, course, rounds: [r0, r2, r3]})).map((c) => c.change), ['found']);

  // 複製の整理：記録が「z (2).pdf」で、元の名前のファイルが残っていて中身が記録どおりならゴミ箱へ。
  // 中身が記録と違う「y (2).pdf」（本人が編集した）は触らない
  const r3dir = path.join(base, '第03回_原価維持');
  await writeFile(path.join(r3dir, 'z.pdf'), 'Z');
  await writeFile(path.join(r3dir, 'z (2).pdf'), 'Z');
  repo.createMaterial({course_id: course.id, round_id: r3.id, url: 'https://lms/file/z', name: 'z (2).pdf', path: path.join(r3dir, 'z (2).pdf'), sha256: sha256(Buffer.from('Z')), size: 1, source: 'lms'});
  await writeFile(path.join(r3dir, 'y.pdf'), 'Y');
  await writeFile(path.join(r3dir, 'y (2).pdf'), 'edited');
  repo.createMaterial({course_id: course.id, round_id: r3.id, url: 'https://lms/file/y', name: 'y (2).pdf', path: path.join(r3dir, 'y (2).pdf'), sha256: sha256(Buffer.from('Y')), size: 1, source: 'lms'});
  const trashedNow = await files.trashDuplicates(course);
  assert.deepEqual(trashedNow.map((m) => m.name), ['z (2).pdf']);
  assert.deepEqual(trashed.map((f) => path.basename(f)), ['z (2).pdf']);
  assert.equal(repo.findMaterialsByUrl('https://lms/file/z')[0].status, 'trashed');
  assert.equal(repo.findMaterialsByUrl('https://lms/file/y')[0].status, 'ok');
  assert.deepEqual((await readdir(r3dir)).sort(), ['renamed.pdf', 'y (2).pdf', 'y.pdf', 'z.pdf']);
});

test('フォルダの改名と合流', async (t) => {
  const {root, files} = await setup(t);
  const from = path.join(root, 'from'),
    to = path.join(root, 'to');
  await mkdir(from, {recursive: true});
  await mkdir(to, {recursive: true});
  await writeFile(path.join(from, 'same.pdf'), 'S');
  await writeFile(path.join(to, 'same.pdf'), 'S');
  await writeFile(path.join(from, 'diff.pdf'), 'X');
  await writeFile(path.join(to, 'diff.pdf'), 'Y');
  await writeFile(path.join(from, 'only.pdf'), 'O');
  await files.renameDir(from, to);
  assert.deepEqual((await readdir(to)).sort(), ['diff (2).pdf', 'diff.pdf', 'only.pdf', 'same.pdf']);
  assert.equal(await readFile(path.join(to, 'diff (2).pdf'), 'utf8'), 'X');
  await assert.rejects(readdir(from));
  await files.renameDir(path.join(root, 'nothing'), path.join(root, 'nowhere')); // 元がなければ何もしない
});
