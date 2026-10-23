// SQLite を開き、マイグレーションを当てる（DESIGN-M0 §5）。node:sqlite（Node 22 以降）を使う。
import {readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

async function loadDriver() {
  try {
    const {DatabaseSync} = await import('node:sqlite');
    return (file) => new DatabaseSync(file);
  } catch (e) {
    // Electron の Node に node:sqlite がないときの逃げ道（依存は入れたときだけ）
    const mod = await import('better-sqlite3').catch(() => null);
    if (!mod) throw new Error(`SQLite が使えません（node:sqlite も better-sqlite3 もない）: ${e.message}`);
    return (file) => mod.default(file);
  }
}

/** DB を開き、PRAGMA を設定し、マイグレーションを当てて返す */
export async function openDatabase(file = ':memory:', {migrationsDir = MIGRATIONS_DIR} = {}) {
  const create = await loadDriver();
  const db = create(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const applied = migrate(db, migrationsDir);
  return {db, applied};
}

/** migrations/NNNN_name.sql を番号順に当てる。当てた版は schema_migrations に残す。戻りは今回当てた版の一覧 */
export function migrate(db, dir = MIGRATIONS_DIR) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)'
  );
  const done = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => Number(r.version))
  );
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
  const applied = [];
  for (const f of files) {
    const version = Number(f.slice(0, 4));
    if (done.has(version)) continue;
    const sql = readFileSync(path.join(dir, f), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        version,
        f,
        new Date().toISOString()
      );
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`マイグレーション ${f} に失敗: ${e.message}`);
    }
    applied.push(version);
  }
  return applied;
}
