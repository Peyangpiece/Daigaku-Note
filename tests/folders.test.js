import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, rename, readdir, utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/main/db/db.js';
import {Repo} from '../src/main/db/repo.js';
import {FileManager} from '../src/main/sync/files.js';
import {createFolders, listFiles, MY_FOLDER, TERM_FOLDERS} from '../src/main/folders.js';

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
