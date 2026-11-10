// iPad アプリに入れる画面（www）を組み立てる：最初の画面（src）と QR を読む部品（jsQR）
import {cpSync, mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

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
console.log(`www を作りました：${www}`);
