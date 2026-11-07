import test from 'node:test';
import assert from 'node:assert/strict';
import {credentialUrlAllowed, loginFailedText, siteOf, staleSsoPage} from '../src/main/browser/login-form.js';

test('ID・パスワードを入れてよいページ：https で、LMS と同じ組織のドメインかレシピのホストだけ', () => {
  assert.equal(siteOf('lms.example-u.ac.jp'), 'example-u.ac.jp');
  assert.equal(siteOf('idp.cc.example-u.ac.jp'), 'example-u.ac.jp');
  assert.equal(siteOf('moodle.example.edu'), 'example.edu');
  assert.equal(siteOf('www.example.co.jp'), 'example.co.jp');
  // 日本以外の「国 + 種類」の 2 段（ac.uk・com.au など）。ac.uk 全体を 1 つの組織にしない
  assert.equal(siteOf('lms.ox.ac.uk'), 'ox.ac.uk');
  assert.equal(siteOf('idp.student.ox.ac.uk'), 'ox.ac.uk');
  assert.equal(siteOf('www.unimelb.edu.au'), 'unimelb.edu.au');
  assert.equal(siteOf('lms.snu.ac.kr'), 'snu.ac.kr');
  assert.equal(siteOf('lms.example.com'), 'example.com', '2 段でない国はこれまでどおり');
  assert.equal(siteOf('lms.example.de'), 'example.de');
  assert.ok(!credentialUrlAllowed('https://login.cam.ac.uk/', {base: 'https://lms.ox.ac.uk/'}), 'ほかの英国の大学');
  assert.ok(credentialUrlAllowed('https://idp.ox.ac.uk/', {base: 'https://lms.ox.ac.uk/'}), '同じ英国の大学の統合認証');
  const base = 'https://lms.example-u.ac.jp/';
  assert.ok(credentialUrlAllowed('https://lms.example-u.ac.jp/login', {base}));
  assert.ok(
    credentialUrlAllowed('https://idp.example-u.ac.jp/idp/profile/SAML2', {base}),
    '大学の統合認証（同じ組織）'
  );
  assert.ok(
    credentialUrlAllowed('https://sso.vendor.example/login', {base, hosts: ['vendor.example']}),
    'レシピに書いたホスト'
  );
  assert.ok(!credentialUrlAllowed('https://other-u.ac.jp/login', {base}), 'ほかの大学');
  assert.ok(!credentialUrlAllowed('https://evil.example/login', {base}), '関係のないページ');
  assert.ok(!credentialUrlAllowed('http://lms.example-u.ac.jp/login', {base}), 'http には入れない');
  assert.ok(
    !credentialUrlAllowed('https://accounts.google.com/', {base, hosts: ['google.com']}),
    'Google には入れない'
  );
  assert.ok(!credentialUrlAllowed('https://ac.jp/', {base}), 'ac.jp そのものは同じ組織ではない');
  assert.ok(credentialUrlAllowed('http://127.0.0.1:3000/login', {base: 'http://127.0.0.1:3000'}), '手元の試験用');
  assert.ok(!credentialUrlAllowed('not a url', {base}));
});

test('統合認証の「過去のリクエスト」の画面を見分ける（v0.16.31）', () => {
  const ja =
    'ウェブログインサービス - 過去のリクエスト\nセキュアなウェブサイトやアプリケーションを閲覧中にブラウザの[戻る]ボタンを…';
  assert.equal(staleSsoPage('https://idp.example-u.ac.jp/idp/profile/SAML2/POST/SSO', ja), true);
  assert.equal(
    staleSsoPage(
      'https://idp.example-u.ac.jp/idp/profile/SAML2/Redirect/SSO?execution=e1s1',
      'Web Login Service - Stale Request'
    ),
    true
  );
  assert.equal(
    staleSsoPage('https://idp.example-u.ac.jp/idp/profile/SAML2/POST/SSO', 'ログイン'),
    false,
    'ふつうのログイン画面'
  );
  assert.equal(
    staleSsoPage('https://lms.example-u.ac.jp/course/view.php', '過去のリクエスト'),
    false,
    'IdP 以外のページ'
  );
  assert.equal(staleSsoPage('not a url', ja), false);
});

test('ログインに失敗したと書いてある画面か（同じ画面に戻ったとき、送り直してよいかを決める。v0.17.7）', () => {
  for (const t of [
    'パスワードが違います',
    'ユーザ名またはパスワードが正しくありません',
    'ログインに失敗しました',
    'アカウントがロックされています',
    'Invalid username or password',
    '認証が失敗しました',
    'Login failed',
    'Your account has been locked'
  ])
    assert.equal(loginFailedText(t), true, t);
  for (const t of [
    '言語 日本語 ログイン CHUKYO MaNaBo ユーザ名 <f124074> パスワード 二段階認証でログイン ユーザ名を入力し直す 二段階認証または生体認証の設定はこちら 設定マニュアルはこちら',
    'ポップアップがブロックされた場合は、ブラウザの設定を確かめてください',
    'お知らせの読み込みに失敗しました',
    'Request failed. Please reload.',
    'ロック画面の設定',
    ''
  ])
    assert.equal(loginFailedText(t), false, t);
});
