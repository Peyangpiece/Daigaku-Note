// node:crypto の代わり（iPad のアプリ）。ハッシュは @noble/hashes、乱数は Web Crypto
import {sha256, sha512} from '@noble/hashes/sha2.js';
import {hmac} from '@noble/hashes/hmac.js';
import {Buffer} from './buffer.js';

const ALGOS = {sha256, sha512};
const te = new TextEncoder();
const bytes = (d, enc) =>
  typeof d === 'string' ? (enc === 'hex' || enc === 'base64' ? Buffer.from(d, enc) : te.encode(d)) : d;
const out = (u8, enc) => {
  const b = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
  return enc ? b.toString(enc) : b;
};
const algo = (name) =>
  ALGOS[String(name).toLowerCase()] ??
  (() => {
    throw new Error(`ハッシュ ${name} は iPad では使えません`);
  })();

export function createHash(name) {
  const h = algo(name).create();
  const api = {
    update(d, enc) {
      h.update(bytes(d, enc));
      return api;
    },
    digest: (enc) => out(h.digest(), enc)
  };
  return api;
}
export function createHmac(name, key) {
  const h = hmac.create(algo(name), bytes(key));
  const api = {
    update(d, enc) {
      h.update(bytes(d, enc));
      return api;
    },
    digest: (enc) => out(h.digest(), enc)
  };
  return api;
}
export const randomBytes = (n) => out(globalThis.crypto.getRandomValues(new Uint8Array(n)));
export const randomUUID = () => globalThis.crypto.randomUUID();
export const getRandomValues = (a) => globalThis.crypto.getRandomValues(a);
const NOT_HERE = () => {
  throw new Error('この操作は iPad ではできません');
};
export const generateKeyPairSync = NOT_HERE;
export const sign = NOT_HERE;
export default {createHash, createHmac, randomBytes, randomUUID, getRandomValues, generateKeyPairSync, sign};
