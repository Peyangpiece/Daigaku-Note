// スマホ連携の https（docs/MOBILE.md §3）：スマホのブラウザでカメラの映像を使う（その場で読む）には、ページが https でなければならない。
// このパソコンで作る自分の証明書（自己署名。ECDSA P-256・SHA-256）。SAN にパソコンの LAN の番号を入れる。
// 公の認証局の証明書ではないので、スマホは初めて開くときに「この接続ではプライバシーが保護されません」と出す（「詳細」→「このWebサイトを閲覧」で進む）。
// 通信の中身は、これとは別に端末ごとの鍵で暗号化している（mobile-wire.js）。証明書は、ブラウザにカメラを使わせるためのもの
import crypto from 'node:crypto';

// ---- DER（ASN.1）を組み立てる最小限 ----
const len = (n) => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const int = (buf) => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const oid = (s) => {
  const p = s.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const b = [v & 0x7f];
    let x = v >> 7;
    while (x > 0) {
      b.unshift(0x80 | (x & 0x7f));
      x >>= 7;
    }
    out.push(...b);
  }
  return tlv(0x06, Buffer.from(out));
};
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const bits = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
const octets = (buf) => tlv(0x04, buf);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
/** 時刻：2049 年までは UTCTime（YYMMDDHHMMSSZ） */
const time = (d) => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z', 'ascii'));
const ctx = (n, body, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, body);

const OID = {
  ecdsaSha256: '1.2.840.10045.4.3.2',
  cn: '2.5.4.3',
  org: '2.5.4.10',
  san: '2.5.29.17',
  basic: '2.5.29.19',
  keyUsage: '2.5.29.15',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1'
};

const ipBytes = (ip) => Buffer.from(ip.split('.').map(Number));

/**
 * 自己署名の証明書を作る。ips：SAN に入れる IPv4（パソコンの LAN の番号）。
 * 有効期間は 825 日（iOS がサーバーの証明書に許す長さまで）。戻り {key, cert}（PEM）
 */
export function makeSelfSigned({ips, now = new Date(), days = 825}) {
  const {privateKey, publicKey} = crypto.generateKeyPairSync('ec', {namedCurve: 'P-256'});
  const spki = publicKey.export({type: 'spki', format: 'der'});
  const name = seq(
    set(seq(oid(OID.org), utf8('Palette Note'))),
    set(seq(oid(OID.cn), utf8('Palette Note on this PC')))
  );
  const notBefore = new Date(now.getTime() - 24 * 3600 * 1000); // 時計のずれに少し余裕
  const notAfter = new Date(now.getTime() + days * 24 * 3600 * 1000);
  const san = seq(...ips.map((ip) => ctx(7, ipBytes(ip), false)), ctx(2, Buffer.from('localhost', 'ascii'), false));
  const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
  const extensions = ctx(
    3,
    seq(
      ext(OID.basic, true, seq()),
      ext(OID.keyUsage, true, bits(Buffer.from([0x80]))), // digitalSignature
      ext(OID.extKeyUsage, false, seq(oid(OID.serverAuth))),
      ext(OID.san, false, san)
    )
  );
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  const alg = seq(oid(OID.ecdsaSha256));
  const tbs = seq(
    ctx(0, int(Buffer.from([2]))),
    int(serial),
    alg,
    name,
    seq(time(notBefore), time(notAfter)),
    name,
    spki,
    extensions
  );
  const sig = crypto.sign('sha256', tbs, privateKey); // DER の ECDSA の署名
  const der = seq(tbs, alg, bits(sig));
  const pem = `-----BEGIN CERTIFICATE-----\n${der
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n')}\n-----END CERTIFICATE-----\n`;
  return {key: privateKey.export({type: 'pkcs8', format: 'pem'}), cert: pem};
}

/**
 * 覚えてある証明書（old：{key, cert, ips, notAfter} か null）を使う。いまの LAN の番号が SAN に入っていない・期限が 30 日を切ったら作り直す。
 * 戻り {key, cert, save}：save は作り直したときに覚えておくもの（使い続けるときは null）
 */
export function certFor(ips, old, now = new Date()) {
  const fresh =
    old?.key &&
    old?.cert &&
    ips.every((ip) => old.ips?.includes(ip)) &&
    new Date(old.notAfter).getTime() - now.getTime() > 30 * 24 * 3600 * 1000;
  if (fresh) return {key: old.key, cert: old.cert, save: null};
  const all = [...new Set([...(old?.ips ?? []), ...ips])].slice(-8); // 前の番号も入れておく（Wi-Fi を行き来しても作り直さない）
  const made = makeSelfSigned({ips: all, now});
  return {...made, save: {...made, ips: all, notAfter: new Date(now.getTime() + 825 * 24 * 3600 * 1000).toISOString()}};
}
