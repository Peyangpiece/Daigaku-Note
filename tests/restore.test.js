import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase, migrate} from '../src/main/db/db.js';
import {COLUMNS} from '../src/main/db/repo.js';
import {
  applyStagedRestore,
  dropUntrustedSettings,
  exportBackup,
  stageRestore,
  RESTORE_FILE,
  RESTORE_FROM_FILE
} from '../src/main/backup.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'dn-restore-'));

test('バックアップの書き出し：選んだファイルに整合した写しができ、読み直せる', async () => {
  const dir = tmp();
  const {db} = await openDatabase(path.join(dir, 'live.sqlite'));
  db.prepare(
    "INSERT INTO term (id, label, year, folder, start_date, end_date) VALUES ('t1', '春', 2026, '2026春', '2026-04-01', '2026-09-30')"
  ).run();
  const out = exportBackup(db, path.join(dir, 'out.sqlite'));
  assert.ok(out.size > 0 && existsSync(out.file));
  const copy = new DatabaseSync(out.file, {readOnly: true});
  assert.equal(copy.prepare('SELECT COUNT(*) c FROM term').get().c, 1);
  copy.close();
  db.close();
});

test('読み込みの準備：パレットノートのバックアップだけ受け付け、userData に写す。ただのファイルは断る', async () => {
  const dir = tmp();
  const {db} = await openDatabase(path.join(dir, 'live.sqlite'));
  exportBackup(db, path.join(dir, 'good.sqlite'));
  db.close();
  writeFileSync(path.join(dir, 'bad.sqlite'), 'not a database');
  const open = (f) => new DatabaseSync(f, {readOnly: true});
  assert.throws(() => stageRestore({userData: dir, src: path.join(dir, 'bad.sqlite'), open}), /バックアップ/);
  const r = stageRestore({userData: dir, src: path.join(dir, 'good.sqlite'), open});
  assert.equal(r.staged, path.join(dir, RESTORE_FILE));
  assert.ok(r.version >= 8);
  assert.ok(existsSync(r.staged));
});

test('起動時の入れ替え：予約があれば、いまのデータベースを before-restore として残して入れ替える。なければ何もしない', async () => {
  const dir = tmp();
  const dbFile = path.join(dir, 'daigaku-note.sqlite');
  assert.equal(applyStagedRestore({userData: dir, dbFile}), false);
  const {db} = await openDatabase(dbFile);
  db.prepare(
    "INSERT INTO term (id, label, year, folder, start_date, end_date) VALUES ('old', '古', 2025, '2025古', '2025-04-01', '2025-09-30')"
  ).run();
  exportBackup(db, path.join(dir, 'snap.sqlite'));
  db.close();
  const staged = stageRestore({
    userData: dir,
    src: path.join(dir, 'snap.sqlite'),
    open: (f) => new DatabaseSync(f, {readOnly: true})
  });
  assert.ok(existsSync(staged.staged));
  assert.equal(applyStagedRestore({userData: dir, dbFile, now: () => new Date('2026-10-26T00:00:00Z')}), true);
  assert.ok(!existsSync(staged.staged), '予約のファイルは本体になる');
  assert.ok(
    readdirSync(dir).some((f) => f.startsWith('daigaku-note.sqlite.before-restore-')),
    '前のものは残す'
  );
  const {db: db2} = await openDatabase(dbFile);
  assert.equal(db2.prepare("SELECT label FROM term WHERE id = 'old'").get().label, '古');
  db2.close();
});

test('起動時の入れ替え：残した before-restore に、閉じる前の直前の変更（-wal の中）も入っている', async () => {
  const live = tmp();
  const liveFile = path.join(live, 'daigaku-note.sqlite');
  const {db} = await openDatabase(liveFile);
  exportBackup(db, path.join(live, 'snap.sqlite'));
  // 開き直す直前の変更。アプリはデータベースを閉じずに終わるので、-wal にだけ入っている
  db.prepare(
    "INSERT INTO term (id, label, year, folder, start_date, end_date) VALUES ('last', '直前', 2026, '2026直前', '2026-04-01', '2026-09-30')"
  ).run();
  assert.ok(existsSync(`${liveFile}-wal`), 'WAL で動いている');
  // 閉じないまま終わったあとの形：本体と -wal をそのまま別の場所へ写す
  const dir = tmp();
  const dbFile = path.join(dir, 'daigaku-note.sqlite');
  for (const suffix of ['', '-wal']) copyFileSync(`${liveFile}${suffix}`, `${dbFile}${suffix}`);
  db.close();
  stageRestore({
    userData: dir,
    src: path.join(live, 'snap.sqlite'),
    open: (f) => new DatabaseSync(f, {readOnly: true})
  });
  assert.equal(applyStagedRestore({userData: dir, dbFile, now: () => new Date('2026-11-14T00:00:00Z')}), true);
  const kept = path.join(
    dir,
    readdirSync(dir).find((f) => /before-restore-[^.]*Z$/.test(f))
  );
  const old = new DatabaseSync(kept);
  assert.equal(old.prepare("SELECT label FROM term WHERE id = 'last'").get()?.label, '直前');
  old.close();
  assert.ok(!existsSync(`${dbFile}-wal`), '新しい本体に、前の -wal を混ぜない');
});

