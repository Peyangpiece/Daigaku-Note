import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, rename, readdir, utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/main/db/db.js';
import {Repo} from '../src/main/db/repo.js';
import {FileManager} from '../src/main/sync/files.js';
import {createFolders, listFiles, renameCourse, MY_FOLDER, TERM_FOLDERS} from '../src/main/folders.js';

async function setup(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'dn-folders-'));
  t.after(() => rm(base, {recursive: true, force: true}));
  const root = path.join(base, '大学ノート');
  await mkdir(root);
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  repo.upsertTerm({
    id: '2026-fall',
    label: '秋学期',
    year: 2026,
    folder: '2026_秋学期',
    start_date: '2026-10-01',
    end_date: '2027-03-31',
    rounds: 15,
    holidays_json: '[]'
  });
  const folders = createFolders({repo, rootDir: () => root, today: () => '2026-10-20'});
  const files = new FileManager({repo, root: () => root, trash: async (f) => rm(f, {force: true})});
  const live = (id) => repo.listMaterials(id).filter((m) => m.status !== 'trashed');
  return {base, root, repo, folders, files, live};
}

test('フォルダを作る：今学期は 学期/自分のフォルダ/名前、マイフォルダは マイフォルダ/名前。同じ名前は (2)', async (t) => {
  const {root, repo, folders} = await setup(t);
  const a = await folders.create({name: 'ゼミ', scope: 'term', mode: 'new'});
  assert.equal(a.kind, 'folder');
  assert.equal(a.dir, path.join(root, '2026_秋学期', TERM_FOLDERS, 'ゼミ'));
  assert.equal(a.term_id, '2026-fall');
  const b = await folders.create({name: '就活', scope: 'always', mode: 'new'});
  assert.equal(b.dir, path.join(root, MY_FOLDER, '就活'));
  const c = await folders.create({name: 'ゼミ', scope: 'term', mode: 'new'});
  assert.equal(path.basename(c.dir), 'ゼミ (2)');
  assert.ok(repo.findRound(a.id, 0), 'クイズ用の見えない回がある');
  await assert.rejects(folders.create({name: '  ', scope: 'term', mode: 'new'}), /名前/);
});

test('ファイルを追加すると作ったフォルダにコピーされ、読み直しても 2 重にならない', async (t) => {
  const {repo, folders, files, live} = await setup(t);
  const f = await folders.create({name: 'ゼミ', scope: 'always', mode: 'new'});
  const term = repo.get('term', f.term_id);
  const r = await files.addOwn({
    term,
    course: f,
    round: folders.roundOf(f),
    name: 'レジュメ.pdf',
    data: Buffer.from('%PDF-1 a')
  });
  assert.equal(r.result, 'saved');
  assert.equal(path.dirname(r.material.path), f.dir);
  assert.deepEqual(await readdir(f.dir), ['レジュメ.pdf']);
  const s = await folders.scan(f.id);
  assert.deepEqual({added: s.added, removed: s.removed}, {added: 0, removed: 0});
  assert.equal(live(f.id).length, 1);
});

