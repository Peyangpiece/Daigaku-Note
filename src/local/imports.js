// iPad のアプリでパソコンの窓口（src/main）を動かすときの、import の名前 → ファイルの対応（docs/SYNC.md §8）。
// base はアプリの中の、src と node_modules がある場所（組み立て build-www.mjs と、テストのページが使う）。副作用なし
export function localImports(base = '/p/') {
  const s = `${base}src/local/shims/`;
  const nm = `${base}node_modules/`;
  return {
    electron: `${s}electron.js`,
    'node:fs': `${s}node-fs.js`,
    'node:fs/promises': `${s}node-fs-promises.js`,
    'node:path': `${s}node-path.js`,
    'node:os': `${s}node-os.js`,
    'node:url': `${s}node-url.js`,
    'node:module': `${s}node-module.js`,
    'node:crypto': `${s}node-crypto.js`,
    'node:child_process': `${s}node-child_process.js`,
    'node:zlib': `${s}node-zlib.js`,
    'node:worker_threads': `${s}node-worker_threads.js`,
    'node:http': `${s}node-http.js`,
    'node:https': `${s}node-http.js`,
    'qrcode-generator': `${s}qrcode-generator.js`,
    'pdf-lib': `${nm}pdf-lib/dist/pdf-lib.esm.js`,
    'pdfjs-dist/legacy/build/pdf.mjs': `${nm}pdfjs-dist/legacy/build/pdf.mjs`,
    '@noble/ciphers/': `${nm}@noble/ciphers/`,
    '@noble/hashes/': `${nm}@noble/hashes/`
  };
}
