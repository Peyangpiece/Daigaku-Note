import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createMoodleConnector} from '../src/main/connectors/moodle.js';
import {parseSlot} from '../src/main/connectors/slot.js';
import {createRegistry} from '../src/main/connectors/index.js';

/** 模擬 Moodle：token.php と webservice/rest/server.php と pluginfile */
function mockMoodle({flaky = 0} = {}) {
  let flakyLeft = flaky;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (o, status = 200) => {
      res.writeHead(status, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(o));
    };
    if (url.pathname === '/login/token.php') {
      const body = req.method === 'POST' ? new URLSearchParams(await text(req)) : url.searchParams;
      if (body.get('username') === 'stu' && body.get('password') === 'pw') return json({token: 'TOK', privatetoken: 'P'});
      return json({error: 'Invalid login, please try again', errorcode: 'invalidlogin'});
    }
    if (url.pathname === '/webservice/rest/server.php') {
      const body = new URLSearchParams(await text(req));
      if (body.get('wstoken') !== 'TOK') return json({exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token'});
      const fn = body.get('wsfunction');
      if (fn === 'core_webservice_get_site_info') return json({userid: 7, fullname: '学生', sitename: 'Example U'});
      if (fn === 'core_enrol_get_users_courses')
        return json([
          {id: 11, fullname: '管理会計Ⅱ（金2）', shortname: 'MA2', visible: 1, startdate: 1759276800},
          {id: 12, fullname: '意思決定論', shortname: 'DM', visible: 0}
        ]);
      if (fn === 'core_course_get_contents') {
        if (flakyLeft-- > 0) return json({}, 503);
        return json([
          {id: 100, section: 0, name: '一般', modules: [{modname: 'forum', contents: []}]},
          {
            id: 101, section: 1, name: '第1回 イントロダクション',
            modules: [{modname: 'resource', contents: [{type: 'file', filename: 'intro.pdf', fileurl: `http://127.0.0.1:${server.address().port}/pluginfile.php/1/intro.pdf?forcedownload=1`, filesize: 5, timemodified: 1760000000}]}]
          },
          {
            id: 102, section: 2, name: 'Topic 2',
            modules: [
              {modname: 'folder', contents: [{type: 'file', filename: 'a.pdf', fileurl: `http://127.0.0.1:${server.address().port}/pluginfile.php/2/a.pdf`}, {type: 'url', filename: 'link', fileurl: 'https://example.com'}]},
              {modname: 'url', contents: [{type: 'url', filename: 'ext', fileurl: 'https://example.com'}]}
            ]
          }
        ]);
      }
      return json({exception: 'x', errorcode: 'invalidrecord', message: 'unknown function'});
    }
    if (url.pathname.startsWith('/pluginfile.php/')) {
      if (url.searchParams.get('token') !== 'TOK') {
        res.writeHead(200, {'Content-Type': 'text/html'});
        return res.end('<html>login</html>');
      }
      res.writeHead(200, {'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="intro.pdf"'});
      return res.end('%PDF-fake');
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({server, base: `http://127.0.0.1:${server.address().port}`})));
}
const text = (req) => new Promise((r) => {
  let s = '';
  req.on('data', (c) => (s += c));
  req.on('end', () => r(s));
});

function memSecrets() {
  const m = new Map();
  return {get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), map: m};
}

test('曜日・時限の読み取り', () => {
  assert.deepEqual(parseSlot('管理会計Ⅱ（金2）'), {weekday: '金', period: 2});
  assert.deepEqual(parseSlot('経営学 金曜2限'), {weekday: '金', period: 2});
  assert.deepEqual(parseSlot('（金曜／2限）'), {weekday: '金', period: 2});
  assert.deepEqual(parseSlot('[月3]'), {weekday: '月', period: 3});
  assert.deepEqual(parseSlot('Marketing Fri-2'), {weekday: '金', period: 2});
  assert.deepEqual(parseSlot('水曜開講'), {weekday: '水', period: null});
  assert.equal(parseSlot('統計学 2026'), null);
  assert.equal(parseSlot('第2回'), null);
});