test('パソコンのフォルダを登録：コピーせずに中身を出し、増えた・消えた・名前を変えたファイルを読み直しで合わせる', async (t) => {
  const {base, root, folders, live, repo} = await setup(t);
  const dir = path.join(base, 'ゼミ 2026');
  await mkdir(path.join(dir, '第1回'), {recursive: true});
  await writeFile(path.join(dir, 'シラバス.pdf'), 'syllabus');
  await writeFile(path.join(dir, '第1回', 'スライド.pptx'), 'slide');
  await writeFile(path.join(dir, '.DS_Store'), 'x');
  await writeFile(path.join(dir, '~$下書き.docx'), 'x');
  const f = await folders.create({name: '', scope: 'term', mode: 'link', dir});
  assert.equal(f.name, 'ゼミ 2026');
  assert.equal(f.dir, dir, 'その場所のまま');
  let s = await folders.scan(f.id);
  assert.equal(s.added, 2, '隠しファイルと Office の一時ファイルは出さない');
  assert.deepEqual(
    live(f.id)
      .map((m) => m.path)
      .sort(),
    [path.join(dir, 'シラバス.pdf'), path.join(dir, '第1回', 'スライド.pptx')].sort()
  );
  assert.ok(live(f.id).every((m) => m.source === 'folder' && m.read_at));

  const slide = live(f.id).find((m) => m.name === 'スライド.pptx');
  await rename(path.join(dir, '第1回', 'スライド.pptx'), path.join(dir, '第1回', 'スライド_改.pptx'));
  await writeFile(path.join(dir, 'メモ.txt'), 'memo');
  await rm(path.join(dir, 'シラバス.pdf'));
  s = await folders.scan(f.id);
  assert.deepEqual({added: s.added, removed: s.removed}, {added: 1, removed: 1});
  const moved = repo.get('material', slide.id);
  assert.equal(moved.name, 'スライド_改.pptx', '名前を変えても同じ記録（注釈・クイズの資料を保つ）');
  assert.equal(moved.status, 'ok');

  await writeFile(path.join(dir, 'メモ.txt'), 'memo 2');
  await utimes(path.join(dir, 'メモ.txt'), new Date(), new Date(Date.now() + 5000));
  await folders.scan(f.id);
  assert.equal(live(f.id).find((m) => m.name === 'メモ.txt').size, 6, '中身が変わったら読み直す');

  const again = await folders.create({name: '', scope: 'always', mode: 'link', dir});
  assert.equal(again.id, f.id, '同じフォルダは 2 重に登録しない');
  assert.equal(repo.get('course', f.id).scope, 'always');

  await assert.rejects(folders.create({name: '', scope: 'term', mode: 'link', dir: root}), /保存先/);
  await assert.rejects(folders.create({name: '', scope: 'term', mode: 'link', dir: base}), /保存先/);
  await assert.rejects(
    folders.create({name: '', scope: 'term', mode: 'link', dir: path.join(base, 'ない')}),
    /見つかりません/
  );

  await rm(dir, {recursive: true});
  s = await folders.scan(f.id);
  assert.equal(s.missing, true, 'フォルダごと見つからないときは記録を消さない');
  assert.equal(live(f.id).length, 2);
});

test('ファイルが多いときは打ち切り、読まなかったファイルを消したことにしない', async (t) => {
  const {base} = await setup(t);
  const dir = path.join(base, 'many');
  await mkdir(dir);
  for (let i = 0; i < 5; i++) await writeFile(path.join(dir, `f${i}.txt`), String(i));
  const r = await listFiles(dir, {max: 3});
  assert.equal(r.files.length, 3);
  assert.equal(r.truncated, true);
});

test('LMS をつながずに（学期がないまま）フォルダを作ると、今日の日付から仮の学期を作る', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'dn-folders-'));
  t.after(() => rm(base, {recursive: true, force: true}));
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  const folders = createFolders({repo, rootDir: () => base, today: () => '2026-10-20'});
  const f = await folders.create({name: 'ゼミ', scope: 'term', mode: 'new'});
  const terms = repo.listTerms();
  assert.equal(terms.length, 1);
  assert.equal(terms[0].label, '秋学期');
  assert.equal(terms[0].source, 'auto');
  assert.equal(f.term_id, terms[0].id);
  assert.equal(f.dir, path.join(base, '2026_秋学期', TERM_FOLDERS, 'ゼミ'));
  await folders.create({name: '就活', scope: 'always', mode: 'new'});
  assert.equal(repo.listTerms().length, 1, '2 つ目からは同じ学期を使う');
});

test('名前を変える：パソコンのフォルダの名前も変わり、同じ親フォルダの中のまま。中のファイルは動かさず、記録は引き継ぐ', async (t) => {
  const {root, repo, folders, live} = await setup(t);
  const c = await folders.create({name: 'ゼミ', scope: 'always', mode: 'new'});
  await mkdir(path.join(c.dir, '資料'));
  await writeFile(path.join(c.dir, '資料', 'a.pdf'), 'A');
  await writeFile(path.join(c.dir, 'b.txt'), 'B');
  await folders.scan(c.id);
  const before = live(c.id);
  repo.updateMaterial(before.find((m) => m.name === 'a.pdf').id, {read_at: null});

  // フォルダ全体の名前
  const r = await folders.rename(c.id, '卒論ゼミ');
  const parent = path.join(root, MY_FOLDER);
  assert.equal(r.name, '卒論ゼミ');
  assert.equal(r.dir, path.join(parent, '卒論ゼミ'));
  assert.deepEqual((await readdir(parent)).sort(), ['卒論ゼミ']);
  assert.deepEqual((await readdir(r.dir)).sort(), ['b.txt', '資料']);
  const after = live(c.id);
  assert.deepEqual(after.map((m) => m.id).sort(), before.map((m) => m.id).sort());
  assert.equal(after.find((m) => m.name === 'a.pdf').path, path.join(r.dir, '資料', 'a.pdf'));

  // 中の小さなフォルダの名前
  await folders.renameSub(c.id, '資料', '配付資料');
  assert.deepEqual((await readdir(r.dir)).sort(), ['b.txt', '配付資料']);
  const a = live(c.id).find((m) => m.name === 'a.pdf');
  assert.equal(a.id, before.find((m) => m.name === 'a.pdf').id); // 記録（注釈・しおり・未読）はそのまま
  assert.equal(a.read_at, null);
  assert.equal(a.path, path.join(r.dir, '配付資料', 'a.pdf'));
  assert.equal(live(c.id).length, 2);

  // 同じ名前がもうあれば変えない。外へ出る名前は使えない
  await mkdir(path.join(r.dir, '別'));
  await assert.rejects(folders.renameSub(c.id, '配付資料', '別'), /もうあります/);
  await assert.rejects(folders.renameSub(c.id, '配付資料', '../x'), /使えない文字/);
  await assert.rejects(folders.renameSub(c.id, '../..', 'x'), /不正/);
});

