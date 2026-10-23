import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/main/db/db.js';
import {Repo} from '../src/main/db/repo.js';
import {cleanLabel, newTermId, recomputeRoundDates, saveTerm} from '../src/main/terms.js';

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
  const own = repo.createCourse({
    term_id: a.id,
    name: 'メモ',
    folder_name: 'メモ',
    kind: 'folder',
    dir: path.join(root, '2026_秋学期', '自分のフォルダ', 'メモ')
  });
  const m = repo.createMaterial({
    course_id: course.id,
    name: 'a.pdf',
    path: path.join(courseDir, 'a.pdf'),
    sha256: 'x',
    size: 3,
    source: 'lms'
  });
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
  const b = await saveTerm(
    {repo, rootDir: root},
    {year: 2027, label: '前期', start: '2027-04-01', end: '2027-09-30', rounds: 15}
  );
  await assert.rejects(
    saveTerm({repo, rootDir: root}, {...fall, id: b.id, year: 2026, label: '秋学期'}),
    /もうあります/
  );
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
  assert.deepEqual(
    repo.listTerms().map((x) => x.id),
    [b.id]
  );
  assert.throws(() => removeTerm(repo, 'nope'), /見つかりません/);
});

test('学期フォルダの移し先がもうあれば中身を合わせる。空のフォルダが残っていても名前を変えられる', async (t) => {
  const {moveDir} = await import('../src/main/terms.js');
  const {root, repo} = await setup(t);
  const a = await saveTerm({repo, rootDir: root}, fall);
  await mkdir(path.join(root, '2026_秋学期', '会計'), {recursive: true});
  await writeFile(path.join(root, '2026_秋学期', '会計', 'a.pdf'), 'a');
  await mkdir(path.join(root, '2026_前期', '自分のフォルダ'), {recursive: true}); // 前の不具合で残った空のフォルダ
  await saveTerm({repo, rootDir: root}, {...fall, id: a.id, label: '前期'});
  assert.equal(await readFile(path.join(root, '2026_前期', '会計', 'a.pdf'), 'utf8'), 'a');
  await assert.rejects(stat(path.join(root, '2026_秋学期')));
  // 同じ名前のファイルがあれば止める（上書きしない）
  await mkdir(path.join(root, 'x', 'c'), {recursive: true});
  await writeFile(path.join(root, 'x', 'c', 'f.txt'), '1');
  await mkdir(path.join(root, 'y', 'c'), {recursive: true});
  await writeFile(path.join(root, 'y', 'c', 'f.txt'), '2');
  await assert.rejects(moveDir(path.join(root, 'x'), path.join(root, 'y')), /同じ名前/);
  assert.equal(await readFile(path.join(root, 'y', 'c', 'f.txt'), 'utf8'), '2');
});

test('仮の学期をまとめるとき、授業とパソコンのフォルダ・資料の記録も新しい学期へ移す', async (t) => {
  const {mergeAutoTerms} = await import('../src/main/terms.js');
  const {autoTerm} = await import('../src/shared/term.js');
  const {root, repo} = await setup(t);
  const auto = repo.upsertTerm(autoTerm('2026-10-22')); // 2026_秋学期
  const dir = path.join(root, auto.folder, '会計');
  await mkdir(dir, {recursive: true});
  await writeFile(path.join(dir, 'a.pdf'), 'a');
  const c = repo.createCourse({term_id: auto.id, name: '会計', folder_name: '会計'});
  const m = repo.createMaterial({
    course_id: c.id,
    name: 'a.pdf',
    path: path.join(dir, 'a.pdf'),
    sha256: 'x',
    size: 1,
    source: 'lms'
  });
  const row = await saveTerm(
    {repo, rootDir: root},
    {year: 2026, label: '後期', start: '2026-09-21', end: '2027-02-10', rounds: 15}
  );
  assert.notEqual(row.id, auto.id);
  await mergeAutoTerms({repo, rootDir: root}, row);
  assert.deepEqual(
    repo.listTerms().map((x) => x.id),
    [row.id]
  );
  assert.equal(repo.get('course', c.id).term_id, row.id);
  assert.equal(repo.get('material', m.id).path, path.join(root, '2026_後期', '会計', 'a.pdf'));
  assert.equal(await readFile(repo.get('material', m.id).path, 'utf8'), 'a');
});

test('学年暦を保存すると、その学期の授業の回の日付を計算し直す。LMS から来た日付はそのまま', async (t) => {
  const {root, repo} = await setup(t);
  const a = await saveTerm({repo, rootDir: root}, {...fall, start: '2026-09-21', end: '2027-01-31'});
  assert.equal(a.swaps_json, '[]');
  const course = repo.createCourse({
    term_id: a.id,
    name: '管理会計',
    folder_name: '管理会計',
    weekday: '月',
    period: 2
  });
  // 回 1〜3 は前の設定での計算の日付、回 4 は LMS から来た日付（計算と違う）
  const r1 = repo.createRound({course_id: course.id, number: 1, folder_name: '01', date: '2026-09-28'});
  const r2 = repo.createRound({course_id: course.id, number: 2, folder_name: '02', date: '2026-10-05'});
  const r3 = repo.createRound({course_id: course.id, number: 3, folder_name: '03', date: '2026-10-19'});
  const r4 = repo.createRound({course_id: course.id, number: 4, folder_name: '04', date: '2026-10-31'});
  const b = await saveTerm(
    {repo, rootDir: root},
    {...fall, id: a.id, start: '2026-09-21', end: '2027-01-31', swaps: [{date: '2026-10-12', weekday: '月'}]}
  );
  assert.deepEqual(JSON.parse(b.swaps_json), [{date: '2026-10-12', weekday: '月'}]);
  const n = recomputeRoundDates(repo, a, b);
  assert.equal(repo.get('round', r1.id).date, '2026-09-28');
  assert.equal(repo.get('round', r2.id).date, '2026-10-05');
  assert.equal(repo.get('round', r3.id).date, '2026-10-12', 'スポーツの日に授業を行うので第 3 回はその日');
  assert.equal(repo.get('round', r4.id).date, '2026-10-31', 'LMS から来た日付は変えない');
  assert.equal(n, 1);
});
