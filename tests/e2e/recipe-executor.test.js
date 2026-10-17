// レシピ実行器の e2e：模擬 LMS（node:http）に対して、ログイン・授業・回・ファイル・お知らせ・取得・ホストの制限を確かめる。
// Playwright と Chromium が要る（npm ci のあと。CI では Linux の headless）。DAIGAKU_CHROMIUM で実行ファイルを指せる
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync, readdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createBrowserSession} from '../../src/main/browser/session.js';
import {createRecipeExecutor} from '../../src/main/connectors/recipe-executor.js';

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  /* 入っていなければ飛ばす */
}
const executablePath = process.env.DAIGAKU_CHROMIUM || (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);

/** 模擬 LMS：manabo レシピのセレクタに合わせた最小の画面 */
function mockLms({logout = '<a id="button-logout" href="/logout">ログアウト</a>'} = {}) {
  const page = (body) => `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const cookie = req.headers.cookie ?? '';
    const loggedIn = /sid=ok/.test(cookie);
    const html = (b, status = 200, headers = {}) => {
      res.writeHead(status, {'Content-Type': 'text/html; charset=utf-8', ...headers});
      res.end(page(b));
    };
    if (url.pathname === '/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const p = new URLSearchParams(body);
        if (p.get('userid') === 'stu' && p.get('password') === 'pw') {
          res.writeHead(302, {'Set-Cookie': 'sid=ok; Path=/', Location: '/'});
          return res.end();
        }
        html('<form method="post" action="/login"><p>ID かパスワードが違います</p><input name="userid"><input type="password" name="password"><input type="submit" value="ログイン"></form>');
      });
      return;
    }
    if (!loggedIn) return html('<form method="post" action="/login"><input name="userid"><input type="password" name="password"><input type="submit" value="ログイン"></form>');
    if (url.pathname === '/')
      return html(`${logout}
        <ul><li><a href="/class/101/">管理会計Ⅱ（金曜／2限）</a></li><li><a href="/class/102/">意思決定論（月曜／3限）</a></li><li><a href="/class/101/">管理会計Ⅱ（金曜／2限）</a></li></ul>
        <a href="https://evil.example.com/x">外部</a>`);
    if (/^\/class\/\d+\/$/.test(url.pathname)) {
      const id = url.pathname.split('/')[2];
      return html(`${logout}<div class="breadcrumb">授業 ${id}</div>
        <div id="div-class-directories"><table>
          <tr><td><a class="a-open-contents" directory_id="d1" href="#">第1回 イントロダクション</a></td></tr>
          <tr><td><a class="a-open-contents" directory_id="d3" href="#">第3回 原価企画</a></td></tr>
          <tr><td><a class="a-open-contents" directory_id="dx" href="#">参考資料</a></td></tr>
        </table></div>
        <div id="div-class-contents"></div>
        <div id="div-class-news"><ul>
          <li><a href="#" class="toggle">[+] 【第02回，10/02】休講のお知らせ</a><div class="body" hidden><a href="/file/n2/">補講資料.pdf</a></div></li>
          <li><a href="#" class="toggle">[+] 事務連絡</a><div class="body" hidden>添付なし</div></li>
        </ul></div>
        <script>
          const files = {d1: [['/file/1/', '第1回 資料.pdf']], d3: [['/file/3/', '第3回 資料.pdf'], ['/file/3b/', '第3回 資料 4up.pdf'], ['/other/page', '関連ページ']], dx: []};
          for (const a of document.querySelectorAll('.a-open-contents')) a.onclick = (e) => { e.preventDefault();
            const list = files[a.getAttribute('directory_id')] || [];
            document.getElementById('div-class-contents').innerHTML = '<h3>' + a.textContent + '</h3>' + list.map(([h, t]) => '<p><a href="' + h + '">' + t + '</a></p>').join('');
          };
          for (const t of document.querySelectorAll('#div-class-news .toggle')) t.onclick = (e) => { e.preventDefault(); t.nextElementSibling.hidden = false; };
        </script>`);
    }
    if (url.pathname.startsWith('/file/')) {
      res.writeHead(200, {'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('資料' + url.pathname.split('/')[2] + '.pdf')}`});
      return res.end('%PDF-' + url.pathname);
    }
    html('not found', 404);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({server, base: `http://127.0.0.1:${server.address().port}`})));
}