test('LMS を使わない授業の名前を変える：授業フォルダの名前も変わり、学期のフォルダの中のまま', async (t) => {
  const {root, repo, files, live} = await setup(t);
  const conn = repo.createConnection({kind: 'manual', connector_id: 'manual', label: '手動'});
  const c = repo.createCourse({term_id: '2026-fall', connection_id: conn.id, name: '英語', folder_name: '英語'});
  const other = repo.createCourse({term_id: '2026-fall', connection_id: conn.id, name: '数学', folder_name: '数学'});
  await files.addOwn({
    term: repo.get('term', '2026-fall'),
    course: c,
    round: null,
    name: 'w.pdf',
    data: Buffer.from('W')
  });
  const m = live(c.id)[0];
  const ctx = {repo, courseDir: (term, course) => files.courseDir(term, course)};
  const r = await renameCourse(ctx, c.id, '英語Ⅰ');
  assert.equal(r.name, '英語Ⅰ');
  assert.equal(r.folder_name, '英語Ⅰ');
  const termDir = path.join(root, '2026_秋学期');
  assert.ok((await readdir(termDir)).includes('英語Ⅰ'));
  assert.ok(!(await readdir(termDir)).includes('英語'));
  const m2 = repo.get('material', m.id);
  assert.equal(m2.path, m.path.replace(path.join(termDir, '英語'), path.join(termDir, '英語Ⅰ')));
  assert.equal(await (await import('node:fs/promises')).readFile(m2.path, 'utf8'), 'W');
  await assert.rejects(renameCourse(ctx, c.id, other.name), /もうあります/);
});

test('中のフォルダを 1 つずつ登録する：今学期のフォルダ（選べばマイフォルダ）として登録する（コピーしない）。中になければそのもの', async (t) => {
  const {base, repo, folders, live} = await setup(t);
  const src = path.join(base, '授業');
  await mkdir(path.join(src, '経済学'), {recursive: true});
  await mkdir(path.join(src, '統計学'));
  await mkdir(path.join(src, '.hidden'));
  await writeFile(path.join(src, '経済学', 'a.pdf'), 'A');
  await writeFile(path.join(src, 'メモ.txt'), 'M');
  const r = await folders.importCourses(src);
  assert.deepEqual(
    r.added.map((c) => c.name),
    ['経済学', '統計学']
  );
  assert.deepEqual(r.failed, []);
  for (const c of r.added) assert.equal(c.scope, 'term');
  assert.equal(r.added[0].dir, path.join(src, '経済学'));
  assert.deepEqual(
    live(r.added[0].id).map((m) => m.name),
    ['a.pdf']
  );
  assert.deepEqual(await readdir(path.join(src, '経済学')), ['a.pdf']); // 元のフォルダはそのまま
  // 同じフォルダをもう一度取り込んでも、増えない
  const again = await folders.importCourses(src);
  assert.equal(again.added.length, 2);
  assert.equal(repo.listCourses().filter((c) => c.kind === 'folder').length, 2);
  // 中にフォルダがなければ、選んだフォルダそのものを登録する
  const one = path.join(base, '一つ');
  await mkdir(one);
  const r2 = await folders.importCourses(one);
  assert.deepEqual(
    r2.added.map((c) => c.dir),
    [one]
  );
  await assert.rejects(folders.importCourses(path.join(base, 'ない')), /見つかりません/);
  // マイフォルダとして 1 つずつ登録する（「パソコンのフォルダを登録」で種類を選んだとき）
  const keep = path.join(base, '残す');
  await mkdir(path.join(keep, 'ゼミ'), {recursive: true});
  const r3 = await folders.importCourses(keep, {scope: 'always'});
  assert.deepEqual(
    r3.added.map((c) => [c.name, c.scope]),
    [['ゼミ', 'always']]
  );
});

