// node:fs の代わり（iPad のアプリ。vfs.js の上）。パソコンの窓口が使うものだけ
import {Buffer} from './buffer.js';
import {norm, vfs} from '../vfs.js';

const enoent = (p, op) => Object.assign(new Error(`ENOENT: no such file or directory, ${op} '${p}'`), {code: 'ENOENT'});
const eexist = (p) => Object.assign(new Error(`EEXIST: file already exists '${p}'`), {code: 'EEXIST'});
const toBytes = (data, enc) =>
  typeof data === 'string'
    ? Buffer.from(data, typeof enc === 'string' ? enc : (enc?.encoding ?? 'utf8'))
    : new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength ?? data.length);
const decode = (b, enc) => {
  const e = typeof enc === 'string' ? enc : enc?.encoding;
  return e
    ? Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString(e)
    : Buffer.from(b.buffer, b.byteOffset, b.byteLength);
};
const statOf = (p) => {
  const s = vfs.stat(p);
  if (!s) throw enoent(p, 'stat');
  return {
    size: s.size,
    mtimeMs: s.mtimeMs,
    mtime: new Date(s.mtimeMs),
    isFile: () => !s.dir,
    isDirectory: () => s.dir,
    isSymbolicLink: () => false
  };
};

export const promises = {
  async readFile(p, enc) {
    const b = await vfs.read(p);
    if (!b) throw enoent(p, 'open');
    return decode(b, enc);
  },
  async writeFile(p, data, enc) {
    vfs.write(p, toBytes(data, enc));
  },
  async appendFile(p, data, enc) {
    const old = (await vfs.read(p)) ?? new Uint8Array();
    const add = toBytes(data, enc);
    const out = new Uint8Array(old.length + add.length);
    out.set(old);
    out.set(add, old.length);
    vfs.write(p, out);
  },
  async stat(p) {
    return statOf(p);
  },
  lstat: async (p) => statOf(p),
  async access(p) {
    if (!vfs.stat(p)) throw enoent(p, 'access');
  },
  async mkdir(p) {
    vfs.mkdir(p);
  },
  async mkdtemp(prefix) {
    const p = `${norm(prefix)}${Math.random().toString(36).slice(2, 8)}`;
    vfs.mkdir(p);
    return p;
  },
  async readdir(p, opt) {
    if (!vfs.isDir(p)) throw enoent(p, 'scandir');
    const names = vfs.list(p);
    if (!opt?.withFileTypes) return names;
    return names.map((name) => {
      const s = vfs.stat(`${norm(p)}/${name}`);
      return {name, isFile: () => !s?.dir, isDirectory: () => !!s?.dir, isSymbolicLink: () => false};
    });
  },
  async rm(p, opt) {
    if (!vfs.stat(p) && !opt?.force) throw enoent(p, 'rm');
    vfs.remove(p, !!opt?.recursive);
  },
  rmdir: async (p, opt) => vfs.remove(p, !!opt?.recursive),
  unlink: async (p) => {
    if (!vfs.stat(p)) throw enoent(p, 'unlink');
    vfs.remove(p);
  },
  async rename(a, b) {
    if (!vfs.stat(a)) throw enoent(a, 'rename');
    if (vfs.has(a) && !vfs.readSync(a)) vfs.write(a, await vfs.read(a)); // 読むだけのものは中身を持ってから移す
    vfs.rename(a, b);
  },
  async copyFile(a, b) {
    const d = await vfs.read(a);
    if (!d) throw enoent(a, 'copyfile');
    vfs.write(b, d);
  },
  /** 書くための口（files.js・pdf-save.js が一時のファイルに書くとき） */
  async open(p, flags = 'r') {
    if (String(flags).includes('x') && vfs.stat(p)) throw eexist(p);
    const parts = [];
    return {
      async write(data) {
        parts.push(toBytes(data));
        return {bytesWritten: data.length};
      },
      async writeFile(data) {
        parts.push(toBytes(data));
      },
      async sync() {},
      async close() {
        const len = parts.reduce((a, b) => a + b.length, 0);
        const out = new Uint8Array(len);
        let o = 0;
        for (const b of parts) {
          out.set(b, o);
          o += b.length;
        }
        vfs.write(p, out);
      },
      async stat() {
        return statOf(p);
      }
    };
  }
};

// 同期の窓口（メモリにあるものだけ。資料の中身など読むだけのものは promises で読む）
export const readFileSync = (p, enc) => {
  const b = vfs.readSync(p);
  if (!b) throw enoent(p, 'open');
  return decode(b, enc);
};
export const writeFileSync = (p, data, enc) => vfs.write(p, toBytes(data, enc));
export const appendFileSync = (p, data, enc) => {
  const old = vfs.readSync(p) ?? new Uint8Array();
  const add = toBytes(data, enc);
  const out = new Uint8Array(old.length + add.length);
  out.set(old);
  out.set(add, old.length);
  vfs.write(p, out);
};
export const existsSync = (p) => !!vfs.stat(p);
export const statSync = (p) => statOf(p);
export const mkdirSync = (p) => vfs.mkdir(p);
export const readdirSync = (p) => vfs.list(p);
export const rmSync = (p, opt) => vfs.remove(p, !!opt?.recursive);
export const unlinkSync = (p) => vfs.remove(p);
export const renameSync = (a, b) => vfs.rename(a, b);
export const copyFileSync = (a, b) => vfs.write(b, readFileSync(a));
export const watch = () => ({close() {}, on() {}});
const noStream = () => {
  throw new Error('この操作は iPad ではできません');
};
export const createReadStream = noStream;
export const createWriteStream = noStream;

export default {
  promises,
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  statSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
  renameSync,
  copyFileSync,
  watch,
  createReadStream,
  createWriteStream
};
