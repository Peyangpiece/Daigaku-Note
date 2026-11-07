import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  MAC_SIGNING_LEAF,
  MAC_TEAM_ID,
  REPLACE_SCRIPT,
  appBundle,
  canReplace,
  developerIdRequirement,
  installerDigest,
  isNewer,
  macInstallerName,
  macInstallerUrl
} from '../src/main/mac-update.js';

const SUM = 'A'.repeat(86) + '==';

test('版の比べ方', () => {
  assert.ok(isNewer('0.2.0', '0.1.9'));
  assert.ok(isNewer('1.0.0', '0.99.99'));
  assert.ok(isNewer('0.1.10', '0.1.9'));
  assert.ok(!isNewer('0.1.0', '0.1.0'));
  assert.ok(!isNewer('0.1', '0.1.0'));
  assert.ok(!isNewer('0.0.9', '0.1.0'));
});

test('配布物の名前と URL は electron-builder.yml の artifactName に合わせる', () => {
  assert.equal(macInstallerName('0.2.0', 'arm64'), 'daigaku-note-0.2.0-mac-arm64.dmg');
  assert.equal(macInstallerName('0.2.0', 'x64'), 'daigaku-note-0.2.0-mac-x64.dmg');
  assert.equal(
    macInstallerUrl('0.2.0', 'arm64'),
    'https://github.com/Peyangpiece/Daigaku-Note/releases/download/v0.2.0/daigaku-note-0.2.0-mac-arm64.dmg'
  );
  const yml = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
  assert.match(yml, /artifactName: daigaku-note-\$\{version\}-\$\{os\}-\$\{arch\}\.\$\{ext\}/);
});

test('sha512 は latest-mac.yml の files から名前で取る。形が違えば使わない', () => {
  const files = [
    {url: 'daigaku-note-0.2.0-mac-x64.zip', sha512: 'B'.repeat(86) + '=='},
    {url: 'https://example.com/x/daigaku-note-0.2.0-mac-arm64.dmg', sha512: SUM}
  ];
  assert.equal(installerDigest(files, 'daigaku-note-0.2.0-mac-arm64.dmg'), SUM);
  assert.equal(installerDigest(files, 'daigaku-note-0.2.0-mac-x64.dmg'), null);
  assert.equal(installerDigest([{url: 'a.dmg', sha512: 'short'}], 'a.dmg'), null);
  assert.equal(installerDigest(null, 'a.dmg'), null);
});

test('入れ替えられる場所か', () => {
  const yes = () => true;
  assert.equal(
    appBundle('/Applications/パレットノート.app/Contents/MacOS/パレットノート'),
    '/Applications/パレットノート.app'
  );
  assert.equal(appBundle('/usr/bin/node'), null);
  assert.ok(canReplace('/Applications/パレットノート.app', yes));
  assert.ok(!canReplace('/Volumes/パレットノート/パレットノート.app', yes));
  assert.ok(!canReplace('/private/var/folders/x/AppTranslocation/y/d/パレットノート.app', yes));
  assert.ok(!canReplace('/Applications/パレットノート.app', (d) => d !== '/Applications'));
  assert.ok(!canReplace(null, yes));
});

