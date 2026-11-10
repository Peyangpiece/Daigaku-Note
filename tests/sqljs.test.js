// iPad のアプリはパソコンの repo.js を sql.js（WebAssembly の SQLite）で動かす（src/shared/sqljs-db.js。docs/SYNC.md §8）。
// データベースを使うテストを sql.js でも走らせて、パソコン（node:sqlite）と同じ結果になるかを確かめる
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['db', 'annotation', 'bookmark', 'quiz'];

// 外のテストの子として扱わせない（NODE_TEST_CONTEXT があると、中のテストのファイルを走らせない）。結果は TAP で読む
const env = {...process.env, DAIGAKU_SQL: 'sqljs'};
delete env.NODE_TEST_CONTEXT;

for (const f of FILES)
  test(`sql.js でも同じ結果：tests/${f}.test.js`, {timeout: 120000}, () => {
    const r = spawnSync(process.execPath, ['--test', `tests/${f}.test.js`], {
      cwd: ROOT,
      env,
      encoding: 'utf8'
    });
    const fail = /^# fail (\d+)/m.exec(r.stdout)?.[1];
    assert.equal(fail, '0', r.stdout.slice(-2000) + r.stderr.slice(-1000));
    assert.equal(r.status, 0);
  });
