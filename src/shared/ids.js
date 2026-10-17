// ID と小さなハッシュ。副作用なし（乱数は crypto）。
import {randomBytes} from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

/** ULID：時刻 48 ビット＋乱数 80 ビット。26 文字。並び順が時刻順になる */
export function ulid(now = Date.now()) {
  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(10);
  let rand = '';
  let acc = 0,
    bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      rand += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return (time + rand).slice(0, 26);
}

export const isUlid = (s) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(String(s ?? ''));

/** FNV-1a 32 ビット。テープの角度など、見た目を安定させる用途 */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) {
    for (const b of Buffer.from(ch, 'utf8')) {
      h ^= b;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

/** マスキングテープの角度：−6〜+6 度。授業 ID から決める（毎回同じ） */
export const tapeAngle = (id) => (hash32(id) % 13) - 6;
