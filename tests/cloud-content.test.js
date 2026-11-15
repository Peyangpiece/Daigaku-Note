// データベースの中身の印（src/main/cloud/content.js。docs/SYNC.md §14）：書いたものが変われば変わり、使っただけでは変わらない
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/main/db/db.js';
import {contentHash} from '../src/main/cloud/content.js';

test('中身の印：同期の記録・ジョブ・このパソコンだけの設定では変わらず、資料・設定（見た目など）が変われば変わる', async () => {
  const {db} = await openDatabase(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  const a = contentHash(db);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(contentHash(db), a, '同じなら同じ');
  const set = (k, v) =>
    db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(k, JSON.stringify(v));
  // 使っただけ：このパソコンだけの設定・同期の記録
  set('cloud.base', '2026-11-01T00:00:00Z');
  set('sync.lastFullDay', '2026-11-01');
  set('scheduler.lastDay', '2026-11-01');
  const cols = db
    .prepare('PRAGMA table_info(sync_run)')
    .all()
    .filter((c) => c.notnull && c.dflt_value == null && !c.pk);
  db.prepare(
    `INSERT INTO sync_run (${cols.map((c) => c.name).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).run(...cols.map((c) => (/INT/i.test(c.type) ? 1 : 'x')));
  assert.equal(contentHash(db), a, '使っただけでは変わらない');
  // 書いた：見た目の設定・資料
  set('ui.theme', 'dark');
  const b = contentHash(db);
  assert.notEqual(b, a);
  db.prepare(
    `INSERT INTO material (id, course_id, name, path, sha256, size, source, downloaded_at) VALUES ('M1', 'C1', 'a.pdf', '/x/a.pdf', 'h', 1, 'lms', '2026-11-01')`
  ).run();
  assert.notEqual(contentHash(db), b);
});