test('古い版のデータベースを上げられる：0001 だけのデータベースに全部のマイグレーションが当たり、repo が使う列がそろう', async () => {
  const dir = tmp();
  const only1 = path.join(dir, 'migrations');
  const {mkdirSync, copyFileSync} = await import('node:fs');
  mkdirSync(only1);
  copyFileSync(new URL('../src/main/db/migrations/0001_init.sql', import.meta.url), path.join(only1, '0001_init.sql'));
  const {db, applied} = await openDatabase(path.join(dir, 'old.sqlite'), {migrationsDir: only1});
  assert.deepEqual(applied, [1]);
  db.prepare(
    "INSERT INTO term (id, label, year, folder, start_date, end_date) VALUES ('t', '春', 2026, '2026春', '2026-04-01', '2026-09-30')"
  ).run();
  const later = migrate(db);
  assert.ok(later.length >= 7 && later[0] === 2, `残りが順に当たる: ${later}`);
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((r) => r.name)
    );
    for (const c of cols) assert.ok(have.has(c), `${table}.${c} が無い`);
  }
  assert.equal(db.prepare("SELECT label FROM term WHERE id = 't'").get().label, '春', 'データは残る');
  db.close();
});

test('読み込みの準備：この版より新しい版のアプリで作ったバックアップは断る（表の形が分からない）', async () => {
  const {latestVersion} = await import('../src/main/db/db.js');
  const dir = tmp();
  const {db} = await openDatabase(path.join(dir, 'live.sqlite'));
  exportBackup(db, path.join(dir, 'now.sqlite'));
  db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (9999, 'future', '2030-01-01')").run();
  exportBackup(db, path.join(dir, 'future.sqlite'));
  db.close();
  const open = (f) => new DatabaseSync(f, {readOnly: true});
  const maxVersion = latestVersion();
  assert.ok(maxVersion >= 8);
  assert.equal(stageRestore({userData: dir, src: path.join(dir, 'now.sqlite'), open, maxVersion}).version, maxVersion);
  assert.throws(
    () => stageRestore({userData: dir, src: path.join(dir, 'future.sqlite'), open, maxVersion}),
    /新しい版/
  );
});

test('読み込みの準備：壊れたファイルは予約しない。ファイルから読み込んだあとは、コマンドの場所の設定を使わない', async () => {
  const dir = tmp();
  const {db} = await openDatabase(path.join(dir, 'a.sqlite'));
  db.prepare("INSERT INTO settings (key, value) VALUES ('quiz.cli', ?)").run(
    JSON.stringify({claude: {path: '/tmp/evil'}})
  );
  db.prepare("INSERT INTO settings (key, value) VALUES ('ui.theme', ?)").run(JSON.stringify('dark'));
  const snap = path.join(dir, 'snap.sqlite');
  exportBackup(db, snap);
  db.close();
  // 途中のページを書きつぶした（壊れた）バックアップ
  const bytes = readFileSync(snap);
  const broken = path.join(dir, 'broken.sqlite');
  bytes.fill(0xff, 4096 * 2, 4096 * 6);
  writeFileSync(broken, bytes);
  const open = (f) => new DatabaseSync(f, {readOnly: true});
  assert.throws(() => stageRestore({userData: dir, src: broken, open}), /壊れています|ではありません/);
  assert.ok(!existsSync(path.join(dir, RESTORE_FILE)));
  // ファイルから読み込んだ印があれば、入れ替えたあとに quiz.cli を消す（ほかの設定はそのまま）。印がなければ何もしない
  const settings = new Map([
    ['quiz.cli', {claude: {path: '/tmp/evil'}}],
    ['ui.theme', 'dark']
  ]);
  const repo = {removeSetting: (k) => settings.delete(k)};
  assert.equal(dropUntrustedSettings({userData: dir, repo}), false);
  assert.ok(settings.has('quiz.cli'));
  writeFileSync(path.join(dir, RESTORE_FROM_FILE), '');
  assert.equal(dropUntrustedSettings({userData: dir, repo}), true);
  assert.deepEqual([...settings.keys()], ['ui.theme']);
  assert.ok(!existsSync(path.join(dir, RESTORE_FROM_FILE)), '印は 1 度だけ');
});
