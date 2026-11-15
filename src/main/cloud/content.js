// データベースの「中身の印」（docs/SYNC.md §14）：書いたもの（授業・回・資料・書き込み・ノート・クイズなど）が変わったかを見る。
// 同期の記録・ジョブ・抜き出した文字・このパソコンだけの設定のように、使っているだけで変わるものは入れない。
// パソコンが最後に送ったときからこの印が変わっていなければ、iPad で書いたものを取り込んでも、パソコンで書いたものは消えない
import {createHash} from 'node:crypto';
import {DEVICE_SETTINGS} from './adopt.js';

/** 印に入れない表（使っているだけで変わる・ほかから作り直せる） */
export const NOISY_TABLES = new Set([
  'sync_run',
  'sync_event',
  'job',
  'ai_usage',
  'material_text',
  'schema_migrations'
]);

const deviceKey = (k) => DEVICE_SETTINGS.some((p) => k.startsWith(p));

/** db：node:sqlite の DatabaseSync（または同じ形）。戻り：16 進の SHA-256 */
export function contentHash(db) {
  const h = createHash('sha256');
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name)
    .filter((t) => !NOISY_TABLES.has(t));
  for (const t of tables) {
    h.update(`\u0000${t}\u0000`);
    const q = `"${t.replace(/"/g, '""')}"`;
    const rows =
      t === 'settings'
        ? db
            .prepare('SELECT key, value FROM settings ORDER BY key')
            .all()
            .filter((r) => !deviceKey(r.key))
        : db.prepare(`SELECT * FROM ${q} ORDER BY rowid`).all();
    for (const r of rows)
      h.update(`${JSON.stringify(r, (k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('base64') : v))}\n`);
  }
  return h.digest('hex');
}
