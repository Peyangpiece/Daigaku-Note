// ホームページの利用規約とプライバシーポリシー（site/terms.html・site/privacy.html）を、アプリの中の文章から作る。
// 文章のもとは src/shared/policy.js と src/shared/lms-terms.js だけ（アプリとホームページで同じ文章にする）。
// 文章を変えたら `node scripts/site-policy.mjs && npm run format` で作り直す。tests/site.test.js がずれを見つける
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {AI_NOT_SENDS, AI_SENDS, POLICY_VERSION, PRIVACY, TERMS} from '../src/shared/policy.js';
import {LMS_FEATURE, LMS_NOTICE, LMS_TERMS, LMS_TERMS_VERSION} from '../src/shared/lms-terms.js';
import {esc} from '../src/shared/html.js';

/** ホームページだけのこと（アプリの外）。アプリの文章ではないので、ここに書く */
export const SITE_PRIVACY = [
  'このホームページは、アクセス解析・広告・Cookie を使いません。',
  'ページを表示するときに、文字の形（フォント）を Google Fonts から、最新版のファイルの一覧を GitHub から読み込みます。このとき、見ている人の IP アドレスなどがそれぞれのサービスに送られます。',
  'このホームページは GitHub Pages で公開し、アプリのファイルは GitHub（Releases）から配っています。GitHub は、そのサービスの決まりに沿ってアクセスの記録を残すことがあります。'
];

const ol = (items) => `<ol>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`;
const ul = (items) => `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;

function page(title, body) {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)} — 大学ノート</title>
    <link rel="icon" href="favicon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Zen+Maru+Gothic:wght@500;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header class="top">
      <a class="brand" href="./"><img src="icon.png" alt="" width="36" height="36" />大学ノート</a>
      <nav aria-label="ほかのページ"><a href="./">ホーム</a><a href="terms.html">利用規約</a><a href="privacy.html">プライバシーポリシー</a></nav>
    </header>
    <main class="doc">
${body}
    </main>
    <footer class="foot">
      <p><a href="terms.html">利用規約</a> ・ <a href="privacy.html">プライバシーポリシー</a> ・ <a href="https://github.com/Peyangpiece/Daigaku-Note">GitHub</a></p>
      <p>© 2026 大学ノート</p>
    </footer>
  </body>
</html>
`;
}

export function termsHtml() {
  return page(
    '利用規約',
    `<h1>利用規約</h1>
<p class="muted">版：${POLICY_VERSION}（アプリの「設定 → 情報 → 利用規約とプライバシーポリシー」と同じ文章です）</p>
${ol(TERMS)}
<h2>${esc(LMS_FEATURE)}の利用規約</h2>
<p class="muted">版：${LMS_TERMS_VERSION}（大学の LMS とつなぐときに、アプリの中で同意をお願いしています）</p>
<div class="callout"><p><strong>使う前に</strong></p>${ul(LMS_NOTICE)}</div>
${LMS_TERMS.map(([h, t]) => `<h3>${esc(h)}</h3><p>${esc(t)}</p>`).join('\n')}
<p><a href="privacy.html">プライバシーポリシー</a>もあわせてお読みください。</p>`
  );
}

export function privacyHtml() {
  return page(
    'プライバシーポリシー',
    `<h1>プライバシーポリシー</h1>
<p class="muted">版：${POLICY_VERSION}（アプリの「設定 → 情報 → 利用規約とプライバシーポリシー」と同じ文章です）</p>
<h2>アプリ（大学ノート）が扱うデータ</h2>
${ol(PRIVACY)}
<h2>AI でクイズを作るとき</h2>
<p>自分の Claude API キーを登録して同意したときだけ、Anthropic の API に送ります。</p>
<div class="two">
<div><h3>送るもの</h3>${ul(AI_SENDS)}</div>
<div><h3>送らないもの</h3>${ul(AI_NOT_SENDS)}</div>
</div>
<h2>このホームページ</h2>
${ul(SITE_PRIVACY)}
<p><a href="terms.html">利用規約</a>もあわせてお読みください。</p>`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL('../site/', import.meta.url);
  writeFileSync(new URL('terms.html', dir), termsHtml());
  writeFileSync(new URL('privacy.html', dir), privacyHtml());
  console.log('site/terms.html・site/privacy.html を作りました。npm run format で整えてください');
}