test('上書き保存したあと、ほかのアプリで変えた PDF：読み直すと変えたファイルが新しい元になり、次の上書き保存でその変更を消さない', async (t) => {
  const {PDFDocument} = await import('pdf-lib');
  const {readFile} = await import('node:fs/promises');
  const {overwritePdf, annoKey} = await import('../src/main/pdf-save.js');
  const {sha256} = await import('../src/main/sync/files.js');
  const {normalizeAnnotation} = await import('../src/shared/annotation.js');
  const {base, repo, folders, files} = await setup(t);
  const f = await folders.create({name: 'ゼミ', scope: 'always', mode: 'new'});
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const orig = Buffer.from(await doc.save());
  const r = await files.addOwn({
    term: repo.get('term', f.term_id),
    course: f,
    round: folders.roundOf(f),
    name: 'レジュメ.pdf',
    data: orig
  });
  const originalsDir = path.join(base, 'originals');
  const anno = normalizeAnnotation({kind: 'mask', page: 1, rect: {x: 50, y: 700, w: 200, h: 14}, body: '', style: {}});
  repo.saveAnnotation(sha256(orig), null, anno);
  const list = () =>
    repo
      .listAnnotations(annoKey(repo.get('material', r.material.id)))
      .map((a) => ({...a, rect: JSON.parse(a.rect_json), style: {}}));
  // 1. アプリで上書き保存（元の写しを取っておき、注釈を描き込む）
  await overwritePdf({repo, material: repo.get('material', r.material.id), annotations: list(), originalsDir});
  assert.equal(repo.get('material', r.material.id).base_sha256, sha256(orig));
  // 2. ほかのアプリで編集（ページを 1 枚足す）。更新日時も変わる
  const saved = await PDFDocument.load(await readFile(r.material.path));
  saved.addPage([595, 842]);
  const edited = Buffer.from(await saved.save());
  await writeFile(r.material.path, edited);
  const later = new Date(Date.now() + 5000);
  await utimes(r.material.path, later, later);
  // 3. フォルダを読み直す：変わったファイルが新しい元になる
  const s = await folders.scan(f.id);
  assert.equal(s.rebased, 1);
  const m = repo.get('material', r.material.id);
  assert.equal(m.sha256, sha256(edited));
  assert.equal(m.base_sha256, null);
  // 4. もう一度上書き保存しても、ほかのアプリでの変更は消えない
  await overwritePdf({repo, material: m, annotations: list(), originalsDir});
  assert.deepEqual(await readFile(r.material.path), edited, 'ほかのアプリで足したページが残る');
});

test('上書き保存したあと、元の中身に戻されたファイル：注釈はそのまま動かせる（知らせない）', async (t) => {
  const {PDFDocument} = await import('pdf-lib');
  const {overwritePdf} = await import('../src/main/pdf-save.js');
  const {sha256} = await import('../src/main/sync/files.js');
  const {base, repo, folders, files} = await setup(t);
  const f = await folders.create({name: 'ゼミ', scope: 'always', mode: 'new'});
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const orig = Buffer.from(await doc.save());
  const r = await files.addOwn({
    term: repo.get('term', f.term_id),
    course: f,
    round: folders.roundOf(f),
    name: 'a.pdf',
    data: orig
  });
  const mask = {id: 'x', page: 1, kind: 'mask', rect: {x: 50, y: 700, w: 200, h: 14}, body: '', style: {}};
  await overwritePdf({
    repo,
    material: repo.get('material', r.material.id),
    annotations: [mask],
    originalsDir: path.join(base, 'o')
  });
  await writeFile(r.material.path, orig);
  const later = new Date(Date.now() + 5000);
  await utimes(r.material.path, later, later);
  const s = await folders.scan(f.id);
  assert.equal(s.rebased, 0);
  const m = repo.get('material', r.material.id);
  assert.equal(m.sha256, sha256(orig));
  assert.equal(m.base_sha256, null, '注釈の鍵は元の SHA-256 のまま（base が sha256 と同じになった）');
});
