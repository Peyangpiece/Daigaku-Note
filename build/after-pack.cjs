// electron-builder の afterPack：Mac のアプリに ad-hoc 署名をする（electron-builder.yml の mac.identity: null で、electron-builder 自身の署名は止めている）。
// Apple の証明書がなくても、署名がないと Apple シリコンでは「壊れているため開けません」になり、自動更新の入れ替え（mac-update.js）でも
// codesign --verify が通らない。ad-hoc は証明書を使わない署名で、中身が壊れていないことだけを確かめられる
const {execFileSync} = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], {stdio: 'inherit'});
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], {stdio: 'inherit'});
  console.log(`大学ノート: ${path.basename(app)} に ad-hoc 署名をしました`);
};
