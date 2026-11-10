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
console.log(`www を作りました：${www}`);
