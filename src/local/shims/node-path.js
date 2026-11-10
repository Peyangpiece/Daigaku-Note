// node:path の代わり（iPad のアプリ。POSIX の形）
import {norm} from '../vfs.js';

const sep = '/';
const isAbsolute = (p) => String(p).startsWith('/') || /^[A-Za-z]:[\\/]/.test(String(p));
function resolve(...parts) {
  let out = '';
  for (const p of parts) {
    if (p == null || p === '') continue;
    out = isAbsolute(p) ? String(p) : out ? `${out}/${p}` : `/${p}`;
  }
  return norm(out || '/');
}
const join = (...parts) => {
  const s = parts.filter((p) => p != null && p !== '').join('/');
  if (!s) return '.';
  const abs = isAbsolute(s);
  const n = norm(s);
  return abs ? n : n.slice(1) || '.';
};
const dirname = (p) => {
  const s = String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i < 0 ? '.' : i === 0 ? '/' : s.slice(0, i);
};
const basename = (p, ext) => {
  const b = String(p).replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? '';
  return ext && b.endsWith(ext) && b !== ext ? b.slice(0, -ext.length) : b;
};
const extname = (p) => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i);
};
const relative = (from, to) => {
  const a = resolve(from).split('/').filter(Boolean);
  const b = resolve(to).split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
};
const normalize = (p) => (isAbsolute(p) ? norm(p) : norm(p).slice(1) || '.');
const parse = (p) => {
  const base = basename(p);
  const ext = extname(p);
  return {root: isAbsolute(p) ? '/' : '', dir: dirname(p), base, ext, name: ext ? base.slice(0, -ext.length) : base};
};
const format = (o) => `${o.dir ? `${o.dir}/` : ''}${o.base ?? `${o.name ?? ''}${o.ext ?? ''}`}`;

const path = {
  sep,
  delimiter: ':',
  isAbsolute,
  resolve,
  join,
  dirname,
  basename,
  extname,
  relative,
  normalize,
  parse,
  format
};
path.posix = path;
path.win32 = path;
export default path;
export {sep, isAbsolute, resolve, join, dirname, basename, extname, relative, normalize, parse, format};
