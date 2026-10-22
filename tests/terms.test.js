import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/main/db/db.js';
import {Repo} from '../src/main/db/repo.js';
import {cleanLabel, newTermId, saveTerm} from '../src/main/terms.js';

async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dn-terms-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const {db} = await openDatabase(':memory:');
  return {root, repo: new Repo(db)};
}
const fall = {year: 2026, label: '秋学期', start: '2026-10-01', end: '2027-03-31', rounds: 15, holidays: []};

test('学期名を変えても同じ学期のまま：秋学期を前期にでき、授業はその学期に付いたまま', async (t) => {
  const {root, repo} = await setup(t);
  const a = await saveTerm({repo, rootDir: root}, fall);
  assert.equal(a.id, '2026-fall');
  const course = repo.createCourse({term_id: a.id, name: '管理会計', folder_name: '管理会計'});
  const b = await saveTerm({repo, rootDir: root}, {...fall, id: a.id, label: '前期'});
  assert.equal(b.id, '2026-fall', 'id は変えない');
  assert.equal(b.label, '前期');
  assert.equal(b.folder, '2026_前期');
  assert.equal(repo.listTerms().length, 1, '別の学期を増やさない');
  assert.equal(repo.get('course', course.id).term_id, '2026-fall');
  assert.equal(b.start_date, '2026-10-01', '日付は入れたまま（学期名で勝手に変えない）');
});

test('学期名は自由に入れられる（候補にない名前も）。空・長すぎは断る', async (t) => {
  const {root, repo} = await setup(t);
  const a = await saveTerm({repo, rootDir: root}, {...fall, label: '  1学期 '});
  assert.equal(a.label, '1学期');
  assert.equal(a.id, '2026-year');
  const b = await saveTerm({repo, rootDir: root}, {...fall, id: a.id, label: 'Fall Semester'});
  assert.equal(b.label, 'Fall Semester');
  assert.throws(() => cleanLabel('  '), /入れて/);
  assert.throws(() => cleanLabel('あ'.repeat(21)), /20 文字/);
});

test('学期名を変えると、パソコンの学期フォルダの名前と、中の資料・自分のフォルダの記録も変わる', async (t) => {
  const {root, repo} = await setup(t);
  const a = await saveTerm({repo, rootDir: root}, fall);
  const courseDir = path.join(root, '2026_秋学期', '管理会計');
  await mkdir(courseDir, {recursive: true});
  await writeFile(path.join(courseDir, 'a.pdf'), 'pdf');
  const course = repo.createCourse({term_id: a.id, name: '管理会計', folder_name: '管理会計'});
  const own = repo.createCourse({term_id: a.id, name: 'メモ', folder_name: 'メモ', kind: 'folder', dir: path.join(root, '2026_秋学期', '自分のフォルダ', 'メモ')});
  const m = repo.createMaterial({course_id: course.id, name: 'a.pdf', path: path.join(courseDir, 'a.pdf'), sha256: 'x', size: 3, source: 'lms'});
  await saveTerm({repo, rootDir: root}, {...fall, id: a.id, label: '後期'});
  assert.ok(await stat(path.join(root, '2026_後期', '管理会計', 'a.pdf')));
  await assert.rejects(stat(path.join(root, '2026_秋学期')));
  assert.equal(repo.get('material', m.id).path, path.join(root, '2026_後期', '管理会計', 'a.pdf'));
  assert.equal(await readFile(repo.get('material', m.id).path, 'utf8'), 'pdf');
  assert.equal(repo.get('course', own.id).dir, path.join(root, '2026_後期', '自分のフォルダ', 'メモ'));
});

test('ほかの学期と同じ年度・学期名には直せない。新しく足すときに同じ名前があれば、その学期を直す', async (t) => {
  const {root, repo} = await setup(t);
  const a = await saveTerm({repo, rootDir: root}, fall);
  const b = await saveTerm({repo, rootDir: root}, {year: 2027, label: '前期', start: '2027-04-01', end: '2027-09-30', rounds: 15});
  await assert.rejects(saveTerm({repo, rootDir: root}, {...fall, id: b.id, year: 2026, label: '秋学期'}), /もうあります/);
  const again = await saveTerm({repo, rootDir: root}, {...fall, rounds: 14});
  assert.equal(again.id, a.id);
  assert.equal(again.rounds, 14);
  assert.equal(repo.listTerms().length, 2);
  await assert.rejects(saveTerm({repo, rootDir: root}, {...fall, id: 'nope'}), /見つかりません/);
  await assert.rejects(saveTerm({repo, rootDir: root}, {...fall, start: '2027-04-01'}), /終了日/);
});

test('新しい学期の id は年度と学期名からの鍵。使われていれば番号を付ける', () => {
  assert.equal(newTermId(2026, '春学期', new Set()), '2026-spring');
  assert.equal(newTermId(2026, '前期', new Set(['2026-spring'])), '2026-spring-2');
  assert.equal(newTermId(2026, '前期', new Set(['2026-spring', '2026-spring-2'])), '2026-spring-3');
});

test('授業・フォルダのない学期だけ消せる。最後の 1 つは消さない', async (t) => {
  const {removeTerm} = await import('../src/main/terms.js');
  const {root, repo} = await setup(t);
  const a = await saveTerm({repo, rootDir: root}, fall);
  assert.throws(() => removeTerm(repo, a.id), /最後/);
  const b = await saveTerm({repo, rootDir: root}, {...fall, label: '前期', start: '2026-04-01', end: '2026-09-30'});
  repo.createCourse({term_id: b.id, name: '会計', folder_name: '会計'});
  assert.throws(() => removeTerm(repo, b.id), /1 件/);
  removeTerm(repo, a.id);
  assert.deepEqual(repo.listTerms().map((x) => x.id), [b.id]);
  assert.throws(() => removeTerm(repo, 'nope'), /見つかりません/);
});
