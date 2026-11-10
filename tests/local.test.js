// iPad のアプリでパソコンの窓口を動かす部品（src/local。docs/SYNC.md §8）：Node と Electron の代わり（shims）・ファイル（vfs）・
// import の対応（imports.js）が、パソコンの窓口が使うものをすべて受けるか
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import nodePath from 'node:path';
import {createHash, createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {localImports} from '../src/local/imports.js';
import {vfs} from '../src/local/vfs.js';
import path from '../src/local/shims/node-path.js';
import fs, {promises as fsp} from '../src/local/shims/node-fs.js';
import {Buffer as B} from '../src/local/shims/buffer.js';
import * as shimCrypto from '../src/local/shims/node-crypto.js';

const ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..');

test('import の対応：パソコンの窓口（ipc/index.js からたどれるもの）の名前の import を、すべて代わりのファイルにつなぐ', () => {
  const map = localImports('/p/');
  const seen = new Set();
  const missing = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    // 静かな import だけ（await import(…) は使うときにだけ読むので、ここでは見ない）
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+'([^']+)'/g)) {
      const sp = m[1];
      if (sp.startsWith('.')) walk(nodePath.resolve(nodePath.dirname(file), sp));
      else if (!(sp in map) && !Object.keys(map).some((k) => k.endsWith('/') && sp.startsWith(k)))
        missing.add(`${sp}（${nodePath.relative(ROOT, file)}）`);
    }
  };
  walk(nodePath.join(ROOT, 'src/main/ipc/index.js'));
  walk(nodePath.join(ROOT, 'src/local/client.js'));
  assert.ok(seen.size > 60);
  assert.deepEqual(
    [...missing].filter((x) => !x.startsWith('/cloud/')),
    []
  );
  for (const v of Object.values(map)) assert.ok(v.startsWith('/p/'), v);
});

test('道（node:path の代わり）：パソコンと同じ結果（POSIX）・Windows の場所も / にそろえる', () => {
  for (const [a, b] of [
    [['/a/b', '../c'], '/a/c'],
    [['/a', 'b', 'c.pdf'], '/a/b/c.pdf']
  ]) {
    assert.equal(path.join(...a), nodePath.posix.join(...a));
    assert.equal(path.join(...a), b);
  }
  assert.equal(path.resolve('/x/y', 'z'), '/x/y/z');
  assert.equal(path.dirname('/a/b/c.pdf'), '/a/b');
  assert.equal(path.basename('/a/b/c.pdf', '.pdf'), 'c');
  assert.equal(path.extname('/a/b/c.tar.gz'), '.gz');
  assert.equal(path.relative('/a/b/c', '/a/d'), '../../d');
  assert.equal(path.join('C:\\Users\\me', 'a.pdf'), '/c/Users/me/a.pdf');
});

test('ファイル（node:fs の代わり）：読むだけのもの（ドライブから読み込んだ資料）・書く・一覧・消す・移す', async () => {
  vfs.reset();
  let reads = 0;
  vfs.mount('/Users/me/Desktop/a.pdf', async () => (reads++, new Uint8Array([1, 2, 3])), 3);
  assert.deepEqual([...(await fsp.readFile('/Users/me/Desktop/a.pdf'))], [1, 2, 3]);
  assert.equal(reads, 1);
  assert.equal((await fsp.stat('/Users/me/Desktop/a.pdf')).size, 3);
  assert.ok((await fsp.stat('/Users/me/Desktop')).isDirectory());
  await fsp.writeFile('/app/userData/notes/x.txt', 'こんにちは');
  assert.equal(await fsp.readFile('/app/userData/notes/x.txt', 'utf8'), 'こんにちは');
  assert.equal(fs.readFileSync('/app/userData/notes/x.txt', 'utf8'), 'こんにちは');
  assert.deepEqual(await fsp.readdir('/app/userData'), ['notes']);
  await fsp.rename('/app/userData/notes/x.txt', '/app/userData/notes/y.txt');
  assert.ok(fs.existsSync('/app/userData/notes/y.txt') && !fs.existsSync('/app/userData/notes/x.txt'));
  // 一時のファイルに書いてから移す（pdf-save.js・files.js の書き方）
  const fh = await fsp.open('/app/tmp/t', 'wx');
  await fh.write(new Uint8Array([9]));
  await fh.close();
  await assert.rejects(fsp.open('/app/tmp/t', 'wx'), (e) => e.code === 'EEXIST');
  await assert.rejects(fsp.readFile('/nope'), (e) => e.code === 'ENOENT');
  await fsp.rm('/app/tmp', {recursive: true, force: true});
  assert.ok(!fs.existsSync('/app/tmp/t'));
  // アプリに入れたファイル（pdf.js の字の形など）は、道の頭ごとに読む
  vfs.mountPrefix('/app/node_modules', async (rel) => (rel === 'x/y.bin' ? new Uint8Array([7]) : null));
  assert.deepEqual([...(await fsp.readFile('/app/node_modules/x/y.bin'))], [7]);
  vfs.reset();
});

test('Buffer と node:crypto の代わり：パソコンと同じ結果', () => {
  const s = 'パレットノート';
  assert.equal(B.from(s).toString('base64'), Buffer.from(s).toString('base64'));
  assert.equal(B.from(Buffer.from(s).toString('base64'), 'base64').toString(), s);
  assert.equal(B.from(s).toString('hex'), Buffer.from(s).toString('hex'));
  assert.equal(B.concat([B.from('a'), B.from('b')]).toString(), 'ab');
  const data = new Uint8Array([1, 2, 3, 250]);
  assert.equal(
    shimCrypto.createHash('sha256').update(data).digest('hex'),
    createHash('sha256').update(data).digest('hex')
  );
  assert.equal(
    shimCrypto.createHash('sha512').update('x').digest('base64'),
    createHash('sha512').update('x').digest('base64')
  );
  assert.equal(
    shimCrypto.createHmac('sha256', 'k').update('m').digest('hex'),
    createHmac('sha256', 'k').update('m').digest('hex')
  );
  assert.equal(shimCrypto.randomBytes(16).length, 16);
});

test('入口：パソコンの画面の index.html を、iPad の中の窓口で動く形にする（CSP のハッシュ・sql.js・env.js・boot.js）', async () => {
  const {localIndexHtml} = await import('../src/local/index-html.js');
  const html = localIndexHtml(readFileSync(nodePath.join(ROOT, 'src/renderer/index.html'), 'utf8'));
  const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
  const hash = `'sha256-${createHash('sha256').update(map).digest('base64')}'`;
  assert.ok(html.includes(hash), 'CSP に import の対応表のハッシュ');
  assert.match(html, /'wasm-unsafe-eval'/);
  const imports = JSON.parse(map).imports;
  assert.equal(imports.electron, '/m/p/src/local/shims/electron.js');
  assert.ok(imports.three, 'パソコンの画面の対応も残す');
  const order = ['sql-wasm-browser.js', '/m/p/src/local/env.js', '/m/p/pad/boot.js'].map((s) => html.indexOf(s));
  assert.ok(
    order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])),
    '読む順：sql.js → env.js → boot.js'
  );
});
