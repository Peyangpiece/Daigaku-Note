// IPC の窓口：セットアップと LMS の接続（setup.*・connection.*・courses.list）。index.js が register を呼ぶ（SPEC §12・DESIGN-M0 §4）
import {LMS_TERMS_VERSION} from '../../shared/lms-terms.js';
import {str, id, httpsUrl, bad} from './common.js';

export function register({handle, ctx, repo, registry, secrets, log}) {
  handle('setup.detect', async ({url}) => {
    const u = httpsUrl(url) ?? bad('URL は https:// で始まる形で入れてください');
    let html = '';
    try {
      const res = await fetch(u, {redirect: 'follow', signal: AbortSignal.timeout(10000)});
      html = (await res.text()).slice(0, 200000);
    } catch {
      /* 取れなくても URL だけで判定する */
    }
    const candidates = await registry.detect(u, html);
    return {
      candidates,
      base: new URL(u).origin + new URL(u).pathname.replace(/\/(login\/index\.php|my\/?|index\.php)?$/, '')
    };
  });

  handle('setup.createConnection', ({connectorId, kind, baseUrl, label}) => {
    const cid = str(connectorId, 32) ?? bad('コネクタが不正です');
    if (!['api', 'recipe', 'generic', 'manual'].includes(kind)) bad('接続の種類が不正です');
    // 大学サービスとつなぐのは、いまの版の利用規約に同意してから
    if (kind !== 'manual' && repo.getSetting('lms.terms', null)?.version !== LMS_TERMS_VERSION)
      bad('先に利用規約に同意してください');
    const base = kind === 'manual' ? null : (httpsUrl(baseUrl) ?? bad('URL が不正です'));
    const recipe = registry.recipes.find((r) => r.id === cid);
    // 同じ LMS への接続がもうあれば、それを使う（作り直すと授業が 2 つずつできてしまう）
    const host = base ? new URL(base).hostname.toLowerCase() : null;
    const same = repo
      .listConnections()
      .find(
        (c) => c.connector_id === cid && c.kind === kind && (c.university_host ?? '').toLowerCase() === (host ?? '')
      );
    const name = (str(label, 200) ?? '').trim().slice(0, 60);
    if (same) {
      if (name && name !== same.label) repo.updateConnection(same.id, {label: name}); // 入れ直した名前にする
      return {connectionId: same.id, reused: true};
    }
    const conn = repo.createConnection({
      kind,
      connector_id: cid,
      label: name || recipe?.name || cid,
      base_url: base,
      university_host: base ? new URL(base).hostname : null,
      recipe_version: recipe?.version ?? null
    });
    if (ctx.browser?.state === 'none') {
      // 初めて LMS をつないだので、画面を読むための Chromium を取り込み始める（main.js）
      ctx.browser = {state: 'pending', message: ''};
      ctx.installBrowser?.();
    }
    return {connectionId: conn.id};
  });

  // 学習支援サービスの名前（自分で付ける。ホームやお知らせ・設定に出る）
  handle('connection.update', ({connectionId, label}) => {
    const cid = id(connectionId) ?? bad('接続が不正です');
    if (!repo.get('connection', cid)) bad('接続が見つかりません');
    const name = (str(label, 200) ?? '').trim().slice(0, 60) || bad('名前を入れてください');
    repo.updateConnection(cid, {label: name});
    return {ok: true};
  });

  handle('connection.savePassword', async ({connectionId, user, password}) => {
    const cid = id(connectionId) ?? bad('接続が不正です');
    const conn = repo.get('connection', cid) ?? bad('接続がありません');
    const u = str(user, 200),
      p = str(password, 500);
    if (!u || !p) bad('ID とパスワードを入れてください');
    if (!['api', 'recipe'].includes(conn.kind)) bad('この接続ではパスワードを使いません');
    if (!(await secrets.available())) bad('このパソコンでは暗号化して保存できないため、パスワードは保存しません');
    await secrets.set(`conn:${cid}:password`, {user: u, password: p});
    repo.updateConnection(cid, {save_password: 1});
    return {ok: true};
  });

  // 自動ログインをやめる：保存した ID・パスワードを消す（Cookie は残すので、期限まではそのまま入れる）
  handle('connection.forgetPassword', async ({connectionId}) => {
    const cid = id(connectionId) ?? bad('接続が不正です');
    repo.get('connection', cid) ?? bad('接続がありません');
    await secrets.remove(`conn:${cid}:password`);
    repo.updateConnection(cid, {save_password: 0});
    return {ok: true};
  });

  handle('connection.login', async ({connectionId, mode}) => {
    const cid = id(connectionId) ?? bad('接続が不正です');
    const conn = repo.get('connection', cid) ?? bad('接続がありません');
    const connector = registry.forConnection(conn);
    const c = await connector.createContext(conn);
    const wantVisible = mode === 'visible' || !conn.save_password;
    try {
      if (conn.kind === 'api' && conn.connector_id === 'moodle') {
        if (!wantVisible) await connector.login(c, 'headless');
        else {
          // Moodle 公式アプリと同じ流れ：launch.php を見えるブラウザ窓で開き、ログイン後の転送先からトークンを取る
          const passport = Math.random().toString(36).slice(2) + Date.now().toString(36);
          const {captured, visitedHosts} = await ctx.session.loginVisible(conn, {
            url: connector.launchUrl(c, passport),
            isLoggedIn: () => false,
            capture: {
              urlPattern: /\/admin\/tool\/mobile\/launch\.php/,
              extract: ({headers, body}) =>
                connector.parseLaunchToken(headers?.location ?? '') ?? connector.parseLaunchToken(body)
            }
          });
          await connector.login(c, 'visible', {tokenFromBrowser: captured});
          repo.updateConnection(cid, {allowed_hosts_json: JSON.stringify(visitedHosts)});
        }
      } else if (conn.kind === 'recipe') {
        if (!wantVisible) await connector.login(c, 'headless');
        else {
          const r = await connector.login(c, 'visible');
          if (r.visitedHosts?.length) repo.updateConnection(cid, {allowed_hosts_json: JSON.stringify(r.visitedHosts)});
        }
      } else bad('この接続はログインを使いません');
      repo.updateConnection(cid, {status: 'ok'});
      return {ok: true};
    } catch (e) {
      log.warn(`login ${conn.label}: ${e.code ?? ''} ${e.message}`);
      if (e.code === 'login-bad-credentials') repo.updateConnection(cid, {save_password: 0}); // 何度も送ってロックさせない
      return {ok: false, reason: e.code ?? 'login-required', message: e.message};
    } finally {
      await connector.releaseContext?.(c);
    }
  });

  handle('connection.remove', async ({connectionId}) => {
    const cid = id(connectionId) ?? bad('接続が不正です');
    if (!repo.get('connection', cid)) bad('接続が見つかりません');
    // 授業・資料・注釈は残す。授業から接続への結び付きを外してから接続を消し、最後に保存した ID・パスワードを消す
    // （先に秘密を消すと、接続の削除が失敗したときにパスワードだけが消える）
    repo.transaction(() => {
      repo.db.prepare('UPDATE course SET connection_id = NULL WHERE connection_id = ?').run(cid);
      repo.remove('connection', cid);
      repo.db.prepare('DELETE FROM settings WHERE key = ?').run(`courses.exclude.${cid}`);
    });
    await secrets.removeByPrefix(`conn:${cid}:`);
    return {ok: true};
  });

  handle('courses.list', async ({connectionId}) => {
    const cid = id(connectionId) ?? bad('接続が不正です');
    const conn = repo.get('connection', cid) ?? bad('接続がありません');
    const connector = registry.forConnection(conn);
    const c = await connector.createContext(conn);
    try {
      if ((await connector.ensureSession(c)) !== 'ok') return {error: 'login-required'};
      return await connector.listCourses(c);
    } finally {
      await connector.releaseContext?.(c);
    }
  });

  // セットアップの「授業の確認」：外した授業の LMS の ID を覚える。まだ作られていない授業は同期で非表示として作る（engine.reconcileCourses）
  handle('setup.excludeCourses', ({connectionId, lmsIds}) => {
    const cid = id(connectionId) ?? bad('接続が不正です');
    repo.get('connection', cid) ?? bad('接続がありません');
    const list = (Array.isArray(lmsIds) ? lmsIds : []).map((x) => str(String(x), 200)).filter(Boolean);
    repo.setSetting(`courses.exclude.${cid}`, list);
    for (const row of repo.listCourses({connectionId: cid})) {
      const hide = list.includes(row.lms_id);
      if (!!row.hidden !== hide) repo.updateCourse(row.id, {hidden: hide ? 1 : 0});
    }
    return {ok: true};
  });
}
