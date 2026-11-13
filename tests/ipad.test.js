// iPad アプリ（ipad/。docs/MOBILE.md §8）：QR の読み方と、アプリの設定（バンドル ID・iPad 専用・カメラ・LAN）
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fromQr, lanBase, lanHost} from '../ipad/src/qr.js';
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

test('QR・設定：アプリの中で開くのは LAN の番号のパソコンだけ（外の先・名前の先は開かない）', () => {
  const hash = `#d=${ULID}&k=abc&hp=47390`;
  for (const ok of ['10.0.0.2', '192.168.1.5', '172.16.0.9', '172.31.255.1'])
    assert.equal(fromQr(`https://${ok}:47391/m/${hash}`)?.base, `http://${ok}:47390`, ok);
  for (const bad of ['evil.example.com', '8.8.8.8', '172.32.0.1', '192.169.1.1', '127.0.0.1', '10.0.0.999', '[::1]'])
    assert.equal(fromQr(`https://${bad}:47391/m/${hash}`), null, bad);
  assert.equal(lanHost('192.168.1.5'), true);
  assert.equal(lanBase('http://192.168.1.5:47390'), true);
  for (const bad of ['http://evil.example.com:47390', 'https://192.168.1.5:47391', 'http://192.168.1.5:47390/x', ''])
    assert.equal(lanBase(bad), false, bad);
  assert.match(read('ipad/src/start.js'), /lanBase\(s\.base\)/, '覚えた入口も確かめる');
  // アプリの設定も同じ範囲だけ（どこへでも移れる "*" にしない）。Capacitor は . で区切った段ごとに * を見る
  const nav = JSON.parse(read('ipad/capacitor.config.json')).server.allowNavigation;
  assert.ok(!nav.includes('*'));
  assert.equal(nav.length, 18);
  for (const pat of nav) assert.match(pat, /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))(\.\*){2,3}$/, pat);
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
  const js = read('ipad/src/scanner.js');
  assert.match(js, /type="file" accept="image\/\*" capture="environment"/);
  assert.match(js, /readPhoto/);
  assert.match(read('ipad/src/start.js'), /photoButton\(\)/);
});

test('パソコンなしで使う：Google のログインから戻る URL スキームを Info.plist に入れ、使うプラグインを入れている', async () => {
  const {GOOGLE_IOS} = await import('../src/shared/google-client.js');
  const plist = read('ipad/ios/App/App/Info.plist');
  assert.match(plist, /CFBundleURLTypes/);
  assert.ok(plist.includes(`<string>${GOOGLE_IOS.scheme}</string>`));
  const pkg = JSON.parse(read('ipad/package.json'));
  for (const p of ['@capacitor/app', '@capacitor/browser', '@capacitor/filesystem'])
    assert.match(pkg.dependencies[p] ?? '', /^\d+\.\d+\.\d+$/, `${p} の版を固定する`);
  const spm = read('ipad/ios/App/CapApp-SPM/Package.swift');
  for (const p of ['CapacitorApp', 'CapacitorBrowser', 'CapacitorFilesystem']) assert.match(spm, new RegExp(p));
  // 組み立てで、パソコンと同じ部品（暗号化・鍵）と @noble を入れる。中継の src/shared は本体を読む
  const build = read('ipad/build-www.mjs');
  for (const f of ['vault.js', 'vault-keys.js', 'google-client.js']) {
    assert.ok(build.includes(`'${f}'`), f);
    assert.match(read(`ipad/src/shared/${f}`), new RegExp(`src/shared/${f.replace('.', '\\.')}`));
  }
  assert.match(read('ipad/src/index.html'), /"@noble\/hashes\/": "\.\/vendor\/noble-hashes\/"/);
});
