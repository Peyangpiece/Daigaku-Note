// IPC の契約（DESIGN-M0 §4）。レンダラから受け取る値は必ず検査する。パスは受け取らない。
import {ipcMain, dialog, shell, app} from 'electron';
import {isUlid} from '../shared/ids.js';
import {checkDownloadDir, defaultRoot} from '../shared/paths.js';
import {courseFolderName} from '../shared/naming.js';
import {defaultTermDates, termFolder, termId} from '../shared/term.js';
import {PERIOD_PRESETS} from '../shared/schedule.js';
import {isOpenable} from './sync/files.js';

const str = (v, max = 500) => (typeof v === 'string' && v.length <= max ? v : null);
const id = (v) => (isUlid(v) ? v : null);
const httpsUrl = (v) => {
  try {
    const u = new URL(String(v));
    return u.protocol === 'https:' || (u.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(u.hostname)) ? u.toString() : null;
  } catch {
    return null;
  }
};
const bad = (msg) => {
  throw new Error(msg);
};

export function registerIpc(ctx, {openWindow}) {
  const {repo, registry, jobs, files, secrets, log} = ctx;
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (_e, arg) => {
      try {
        return await fn(arg ?? {});
      } catch (e) {
        log.warn(`ipc ${channel}: ${e.message}`);
        return {error: e.message};
      }
    });

  handle('state.get', () => {
    const terms = repo.listTerms();
    const connections = repo.listConnections().map(({session_json, ...c}) => c);
    const courses = repo.listCourses().map((c) => ({...c, unread: repo.countUnread(c.id)}));
    const rounds = Object.fromEntries(courses.map((c) => [c.id, repo.listRounds(c.id)]));
    const materials = Object.fromEntries(courses.map((c) => [c.id, repo.listMaterials(c.id).map(({path, ...m}) => m)]));
    return {
      connections,
      terms,
      courses,
      rounds,
      materials,
      settings: {
        root: ctx.rootDir(),
        defaultRoot: defaultRoot(app.getPath('desktop')),
        syncTime: repo.getSetting('sync.time', '16:30'),
        classStart: repo.getSetting('sync.classStart', true),
        everyHours: repo.getSetting('sync.everyHours', 0),
        theme: repo.getSetting('ui.theme', 'system'),
        rules: repo.getSetting('ui.rules', 'normal')
      },
      lastSync: repo.lastSyncRun(),
      browser: ctx.browser ?? {state: 'pending', message: ''},
      status: ctx.status ?? '',
      jobs: repo.pendingJobs().map((j) => ({id: j.id, kind: j.kind, status: j.status})),
      presets: Object.keys(PERIOD_PRESETS),
      version: app.getVersion()
    };
  });

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
    return {candidates, base: new URL(u).origin + new URL(u).pathname.replace(/\/(login\/index\.php|my\/?|index\.php)?$/, '')};
  });

  handle('setup.createConnection', ({connectorId, kind, baseUrl, label}) => {
    const cid = str(connectorId, 32) ?? bad('コネクタが不正です');
    if (!['api', 'recipe', 'generic', 'manual'].includes(kind)) bad('接続の種類が不正です');
    const base = kind === 'manual' ? null : httpsUrl(baseUrl) ?? bad('URL が不正です');
    const recipe = registry.recipes.find((r) => r.id === cid);
    const conn = repo.createConnection({
      kind,
      connector_id: cid,
      label: str(label, 60) || recipe?.name || cid,
      base_url: base,
      university_host: base ? new URL(base).hostname : null,
      recipe_version: recipe?.version ?? null
    });
    return {connectionId: conn.id};
  });

  handle('connection.savePassword', async ({connectionId, user, password}) => {
    const cid = id(connectionId) ?? bad('接続が不正です');
    const conn = repo.get('connection', cid) ?? bad('接続がありません');
    const u = str(user, 200),
      p = str(password, 500);
    if (!u || !p) bad('ID とパスワードを入れてください');
    if (conn.kind === 'recipe') {
      const recipe = registry.recipes.find((r) => r.id === conn.connector_id);
      if (!recipe?.login?.form) bad('この LMS は統合認証のため、パスワードは保存できません。ブラウザ窓でログインしてください');
    }
    await secrets.set(`conn:${cid}:password`, {user: u, password: p});
    repo.updateConnection(cid, {save_password: 1});
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
              extract: ({headers, body}) => connector.parseLaunchToken(headers?.location ?? '') ?? connector.parseLaunchToken(body)
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
      return {ok: false, reason: e.code ?? 'login-required', message: e.message};
    } finally {
      await connector.releaseContext?.(c);
    }
  });

  handle('connection.remove', async ({connectionId}) => {
    const cid = id(connectionId) ?? bad('接続が不正です');
    await secrets.removeByPrefix(`conn:${cid}:`);
    repo.remove('connection', cid);
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

  handle('term.save', ({term}) => {
    const label = str(term?.label, 20) ?? bad('学期名を入れてください');
    const year = Number(term?.year);
    if (!(year >= 2000 && year <= 2100)) bad('年度が不正です');
    const d = defaultTermDates(label, year);
    const start = /^\d{4}-\d{2}-\d{2}$/.test(term.start) ? term.start : d.start;
    const end = /^\d{4}-\d{2}-\d{2}$/.test(term.end) ? term.end : d.end;
    if (start >= end) bad('終了日は開始日より後にしてください');
    const rounds = [15, 14, 8, 7].includes(Number(term.rounds)) ? Number(term.rounds) : 15;
    const periods = term.preset && PERIOD_PRESETS[term.preset] ? PERIOD_PRESETS[term.preset] : term.periods && typeof term.periods === 'object' ? term.periods : null;
    const row = repo.upsertTerm({
      id: termId(year, label),
      label,
      year,
      folder: termFolder(year, label),
      start_date: start,
      end_date: end,
      rounds,
      holidays_json: JSON.stringify(Array.isArray(term.holidays) ? term.holidays.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)) : []),
      periods_json: periods ? JSON.stringify(periods) : null,
      source: 'user'
    });
    return {ok: true, term: row};
  });

  handle('course.update', ({courseId, patch}) => {
    const cid = id(courseId) ?? bad('授業が不正です');
    const allowed = {};
    if (Number.isInteger(patch.color) && patch.color >= 1 && patch.color <= 8) allowed.color = patch.color;
    if (['plain', 'stripe', 'dot'].includes(patch.tape_pattern)) allowed.tape_pattern = patch.tape_pattern;
    if (typeof patch.hidden === 'boolean') allowed.hidden = patch.hidden ? 1 : 0;
    if (typeof patch.sync_enabled === 'boolean') allowed.sync_enabled = patch.sync_enabled ? 1 : 0;
    if (Number.isInteger(patch.sort_order)) allowed.sort_order = patch.sort_order;
    if (patch.weekday !== undefined) {
      if (patch.weekday && !'月火水木金土日'.includes(patch.weekday)) bad('曜日が不正です');
      allowed.weekday = patch.weekday || null;
      allowed.period = Number.isInteger(patch.period) && patch.period >= 1 && patch.period <= 7 ? patch.period : null;
      allowed.weekday_from = 'user';
    }
    if (patch.font && typeof patch.font === 'object') allowed.font_json = JSON.stringify(patch.font);
    if (patch.quiz && typeof patch.quiz === 'object') allowed.quiz_json = JSON.stringify(patch.quiz);
    return {course: repo.updateCourse(cid, allowed)};
  });

  handle('sync.run', ({connectionId, courseId, full}) => {
    const payload = {};
    if (connectionId) payload.connectionId = id(connectionId) ?? bad('接続が不正です');
    if (courseId) payload.courseId = id(courseId) ?? bad('授業が不正です');
    if (full === true) payload.full = true;
    payload.kind = courseId ? 'course' : 'manual';
    return {jobId: jobs.enqueue('sync', payload).id};
  });

  handle('material.open', async ({materialId}) => {
    const m = repo.get('material', id(materialId) ?? bad('資料が不正です')) ?? bad('資料がありません');
    if (!isOpenable(m.path)) bad('この種類のファイルはアプリから開きません');
    repo.updateMaterial(m.id, {read_at: new Date().toISOString()});
    const err = await shell.openPath(m.path);
    return err ? {error: err} : {ok: true};
  });
  handle('material.reveal', ({materialId}) => {
    const m = repo.get('material', id(materialId) ?? bad('資料が不正です')) ?? bad('資料がありません');
    shell.showItemInFolder(m.path);
    return {ok: true};
  });
  handle('material.move', ({materialId, roundId}) => {
    const m = repo.get('material', id(materialId) ?? bad('資料が不正です')) ?? bad('資料がありません');
    const r = repo.get('round', id(roundId) ?? bad('回が不正です')) ?? bad('回がありません');
    if (r.course_id !== m.course_id) bad('別の授業の回には移せません');
    return {jobId: jobs.enqueue('move', {materialId: m.id, roundId: r.id}).id};
  });

  handle('settings.pickDownloadDir', async () => {
    const r = await dialog.showOpenDialog({title: '資料の保存先のフォルダ', defaultPath: ctx.rootDir(), properties: ['openDirectory', 'createDirectory']});
    if (r.canceled) return {dir: null};
    const dir = checkDownloadDir(r.filePaths[0], app.getPath('home'));
    repo.setSetting('storage.root', dir);
    return {dir};
  });
  handle('settings.update', ({patch}) => {
    if (typeof patch.syncTime === 'string' && /^\d{2}:\d{2}$/.test(patch.syncTime)) repo.setSetting('sync.time', patch.syncTime);
    if (typeof patch.classStart === 'boolean') repo.setSetting('sync.classStart', patch.classStart);
    if ([0, 1, 3, 6].includes(patch.everyHours)) repo.setSetting('sync.everyHours', patch.everyHours);
    if (['system', 'light', 'dark'].includes(patch.theme)) repo.setSetting('ui.theme', patch.theme);
    if (['normal', 'light', 'none'].includes(patch.rules)) repo.setSetting('ui.rules', patch.rules);
    if (patch.resetRoot === true) repo.setSetting('storage.root', null);
    return {ok: true};
  });

  handle('browser.install', async () => {
    if (ctx.browser?.state === 'pending') return {ok: true, message: '準備中です'};
    ctx.browser = {state: 'pending', message: ''};
    await ctx.installBrowser?.();
    return {ok: ctx.browser.state === 'ready', message: ctx.browser.message};
  });

  handle('shell.openExternal', ({url}) => {
    const u = httpsUrl(url) ?? bad('URL が不正です');
    shell.openExternal(u);
    return {ok: true};
  });
  handle('shell.openRoot', () => shell.openPath(ctx.rootDir()).then((e) => (e ? {error: e} : {ok: true})));
  handle('app.version', () => ({version: app.getVersion(), recipes: registry.recipes.map((r) => ({id: r.id, version: r.version, verified: r.verified === true}))}));
  handle('app.openWindow', ({route}) => (openWindow(str(route, 100)), {ok: true}));
  void courseFolderName;
}
