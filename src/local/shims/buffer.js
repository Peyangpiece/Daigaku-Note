// Node の Buffer の代わり（iPad のアプリ）。パソコンの窓口が使うものだけ：from・isBuffer・concat・alloc・toString
const te = new TextEncoder();
const td = new TextDecoder();
const toB64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};

export class Buffer extends Uint8Array {
  static from(x, a, b) {
    if (typeof x === 'string') {
      const enc = a ?? 'utf8';
      if (enc === 'base64' || enc === 'base64url') {
        const s = atob(x.replace(/-/g, '+').replace(/_/g, '/'));
        const out = new Buffer(s.length);
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
      }
      if (enc === 'hex') return new Buffer((x.match(/../g) ?? []).map((h) => parseInt(h, 16)));
      if (enc === 'latin1' || enc === 'binary') return new Buffer([...x].map((c) => c.charCodeAt(0) & 255));
      const u = te.encode(x);
      return new Buffer(u.buffer, u.byteOffset, u.byteLength);
    }
    if (x instanceof ArrayBuffer) return new Buffer(x, a ?? 0, b ?? x.byteLength - (a ?? 0));
    if (ArrayBuffer.isView(x)) {
      const c = new Buffer(x.byteLength);
      c.set(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
      return c;
    }
    return new Buffer(x);
  }
  static isBuffer(x) {
    return x instanceof Buffer;
  }
  static alloc(n) {
    return new Buffer(n);
  }
  static concat(list, total) {
    const len = total ?? list.reduce((a, b) => a + b.length, 0);
    const out = new Buffer(len);
    let o = 0;
    for (const b of list) {
      out.set(b, o);
      o += b.length;
    }
    return out;
  }
  static byteLength(s) {
    return typeof s === 'string' ? te.encode(s).length : s.byteLength;
  }
  toString(enc = 'utf8', start = 0, end = this.length) {
    const u = this.subarray(start, end);
    if (enc === 'base64') return toB64(u);
    if (enc === 'base64url') return toB64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (enc === 'hex') return Array.from(u, (x) => x.toString(16).padStart(2, '0')).join('');
    if (enc === 'latin1' || enc === 'binary') return Array.from(u, (x) => String.fromCharCode(x)).join('');
    return td.decode(u);
  }
  equals(o) {
    return this.length === o.length && this.every((v, i) => v === o[i]);
  }
}
export default {Buffer};