function memSecrets() {
  const m = new Map();
  return {get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), map: m};
}

const recipeBase = JSON.parse(readFileSync(new URL('../../recipes/manabo.json', import.meta.url), 'utf8'));

test('レシピ実行器：ログイン → 授業 → 回 → ファイル → お知らせ → 取得 → ホストの制限', {skip: !playwright && 'Playwright が入っていません'}, async (t) => {
  const {server, base} = await mockLms();
  t.after(() => server.close());
  const secrets = memSecrets();
  const session = createBrowserSession({secrets, playwright, executablePath});
  t.after(() => session.shutdown());
  // 模擬 LMS はパスワードのフォームなので、レシピの login.form を足す（本物の manabo は統合認証で null）
  const recipe = {...recipeBase, login: {loggedIn: {selector: '#button-logout'}, form: {user: 'input[name=userid]', password: 'input[name=password]', submit: 'input[type=submit]'}}};
  const connector = createRecipeExecutor(recipe, {session, secrets});
  const connection = {id: 'c1', base_url: base, university_host: '127.0.0.1'};

  const ctx = await connector.createContext(connection);
  try {
    assert.equal(await connector.ensureSession(ctx), 'login-required');
    await assert.rejects(connector.login(ctx, 'headless', {credentials: {user: 'stu', password: 'bad'}}), /ID かパスワード/);
    assert.deepEqual(await connector.login(ctx, 'headless', {credentials: {user: 'stu', password: 'pw'}}), {ok: true});
    assert.ok(secrets.map.get('conn:c1:cookies'), 'Cookie を保存した');
    assert.equal(await connector.ensureSession(ctx), 'ok');

    const courses = await connector.listCourses(ctx);
    assert.deepEqual(
      courses.map((c) => [c.lmsId, c.name, c.weekday, c.period]),
      [['101', '管理会計Ⅱ', '金', 2], ['102', '意思決定論', '月', 3]],
      '重複は 1 つに、曜日・時限を読み、名前から時限の表記を外す'
    );
    const course = {lms_id: '101', lms_url: courses[0].url};
    const rounds = await connector.listRounds(ctx, course);
    assert.deepEqual(rounds.map((r) => [r.number, r.title, r.lmsRef]), [[1, '第1回 イントロダクション', 'd1'], [3, '第3回 原価企画', 'd3'], [0, '参考資料', 'dx']]);

    const files3 = await connector.listFiles(ctx, course, rounds[1]);
    assert.deepEqual(files3.map((f) => f.name), ['第3回 資料.pdf', '第3回 資料 4up.pdf'], 'ファイルでないリンクは除く（1up の選別は同期エンジンが行う）');
    assert.ok(files3[0].url.startsWith(base + '/file/3/'), '相対リンクを絶対 URL に');
    assert.deepEqual(await connector.listFiles(ctx, course, rounds[2]), [], '資料のない回は空');

    const notices = await connector.listNoticeFiles(ctx, course);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].round, 2);
    assert.equal(notices[0].name, '補講資料.pdf');

    const got = await connector.fetchFile(ctx, files3[0]);
    assert.equal(got.ok, true);
    assert.equal(got.contentType, 'application/pdf');
    assert.equal(got.body.toString(), '%PDF-/file/3/');
    assert.match(got.disposition, /filename\*=UTF-8/);

    await assert.rejects(connector.fetchFile(ctx, {url: 'https://evil.example.com/x.pdf'}), /許可していない/);
  } finally {
    await connector.releaseContext(ctx);
  }

  // 保存した Cookie で新しい文脈はログイン済み
  const ctx2 = await connector.createContext(connection);
  try {
    assert.equal(await connector.ensureSession(ctx2), 'ok');
  } finally {
    await connector.releaseContext(ctx2);
  }
});

