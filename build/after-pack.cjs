// electron-builder の afterPack：Mac のアプリに署名する（electron-builder.yml の mac.identity: null で、electron-builder 自身の署名は止めている）。
// MAC_SIGN_IDENTITY（release.yml が GitHub の Secrets の MAC_SIGN_P12 から用意する自分の証明書）があればそれで、なければ ad-hoc（-）で署名する。
// - 署名がないと Apple シリコンでは「壊れているため開けません」になり、自動更新の入れ替え（mac-update.js）でも codesign --verify が通らない
// - 毎回同じ証明書で署名すると、アプリの「指定要件」（designated requirement）が版をまたいで変わらない。キーチェーンの
//   「大学ノート Safe Storage」に「常に許可」した許可が更新のあとも引き継がれ、保存した LMS のログイン（secrets.js）を読み続けられる。
//   ad-hoc は版ごとに指定要件が変わるので、更新のたびに読めなくなる（接続が切れる）
const {execFileSync, spawnSync} = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const identity = process.env.MAC_SIGN_IDENTITY || '-';
  const keychain = process.env.MAC_SIGN_KEYCHAIN;
  const codesign = (args) => execFileSync('/usr/bin/codesign', args, {stdio: 'inherit'});
  codesign(['--force', '--deep', '--sign', identity, ...(keychain ? ['--keychain', keychain] : []), app]);
  codesign(['--verify', '--deep', '--strict', '--verbose=2', app]);
  const info = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', app], {encoding: 'utf8'}).stderr || '';
  console.log(info.split('\n').filter((l) => /^(Identifier|Authority|Signature|TeamIdentifier)=/.test(l)).join('\n'));
  const req = spawnSync('/usr/bin/codesign', ['-d', '-r-', app], {encoding: 'utf8'});
  console.log(`${req.stdout || ''}${req.stderr || ''}`.split('\n').filter((l) => l.startsWith('designated')).join('\n'));
  if (identity !== '-' && /Signature=adhoc/.test(info)) throw new Error('証明書で署名したはずが ad-hoc のままです');
  console.log(`大学ノート: ${path.basename(app)} を${identity === '-' ? ' ad-hoc ' : '自分の証明書'}で署名しました`);
};
