// Canvas（慶應義塾大学の K-LMS など）のコネクタ（src/main/connectors/canvas.js）：ログインしたブラウザの Cookie で
// Canvas の窓口（/api/v1）を読む。偽の Canvas（JSON の頭の while(1);・ページ送り・401 の 2 通り・ファイルの転送）で確かめる
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCanvasConnector, currentCourse, fileIdsIn, nextLink} from '../src/main/connectors/canvas.js';
import {createRegistry} from '../src/main/connectors/index.js';
import {validateRecipe} from '../src/shared/recipe.js';

const BASE = 'https://lms.keio.jp';
const NOW = new Date('2026-11-17T00:00:00Z');

/** 偽の Canvas：パス → [状態, 本文, ヘッダー]。loggedIn が false なら窓口は 401（unauthenticated） */
function fakeCanvas({loggedIn = true} = {}) {
  const calls = [];
  const json = (v) => `while(1);${JSON.stringify(v)}`;
  const routes = {
    '/api/v1/users/self': [200, json({id: 1, name: 'me'})],
    '/api/v1/courses?enrollment_state=active&include[]=term&per_page=100': [
      200,
      json([
        {id: 101, name: '線形代数（月2）', course_code: 'LA', term: {end_at: '2027-01-31T00:00:00Z'}},
        {id: 102, name: '経済学', term: {end_at: '2026-02-01T00:00:00Z'}} // 終わった学期
      ]),
      {link: `<${BASE}/api/v1/courses?page=2&per_page=100>; rel="next"`}
    ],
    '/api/v1/courses?page=2&per_page=100': [200, json([{id: 103, name: '統計学 金3', term: {}}])],
    '/api/v1/courses/101/modules?include[]=items&per_page=100': [
      200,
      json([
        {
          id: 11,
          name: '第1回 ベクトル',
          items: [
            {type: 'File', content_id: 501},
            {type: 'Page', page_url: 'week1'},
            {type: 'ExternalUrl', external_url: 'https://example.com'}
          ]
        },
        {id: 12, name: 'Week 2: 行列'} // 項目が多いと items が付かない
      ])
    ],
    '/api/v1/courses/101/modules/12/items?per_page=100': [200, json([{type: 'File', content_id: 503}])],
    '/api/v1/courses/101/pages/week1': [
      200,
      json({
        body: `<p><a href="${BASE}/courses/101/files/502/download">補足</a> <a href="/courses/101/files/501">同じもの</a></p>`
      })
    ],
    '/api/v1/courses/101/files/501': [
      200,
      json({id: 501, display_name: '第1回.pdf', size: 10, updated_at: '2026-10-01T00:00:00Z'})
    ],
    '/api/v1/courses/101/files/502': [
      200,
      json({id: 502, display_name: '補足.pdf', size: 5, updated_at: '2026-10-02T00:00:00Z'})
    ],
    '/api/v1/courses/101/files/503': [200, json({id: 503, display_name: '第2回.pptx', size: 7})],
    '/api/v1/courses/101/files/504': [
      401,
      json({status: 'unauthorized', errors: [{message: 'user not authorized to perform that action'}]})
    ],
    '/api/v1/files/504': [401, json({status: 'unauthorized'})],
    '/api/v1/courses/103/modules?include[]=items&per_page=100': [200, json([])],
    '/api/v1/courses/103/files?per_page=100&sort=created_at': [
      200,
      json([
        {id: 601, display_name: '03_回帰.pdf', size: 3},
        {id: 602, display_name: '隠し.pdf', hidden_for_user: true}
      ])
    ],
    '/courses/101/files/501/download?download_frd=1': [
      302,
      '',
      {location: 'https://files.keio-canvas.example/abc?sig=1'}
    ],
    'https://files.keio-canvas.example/abc?sig=1': [200, 'PDFDATA', {'content-type': 'application/pdf'}]
  };
  const announce = (cid) =>
    cid === '101'
      ? [
          200,
          json([
            {
              title: '【第2回】資料の追加',
              message: `<a href="/courses/101/files/503">資料</a> <a href="/courses/101/files/504">非公開</a>`
            },
            {title: 'お知らせ', message: '', attachments: [{id: 502}]}
          ])
        ]
      : [200, json([])];
  const context = {
    request: {
      async get(url) {
        const u = new URL(url);
        const key = u.origin === BASE ? `${u.pathname}${u.search}` : url;
        calls.push(key);
        let r = routes[key];
        if (!r && u.pathname === '/api/v1/announcements')
          r = announce(u.searchParams.get('context_codes[]').replace('course_', ''));
        if (!loggedIn && key.startsWith('/api/'))
          r = [401, json({status: 'unauthenticated', errors: [{message: 'user authorization required'}]})];
        const [status, body, headers = {}] = r ?? [404, json({errors: [{message: 'not found'}]})];
        return {
          status: () => status,
          ok: () => status >= 200 && status < 300,
          headers: () => headers,
          text: async () => body,
          body: async () => Buffer.from(body),
          dispose: async () => {}
        };
      }
    }
  };
  // 画面操作の実行器の代わり（ログイン・Cookie は使わない。窓口を呼ぶ文脈だけ）
  const executor = {id: 'canvas', kind: 'recipe', _context: async () => context, login: async () => ({ok: true})};
  return {calls, connector: createCanvasConnector(executor, {now: () => NOW}), ctx: {base: BASE}};
}

