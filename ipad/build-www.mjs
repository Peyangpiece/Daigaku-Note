// iPad アプリに入れる画面（www）を組み立てる：最初の画面（src）と QR を読む部品（jsQR）
import {cpSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const www = path.join(here, 'www');
rmSync(www, {recursive: true, force: true});
mkdirSync(www, {recursive: true});
cpSync(path.join(here, 'src'), www, {recursive: true});
// jsQR はパソコンのアプリと同じもの（親の node_modules）
const require = createRequire(path.join(here, '..', 'package.json'));
cpSync(require.resolve('jsqr/dist/jsQR.js'), path.join(www, 'jsQR.js'));
// パソコンと同じ部品（暗号化・鍵・Google のクライアント ID）：src/shared の中継を本体に置き換える
const shared = path.join(here, '..', 'src', 'shared');
for (const f of ['vault.js', 'vault-keys.js', 'google-client.js'])
  cpSync(path.join(shared, f), path.join(www, 'shared', f));
// 暗号化・ハッシュの部品（@noble）。index.html の importmap で名前から引く
const pkgDir = (name) => path.join(here, '..', 'node_modules', name); // 名前の出口（exports）に package.json がないので、置き場から引く
for (const [name, dir] of [
  ['@noble/ciphers', 'noble-ciphers'],
  ['@noble/hashes', 'noble-hashes']
])
  cpSync(pkgDir(name), path.join(www, 'vendor', dir), {
    recursive: true,
    filter: (src) => !/\.(d\.ts|map|md)$/.test(src) && !src.includes(`${path.sep}src${path.sep}`)
  });

// ---- パソコンなしで使う（docs/SYNC.md §8）：パソコンの画面と窓口を、パソコンと同じ画面（iPad）と同じ並び（/m/p/…）で入れる ----
const repo = path.join(here, '..');
const p = (...a) => path.join(www, 'm', 'p', ...a);
const skip = (src) => /\.(map|md|d\.ts)$/.test(src);
for (const dir of ['renderer', 'shared', 'main', 'local'])
  cpSync(path.join(repo, 'src', dir), p('src', dir), {
    recursive: true,
    filter: (src) => !skip(src) && !src.includes(`${path.sep}connectors${path.sep}recipes`)
  });
cpSync(path.join(repo, 'src', 'pad'), p('pad'), {recursive: true});
const nm = (rel, to = rel) =>
  cpSync(path.join(repo, 'node_modules', rel), p('node_modules', to), {recursive: true, filter: (src) => !skip(src)});
for (const rel of [
  'pdfjs-dist/legacy/build',
  'pdfjs-dist/cmaps',
  'pdfjs-dist/standard_fonts',
  'pdfjs-dist/wasm',
  'pdfjs-dist/iccs',
  'pdfjs-dist/package.json'
])
  nm(rel);
nm('three/build');
nm('pdf-lib/dist/pdf-lib.esm.js');
nm('sql.js/dist/sql-wasm-browser.js');
nm('sql.js/dist/sql-wasm-browser.wasm');
nm('@noble/ciphers');
nm('@noble/hashes');
// パソコンと同じ画面の部品（bridge.js）が話す相手を、このアプリの中の窓口にする
mkdirSync(path.join(www, 'm', 'app'), {recursive: true});
writeFileSync(path.join(www, 'm', 'app', 'client.js'), "export * from '/m/p/src/local/client.js';\n");
const {localIndexHtml} = await import(pathToFileURL(path.join(repo, 'src', 'local', 'index-html.js')).href);
writeFileSync(
  p('src', 'renderer', 'index.html'),
  localIndexHtml(readFileSync(path.join(repo, 'src', 'renderer', 'index.html'), 'utf8'))
);
console.log(`www を作りました：${www}`);
