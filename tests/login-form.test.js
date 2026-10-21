import test from 'node:test';
import assert from 'node:assert/strict';
import {credentialUrlAllowed, siteOf} from '../src/main/browser/login-form.js';

test('ID・パスワードを入れてよいページ：https で、LMS と同じ組織のドメインかレシピのホストだけ', () => {
  assert.equal(siteOf('lms.example-u.ac.jp'), 'example-u.ac.jp');
  assert.equal(siteOf('idp.cc.example-u.ac.jp'), 'example-u.ac.jp');
  assert.equal(siteOf('moodle.example.edu'), 'example.edu');
  assert.equal(siteOf('www.example.co.jp'), 'example.co.jp');
  const base = 'https://lms.example-u.ac.jp/';
  assert.ok(credentialUrlAllowed('https://lms.example-u.ac.jp/login', {base}));
  assert.ok(credentialUrlAllowed('https://idp.example-u.ac.jp/idp/profile/SAML2', {base}), '大学の統合認証（同じ組織）');
  assert.ok(credentialUrlAllowed('https://sso.vendor.example/login', {base, hosts: ['vendor.example']}), 'レシピに書いたホスト');
  assert.ok(!credentialUrlAllowed('https://other-u.ac.jp/login', {base}), 'ほかの大学');
  assert.ok(!credentialUrlAllowed('https://evil.example/login', {base}), '関係のないページ');
  assert.ok(!credentialUrlAllowed('http://lms.example-u.ac.jp/login', {base}), 'http には入れない');
  assert.ok(!credentialUrlAllowed('https://accounts.google.com/', {base, hosts: ['google.com']}), 'Google には入れない');
  assert.ok(!credentialUrlAllowed('https://ac.jp/', {base}), 'ac.jp そのものは同じ組織ではない');
  assert.ok(credentialUrlAllowed('http://127.0.0.1:3000/login', {base: 'http://127.0.0.1:3000'}), '手元の試験用');
  assert.ok(!credentialUrlAllowed('not a url', {base}));
});
