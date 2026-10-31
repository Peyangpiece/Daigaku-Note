// 配布物に入る第三者のソフトウェアのライセンス一覧（THIRD-PARTY-NOTICES.md）を作る。
// 使い方：node scripts/third-party-notices.mjs（依存を変えたら実行してコミットする。tests/notices.test.js が漏れを見る）
// 対象：package-lock.json の本番の依存（dev でないもの）＋同梱するフォント・three の addons・Electron
import {readFileSync, writeFileSync, readdirSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const pkgs = Object.entries(lock.packages)
  .filter(([k, v]) => k && !v.dev)
  .map(([k]) => k)
  .sort();

function licenseText(dir) {
  const f = readdirSync(dir).find((n) => /^(licen[cs]e|copying)(\.|$)/i.test(n));
  return f ? readFileSync(path.join(dir, f), 'utf8').trim() : null;
}

const parts = [];
parts.push(`# 第三者のソフトウェアのライセンス

大学ノートは、次のソフトウェア・フォントを含んで配布しています。それぞれの著作権とライセンスは各項のとおりです。
この一覧は \`scripts/third-party-notices.mjs\` が package-lock.json から作ります（依存を変えたら作り直す）。

## 実行環境

- **Electron**（MIT）と、その中の **Chromium**・**Node.js** ほか。これらのライセンス文はアプリに同梱の \`LICENSE.electron.txt\`・\`LICENSES.chromium.html\` にあります。
- **Noto Sans JP**・**Zen Maru Gothic**（SIL Open Font License 1.1）。ライセンス文は \`src/renderer/fonts/OFL-NotoSansJP.txt\`・\`OFL-ZenMaruGothic.txt\`。
- **three.js の addons**（MIT。three 本体と同じ。\`src/renderer/vendor/three-addons/LICENSE\`）。
- **IPA ゴシック**（IPA フォントライセンス v1.0）。公式の文房具の 3D モデル（\`src/renderer/assets/stationery/*.glb\`）の印字「大学ノート」は、この書体の字の形を立体にしたもの（フォントのファイルは含まない）。

## npm の依存
`);
for (const p of pkgs) {
  const dir = path.join(root, p);
  if (!existsSync(path.join(dir, 'package.json'))) continue;
  const meta = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const text = licenseText(dir);
  parts.push(`### ${meta.name} ${meta.version}

- ライセンス：${typeof meta.license === 'string' ? meta.license : (meta.license?.type ?? '（package.json に記載なし）')}
${meta.homepage ? `- ${meta.homepage}\n` : ''}
${text ? '```\n' + text + '\n```' : '（ライセンス文のファイルは同梱されていません。上のライセンス名を参照）'}
`);
}
writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), parts.join('\n'));
console.log(`THIRD-PARTY-NOTICES.md：${pkgs.length} パッケージ`);
