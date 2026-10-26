import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase, migrate} from '../src/main/db/db.js';
import {COLUMNS} from '../src/main/db/repo.js';
import {applyStagedRestore, exportBackup, stageRestore, RESTORE_FILE} from '../src/main/backup.js';

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

test('読み込みの準備：大学ノートのバックアップだけ受け付け、userData に写す。ただのファイルは断る', async () => {
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
