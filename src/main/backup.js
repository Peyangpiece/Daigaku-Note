// 自動バックアップ（SPEC §12.3）。毎日 1 回、データベースの写しを userData/backups/ に取り、7 日分だけ残す。
// 秘密（secrets.json）は含めない。資料ファイルも含めない。写しは SQLite の VACUUM INTO で取る（WAL の途中でも整合した 1 ファイルになる）。
// あわせて、増える一方の記録（同期の実行と出来事・終わったジョブ）を古いものから刈り込む。
import {copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';
import {todayJst} from '../shared/schedule.js';

export const KEEP_BACKUPS = 7;
const PRUNE_SYNC_DAYS = 90;
const PRUNE_JOB_DAYS = 30;
const DAY = 864e5;

/** バックアップのファイル名（daigaku-note-YYYY-MM-DD.sqlite）。同じ日に 2 回取れば上書き */
export const backupName = (date) => `daigaku-note-${date}.sqlite`;

/**
 * バックアップを 1 回取る。戻りは {file, removed: 消した古いバックアップの名前, pruned: {syncRuns, syncEvents, jobs}}
 * @param {object} p
 * @param {import('node:sqlite').DatabaseSync} p.db
 * @param {string} p.dir
 * @param {() => Date} [p.now]
 * @param {number} [p.keep]
 */
export function runBackup({db, dir, now = () => new Date(), keep = KEEP_BACKUPS}) {
  mkdirSync(dir, {recursive: true});
  const at = now();
  const date = todayJst(at);
  const file = path.join(dir, backupName(date));
  const tmp = `${file}.tmp`;
  rmSync(tmp, {force: true});
  // VACUUM INTO は引数を取れないので、パスの ' を '' にして文字列に入れる
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  rmSync(file, {force: true});
  renameSync(tmp, file);

  // 古いものを消す（名前の日付順。keep 個だけ残す）
  const all = readdirSync(dir)
    .filter((f) => /^daigaku-note-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f))
    .sort();
  const removed = all.slice(0, Math.max(0, all.length - keep));
  for (const f of removed) rmSync(path.join(dir, f), {force: true});

  const pruned = prune(db, at);
  return {file, size: statSync(file).size, removed, pruned};
}

/** 手動の書き出し：選んだファイルへ写しを取る（VACUUM INTO。秘密は含まない） */
export function exportBackup(db, file) {
  const tmp = `${file}.tmp`;
  rmSync(tmp, {force: true});
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  rmSync(file, {force: true});
  renameSync(tmp, file);
  return {file, size: statSync(file).size};
}

/** 読み込み待ちのファイル名（userData に置き、次の起動で入れ替える） */
export const RESTORE_FILE = 'daigaku-note.restore.sqlite';

/**
 * 手動の読み込み（復元）の準備：大学ノートのバックアップか確かめて userData に写す。入れ替えは次の起動（applyStagedRestore）。
 * open：ファイルを読み取り専用で開く関数（DatabaseSync）。大学ノートの表（schema_migrations・course）がなければ Error
 */
export function stageRestore({userData, src, open}) {
  let db;
  try {
    db = open(src);
  } catch {
    throw new Error('大学ノートのバックアップ（.sqlite）ではありません');
  }
  try {
    let names;
    try {
      // SQLite のファイルでなければ、ここで初めて分かる（開くのは遅延）
      names = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((r) => r.name)
      );
    } catch {
      throw new Error('大学ノートのバックアップ（.sqlite）ではありません');
    }
    if (!names.has('schema_migrations') || !names.has('course'))
      throw new Error('大学ノートのバックアップ（.sqlite）ではありません');
    const version = Math.max(
      0,
      ...db
        .prepare('SELECT version FROM schema_migrations')
        .all()
        .map((r) => Number(r.version))
    );
    const staged = path.join(userData, RESTORE_FILE);
    copyFileSync(src, staged);
    return {staged, version};
  } finally {
    db.close?.();
  }
}

/**
 * 起動時：読み込み待ちのファイルがあれば、いまのデータベースを before-restore として残して入れ替える。
 * 戻りは入れ替えたかどうか。古い版のバックアップでも、そのあとのマイグレーションで上がる
 */
export function applyStagedRestore({userData, dbFile, now = () => new Date()}) {
  const staged = path.join(userData, RESTORE_FILE);
  if (!existsSync(staged)) return false;
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  if (existsSync(dbFile)) renameSync(dbFile, `${dbFile}.before-restore-${stamp}`);
  for (const suffix of ['-wal', '-shm']) rmSync(`${dbFile}${suffix}`, {force: true});
  renameSync(staged, dbFile);
  return true;
}

/** 古い記録を刈り込む。同期の実行と出来事は 90 日、終わったジョブは 30 日より前のものを消す */
export function prune(db, at = new Date()) {
  const syncBefore = new Date(at.getTime() - PRUNE_SYNC_DAYS * DAY).toISOString();
  const jobBefore = new Date(at.getTime() - PRUNE_JOB_DAYS * DAY).toISOString();
  const syncEvents = db
    .prepare('DELETE FROM sync_event WHERE run_id IN (SELECT id FROM sync_run WHERE started_at < ?)')
    .run(syncBefore).changes;
  const syncRuns = db.prepare('DELETE FROM sync_run WHERE started_at < ?').run(syncBefore).changes;
  const jobs = db
    .prepare("DELETE FROM job WHERE status IN ('done', 'failed') AND updated_at < ?")
    .run(jobBefore).changes;
  return {syncRuns: Number(syncRuns), syncEvents: Number(syncEvents), jobs: Number(jobs)};
}
