// 資料をまたいで探す（main/search.js・shared/search.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/main/db/db.js';
import {Repo} from '../src/main/db/repo.js';
import {createSearch} from '../src/main/search.js';
import {likeOf, normText, snippetOf, termsOf} from '../src/shared/search.js';

test('比べ方：空白・全角半角・大文字小文字を無視する。探す言葉は空白で区切る', () => {
  assert.equal(normText('Ｃｏｓｔ　 Accounting\n原 価'), 'costaccounting原価');
  assert.deepEqual(termsOf('  原価　ＡＢＣ '), ['原価', 'abc']);
  assert.equal(likeOf('50%_a\\'), '%50\\%\\_a\\\\%');
});

test('見つけた所の前後：もとの文字（空白・全角のまま）から取り出す', () => {
  const s = snippetOf('標準 原価 計算では、原価差異を分析する。ＡＢＣ（活動基準原価計算）も扱う。', '原価計算', 6);
  assert.deepEqual(s, {before: '標準 ', match: '原価 計算', after: 'では、原価差…'});
  assert.equal(snippetOf('ＡＢＣ分析', 'abc').match, 'ＡＢＣ');
  assert.equal(snippetOf('なにもない', '原価'), null);
});

async function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dn-search-'));
  const {db} = await openDatabase(path.join(dir, 'a.sqlite'));
  const repo = new Repo(db);
  db.exec('PRAGMA foreign_keys = OFF');
  const course = db.prepare(
    `INSERT INTO course (id, term_id, name, folder_name, kind, hidden, created_at, updated_at)
     VALUES (?, 'T', ?, ?, ?, 0, '2026-11-01', '2026-11-01')`
  );
  course.run('C1', '管理会計', '管理会計', 'lms');
  course.run('C2', '統計学', '統計学', 'folder');
  db.prepare(
    "INSERT INTO round (id, course_id, number, title, folder_name) VALUES ('R3', 'C1', 3, '原価企画', '第03回')"
  ).run();
  const mat = db.prepare(
    `INSERT INTO material (id, course_id, round_id, name, path, sha256, size, source, status, downloaded_at, base_sha256)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'lms', ?, '2026-11-01', ?)`
  );
  mat.run('M1', 'C1', 'R3', '第3回 原価企画.pdf', '/x/a.pdf', 'h1', 'ok', 'h1base');
  mat.run('M2', 'C2', null, 'regression.pdf', '/x/b.pdf', 'h2', 'ok', null);
  mat.run('M3', 'C2', null, 'なくした原価.pdf', '/x/c.pdf', 'h3', 'missing', null);
  mat.run('M4', 'C2', null, 'photo.png', '/x/d.png', 'h4', 'ok', null);
  return {db, repo};
}

test('探す：名前・本文・書き込み・回のメモ・授業の名前。見つからない資料は出さない', async () => {
  const {db, repo} = await setup();
  const read = [];
  const texts = {
    '/x/a.pdf': [
      {page: 1, text: '目標 原価の設定'},
      {page: 2, text: 'ＶＥ（価値工学）と原価 企画の関係'}
    ],
    '/x/b.pdf': [{page: 1, text: 'Simple Regression と 最小二乗法'}]
  };
  const search = createSearch({
    repo,
    extract: async (file) => (read.push(file), {method: 'fake', pages: texts[file]})
  });
  assert.equal(search.query('原価').pending, 2, 'まだ読んでいない資料（PDF 2 つ。見つからないもの・画像は数えない）');
  assert.equal(await search.index(), 2);
  assert.deepEqual(read.sort(), ['/x/a.pdf', '/x/b.pdf']);
  assert.equal(await search.index(), 0, '読んだものは読み直さない');

  // 本文：空白・全角半角を無視。ページと前後の文字を返す
  const r = search.query('原価企画');
  assert.equal(r.pending, 0);
  assert.deepEqual(
    r.materials.map((m) => [m.id, m.nameHit, m.courseName, m.round, m.pdf]),
    [['M1', true, '管理会計', '第3回 原価企画', true]]
  );
  assert.deepEqual(r.materials[0].hits, [
    {page: 2, where: 'text', before: 'ＶＥ（価値工学）と', match: '原価 企画', after: 'の関係'}
  ]);
  assert.deepEqual(
    search.query('regression 二乗').materials.map((m) => m.id),
    ['M2'],
    '言葉をすべて含むページ'
  );
  assert.deepEqual(search.query('regression 原価').materials, []);
  assert.deepEqual(search.query('ve').materials[0].hits[0].match, 'ＶＥ');

  // 書き込んだ文字（PDF は書き込む前の中身に結び付く）
  db.prepare(
    `INSERT INTO annotation (id, sha256, page, kind, rect_json, body, z, created_at, updated_at)
     VALUES ('A1', 'h1base', 1, 'note', '{}', 'ここは試験に出る', 0, '2026-11-01', '2026-11-01')`
  ).run();
  assert.deepEqual(search.query('試験').materials[0].hits, [
    {page: 1, where: 'note', before: 'ここは', match: '試験', after: 'に出る'}
  ]);

  // 回のメモ・授業の名前
  db.prepare("INSERT INTO round_note (round_id, body, updated_at) VALUES ('R3', '来週は小テスト', '2026-11-01')").run();
  assert.deepEqual(search.query('小テスト').notes, [
    {courseId: 'C1', courseName: '管理会計', round: '第3回 原価企画', before: '来週は', match: '小テスト', after: ''}
  ]);
  assert.deepEqual(search.query('統計').courses, [{id: 'C2', name: '統計学', folder: true}]);
  assert.deepEqual(search.query('  ').materials, []);
  // % と _ はそのままの文字として探す
  assert.deepEqual(search.query('%').materials, []);
});

test('探す：前の版で入れた本文（比べる形がない）も、読み直さずに探せる。読めない資料は 1 度だけ試す', async () => {
  const {db, repo} = await setup();
  db.prepare("INSERT INTO material_text (sha256, page, text, method) VALUES ('h1', 1, '損益 分岐点', 'pdfjs')").run();
  let tries = 0;
  const search = createSearch({
    repo,
    extract: async () => {
      tries++;
      throw new Error('読めない');
    }
  });
  await search.index();
  assert.equal(tries, 1, '読んでいないのは b.pdf だけ');
  assert.equal(search.pending(), 0, '読めなかったものは数えない');
  await search.index();
  assert.equal(tries, 1);
  assert.deepEqual(
    search.query('損益分岐点').materials.map((m) => m.id),
    ['M1']
  );
});
