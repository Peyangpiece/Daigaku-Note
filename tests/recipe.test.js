import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {
  applyRegex,
  applyUniversityOverride,
  detectScore,
  fillTemplate,
  hostAllowed,
  parseField,
  parseFieldList,
  resolveHref,
  validateRecipe
} from '../src/shared/recipe.js';

test('式の解釈', () => {
  assert.deepEqual(parseField('td.name a'), {selector: 'td.name a', attr: 'text', regex: null});
  const f = parseField('a@href:/course_(\\d+)/');
  assert.equal(f.selector, 'a');
  assert.equal(f.attr, 'href');
  assert.equal(applyRegex('https://x/ct/course_12345_query', f), '12345');
  assert.equal(applyRegex('https://x/other', f), '');
  const g = parseField('@text:/([月火水木金土日])曜/');
  assert.equal(g.selector, '');
  assert.equal(applyRegex('（金曜／2限）', g), '金');
  const h = parseField('h3@text:/第\\s*(\\d{1,2})\\s*回|Week\\s*(\\d{1,2})/i');
  assert.equal(applyRegex('Week 4 slides', h), '4');
  assert.equal(applyRegex('第 03 回', h), '03');
  assert.equal(applyRegex('  trimmed  ', parseField('')), 'trimmed');
  // 歩き方の接頭辞はセレクタとしてそのまま残す（解釈は実行器）
  assert.deepEqual(parseField('^tr<@text'), {selector: '^tr<', attr: 'text', regex: null});
  assert.deepEqual(parseField('>@innertext'), {selector: '>', attr: 'innertext', regex: null});
  // ' || ' で候補を並べる
  const alts = parseFieldList('@text || ^tr<@text:/第(\\d+)回/');
  assert.equal(alts.length, 2);
  assert.deepEqual(alts[0], {selector: '', attr: 'text', regex: null});
  assert.equal(alts[1].selector, '^tr<');
  assert.ok(alts[1].regex instanceof RegExp);
  assert.equal(parseFieldList('a@href').length, 1);
  assert.throws(() => parseFieldList('@text || '), /空の式/);
});

test('URL の差し込みと解決', () => {
  const vars = {
    base: 'https://lms.example.ac.jp',
    course: {url: 'https://lms.example.ac.jp/c/1', lmsId: '1'},
    round: {lmsRef: 'd9'}
  };
  assert.equal(fillTemplate('{base}/ct/home_course', vars), 'https://lms.example.ac.jp/ct/home_course');
  assert.equal(
    fillTemplate('{course.url}_page?d={round.lmsRef}&x={nothing}', vars),
    'https://lms.example.ac.jp/c/1_page?d=d9&x='
  );
  assert.equal(resolveHref('/file/3/', 'https://lms.example.ac.jp/class/1/'), 'https://lms.example.ac.jp/file/3/');
  assert.equal(resolveHref('::bad', 'not a url'), '');
});

test('ホストの許可', () => {
  assert.equal(hostAllowed('https://lms.example.ac.jp/x', ['lms.example.ac.jp']), true);
  assert.equal(hostAllowed('https://sso.example.ac.jp/x', ['example.ac.jp']), true);
  assert.equal(hostAllowed('https://evil.com/x', ['example.ac.jp']), false);
  assert.equal(hostAllowed('https://notexample.ac.jp/x', ['example.ac.jp']), false);
  assert.equal(hostAllowed('garbage', ['example.ac.jp']), false);
});

const good = {
  id: 'sample',
  name: 'Sample LMS',
  version: '2026.10.1',
  detect: {urlPatterns: ['sample\\.ac\\.jp'], htmlMarkers: ['SampleLMS']},
  login: {loggedIn: {selector: 'a.logout'}, form: {user: '#u', password: '#p', submit: '#s'}},
  courses: {url: '{base}/courses', items: 'li.course', name: 'a', link: 'a@href'},
  rounds: {url: '{course.url}', items: '.section', title: 'h3', link: 'a@href'},
  files: {url: '{round.url}', items: 'a.file', name: '@text', link: '@href'},
  universities: {'u.sample.ac.jp': {login: {form: null}}}
};

test('レシピの検査', () => {
  assert.deepEqual(validateRecipe(good), []);
  const bad = structuredClone(good);
  bad.id = 'Bad ID';
  bad.version = '1';
  delete bad.courses.link;
  bad.rounds.title = 'h3@text:/[unclosed/';
  bad.script = 'alert(1)';
  const errors = validateRecipe(bad);
  assert.ok(errors.some((e) => e.includes('id')));
  assert.ok(errors.some((e) => e.includes('version')));
  assert.ok(errors.some((e) => e.includes('courses.link')));
  assert.ok(errors.some((e) => e.includes('rounds.title')));
  assert.ok(errors.some((e) => e.includes('コード')));
  const auto = structuredClone(good);
  auto.notices = {url: '{course.url}', items: 'auto', openBeforeRead: 'auto', files: 'a'};
  assert.ok(
    validateRecipe(auto).some((e) => e.includes('container')),
    'auto には container が要る'
  );
  auto.notices.container = '#news';
  assert.deepEqual(validateRecipe(auto), []);
  // login.sso：LMS 自身のログイン画面に出る統合認証へのリンク（セレクタの文字列）
  const sso = structuredClone(good);
  sso.login.sso = "a[href*='/auth/shibboleth']";
  assert.deepEqual(validateRecipe(sso), []);
  sso.login.sso = '';
  assert.ok(validateRecipe(sso).some((e) => e.includes('login.sso')));
});

test('大学別の上書きと判定', () => {
  const r = applyUniversityOverride(good, 'u.sample.ac.jp');
  assert.equal(r.login.form, null);
  assert.equal(good.login.form.user, '#u', '元は変えない');
  assert.equal(applyUniversityOverride(good, 'other').login.form.user, '#u');
  assert.equal(detectScore(good, 'https://lms.sample.ac.jp/'), 0.8);
  assert.equal(detectScore(good, 'https://lms.sample.ac.jp/', '<title>SampleLMS</title>'), 0.95);
  assert.equal(detectScore(good, 'https://x.com/', '<title>SampleLMS</title>'), 0.6);
  assert.equal(detectScore(good, 'https://x.com/'), 0);
});

test('同梱のレシピはすべて検査に通る', () => {
  const dir = new URL('../recipes/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'schema.json')) {
    const r = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    assert.deepEqual(validateRecipe(r), [], f);
  }
});
