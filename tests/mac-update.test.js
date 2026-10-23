import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  MAC_SIGNING_LEAF,
  REPLACE_SCRIPT,
  appBundle,
  canReplace,
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
  assert.equal(appBundle('/Applications/大学ノート.app/Contents/MacOS/大学ノート'), '/Applications/大学ノート.app');
  assert.equal(appBundle('/usr/bin/node'), null);
  assert.ok(canReplace('/Applications/大学ノート.app', yes));
  assert.ok(!canReplace('/Volumes/大学ノート/大学ノート.app', yes));
  assert.ok(!canReplace('/private/var/folders/x/AppTranslocation/y/d/大学ノート.app', yes));
  assert.ok(!canReplace('/Applications/大学ノート.app', (d) => d !== '/Applications'));
  assert.ok(!canReplace(null, yes));
});

const GOOD_LEAF = MAC_SIGNING_LEAF;
// 入れ替えのスクリプトを、Mac のコマンドの代わりの小さなスクリプトで動かす（hdiutil は .dmg の代わりのフォルダを写す）
function sandbox() {
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
  const app = path.join(dir, 'Applications', '大学ノート.app');
  makeApp(app, '0.1.0');
  const image = path.join(dir, 'image');
  makeApp(path.join(image, '大学ノート.app'), '0.2.0');
  const dmg = path.join(dir, 'daigaku-note-0.2.0-mac-arm64.dmg');
  writeFileSync(dmg, 'dmg のかわり');
  const opened = path.join(dir, 'opened.txt');
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
    // -R（要件）付きの確かめは、正しい指紋のときだけ通す
    CODESIGN: fake(
      'codesign',
      `for a; do case "$a" in -R=*) [ "$a" = '-R=certificate leaf = H"${GOOD_LEAF}"' ] || exit 1;; esac; done; exit 0`
    )
  };
  const run = (sum, leaf = GOOD_LEAF) => {
    const log = path.join(dir, 'updater.log');
    // プロセス番号 1 の代わりに、もう終わったプロセスを渡す（待たずに進む）
    let code = 0;
    try {
      execFileSync('/bin/sh', ['-c', REPLACE_SCRIPT, 'sh', '999999', dmg, app, '0.2.0', log, sum, leaf], {env});
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
  '入れ替え：新しい版が大学ノートの証明書で署名されていなければ（指紋が違う・指紋がない）入れ替えない',
  {skip: noShell},
  () => {
    for (const leaf of ['0000000000000000000000000000000000000000', '']) {
      const s = sandbox();
      const {code, log} = s.run(s.sha, leaf);
      assert.equal(code, 1);
      assert.match(log, leaf ? /大学ノートの証明書で署名されていません/ : /証明書の指紋がありません/);
      assert.match(s.version(), /CFBundleShortVersionString=0\.1\.0/);
      assert.equal(s.opened(), s.app);
    }
  }
);
