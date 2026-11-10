// iPad のアプリの「パソコンなしで使う」画面の入口（docs/SYNC.md §8）。パソコンの画面の index.html を、パソコンと同じ画面（iPad）の形に
// 直したもの（server.js の padIndexHtml）に、さらに：パソコンの窓口を動かすための import の対応（imports.js）・sql.js・大域の名前（env.js）を足す。
// 組み立て（ipad/build-www.mjs）が node で使う
import {createHash} from 'node:crypto';
import {padIndexHtml} from '../main/mobile/server.js';
import {localImports} from './imports.js';

export function localIndexHtml(raw) {
  const html = padIndexHtml(raw);
  const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  const json = JSON.parse(map[1]);
  Object.assign(json.imports, localImports('/m/p/'), {'@noble/ciphers/': '/m/p/node_modules/@noble/ciphers/'});
  const body = `\n${JSON.stringify(json, null, 2)}\n`;
  const hash = (t) => `'sha256-${createHash('sha256').update(t).digest('base64')}'`;
  const old = hash(map[1]);
  if (!html.includes(old)) throw new Error('index.html の CSP に import の対応表のハッシュがありません');
  const boot = '<script type="module" src="/m/p/pad/boot.js"></script>';
  if (!html.includes(boot)) throw new Error('index.html に boot.js がありません');
  return (
    html
      .replace(old, `${hash(body)} 'wasm-unsafe-eval'`) // sql.js（WebAssembly）を動かす
      .replace(map[0], `<script type="importmap">${body}</script>`)
      // sql.js は大域の initSqlJs を作る古い形の部品。env.js（process・Buffer）は boot.js より先に
      .replace(
        boot,
        `<script src="/m/p/node_modules/sql.js/dist/sql-wasm-browser.js"></script>\n    <script type="module" src="/m/p/src/local/env.js"></script>\n    ${boot}`
      )
      .replace(/<link rel="manifest"[^>]*>\n?\s*/, '')
  );
}
