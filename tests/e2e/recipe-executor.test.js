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
const executablePath =
  process.env.DAIGAKU_CHROMIUM ||
  (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);

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
        html(
          '<form method="post" action="/login"><p>ID かパスワードが違います</p><input name="userid"><input type="password" name="password"><input type="submit" value="ログイン"></form>'
        );
      });
      return;
    }
    if (!loggedIn)
      return html(
        '<form method="post" action="/login"><input name="userid"><input type="password" name="password"><input type="submit" value="ログイン"></form>'
      );
    if (url.pathname === '/')
      return html(`${logout}
        <ul><li><a href="/class/101/"><span>管理会計Ⅱ（金曜／2限）</span>
          <span class="teacher">山田　太郎</span></a></li><li><a href="/class/102/">意思決定論（月曜／3限）</a></li><li><a href="/class/101/">管理会計Ⅱ（金曜／2限）</a></li></ul>
        <a href="https://evil.example.com/x">外部</a>`);
    if (/^\/class\/\d+\/$/.test(url.pathname)) {
      const id = url.pathname.split('/')[2];
      return html(`${logout}<div class="breadcrumb">授業 ${id}</div>
        <div id="div-class-directories"><table>
          <tr><td><a class="a-open-contents" directory_id="d1" href="#">第1回 イントロダクション</a></td></tr>
          <tr><td><a class="a-open-contents" directory_id="d3" href="#">第3回 原価企画</a></td></tr>
          <tr><td>参考資料</td></tr>
          <tr><td><a class="a-open-contents" directory_id="dx" href="#"><img alt="開く"></a></td></tr>
        </table></div>
        <div id="div-class-contents"></div>
        <div id="div-class-news"></div>
        <script>
          // お知らせは AJAX で後から入る（manabo と同じ）。見出しは [+] の画像で、押すと本文と添付が出る。項目の作りは li ではなく div
          setTimeout(() => { document.getElementById('div-class-news').innerHTML =
            '<div class="n"><div class="h"><a href="javascript:void(0)" class="btn-open"><img src="/img/plus.gif" alt="+"></a> 【第02回，10/02】休講のお知らせ</div><div class="b" style="display:none"><a href="/file/n2/">補講資料.pdf</a></div></div>' +
            '<div class="n"><div class="h"><a href="javascript:void(0)" class="btn-open"><img src="/img/plus.gif" alt="+"></a> 事務連絡</div><div class="b" style="display:none">添付なし</div></div>' +
            '<a href="/news/all/">お知らせ一覧</a>';
            for (const t of document.querySelectorAll('#div-class-news .btn-open')) t.onclick = (e) => { e.preventDefault(); t.closest('.n').querySelector('.b').style.display = 'block'; };
          }, 500);
          const files = {d1: [['/file/1/', '第1回 資料.pdf']], d3: [['/file/3/', '第3回 資料.pdf'], ['/file/3b/', '第3回 資料 4up.pdf'], ['/other/page', '関連ページ']], dx: []};
          for (const a of document.querySelectorAll('.a-open-contents')) a.onclick = (e) => { e.preventDefault();
            const list = files[a.getAttribute('directory_id')] || [];
            const box = document.getElementById('div-class-contents');
            box.innerHTML = '<div class="loading">読み込み中</div>';
            setTimeout(() => { box.innerHTML = '<h3>' + a.textContent + '</h3>' + list.map(([h, t]) => '<p><a href="' + h + '">' + t + '</a></p>').join(''); }, 300);
          };
        </script>`);
    }
    if (url.pathname.startsWith('/file/')) {
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('資料' + url.pathname.split('/')[2] + '.pdf')}`
      });
      return res.end('%PDF-' + url.pathname);
    }
    html('not found', 404);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({server, base: `http://127.0.0.1:${server.address().port}`}))
  );
}

function memSecrets() {
  const m = new Map();
  return {get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), map: m};
}

const recipeBase = JSON.parse(readFileSync(new URL('../../recipes/manabo.json', import.meta.url), 'utf8'));

