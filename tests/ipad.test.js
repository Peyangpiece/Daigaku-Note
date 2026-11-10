// iPad アプリ（ipad/。docs/MOBILE.md §8）：QR の読み方と、アプリの設定（バンドル ID・iPad 専用・カメラ・LAN）
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fromQr} from '../ipad/src/qr.js';
import {pairUrl, randomBytes} from '../src/shared/mobile-wire.js';

const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('QR：https の入口の QR から、http の入口（hp）と # をそのまま取り出す', () => {
  const url = pairUrl({
    host: '192.168.1.5',
    port: 47391,
    deviceId: ULID,
    key: randomBytes(32),
    secure: true,
    httpPort: 47390
  });
  const r = fromQr(url);
  assert.equal(r.base, 'http://192.168.1.5:47390');
  assert.equal(r.hash, new URL(url).hash);
  // 前の版の QR（hp なし）：http の入口ならそのまま、https だけなら使えない
  assert.equal(
    fromQr(pairUrl({host: '10.0.0.2', port: 47390, deviceId: ULID, key: randomBytes(32)})).base,
    'http://10.0.0.2:47390'
  );
  assert.equal(
    fromQr(pairUrl({host: '10.0.0.2', port: 47391, deviceId: ULID, key: randomBytes(32), secure: true})),
    null
  );
  for (const bad of ['', 'hello', 'https://example.com/', 'http://10.0.0.2:47390/m/#d=x'])
    assert.equal(fromQr(bad), null, bad);
});

test('アプリの設定：バンドル ID・iPad 専用・カメラと LAN の説明・LAN の http を許す', () => {
  const cap = JSON.parse(read('ipad/capacitor.config.json'));
  assert.equal(cap.appId, 'jp.daigakunote.ipad');
  assert.match(cap.appendUserAgent, /PaletteNoteApp/);
  const pbx = read('ipad/ios/App/App.xcodeproj/project.pbxproj');
  assert.ok(!/TARGETED_DEVICE_FAMILY = "1,2"/.test(pbx));
  assert.match(pbx, /TARGETED_DEVICE_FAMILY = 2;/);
  assert.match(pbx, /PRODUCT_BUNDLE_IDENTIFIER = jp\.daigakunote\.ipad;/);
  const plist = read('ipad/ios/App/App/Info.plist');
  for (const k of ['NSCameraUsageDescription', 'NSLocalNetworkUsageDescription', 'NSAllowsLocalNetworking'])
    assert.ok(plist.includes(k), k);
  // アプリの中で開いたページは、ホーム画面に追加したアイコンと同じ扱い（QR の # でつなぐ）
  assert.match(read('src/mobile/client.js'), /PaletteNoteApp/);
});

test('最初の画面：カメラの映像が出ないときのために、写真を撮って QR を読める', () => {
  const js = read('ipad/src/start.js');
  assert.match(js, /type="file" accept="image\/\*" capture="environment"/);
  assert.match(js, /readPhoto/);
});