const GOOD_LEAF = MAC_SIGNING_LEAF;
const DEVID = developerIdRequirement(MAC_TEAM_ID);
// 入れ替えのスクリプトを、Mac のコマンドの代わりの小さなスクリプトで動かす（hdiutil は .dmg の代わりのフォルダを写す）
// signedBy：新しい版の署名。'self' は自分の証明書、'devid' は Developer ID（チーム 9G78U9XD92）
function sandbox(signedBy = 'self') {
  const dir = mkdtempSync(path.join(tmpdir(), 'daigaku-update-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  const fake = (name, body) => {
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
    return path.join(bin, name);
  };
  const makeApp = (at, version) => {
    mkdirSync(path.join(at, 'Contents'), {recursive: true});
    writeFileSync(
      path.join(at, 'Contents', 'Info.plist'),
      `CFBundleIdentifier=jp.daigakunote.app\nCFBundleShortVersionString=${version}\n`
    );
  };
  const app = path.join(dir, 'Applications', 'パレットノート.app');
  makeApp(app, '0.1.0');
  const image = path.join(dir, 'image');
  makeApp(path.join(image, 'パレットノート.app'), '0.2.0');
  const dmg = path.join(dir, 'daigaku-note-0.2.0-mac-arm64.dmg');
  writeFileSync(dmg, 'dmg のかわり');
  const opened = path.join(dir, 'opened.txt');
  const devidFile = path.join(dir, 'devid.txt');
  writeFileSync(devidFile, DEVID);
  const env = {
    ...process.env,
    TMPDIR: dir,
    WAIT: '4',
    HDIUTIL: fake(
      'hdiutil',
      `[ "$1" = attach ] && { while [ $# -gt 1 ]; do [ "$1" = -mountpoint ] && mnt=$2; shift; done; cp -R "${image}"/. "$mnt"/; }; exit 0`
    ),
    PLIST: fake('plistbuddy', 'key=${2#Print :}; grep "^$key=" "$3" | cut -d= -f2-'),
    DITTO: fake('ditto', 'cp -R "$1" "$2"'),
    OPEN: fake('open', `echo "$1" >> "${opened}"`),
    XATTR: fake('xattr', 'exit 0'),
    // -R（要件）付きの確かめは、署名の種類に合う要件（自分の証明書の正しい指紋、または Developer ID の要件）のときだけ通す
    CODESIGN: fake(
      'codesign',
      signedBy === 'devid'
        ? `for a; do case "$a" in -R=*) [ "$a" = "-R=$(cat '${devidFile}')" ] || exit 1;; esac; done; exit 0`
        : `for a; do case "$a" in -R=*) [ "$a" = '-R=certificate leaf = H"${GOOD_LEAF}"' ] || exit 1;; esac; done; exit 0`
    )
  };
  const run = (sum, leaf = GOOD_LEAF, devid = DEVID) => {
    const log = path.join(dir, 'updater.log');
    // プロセス番号 1 の代わりに、もう終わったプロセスを渡す（待たずに進む）
    let code = 0;
    try {
      execFileSync('/bin/sh', ['-c', REPLACE_SCRIPT, 'sh', '999999', dmg, app, '0.2.0', log, sum, leaf, devid], {
        env
      });
    } catch (e) {
      code = e.status;
    }
    return {code, log: readFileSync(log, 'utf8')};
  };
  const sha = createHash('sha512').update(readFileSync(dmg)).digest('base64');
  return {
    app,
    run,
    sha,
    version: () => readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8'),
    opened: () => readFileSync(opened, 'utf8').trim()
  };
}

// 入れ替えのスクリプトは Mac でしか動かない（/bin/sh・openssl を使う）。Windows には /bin/sh がないので、Linux と Mac で確かめる
const noShell = (() => {
  if (process.platform === 'win32') return 'Mac 用のシェルスクリプトのため Windows では動かさない';
  try {
    execFileSync('openssl', ['version']);
    return false;
  } catch {
    return 'openssl がない';
  }
})();

test('入れ替え：sha512 が合えば新しい版に入れ替えて開く', {skip: noShell}, () => {
  const s = sandbox();
  const {code, log} = s.run(s.sha);
  assert.equal(code, 0);
  assert.match(log, /0\.2\.0 に入れ替えました/);
  assert.match(s.version(), /CFBundleShortVersionString=0\.2\.0/);
  assert.equal(s.opened(), s.app);
  assert.ok(!existsSync(`${s.app}.old`) && !existsSync(`${s.app}.new`));
});

test('入れ替え：sha512 が合わなければ元のまま開き直す', {skip: noShell}, () => {
  const s = sandbox();
  const {code, log} = s.run(SUM);
  assert.equal(code, 1);
  assert.match(log, /\.dmg が配布物と一致しません/);
  assert.match(s.version(), /CFBundleShortVersionString=0\.1\.0/);
  assert.equal(s.opened(), s.app);
});

test(
  '入れ替え：新しい版がパレットノートの証明書で署名されていなければ（指紋が違う・指紋がない）入れ替えない',
  {skip: noShell},
  () => {
    for (const leaf of ['0000000000000000000000000000000000000000', '']) {
      const s = sandbox();
      const {code, log} = s.run(s.sha, leaf);
      assert.equal(code, 1);
      assert.match(log, leaf ? /パレットノートの証明書で署名されていません/ : /証明書の指紋がありません/);
      assert.match(s.version(), /CFBundleShortVersionString=0\.1\.0/);
      assert.equal(s.opened(), s.app);
    }
  }
);

test('入れ替え：Developer ID（チーム 9G78U9XD92）で署名された版も受け入れる（v0.18.5）', {skip: noShell}, () => {
  assert.equal(MAC_TEAM_ID, '9G78U9XD92');
  assert.match(DEVID, /anchor apple generic/);
  assert.match(DEVID, /certificate leaf\[subject\.OU\] = "9G78U9XD92"/);
  const s = sandbox('devid');
  const {code, log} = s.run(s.sha);
  assert.equal(code, 0);
  assert.match(log, /0\.2\.0 に入れ替えました/);
  assert.match(s.version(), /CFBundleShortVersionString=0\.2\.0/);
});

test('入れ替え：Developer ID の要件を渡さなければ、Developer ID の版は入れ替えない', {skip: noShell}, () => {
  const s = sandbox('devid');
  const {code, log} = s.run(s.sha, GOOD_LEAF, '');
  assert.equal(code, 1);
  assert.match(log, /パレットノートの証明書で署名されていません/);
  assert.match(s.version(), /CFBundleShortVersionString=0\.1\.0/);
});

test('配布物のダウンロード：公開直後の 400 は取り直し、途中で切れたら続き（Range）から取る。取り直しても変わらない状態はすぐ止める', async () => {
  const {downloadResumable} = await import('../src/main/mac-update.js');
  const {Readable} = await import('node:stream');
  const {tmpdir} = await import('node:os');
  const path = await import('node:path');
  const dir = mkdtempSync(path.join(tmpdir(), 'dn-dl-'));
  const part = path.join(dir, 'a.dmg.download');
  const body = Buffer.from('0123456789abcdefghij');
  // 途中で切れる流れ（最初の n バイトのあとで HTTP/2 の誤り）
  const broken = (buf) =>
    new Readable({
      read() {
        if (this.sent) return;
        this.sent = true;
        this.push(buf);
        setTimeout(() => this.destroy(new Error('net::ERR_HTTP2_PROTOCOL_ERROR')), 30); // 書けたあとで切れる
      }
    });
  const calls = [];
  const steps = [
    () => ({status: 400, length: 0, stream: Readable.from([])}),
    () => ({status: 200, length: body.length, stream: broken(body.subarray(0, 8))}),
    ({from}) =>
      from > 0
        ? {status: 206, length: body.length - from, stream: Readable.from([body.subarray(from)])}
        : {status: 200, length: body.length, stream: Readable.from([body])}
  ];
  const waits = [];
  const r = await downloadResumable(async (o) => (calls.push(o), steps.shift()(o)), part, {
    delays: [1, 1, 1],
    sleep: async () => {},
    onWait: (n) => waits.push(n)
  });
  assert.equal(r.size, body.length);
  assert.deepEqual(readFileSync(part), body, '切れたところから続きを足して、元と同じ中身');
  assert.deepEqual(
    calls.map((c) => c.from),
    [0, 0, 8],
    '3 回目は 8 バイト目から頼む'
  );
  assert.deepEqual(waits, [1, 2]);
  await assert.rejects(
    downloadResumable(async () => ({status: 410, length: 0, stream: Readable.from([])}), path.join(dir, 'b'), {
      delays: [1],
      sleep: async () => {}
    }),
    /（410）/,
    '取り直しても変わらない状態はすぐ止める'
  );
  let n = 0;
  await assert.rejects(
    downloadResumable(async () => (n++, {status: 503, length: 0, stream: Readable.from([])}), path.join(dir, 'c'), {
      delays: [1, 1],
      sleep: async () => {}
    }),
    /（503）/
  );
  assert.equal(n, 3, '最初の 1 回と取り直し 2 回');
});

test('通信の名乗りは英字だけ：日本語のアプリ名は PaletteNote に替える', async () => {
  const {asciiUserAgent} = await import('../src/main/user-agent.js');
  const ua =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) パレットノート/0.19.1 Chrome/152.0.7977.167 Electron/44.9.3 Safari/537.36';
  const out = asciiUserAgent(ua);
  assert.equal(
    out,
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) PaletteNote/0.19.1 Chrome/152.0.7977.167 Electron/44.9.3 Safari/537.36'
  );
  assert.ok(/^[\x20-\x7e]+$/.test(out));
  assert.equal(asciiUserAgent('a/1 b'), 'a/1 b', '英字だけならそのまま');
});