test(
  'レシピ実行器：ログイン → 授業 → 回 → ファイル → お知らせ → 取得 → ホストの制限',
  {skip: !playwright && 'Playwright が入っていません'},
  async (t) => {
    const {server, base} = await mockLms();
    t.after(() => server.close());
    const secrets = memSecrets();
    const session = createBrowserSession({secrets, playwright, executablePath});
    t.after(() => session.shutdown());
    // 模擬 LMS はパスワードのフォームなので、レシピの login.form を足す（本物の manabo は統合認証で null）
    const recipe = {
      ...recipeBase,
      login: {
        loggedIn: {selector: '#button-logout'},
        form: {user: 'input[name=userid]', password: 'input[name=password]', submit: 'input[type=submit]'}
      }
    };
    const connector = createRecipeExecutor(recipe, {session, secrets});
    const connection = {id: 'c1', base_url: base, university_host: '127.0.0.1'};

    const ctx = await connector.createContext(connection);
    try {
      assert.equal(await connector.ensureSession(ctx), 'login-required');
      await assert.rejects(
        connector.login(ctx, 'headless', {credentials: {user: 'stu', password: 'bad'}}),
        /ID かパスワード/
      );
      assert.deepEqual(await connector.login(ctx, 'headless', {credentials: {user: 'stu', password: 'pw'}}), {
        ok: true
      });
      assert.ok(secrets.map.get('conn:c1:cookies'), 'Cookie を保存した');
      assert.equal(await connector.ensureSession(ctx), 'ok');

      const courses = await connector.listCourses(ctx);
      assert.deepEqual(
        courses.map((c) => [c.lmsId, c.name, c.weekday, c.period]),
        [
          ['101', '管理会計Ⅱ', '金', 2],
          ['102', '意思決定論', '月', 3]
        ],
        '重複は 1 つに、曜日・時限を読み、名前から時限の表記を外す。2 行目の教員名は入れない'
      );
      const course = {lms_id: '101', lms_url: courses[0].url};
      const rounds = await connector.listRounds(ctx, course);
      assert.deepEqual(
        rounds.map((r) => [r.number, r.title, r.lmsRef]),
        [
          [1, '第1回 イントロダクション', 'd1'],
          [3, '第3回 原価企画', 'd3'],
          [0, '参考資料', 'dx']
        ],
        '題名は押す要素の文字、なければ 1 つ前の行'
      );

      const files3 = await connector.listFiles(ctx, course, rounds[1]);
      assert.deepEqual(
        files3.map((f) => f.name),
        ['第3回 資料.pdf', '第3回 資料 4up.pdf'],
        'ファイルでないリンクは除く（1up の選別は同期エンジンが行う）'
      );
      assert.ok(files3[0].url.startsWith(base + '/file/3/'), '相対リンクを絶対 URL に');
      assert.deepEqual(await connector.listFiles(ctx, course, rounds[2]), [], '欄はあるが資料のない回は空');
      // 欄（container）そのものがなければ「資料のない回」ではなく、画面の構成が変わったとして知らせる（黙って 0 件にしない）
      const noBox = createRecipeExecutor(
        {...recipe, files: {...recipe.files, container: '#no-such-box'}},
        {session, secrets}
      );
      const ctxNoBox = await noBox.createContext(connection);
      try {
        await assert.rejects(
          noBox.listFiles(ctxNoBox, course, rounds[2]),
          (e) => e.code === 'selector-missing' && e.containerMissing === true
        );
      } finally {
        await noBox.releaseContext(ctxNoBox);
      }
      assert.deepEqual(await connector.listFiles(ctx, course, rounds[2]), [], '資料のない回は空');

      const notices = await connector.listNoticeFiles(ctx, course);
      assert.equal(notices.length, 1, 'AJAX で入った欄の折りたたみを開き、添付だけを拾う（一覧へのリンクは拾わない）');
      assert.equal(notices[0].round, 2);
      assert.equal(notices[0].name, '補講資料.pdf');
      assert.match(notices[0].noticeTitle, /【第02回，10\/02】休講のお知らせ/);

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
  }
);

test(
  'レシピ実行器：要素が見つからなければ selector-missing、ログインに戻されれば login-required',
  {skip: !playwright && 'Playwright が入っていません'},
  async (t) => {
    const {server, base} = await mockLms();
    t.after(() => server.close());
    const secrets = memSecrets();
    const session = createBrowserSession({secrets, playwright, executablePath});
    t.after(() => session.shutdown());
    const broken = {
      ...recipeBase,
      login: {
        loggedIn: {selector: '#button-logout'},
        form: {user: 'input[name=userid]', password: 'input[name=password]', submit: 'input[type=submit]'}
      },
      courses: {...recipeBase.courses, items: 'table.nothing tr'}
    };
    const debugDir = mkdtempSync(path.join(tmpdir(), 'daigaku-debug-'));
    const logs = [];
    const connector = createRecipeExecutor(broken, {
      session,
      secrets,
      log: (m) => logs.push(m),
      debug: {dir: debugDir}
    });
    const ctx = await connector.createContext({id: 'c2', base_url: base, university_host: '127.0.0.1'});
    try {
      await connector.login(ctx, 'headless', {credentials: {user: 'stu', password: 'pw'}});
      await assert.rejects(connector.listCourses(ctx), (e) => e.code === 'selector-missing');
      const dumps = readdirSync(debugDir).filter((f) => f.startsWith('manabo_courses_') && f.endsWith('.html'));
      assert.equal(dumps.length, 1, '合わなかった画面を debug に保存する');
      assert.match(readFileSync(path.join(debugDir, dumps[0]), 'utf8'), /\/class\/101\//);
      assert.ok(
        logs.some((m) => /manabo courses: .*\/class\/101\(2\).*#button-logout.*画面を保存/.test(m)),
        `要約をログに出す: ${logs.join(' | ')}`
      );
    } finally {
      await connector.releaseContext(ctx);
    }
    const ctx3 = await connector.createContext({id: 'c3', base_url: base, university_host: '127.0.0.1'});
    try {
      await assert.rejects(connector.listCourses(ctx3), (e) => e.code === 'login-required');
    } finally {
      await connector.releaseContext(ctx3);
    }
  }
);

test(
  'レシピ実行器：loggedIn のセレクタが合わなくても「ログアウト」の表示があればログイン済みとみなす',
  {skip: !playwright && 'Playwright が入っていません'},
  async (t) => {
    const {server, base} = await mockLms({
      logout: '<form action="/logout" method="post"><button type="submit" class="nav-item">ログアウト</button></form>'
    });
    t.after(() => server.close());
    const secrets = memSecrets();
    const session = createBrowserSession({secrets, playwright, executablePath});
    t.after(() => session.shutdown());
    const logs = [];
    const recipe = {
      ...recipeBase,
      login: {
        loggedIn: {selector: '#button-logout'},
        form: {user: 'input[name=userid]', password: 'input[name=password]', submit: 'input[type=submit]'}
      }
    };
    const connector = createRecipeExecutor(recipe, {session, secrets, log: (m) => logs.push(m)});
    const ctx = await connector.createContext({id: 'c4', base_url: base, university_host: '127.0.0.1'});
    try {
      assert.equal(
        await connector.ensureSession(ctx),
        'login-required',
        'ログイン前（パスワード欄あり）は予備判定でも未ログイン'
      );
      assert.deepEqual(await connector.login(ctx, 'headless', {credentials: {user: 'stu', password: 'pw'}}), {
        ok: true
      });
      assert.equal(await connector.ensureSession(ctx), 'ok');
      assert.ok(
        logs.some((m) => /login\.loggedIn のセレクタ（#button-logout）は一致しませんでしたが/.test(m)),
        'レシピの見直しを促すログを 1 回出す'
      );
      assert.equal(logs.filter((m) => /一致しませんでしたが/.test(m)).length, 1);
      const courses = await connector.listCourses(ctx);
      assert.equal(courses.length, 2);
    } finally {
      await connector.releaseContext(ctx);
    }
  }
);

/**
 * 模擬の統合認証：LMS（127.0.0.1）に未ログインで来ると IdP（localhost。別のホスト）へ転送。
 * IdP は ID のページ → パスワードのページ →（code: true なら）認証コードのページ → LMS の /sso?ticket=… に戻して Cookie を付ける
 */
async function mockSso({code = false, localLogin = false} = {}) {
  const page = (body) => `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
  const send = (res, b, status = 200, headers = {}) => {
    res.writeHead(status, {'Content-Type': 'text/html; charset=utf-8', ...headers});
    res.end(page(b));
  };
  const form = (req) =>
    new Promise((resolve) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => resolve(new URLSearchParams(body)));
    });
  const seen = {users: [], passwords: 0, codes: [], local: 0};
  let lmsBase = '';
  const idp = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/idp/login' && req.method === 'GET')
      return send(
        res,
        `<form method="post" action="/idp/user"><label>ユーザID<input type="text" id="j_username" name="j_username"></label><input type="text" name="q" placeholder="サイト内検索"><button type="submit">次へ</button></form>`
      );
    if (url.pathname === '/idp/user') {
      const p = await form(req);
      seen.users.push(p.get('j_username'));
      if (p.get('j_username') !== 'stu')
        return send(
          res,
          `<p>ユーザが見つかりません</p><form method="post" action="/idp/user"><input type="text" id="j_username" name="j_username"><button type="submit">次へ</button></form>`
        );
      return send(
        res,
        `<form method="post" action="/idp/pass"><input type="hidden" name="u" value="stu"><input type="password" id="j_password" name="j_password"><button type="submit">ログイン</button></form>`
      );
    }
    if (url.pathname === '/idp/pass') {
      const p = await form(req);
      seen.passwords++;
      if (p.get('j_password') !== 'pw')
        return send(
          res,
          `<p>パスワードが違います</p><form method="post" action="/idp/pass"><input type="password" id="j_password" name="j_password"><button type="submit">ログイン</button></form>`
        );
      if (code)
        return send(
          res,
          `<form method="post" action="/idp/code"><p>メールに届いた認証コードを入れてください</p><input type="text" name="otp_code" autocomplete="one-time-code"><button type="submit">送信</button></form>`
        );
      // SAML のように、自動で送信されるフォームで LMS へ戻る
      return send(
        res,
        `<form id="f" method="get" action="${lmsBase}/sso"><input type="hidden" name="ticket" value="t1"></form><script>document.getElementById('f').submit()</script>`
      );
    }
    if (url.pathname === '/idp/code') {
      const p = await form(req);
      seen.codes.push(p.get('otp_code'));
      return send(res, 'ng');
    }
    send(res, 'not found', 404);
  });
  const lms = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/sso' && url.searchParams.get('ticket') === 't1') {
      res.writeHead(302, {'Set-Cookie': 'sid=ok; Path=/', Location: '/'});
      return res.end();
    }
    // localLogin：manabo のように、LMS 自身のログイン画面（ID・パスワード）と「全学ID」のリンクを出す
    if (localLogin && url.pathname === '/login' && req.method === 'POST') {
      seen.local++;
      return send(res, '<p>ログイン ID かパスワードが違います</p>');
    }
    if (url.pathname === '/auth/shibboleth/') {
      res.writeHead(302, {Location: `${idpBase}/idp/login`});
      return res.end();
    }
    if (!/sid=ok/.test(req.headers.cookie ?? '')) {
      if (localLogin)
        return send(
          res,
          '<form method="post" action="/login"><input type="text" name="login_id"><input type="password" name="password"><button type="submit">ログイン</button></form><a href="/auth/shibboleth/">中京大学 全学IDをお持ちの方</a>'
        );
      res.writeHead(302, {Location: `${idpBase}/idp/login`});
      return res.end();
    }
    send(res, '<a id="button-logout" href="/logout">ログアウト</a><a href="/class/101/">管理会計Ⅱ（金曜／2限）</a>');
  });
  await new Promise((r) => idp.listen(0, '127.0.0.1', r));
  await new Promise((r) => lms.listen(0, '127.0.0.1', r));
  const idpBase = `http://localhost:${idp.address().port}`;
  lmsBase = `http://127.0.0.1:${lms.address().port}`;
  return {base: lmsBase, seen, close: () => (idp.close(), lms.close())};
}

test(
  '自動ログイン：統合認証（ID → パスワードの 2 段階・別のホスト）にレシピのセレクタなしで入る',
  {skip: !playwright && 'Playwright が入っていません'},
  async (t) => {
    const sso = await mockSso();
    t.after(sso.close);
    const secrets = memSecrets();
    const session = createBrowserSession({secrets, playwright, executablePath});
    t.after(() => session.shutdown());
    const connector = createRecipeExecutor(recipeBase, {session, secrets}); // 同梱の manabo レシピ（login.form は null）
    const cred = {credentials: {user: 'stu', password: 'pw'}};

    // 見えるログイン窓で一度も通っていない（IdP のホストを知らない）なら、入力せずに止まる
    const unknown = await connector.createContext({id: 's0', base_url: sso.base, university_host: '127.0.0.1'});
    try {
      await assert.rejects(
        connector.login(unknown, 'headless', cred),
        (e) => e.code === 'login-required' && /一度ブラウザ窓でログイン/.test(e.message)
      );
      assert.deepEqual(sso.seen.users, [], 'IdP に ID を送っていない');
    } finally {
      await connector.releaseContext(unknown);
    }

    const conn = {id: 's1', base_url: sso.base, university_host: '127.0.0.1', allowed_hosts_json: '["localhost"]'};
    const ctx = await connector.createContext(conn);
    try {
      assert.equal(await connector.ensureSession(ctx), 'login-required');
      assert.deepEqual(await connector.login(ctx, 'headless', cred), {ok: true});
      assert.deepEqual(sso.seen.users, ['stu'], 'ID の欄に入れた（検索欄には入れない）');
      assert.ok(secrets.map.get('conn:s1:cookies'), 'Cookie を保存した');
      assert.equal(await connector.ensureSession(ctx), 'ok');
    } finally {
      await connector.releaseContext(ctx);
    }

    // 保存したパスワードを使うのは save_password が 1 のときだけ
    await secrets.set('conn:s2:password', {user: 'stu', password: 'pw'});
    const off = await connector.createContext({...conn, id: 's2', save_password: 0});
    try {
      await assert.rejects(connector.login(off, 'headless'), (e) => e.code === 'login-required');
    } finally {
      await connector.releaseContext(off);
    }
    const on = await connector.createContext({...conn, id: 's2', save_password: 1});
    try {
      assert.deepEqual(await connector.login(on, 'headless'), {ok: true});
    } finally {
      await connector.releaseContext(on);
    }
  }
);

test(
  '自動ログイン：LMS 自身のログイン画面が出たら、ID・パスワードを入れずに統合認証のリンク（login.sso）へ進む',
  {skip: !playwright && 'Playwright が入っていません'},
  async (t) => {
    const sso = await mockSso({localLogin: true});
    t.after(sso.close);
    const secrets = memSecrets();
    const session = createBrowserSession({secrets, playwright, executablePath});
    t.after(() => session.shutdown());
    const connector = createRecipeExecutor(recipeBase, {session, secrets}); // 同梱の manabo レシピ（login.sso あり）
    const conn = {id: 'l1', base_url: sso.base, university_host: '127.0.0.1', allowed_hosts_json: '["localhost"]'};
    const ctx = await connector.createContext(conn);
    try {
      assert.deepEqual(await connector.login(ctx, 'headless', {credentials: {user: 'stu', password: 'pw'}}), {
        ok: true
      });
      assert.equal(sso.seen.local, 0, 'LMS 自身のログインのフォームには送らない');
      assert.deepEqual(sso.seen.users, ['stu'], '統合認証の ID の欄に入れた');
      assert.equal(await connector.ensureSession(ctx), 'ok');
    } finally {
      await connector.releaseContext(ctx);
    }
  }
);

test(
  '自動ログイン：パスワード違いは login-bad-credentials（1 回だけ送る）、認証コードは login-needs-user（ID を入れない）',
  {skip: !playwright && 'Playwright が入っていません'},
  async (t) => {
    const secrets = memSecrets();
    const session = createBrowserSession({secrets, playwright, executablePath});
    t.after(() => session.shutdown());
    const connector = createRecipeExecutor(recipeBase, {session, secrets});

    const sso = await mockSso();
    t.after(sso.close);
    const bad = await connector.createContext({
      id: 'b1',
      base_url: sso.base,
      university_host: '127.0.0.1',
      allowed_hosts_json: '["localhost"]'
    });
    try {
      await assert.rejects(
        connector.login(bad, 'headless', {credentials: {user: 'stu', password: 'nope'}}),
        (e) => e.code === 'login-bad-credentials'
      );
      assert.equal(sso.seen.passwords, 1, 'パスワードは 1 回だけ送る（ロックさせない）');
    } finally {
      await connector.releaseContext(bad);
    }

    const sso2 = await mockSso({code: true});
    t.after(sso2.close);
    const otp = await connector.createContext({
      id: 'b2',
      base_url: sso2.base,
      university_host: '127.0.0.1',
      allowed_hosts_json: '["localhost"]'
    });
    try {
      await assert.rejects(
        connector.login(otp, 'headless', {credentials: {user: 'stu', password: 'pw'}}),
        (e) => e.code === 'login-needs-user' && /認証コード/.test(e.message)
      );
      assert.deepEqual(sso2.seen.codes, [], '認証コードの欄には何も送らない');
    } finally {
      await connector.releaseContext(otp);
    }
  }
);

test(
  'ログインの欄を探す：1 ページのフォーム・ID だけのページ・認証コードのページ・検索欄',
  {skip: !playwright && 'Playwright が入っていません'},
  async (t) => {
    const {markLoginForm} = await import('../../src/main/browser/login-form.js');
    const browser = await playwright.chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
    t.after(() => browser.close());
    const page = await browser.newPage();
    const look = async (html) => {
      await page.setContent(`<!doctype html><meta charset="utf-8"><body>${html}</body>`);
      const f = await page.evaluate(markLoginForm);
      const marked = await page.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll('[data-dn-login]')].map((e) => [e.dataset.dnLogin, e.name || e.textContent])
        )
      );
      return {...f, marked};
    };
    // Shibboleth の形：ID・パスワード・ログイン（前に検索欄があっても ID の欄を選ぶ）
    let f = await look(
      '<input type="text" name="q" placeholder="検索"><form><input name="j_username"><input type="password" name="j_password"><button type="submit">Login</button></form>'
    );
    assert.deepEqual(f.marked, {user: 'j_username', password: 'j_password', submit: 'Login'});
    // ID だけを先に聞くページ
    f = await look('<form><input type="email" name="loginfmt"><input type="submit" name="next" value="次へ"></form>');
    assert.equal(f.marked.user, 'loginfmt');
    assert.equal(f.password, false);
    // 認証コードだけのページ：ID の欄とみなさない
    f = await look(
      '<form><p>認証コード</p><input type="text" name="otp_code" autocomplete="one-time-code"><button type="submit">送信</button></form>'
    );
    assert.equal(f.user, false);
    assert.equal(f.password, false);
    assert.equal(f.extra, true);
    // 欄が 1 つだけでも、ID らしい名前でなければ当て推量で入れない
    f = await look('<form><input type="text" name="keyword"><button type="submit">探す</button></form>');
    assert.equal(f.user, false);
    // 隠れた欄は使わない
    f = await look(
      '<form><input name="username" style="display:none"><input name="login_id"><input type="password" name="pw"><input type="submit" value="ログイン"></form>'
    );
    assert.equal(f.marked.user, 'login_id');
  }
);

test(
  '見えるログイン窓：LMS 自身のログイン画面なら、統合認証のリンク（login.sso）を押してから見せ、LMS の欄には入れない',
  {
    skip:
      (!playwright && 'Playwright が入っていません') ||
      (process.platform === 'linux' && !process.env.DISPLAY && '画面がありません（xvfb-run で動かす）')
  },
  async (t) => {
    const sso = await mockSso({localLogin: true});
    t.after(sso.close);
    let headed = null;
    const wrapped = {
      ...playwright,
      chromium: {
        ...playwright.chromium,
        launch: async (o) =>
          o.headless === false ? (headed = await playwright.chromium.launch(o)) : playwright.chromium.launch(o)
      }
    };
    const secrets = memSecrets();
    const session = createBrowserSession({secrets, playwright: wrapped, executablePath});
    t.after(() => session.shutdown());
    const connector = createRecipeExecutor({...recipeBase, allowedHosts: ['localhost']}, {session, secrets});
    await secrets.set('conn:v2:password', {user: 'stu', password: 'pw'});
    const ctx = await connector.createContext({
      id: 'v2',
      base_url: sso.base,
      university_host: '127.0.0.1',
      save_password: 1
    });
    const done = connector.login(ctx, 'visible');
    for (let i = 0; i < 50 && !headed?.contexts()[0]?.pages()[0]; i++) await new Promise((r) => setTimeout(r, 100));
    const page = headed.contexts()[0].pages()[0];
    assert.ok(page);
    // 本人が押さなくても、全学 ID のリンク → ID → 次へ → パスワード → ログイン と進んで終わる
    assert.equal((await done).ok, true);
    assert.deepEqual(sso.seen.users, ['stu'], '統合認証の ID の欄に入れて送った');
    assert.equal(sso.seen.passwords, 1, 'パスワードは 1 回だけ送った');
    assert.equal(sso.seen.local, 0, 'LMS 自身のログインの欄には送らない');
    await connector.releaseContext(ctx);
  }
);

test(
  '見えるログイン窓：保存した ID とパスワードを入れ、「次へ」「ログイン」も押す。パスワードが違えば 1 回だけで本人に任せる',
  {
    skip:
      (!playwright && 'Playwright が入っていません') ||
      (process.platform === 'linux' && !process.env.DISPLAY && '画面がありません（xvfb-run で動かす）')
  },
  async (t) => {
    const sso = await mockSso();
    t.after(sso.close);
    // 起動した見えるブラウザをテストから操作するため、launch を包む
    let headed = null;
    const wrapped = {
      ...playwright,
      chromium: {
        ...playwright.chromium,
        launch: async (o) =>
          o.headless === false ? (headed = await playwright.chromium.launch(o)) : playwright.chromium.launch(o)
      }
    };
    const secrets = memSecrets();
    const session = createBrowserSession({secrets, playwright: wrapped, executablePath});
    t.after(() => session.shutdown());
    // 保存した ID・パスワードを入れるのは、LMS と同じ組織のドメインか、レシピの allowedHosts に書いたホストだけ
    // （v0.5.15 の credentialUrlAllowed。模擬の統合認証は localhost、LMS は 127.0.0.1 なので、レシピに書いておく）
    const connector = createRecipeExecutor({...recipeBase, allowedHosts: ['localhost']}, {session, secrets});
    await secrets.set('conn:v1:password', {user: 'stu', password: 'pw'});
    const ctx = await connector.createContext({
      id: 'v1',
      base_url: sso.base,
      university_host: '127.0.0.1',
      save_password: 1
    });
    const done = connector.login(ctx, 'visible');
    const pageOf = async () => {
      for (let i = 0; i < 50 && !headed?.contexts()[0]?.pages()[0]; i++) await new Promise((r) => setTimeout(r, 100));
      return headed.contexts()[0].pages()[0];
    };
    assert.ok(await pageOf());
    // 本人が押さなくても、ID → 次へ → パスワード → ログイン と進んで終わる
    const r = await done;
    assert.equal(r.ok, true);
    assert.deepEqual(sso.seen.users, ['stu']);
    assert.equal(sso.seen.passwords, 1);
    assert.ok(r.visitedHosts.includes('localhost'), 'IdP のホストを覚える（次から自動ログインに使う）');
    await connector.releaseContext(ctx);

    // パスワードが違うときは 1 回だけ送り、あとは本人に任せる（何度も送ってロックさせない）
    headed = null;
    await secrets.set('conn:v3:password', {user: 'stu', password: 'nope'});
    const bad = await connector.createContext({
      id: 'v3',
      base_url: sso.base,
      university_host: '127.0.0.1',
      save_password: 1
    });
    const badDone = connector.login(bad, 'visible').then(
      () => 'ok',
      (e) => e.code
    );
    const badPage = await pageOf();
    for (let i = 0; i < 100 && sso.seen.passwords < 2; i++) await new Promise((res) => setTimeout(res, 100));
    await new Promise((res) => setTimeout(res, 3000));
    assert.equal(sso.seen.passwords, 2, '違うパスワードは 1 回だけ送る');
    await badPage.close(); // 本人が窓を閉じる
    assert.notEqual(await badDone, 'ok', '本人が閉じたらログインできていない');
    await connector.releaseContext(bad);
  }
);
