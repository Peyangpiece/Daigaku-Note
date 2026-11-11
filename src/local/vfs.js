// iPad のアプリの中のファイル（docs/SYNC.md §8）。パソコンの窓口（main/ipc）が node:fs で読み書きするものを、ここに置く。
// - 読むだけのもの（lazy）：パソコンの場所 → 読み出す関数（ドライブから読み込んで暗号化したまま置いたものを、読むときに開く）
// - 書いたもの（files）：この画面の間、メモリに持つ（ドライブへ返すのは段階 3）
// 道の名前は POSIX の形（/ 区切り）。Windows のパソコンの場所（C:\…）は / に直して扱う
export const norm = (p) => {
  let s = String(p ?? '').replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(s)) s = `/${s[0].toLowerCase()}${s.slice(2)}`;
  const out = [];
  for (const part of s.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
};

const files = new Map(); // 道 → {bytes, mtimeMs}
const lazy = new Map(); // 道 → {read: async () => Uint8Array, size}
const dirs = new Set(['/']);
const prefixes = []; // [道の頭, (残り) => Promise<Uint8Array|null>]（pdf.js の字の形など、アプリに入れたファイルを読む）

const parentsOf = (p) => {
  const out = [];
  let d = p;
  while (d !== '/') {
    d = d.slice(0, d.lastIndexOf('/')) || '/';
    out.push(d);
  }
  return out;
};
const addDirs = (p) => {
  for (const d of parentsOf(p)) dirs.add(d);
};

// 書いた・消したことを知らせる先（client.js が iPad に残す。テストでは使わない）
const hooks = {write: null, remove: null};

export const vfs = {
  /** 書いた・消したことを知らせる先：{write(道, bytes), remove(道)} */
  setHooks(h) {
    hooks.write = h?.write ?? null;
    hooks.remove = h?.remove ?? null;
  },
  /** 読むだけのものを置く（ドライブから読み込んだ資料など） */
  mount(p, read, size = 0) {
    const n = norm(p);
    lazy.set(n, {read, size});
    addDirs(n);
  },
  /** 道の頭ごとに読む（アプリに入れたファイル。なければ null を返す関数） */
  mountPrefix(prefix, read) {
    prefixes.push([norm(prefix), read]);
  },
  has: (p) => files.has(norm(p)) || lazy.has(norm(p)),
  isDir: (p) => dirs.has(norm(p)),
  async read(p) {
    const n = norm(p);
    if (files.has(n)) return files.get(n).bytes;
    const l = lazy.get(n);
    if (l) return l.read();
    for (const [pre, read] of prefixes) if (n.startsWith(`${pre}/`)) return read(n.slice(pre.length + 1));
    return null;
  },
  readSync(p) {
    const f = files.get(norm(p));
    return f ? f.bytes : null;
  },
  write(p, bytes, {quiet = false} = {}) {
    const n = norm(p);
    files.set(n, {bytes, mtimeMs: Date.now()});
    addDirs(n);
    if (!quiet) hooks.write?.(n, bytes);
  },
  stat(p) {
    const n = norm(p);
    if (files.has(n)) return {size: files.get(n).bytes.length, mtimeMs: files.get(n).mtimeMs, dir: false};
    if (lazy.has(n)) return {size: lazy.get(n).size, mtimeMs: 0, dir: false};
    if (dirs.has(n)) return {size: 0, mtimeMs: 0, dir: true};
    if (prefixes.some(([pre]) => n.startsWith(`${pre}/`))) return {size: 0, mtimeMs: 0, dir: false};
    return null;
  },
  mkdir(p) {
    const n = norm(p);
    dirs.add(n);
    addDirs(n);
  },
  list(p) {
    const n = norm(p);
    const pre = n === '/' ? '/' : `${n}/`;
    const names = new Set();
    for (const k of [...files.keys(), ...lazy.keys(), ...dirs])
      if (k !== n && k.startsWith(pre)) names.add(k.slice(pre.length).split('/')[0]);
    return [...names];
  },
  remove(p, recursive = false) {
    const n = norm(p);
    if (files.has(n) || lazy.has(n)) hooks.remove?.(n);
    files.delete(n);
    lazy.delete(n);
    if (recursive)
      for (const m of [files, lazy])
        for (const k of [...m.keys()])
          if (k.startsWith(`${n}/`)) {
            hooks.remove?.(k);
            m.delete(k);
          }
    if (recursive) for (const d of [...dirs]) if (d === n || d.startsWith(`${n}/`)) dirs.delete(d);
  },
  rename(a, b) {
    const x = norm(a);
    const y = norm(b);
    if (files.has(x)) {
      files.set(y, files.get(x));
      files.delete(x);
      hooks.remove?.(x);
      hooks.write?.(y, files.get(y).bytes);
    } else if (lazy.has(x)) {
      lazy.set(y, lazy.get(x));
      lazy.delete(x);
    }
    addDirs(y);
  },
  /** テスト用：全部消す */
  reset() {
    hooks.write = hooks.remove = null;
    files.clear();
    lazy.clear();
    dirs.clear();
    dirs.add('/');
  }
};
