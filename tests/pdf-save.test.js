import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile, stat, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {openDatabase} from '../src/main/db/db.js';
import {Repo} from '../src/main/db/repo.js';
import {sha256} from '../src/main/sync/files.js';
import {annoKey, originalPath, overwritePdf, readBase} from '../src/main/pdf-save.js';

async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dn-pdfsave-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  const bytes = Buffer.from(await doc.save());
  const file = path.join(dir, '第1回 資料.pdf');
  await writeFile(file, bytes);
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  repo.upsertTerm({
    id: 't',
    label: '秋学期',
    year: 2026,
    folder: '2026_秋学期',
    start_date: '2026-10-01',
    end_date: '2027-03-31',
    rounds: 15,
    holidays_json: '[]'
  });
  const course = repo.createCourse({term_id: 't', name: '管理会計', folder_name: '管理会計'});
  const m = repo.createMaterial({
    course_id: course.id,
    name: path.basename(file),
    path: file,
    sha256: sha256(bytes),
    size: bytes.length,
    source: 'lms',
    status: 'ok'
  });
  return {dir, file, bytes, repo, course, m, originalsDir: path.join(dir, 'originals')};
}
const mask = (id, page = 1) => ({id, page, kind: 'mask', rect: {x: 50, y: 700, w: 200, h: 14}, body: null, style: {}});

test('上書き保存：注釈を描き込んでファイルを置き換え、元の写しを取っておく。注釈の鍵は元の SHA-256 のまま', async (t) => {
  const {file, bytes, repo, m, originalsDir, course} = await setup(t);
  const r = await overwritePdf({repo, material: m, annotations: [mask('a1')], originalsDir});
  assert.equal(r.changed, true);
  const now = await readFile(file);
  assert.notEqual(sha256(now), sha256(bytes), 'ファイルが描き込み済みに変わる（Finder で見ても注釈がある）');
  const after = repo.get('material', m.id);
  assert.equal(after.sha256, sha256(now));
  assert.equal(after.base_sha256, sha256(bytes));
  assert.equal(annoKey(after), sha256(bytes), '注釈・しおりは元の PDF に結び付いたまま');
  assert.deepEqual(await readFile(originalPath(originalsDir, sha256(bytes))), bytes, '元の写しはそのまま');
  const base = await readBase(after, originalsDir);
  assert.equal(base.pristine, true);
  assert.deepEqual(base.bytes, bytes, 'アプリで開くのは元の写し（注釈を 2 重に描かない）');
  assert.equal(
    repo.findMaterialByHash(course.id, sha256(bytes))?.id,
    m.id,
    '同期で LMS の元の PDF を取っても同じ資料と分かる'
  );
  assert.deepEqual(
    (await readdir(path.dirname(file))).filter((n) => n.startsWith('.daigaku-tmp')),
    [],
    '一時ファイルを残さない'
  );
});

test('2 回目以降も元の写しから作る（描き込み済みに重ねない）。注釈を全部消したら元の PDF に戻す', async (t) => {
  const {file, bytes, repo, m, originalsDir} = await setup(t);
  await overwritePdf({repo, material: m, annotations: [mask('a1')], originalsDir});
  const once = await readFile(file);
  await overwritePdf({repo, material: repo.get('material', m.id), annotations: [mask('a1')], originalsDir});
  assert.deepEqual(await readFile(file), once, '同じ注釈なら同じ中身（重ねて描いていない）');
  const r2 = await overwritePdf({
    repo,
    material: repo.get('material', m.id),
    annotations: [mask('a1'), mask('a2', 2)],
    originalsDir
  });
  assert.equal(r2.changed, true);
  const loaded = await PDFDocument.load(await readFile(file));
  assert.equal(loaded.getPageCount(), 2);
  await overwritePdf({repo, material: repo.get('material', m.id), annotations: [], originalsDir});
  assert.deepEqual(await readFile(file), bytes, '注釈がなければ元の PDF のまま');
  const back = repo.get('material', m.id);
  assert.equal(back.sha256, sha256(bytes));
  assert.equal(back.base_sha256, null);
});

