import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import https from 'node:https';
import tls from 'node:tls';
import {certFor, makeSelfSigned} from '../src/main/mobile/tls-cert.js';
import {pairUrl} from '../src/shared/mobile-wire.js';

test('スマホ連携の https：自分の証明書は LAN の番号を SAN に持ち、署名が正しく、825 日で切れる', () => {
  const now = new Date('2026-11-08T00:00:00Z');
  const {key, cert} = makeSelfSigned({ips: ['192.168.1.20'], now});
  const x = new crypto.X509Certificate(cert);
  assert.match(x.subjectAltName, /IP Address:192\.168\.1\.20/);
  assert.ok(x.verify(x.publicKey), '自分の鍵で署名を確かめられる');
  assert.ok(x.checkPrivateKey(crypto.createPrivateKey(key)), '秘密の鍵と組になっている');
  const days = (new Date(x.validTo) - now) / 86400000;
  assert.ok(days > 824 && days <= 826, `有効期間 ${days} 日`);
  assert.match(x.keyUsage?.join(',') ?? '', /1\.3\.6\.1\.5\.5\.7\.3\.1/, 'サーバーの認証に使える');
});

test('スマホ連携の https：証明書の番号の先頭が 0 でも、いちばん短い形で書く（DER の決まり。でないと読めない証明書になる）', () => {
  for (const head of [
    [0x00, 0x01],
    [0x00, 0x80],
    [0x00, 0x00, 0x05],
    [0x80, 0x01]
  ]) {
    const serial = Buffer.concat([Buffer.from(head), crypto.randomBytes(13)]);
    const {cert} = makeSelfSigned({ips: ['192.168.1.20'], serial});
    const x = new crypto.X509Certificate(cert);
    assert.ok(x.verify(x.publicKey));
    assert.doesNotThrow(() => tls.createSecureContext({cert}));
  }
});

test('スマホ連携の https：証明書で TLS を張れる。LAN の番号が変われば作り直す（前の番号も残す）', async () => {
  const first = certFor(['192.168.1.20'], null);
  assert.ok(first.save);
  const same = certFor(['192.168.1.20'], first.save);
  assert.equal(same.save, null, '同じ番号なら作り直さない');
  assert.equal(same.cert, first.cert);
  const moved = certFor(['10.0.0.8'], first.save);
  assert.ok(moved.save);
  assert.deepEqual(moved.save.ips, ['192.168.1.20', '10.0.0.8']);
  const server = https.createServer({key: moved.key, cert: moved.cert}, (q, r) => r.end('ok'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const san = await new Promise((resolve, reject) => {
    const c = tls.connect({port: server.address().port, host: '127.0.0.1', rejectUnauthorized: false}, () => {
      resolve(c.getPeerX509Certificate().subjectAltName);
      c.end();
    });
    c.on('error', reject);
  });
  server.close();
  assert.match(san, /10\.0\.0\.8/);
});

test('スマホを追加する QR：https のときは https の入口（カメラを使えるページ）', () => {
  const key = new Uint8Array(32);
  const d = '01JABCDEFGHJKMNPQRSTVWXYZ1';
  assert.match(
    pairUrl({host: '192.168.1.20', port: 47391, deviceId: d, key, secure: true}),
    /^https:\/\/192\.168\.1\.20:47391\/m\/#d=/
  );
  assert.match(pairUrl({host: '192.168.1.20', port: 47390, deviceId: d, key}), /^http:\/\//);
});
