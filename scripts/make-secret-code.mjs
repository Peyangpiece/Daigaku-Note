// シークレットコードを作る（管理者だけが使う。src/shared/secret-codes.js）。
//   node scripts/make-secret-code.mjs <id> <ポイント> [<履歴に出す名前>] [<使える最後の日 YYYY-MM-DD>]
// コード（人に配るもの）と、CODES に足す 1 行を出す。コードはリポジトリに書かない（公開しているため）。CODES には印だけを置く
import {randomBytes} from 'node:crypto';
import {hashCode} from '../src/shared/secret-codes.js';

const [id, amount, label = 'シークレットコード', until = null] = process.argv.slice(2);
if (!/^[a-z0-9-]{2,40}$/.test(id ?? '') || !/^[1-9]\d{0,6}$/.test(amount ?? '')) {
  console.error('使い方：node scripts/make-secret-code.mjs <id（英小文字・数字・-）> <ポイント> [名前] [YYYY-MM-DD]');
  process.exit(1);
}
if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
  console.error('使える最後の日は YYYY-MM-DD');
  process.exit(1);
}
// 紛らわしい文字（I・L・O・0・1）を除いた 31 文字から 12 文字（約 59 ビット）。偏らないよう、範囲外のバイトは捨てる
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
let body = '';
while (body.length < 12) for (const b of randomBytes(16)) if (b < 248 && body.length < 12) body += ABC[b % ABC.length];
const code = `PN-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}`;
const salt = randomBytes(8).toString('hex');
const entry = {id, salt, hash: hashCode(code, salt), amount: Number(amount), label, until};
console.log(`配るコード：${code}`);
console.log('src/shared/secret-codes.js の CODES に足す行：');
console.log(`  ${JSON.stringify(entry)},`);