test('Moodle：判定・ログイン・授業・回・ファイル・取得', async (t) => {
  const {server, base} = await mockMoodle();
  t.after(() => server.close());
  const secrets = memSecrets();
  const moodle = createMoodleConnector({secrets, retryDelays: [1, 1, 1]});
  assert.ok((await moodle.detect(base + '/')) >= 0.9, 'token.php の応答で Moodle と分かる');

  const connection = {id: 'c1', base_url: base + '/'};
  const ctx = await moodle.createContext(connection);
  assert.equal(await moodle.ensureSession(ctx), 'login-required');
  await assert.rejects(moodle.login(ctx, 'headless', {credentials: {user: 'stu', password: 'bad'}}), /ID かパスワード|Invalid login/);
  const who = await moodle.login(ctx, 'headless', {credentials: {user: 'stu', password: 'pw'}});
  assert.equal(who.userid, 7);
  assert.equal(secrets.map.get('conn:c1:token'), 'TOK');

  const ctx2 = await moodle.createContext(connection);
  assert.equal(ctx2.token, 'TOK', '保存したトークンを使う');
  assert.equal(await moodle.ensureSession(ctx2), 'ok');

  const courses = await moodle.listCourses(ctx2);
  assert.deepEqual(courses.map((c) => c.lmsId), ['11'], '非表示の授業は出さない');
  assert.equal(courses[0].weekday, '金');
  assert.equal(courses[0].period, 2);
  assert.equal(courses[0].startDate, '2025-10-01');

  const course = {lms_id: '11', lms_url: courses[0].url};
  const rounds = await moodle.listRounds(ctx2, course);
  assert.deepEqual(rounds.map((r) => [r.number, r.title]), [[0, '一般'], [1, 'イントロダクション'.length ? '第1回 イントロダクション' : ''], [2, 'Topic 2']]);
  const files1 = await moodle.listFiles(ctx2, course, rounds[1]);
  assert.equal(files1.length, 1);
  assert.equal(files1[0].name, 'intro.pdf');
  assert.equal(files1[0].modified, '2025-10-09T08:53:20.000Z');
  const files2 = await moodle.listFiles(ctx2, course, rounds[2]);
  assert.deepEqual(files2.map((f) => f.name), ['a.pdf'], 'URL モジュールと外部リンクは対象外');

  const got = await moodle.fetchFile(ctx2, files1[0]);
  assert.equal(got.ok, true);
  assert.equal(got.contentType, 'application/pdf');
  assert.equal(got.body.toString(), '%PDF-fake');
  assert.equal(moodle.openUrl({lms_url: course.lms_url}, {number: 2}), course.lms_url + '#section-2');
});

test('Moodle：トークン無効は login-required、5xx はやり直す', async (t) => {
  const {server, base} = await mockMoodle({flaky: 2});
  t.after(() => server.close());
  const secrets = memSecrets();
  await secrets.set('conn:c1:token', 'BAD');
  const moodle = createMoodleConnector({secrets, retryDelays: [1, 1, 1]});
  const ctx = await moodle.createContext({id: 'c1', base_url: base});
  assert.equal(await moodle.ensureSession(ctx), 'login-required');
  ctx.token = 'TOK';
  const rounds = await moodle.listRounds(ctx, {lms_id: '11'});
  assert.equal(rounds.length, 3, '2 回の 503 のあと成功');
});

test('launch.php のトークンの取り出しと URL', () => {
  const moodle = createMoodleConnector({});
  const payload = Buffer.from('hash:::THETOKEN:::private').toString('base64');
  assert.equal(moodle.parseLaunchToken(`daigakunote://token=${payload}`), 'THETOKEN');
  assert.equal(moodle.parseLaunchToken('daigakunote://nothing'), null);
  assert.match(moodle.launchUrl({base: 'https://m'}, 'abc'), /^https:\/\/m\/admin\/tool\/mobile\/launch\.php\?service=moodle_mobile_app&passport=abc&urlscheme=daigakunote$/);
});

test('登録：URL から候補を順に返す', async (t) => {
  const {server, base} = await mockMoodle();
  t.after(() => server.close());
  const registry = createRegistry({secrets: memSecrets()});
  const cands = await registry.detect(base + '/', '');
  assert.equal(cands[0].connectorId, 'moodle');
  assert.ok(!cands.some((c) => c.connectorId === 'generic')); // 汎用型はまだ同期できないので出さない
  assert.deepEqual(await registry.detect('https://unknown.example.ac.jp/', '<html></html>'), []);
  const manabo = await registry.detect('https://manabo.example.ac.jp/', '<div id="div-class-directories"></div>');
  assert.equal(manabo[0].connectorId, 'manabo');
  assert.equal(manabo[0].kind, 'recipe');
  assert.throws(() => registry.forConnection({kind: 'api', connector_id: 'nope'}), /知らない/);
  assert.equal(registry.forConnection({kind: 'api', connector_id: 'moodle'}).id, 'moodle');
});