test('ほかのアプリで変えられた PDF・元の写しがないときは上書きしない', async (t) => {
  const {file, repo, m, originalsDir} = await setup(t);
  await overwritePdf({repo, material: m, annotations: [mask('a1')], originalsDir});
  const saved = repo.get('material', m.id);
  await writeFile(file, Buffer.concat([await readFile(file), Buffer.from('\n% edited elsewhere\n')]));
  const edited = await readFile(file);
  await assert.rejects(
    overwritePdf({repo, material: saved, annotations: [mask('a1'), mask('a2')], originalsDir}),
    (e) => e.code === 'conflict'
  );
  assert.deepEqual(await readFile(file), edited, 'ほかのアプリの変更を消さない');

  // 記録が今のファイルに合っていても、元の写しが消えていたら描き込めない（描き込み済みに重ねてしまうため）
  repo.updateMaterial(m.id, {sha256: sha256(edited)});
  await rm(originalPath(originalsDir, saved.base_sha256));
  await assert.rejects(
    overwritePdf({repo, material: repo.get('material', m.id), annotations: [mask('a1')], originalsDir}),
    (e) => e.code === 'no-original'
  );
  assert.equal((await readBase(repo.get('material', m.id), originalsDir)).pristine, false);
  assert.ok((await stat(file)).size > 0);
});

test('上書き保存の途中で落ちた（ファイルを置き換えたあと、記録を直す前）：次の上書き保存で記録を直して続ける（衝突にしない）', async (t) => {
  const {file, bytes, repo, m, originalsDir} = await setup(t);
  // 記録を直すところで落ちる
  const crashing = Object.create(repo);
  crashing.updateMaterial = () => {
    throw new Error('落ちた');
  };
  await assert.rejects(overwritePdf({repo: crashing, material: m, annotations: [mask('a1')], originalsDir}), /落ちた/);
  const replaced = await readFile(file);
  assert.notEqual(sha256(replaced), sha256(bytes), 'ファイルは置き換わっている');
  assert.equal(repo.get('material', m.id).sha256, sha256(bytes), '記録は古いまま');
  // 次の上書き保存：ほかのアプリでの変更とは扱わず、記録を直して続ける
  const r = await overwritePdf({
    repo,
    material: repo.get('material', m.id),
    annotations: [mask('a1'), mask('a2', 2)],
    originalsDir
  });
  assert.equal(r.changed, true);
  const after = repo.get('material', m.id);
  assert.equal(after.sha256, sha256(await readFile(file)));
  assert.equal(after.base_sha256, sha256(bytes));
  assert.deepEqual(repo.getSetting('pdf.saving', {}), {}, '途中の記録は残さない');
});

test('置き換える前に失敗したら（書き込めない）、一時ファイルも途中の記録も残さず、ファイルはそのまま', async (t) => {
  const {dir, file, bytes, repo, m, originalsDir} = await setup(t);
  // フォルダを書き込み禁止にして失敗させる。root と Windows（フォルダの chmod が効かない）ではできないので飛ばす
  if (process.getuid?.() === 0) return t.skip('root では書き込み禁止にならない');
  if (process.platform === 'win32') return t.skip('Windows ではフォルダの chmod で書き込み禁止にならない');
  const {chmod} = await import('node:fs/promises');
  // 元の写しを先に作っておく（フォルダを書き込み禁止にする前に）
  await overwritePdf({repo, material: m, annotations: [mask('a1')], originalsDir});
  const before = await readFile(file);
  await chmod(dir, 0o555);
  try {
    await assert.rejects(
      overwritePdf({repo, material: repo.get('material', m.id), annotations: [mask('a1'), mask('a2', 2)], originalsDir})
    );
  } finally {
    await chmod(dir, 0o755);
  }
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual(
    (await readdir(dir)).filter((n) => n.startsWith('.daigaku-tmp')),
    []
  );
  assert.equal(repo.get('material', m.id).sha256, sha256(before));
  assert.deepEqual(repo.getSetting('pdf.saving', {}), {}, '途中の記録は残さない');
  void bytes;
});
