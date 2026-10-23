import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/main/db/db.js';
import {Repo} from '../src/main/db/repo.js';
import {KEEP_BACKUPS, backupName, prune, runBackup} from '../src/main/backup.js';
import {JobRunner} from '../src/main/jobs.js';

const DAY = 864e5;

async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dn-backup-'));
  const {db} = await openDatabase(path.join(dir, 'daigaku-note.sqlite'));
  // Windows は開いたままのファイルを消せない（EBUSY）ので、先に閉じる
  t.after(() => {
    db.close?.();
    return rm(dir, {recursive: true, force: true});
  });
  const repo = new Repo(db);
  return {dir, db, repo};
}

test('バックアップ：データベースの写しを日付の名前で取り、7 日分だけ残す', async (t) => {
  const {dir, db, repo} = await setup(t);
  repo.setSetting('probe', 'ok');
  const backups = path.join(dir, 'backups');
  const days = Array.from({length: KEEP_BACKUPS + 2}, (_, i) => new Date(Date.UTC(2026, 9, 1 + i, 3)));
  let last;
  for (const d of days) last = runBackup({db, dir: backups, now: () => d});
  const names = (await readdir(backups)).sort();
  assert.equal(names.length, KEEP_BACKUPS, '7 日分だけ');
  assert.equal(names.at(-1), backupName('2026-10-09'));
  assert.ok(!names.includes(backupName('2026-10-01')), '古いものは消す');
  assert.deepEqual(last.removed, [backupName('2026-10-02')]);
  assert.ok(!names.some((n) => n.endsWith('.tmp')), '途中のファイルを残さない');
  // 写しはふつうに開けて中身がある
  const {db: copy} = await openDatabase(path.join(backups, names.at(-1)));
  assert.equal(new Repo(copy).getSetting('probe'), 'ok');
  copy.close?.();
  // 同じ日に 2 回取っても上書きで 1 つ
  runBackup({db, dir: backups, now: () => days.at(-1)});
  assert.equal((await readdir(backups)).length, KEEP_BACKUPS);
});

test('刈り込み：同期の記録は 90 日、終わったジョブは 30 日より前のものを消す', async (t) => {
  const {db, repo} = await setup(t);
  const now = new Date('2026-10-23T00:00:00Z');
  const old = repo.startSyncRun({kind: 'full'});
  repo.addSyncEvent(old.id, {level: 'info', message: 'old'});
  db.prepare('UPDATE sync_run SET started_at = ? WHERE id = ?').run(
    new Date(now.getTime() - 91 * DAY).toISOString(),
    old.id
  );
  const fresh = repo.startSyncRun({kind: 'full'});
  repo.addSyncEvent(fresh.id, {level: 'info', message: 'fresh'});
  const j1 = repo.enqueueJob('sync', {});
  repo.finishJob(j1.id, 'done');
  db.prepare('UPDATE job SET updated_at = ? WHERE id = ?').run(new Date(now.getTime() - 31 * DAY).toISOString(), j1.id);
  const j2 = repo.enqueueJob('sync', {a: 1});
  repo.finishJob(j2.id, 'failed');
  const j3 = repo.enqueueJob('sync', {b: 1}); // まだ pending（古くても消さない）
  db.prepare('UPDATE job SET updated_at = ? WHERE id = ?').run(new Date(now.getTime() - 40 * DAY).toISOString(), j3.id);
  assert.deepEqual(prune(db, now), {syncRuns: 1, syncEvents: 1, jobs: 1});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sync_run').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sync_event').get().n, 1);
  assert.deepEqual(
    db
      .prepare('SELECT id FROM job ORDER BY created_at')
      .all()
      .map((r) => r.id),
    [j2.id, j3.id]
  );
});

test('ジョブ：backup は ctx.backup を呼ぶ。知らないジョブは失敗にする（「未対応」で done にしない）', async () => {
  const calls = [];
  const logs = [];
  const runner = new JobRunner({
    backup: async () => (
      calls.push(1),
      {file: '/b/x.sqlite', size: 10, removed: ['a'], pruned: {syncRuns: 1, syncEvents: 2, jobs: 3}}
    ),
    log: {info: (m) => logs.push(m)}
  });
  const r = await runner.run({kind: 'backup', payload: {}});
  assert.deepEqual(r, {file: '/b/x.sqlite', removed: 1, pruned: {syncRuns: 1, syncEvents: 2, jobs: 3}});
  assert.equal(calls.length, 1);
  assert.match(logs[0], /バックアップ/);
  await assert.rejects(runner.run({kind: 'recipes', payload: {}}), /未対応のジョブ/);
});
