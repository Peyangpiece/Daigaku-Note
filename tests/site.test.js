import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AI_NOT_SENDS, AI_SENDS, POLICY_VERSION, PRIVACY, TERMS} from '../src/shared/policy.js';
import {LMS_NOTICE, LMS_TERMS, LMS_TERMS_VERSION} from '../src/shared/lms-terms.js';
import {SITE_PRIVACY} from '../scripts/site-policy.mjs';

// 空白（整形で入る改行）を除き、HTML の文字参照を戻して比べる
const flat = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '');
const page = (name) => flat(readFileSync(new URL(`../site/${name}`, import.meta.url), 'utf8'));

test('ホームページの利用規約は、アプリの中の文章と同じ（ずれたら node scripts/site-policy.mjs で作り直す）', () => {
  const html = page('terms.html');
  for (const t of [...TERMS, ...LMS_NOTICE, ...LMS_TERMS.flat(), POLICY_VERSION, LMS_TERMS_VERSION])
    assert.ok(html.includes(flat(t)), `site/terms.html にない：${t.slice(0, 30)}…`);
});

test('ホームページのプライバシーポリシーは、アプリの中の文章と同じ', () => {
  const html = page('privacy.html');
  for (const t of [...PRIVACY, ...AI_SENDS, ...AI_NOT_SENDS, ...SITE_PRIVACY, POLICY_VERSION])
    assert.ok(html.includes(flat(t)), `site/privacy.html にない：${t.slice(0, 30)}…`);
});

test('ホームページの各ページから、利用規約とプライバシーポリシーへ行ける', () => {
  for (const name of ['index.html', 'terms.html', 'privacy.html']) {
    const raw = readFileSync(new URL(`../site/${name}`, import.meta.url), 'utf8');
    assert.ok(raw.includes('href="terms.html"') && raw.includes('href="privacy.html"'), name);
  }
});