test('Canvas のレシピ：形が正しい。K-LMS の URL を Canvas と見分け、ログインは keio.jp（/login/saml）から', () => {
  const recipe = JSON.parse(readFileSync(new URL('../recipes/canvas.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateRecipe(recipe), []);
  assert.equal(recipe.api, 'canvas');
  assert.match(recipe.login.sso, /login\/saml/);
  assert.ok(recipe.universities['lms.keio.jp'].allowedHosts.includes('keio.okta.com'));
  assert.deepEqual(validateRecipe({...recipe, api: 'other'}).length, 1, '知らない api は受けない');
});

test('Canvas のレシピの接続は、一覧を Canvas の窓口で読むコネクタになる。URL の判定で候補に出る', async () => {
  const recipe = JSON.parse(readFileSync(new URL('../recipes/canvas.json', import.meta.url), 'utf8'));
  const registry = createRegistry({recipes: [recipe], recipeExecutorFactory: () => ({id: 'canvas'})});
  assert.equal(registry.forConnection({kind: 'recipe', connector_id: 'canvas'}).api, 'canvas');
  const cands = await registry.detect('https://lms.keio.jp/', '');
  assert.equal(cands[0]?.connectorId, 'canvas');
});

test('Canvas：ログインしているかを窓口で見る（unauthenticated は要ログイン）', async () => {
  assert.equal(await fakeCanvas().connector.ensureSession(fakeCanvas().ctx), 'ok');
  const out = fakeCanvas({loggedIn: false});
  assert.equal(await out.connector.ensureSession(out.ctx), 'login-required');
  await assert.rejects(out.connector.listCourses(out.ctx), (e) => e.code === 'login-required');
});

test('Canvas：授業（ページ送り・終わった学期は除く・曜日と時限）・回（モジュール）・資料（ファイルとページに貼ったもの）', async () => {
  const {connector, ctx} = fakeCanvas();
  const courses = await connector.listCourses(ctx);
  assert.deepEqual(
    courses.map((c) => [c.lmsId, c.name, c.weekday, c.period]),
    [
      ['101', '線形代数（月2）', '月', 2],
      ['103', '統計学 金3', '金', 3]
    ]
  );
  assert.equal(courses[0].url, `${BASE}/courses/101`);
  const course = {lms_id: '101'};
  const rounds = await connector.listRounds(ctx, course);
  assert.deepEqual(
    rounds.map((r) => [r.number, r.title, r.lmsRef]),
    [
      [1, '第1回 ベクトル', 'module:11'],
      [2, 'Week 2: 行列', 'module:12']
    ]
  );
  const r1 = await connector.listFiles(ctx, course, rounds[0]);
  assert.deepEqual(
    r1.map((f) => [f.url, f.name]),
    [
      [`${BASE}/courses/101/files/501`, '第1回.pdf'],
      [`${BASE}/courses/101/files/502`, '補足.pdf']
    ],
    'ページに貼ったファイルも。同じファイルは 1 つ'
  );
  assert.equal(r1[0].modified, '2026-10-01T00:00:00Z');
  const r2 = await connector.listFiles(ctx, course, {row: {lms_ref: 'module:12'}});
  assert.deepEqual(
    r2.map((f) => f.name),
    ['第2回.pptx'],
    '項目の付かないモジュールは読み足す'
  );
});

test('Canvas：お知らせの添付（見る権限のないものは除く）。モジュールのない授業は授業のファイルも読む（隠したものは除く）', async () => {
  const {connector, ctx} = fakeCanvas();
  const notes = await connector.listNoticeFiles(ctx, {lms_id: '101'});
  assert.deepEqual(
    notes.map((f) => [f.name, f.round, f.noticeTitle]),
    [
      ['第2回.pptx', 2, '【第2回】資料の追加'],
      ['補足.pdf', undefined, 'お知らせ']
    ]
  );
  const files = await connector.listNoticeFiles(ctx, {lms_id: '103'});
  assert.deepEqual(
    files.map((f) => [f.url, f.name, f.noticeTitle]),
    [[`${BASE}/courses/103/files/601`, '03_回帰.pdf', undefined]]
  );
});

test('Canvas：ファイルは /download から、置き場への転送をたどって取る。http や外から始めたものは取らない', async () => {
  const {connector, ctx, calls} = fakeCanvas();
  const r = await connector.fetchFile(ctx, {url: `${BASE}/courses/101/files/501`});
  assert.equal(r.ok, true);
  assert.equal(String(r.body), 'PDFDATA');
  assert.ok(calls.includes('/courses/101/files/501/download?download_frd=1'));
  await assert.rejects(
    connector.fetchFile(ctx, {url: 'https://evil.example/files/1'}),
    (e) => e.code === 'blocked-navigation'
  );
});

test('Canvas の小さな部品：本文のファイルの番号・次のページ・終わった授業', () => {
  assert.deepEqual(fileIdsIn('<a href="/courses/1/files/22/download?x">a</a><img src="/files/33/preview">'), [
    '22',
    '33'
  ]);
  assert.equal(nextLink('<https://x/a?page=1>; rel="current",<https://x/a?page=2>; rel="next"'), 'https://x/a?page=2');
  assert.equal(nextLink('<https://x/a?page=1>; rel="last"'), null);
  assert.equal(currentCourse({id: 1, name: 'a', term: {end_at: '2026-10-01T00:00:00Z'}}, NOW), false);
  assert.equal(
    currentCourse({id: 1, name: 'a', term: {end_at: '2026-11-01T00:00:00Z'}}, NOW),
    true,
    '終わって 30 日まではまだ出す'
  );
  assert.equal(currentCourse({id: 1, name: 'a', access_restricted_by_date: true}, NOW), false);
});