test('レシピ実行器：要素が見つからなければ selector-missing、ログインに戻されれば login-required', {skip: !playwright && 'Playwright が入っていません'}, async (t) => {
  const {server, base} = await mockLms();
  t.after(() => server.close());
  const secrets = memSecrets();
  const session = createBrowserSession({secrets, playwright, executablePath});
  t.after(() => session.shutdown());
  const broken = {...recipeBase, login: {loggedIn: {selector: '#button-logout'}, form: {user: 'input[name=userid]', password: 'input[name=password]', submit: 'input[type=submit]'}}, courses: {...recipeBase.courses, items: 'table.nothing tr'}};
  const debugDir = mkdtempSync(path.join(tmpdir(), 'daigaku-debug-'));
  const logs = [];
  const connector = createRecipeExecutor(broken, {session, secrets, log: (m) => logs.push(m), debug: {dir: debugDir}});
  const ctx = await connector.createContext({id: 'c2', base_url: base, university_host: '127.0.0.1'});
  try {
    await connector.login(ctx, 'headless', {credentials: {user: 'stu', password: 'pw'}});
    await assert.rejects(connector.listCourses(ctx), (e) => e.code === 'selector-missing');
    const dumps = readdirSync(debugDir).filter((f) => f.startsWith('manabo_courses_') && f.endsWith('.html'));
    assert.equal(dumps.length, 1, '合わなかった画面を debug に保存する');
    assert.match(readFileSync(path.join(debugDir, dumps[0]), 'utf8'), /\/class\/101\//);
    assert.ok(logs.some((m) => /manabo courses: .*\/class\/101\(2\).*#button-logout.*画面を保存/.test(m)), `要約をログに出す: ${logs.join(' | ')}`);
  } finally {
    await connector.releaseContext(ctx);
  }
  const ctx3 = await connector.createContext({id: 'c3', base_url: base, university_host: '127.0.0.1'});
  try {
    await assert.rejects(connector.listCourses(ctx3), (e) => e.code === 'login-required');
  } finally {
    await connector.releaseContext(ctx3);
  }
});

test('レシピ実行器：loggedIn のセレクタが合わなくても「ログアウト」の表示があればログイン済みとみなす', {skip: !playwright && 'Playwright が入っていません'}, async (t) => {
  const {server, base} = await mockLms({logout: '<form action="/logout" method="post"><button type="submit" class="nav-item">ログアウト</button></form>'});
  t.after(() => server.close());
  const secrets = memSecrets();
  const session = createBrowserSession({secrets, playwright, executablePath});
  t.after(() => session.shutdown());
  const logs = [];
  const recipe = {...recipeBase, login: {loggedIn: {selector: '#button-logout'}, form: {user: 'input[name=userid]', password: 'input[name=password]', submit: 'input[type=submit]'}}};
  const connector = createRecipeExecutor(recipe, {session, secrets, log: (m) => logs.push(m)});
  const ctx = await connector.createContext({id: 'c4', base_url: base, university_host: '127.0.0.1'});
  try {
    assert.equal(await connector.ensureSession(ctx), 'login-required', 'ログイン前（パスワード欄あり）は予備判定でも未ログイン');
    assert.deepEqual(await connector.login(ctx, 'headless', {credentials: {user: 'stu', password: 'pw'}}), {ok: true});
    assert.equal(await connector.ensureSession(ctx), 'ok');
    assert.ok(logs.some((m) => /login\.loggedIn のセレクタ（#button-logout）は一致しませんでしたが/.test(m)), 'レシピの見直しを促すログを 1 回出す');
    assert.equal(logs.filter((m) => /一致しませんでしたが/.test(m)).length, 1);
    const courses = await connector.listCourses(ctx);
    assert.equal(courses.length, 2);
  } finally {
    await connector.releaseContext(ctx);
  }
});
