// IPC の契約（DESIGN-M0 §4）。レンダラから受け取る値は必ず検査する。パスは受け取らない。
import {ipcMain, dialog, shell, app} from 'electron';
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {isUlid} from '../shared/ids.js';
import {checkDownloadDir, defaultRoot} from '../shared/paths.js';
import {courseFolderName} from '../shared/naming.js';
import {defaultTermDates, termFolder, termId} from '../shared/term.js';
import {PERIOD_PRESETS} from '../shared/schedule.js';
import {isOpenable} from './sync/files.js';
import {checkQuestion} from '../shared/quiz.js';

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
// ログイン時に起動（Mac・Windows）。npm start の開発版で登録すると Electron 本体が登録されるので、アプリとして入れたときだけ
const loginItem = () => {
  const available = app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');
  return {available, on: available && app.getLoginItemSettings().openAtLogin === true};
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

  handle('state.get', async () => {
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
        rules: repo.getSetting('ui.rules', 'normal'),
        openAtLogin: loginItem()
      },
      lastSync: repo.lastSyncRun(),
      browser: ctx.browser ?? {state: 'pending', message: ''},
      status: ctx.status ?? '',
      jobs: repo.pendingJobs().map((j) => ({id: j.id, kind: j.kind, status: j.status})),
      presets: Object.keys(PERIOD_PRESETS),
      quizzes: Object.fromEntries(courses.map((c) => [c.id, repo.listQuizzes(c.id).map(({source_json, ...z}) => ({...z, notes: JSON.parse(source_json ?? '{}').notes ?? []}))])),
      quiz: ctx.quiz ? {...ctx.quiz.status(), key: await ctx.quiz.keyInfo(), reviewDue: ctx.quiz.review().questions.length} : null,
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
    // 同じ LMS への接続がもうあれば、それを使う（作り直すと授業が 2 つずつできてしまう）
    const host = base ? new URL(base).hostname.toLowerCase() : null;
    const same = repo.listConnections().find((c) => c.connector_id === cid && c.kind === kind && (c.university_host ?? '').toLowerCase() === (host ?? ''));
    if (same) return {connectionId: same.id, reused: true};
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
      if (e.code === 'login-bad-credentials') repo.updateConnection(cid, {save_password: 0}); // 何度も送ってロックさせない
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
  // 資料を別の回へ移す。roundId が null なら「自分の付箋」へ。すぐ動かす（同期の列に並べると、長い同期のあいだ待たされる）
  handle('material.move', async ({materialId, roundId}) => {
    const m = repo.get('material', id(materialId) ?? bad('資料が不正です')) ?? bad('資料がありません');
    const r = roundId === null ? null : (repo.get('round', id(roundId) ?? bad('回が不正です')) ?? bad('回がありません'));
    if (r && r.course_id !== m.course_id) bad('別の授業の回には移せません');
    if ((r?.id ?? null) === m.round_id) return {ok: true};
    if (m.status !== 'ok') bad('ファイルが見つからないため移せません');
    const course = repo.get('course', m.course_id);
    const term = repo.get('term', course.term_id);
    await files.relocate({term, course, material: m, round: r});
    return {ok: true};
  });

  // 自分のファイルを授業に入れる。最初は「自分の付箋」（roundId を渡せばその回）に置く。
  // ファイルの場所はレンダラから受け取らない：「ファイルを追加」はメインで選ぶ窓を開き、ドラッグは中身（バイト列）と名前だけを受け取る
  const MAX_UPLOAD = 300 * 1024 * 1024;
  const placeFor = (courseId, roundId) => {
    const course = repo.get('course', id(courseId) ?? bad('授業が不正です')) ?? bad('授業がありません');
    const term = repo.get('term', course.term_id) ?? bad('学期がありません');
    const round = roundId ? (repo.get('round', id(roundId) ?? bad('回が不正です')) ?? bad('回がありません')) : null;
    if (round && round.course_id !== course.id) bad('別の授業の回には入れられません');
    return {course, term, round};
  };
  const addAll = async (place, items) => {
    const out = {added: 0, dup: [], failed: []};
    for (const {name, read} of items) {
      try {
        const r = await files.addOwn({...place, name, data: await read()});
        if (r.result === 'dup') {
          const where = r.material.round_id ? repo.get('round', r.material.round_id) : null;
          out.dup.push({name, where: where ? (where.number === 0 ? 'その他' : `第${where.number}回`) : '自分の付箋'});
        } else out.added++;
      } catch (e) {
        log.warn(`ファイルを入れられませんでした: ${name}（${e.message}）`);
        out.failed.push({name, message: e.message});
      }
    }
    return out;
  };
  handle('material.upload', async ({courseId, roundId = null}) => {
    const place = placeFor(courseId, roundId);
    const r = await dialog.showOpenDialog({title: `${place.course.name} に入れるファイル`, properties: ['openFile', 'multiSelections']});
    if (r.canceled || !r.filePaths.length) return {added: 0, dup: [], failed: [], canceled: true};
    const items = [];
    for (const p of r.filePaths) {
      const st = await fsp.stat(p);
      if (st.size > MAX_UPLOAD) bad(`${path.basename(p)} は大きすぎます（300MB まで）`);
      items.push({name: path.basename(p), read: () => fsp.readFile(p)});
    }
    return addAll(place, items);
  });
  handle('material.uploadData', async ({courseId, roundId = null, files: list}) => {
    const place = placeFor(courseId, roundId);
    if (!Array.isArray(list) || !list.length || list.length > 50) bad('ファイルが不正です');
    const items = list.map((f) => {
      const name = str(f?.name, 255) ?? bad('ファイル名が不正です');
      const data = f?.data instanceof Uint8Array ? f.data : f?.data instanceof ArrayBuffer ? new Uint8Array(f.data) : bad('ファイルの中身が不正です');
      if (data.byteLength > MAX_UPLOAD) bad(`${name} は大きすぎます（300MB まで）`);
      return {name, read: async () => Buffer.from(data.buffer, data.byteOffset, data.byteLength)};
    });
    return addAll(place, items);
  });
  // 自分で入れた資料を外す（ファイルは OS のゴミ箱へ）。LMS から取った資料は外さない（次の同期でまた取ってくるため）
  handle('material.remove', async ({materialId}) => {
    const m = repo.get('material', id(materialId) ?? bad('資料が不正です')) ?? bad('資料がありません');
    if (m.source !== 'upload') bad('LMS から取った資料は外せません');
    if (m.status === 'ok') await files.trash(m.path);
    repo.remove('material', m.id);
    return {ok: true};
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
    if (typeof patch.openAtLogin === 'boolean') {
      if (!loginItem().available) bad('ログイン時の起動は、アプリとして入れた大学ノートでだけ設定できます');
      app.setLoginItemSettings({openAtLogin: patch.openAtLogin});
    }
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
  // ---- クイズ（SPEC §11） ----
  const quiz = ctx.quiz;
  const ids = (list, max = 50) => (Array.isArray(list) ? list.slice(0, max).map((x) => id(x) ?? bad('ID が不正です')) : bad('ID の一覧が不正です'));
  const parseQ = ({o_json, tags_json, ...q}) => {
    const o = JSON.parse(o_json ?? '[]');
    return {...q, o: Array.isArray(o) ? o : [], unit: Array.isArray(o) ? '' : o.unit ?? '', tags: JSON.parse(tags_json ?? '[]')};
  };
  handle('quiz.status', async () => ({...quiz.status(), key: await quiz.keyInfo()}));
  handle('quiz.setKey', async ({apiKey}) => quiz.setKey(str(apiKey, 300) ?? bad('API キーを入れてください')));
  handle('quiz.removeKey', async () => (await quiz.removeKey(), {ok: true}));
  handle('quiz.settings', ({patch}) => {
    if (patch.model !== undefined) repo.setSetting('quiz.model', str(patch.model, 40) ?? bad('モデルが不正です'));
    if (patch.mix && typeof patch.mix === 'object') {
      const mix = {};
      for (const t of quiz.status().types) mix[t] = Math.max(0, Math.min(30, Number.isInteger(patch.mix[t]) ? patch.mix[t] : 0));
      const total = Object.values(mix).reduce((a, b) => a + b, 0);
      if (total < 1 || total > 30) bad('問題数は 1〜30 問にしてください');
      repo.setSetting('quiz.mix', mix);
    }
    if (patch.perDay !== undefined) repo.setSetting('quiz.perDay', Math.max(1, Math.min(200, Number(patch.perDay) || 30)));
    if (patch.perMonthUsd !== undefined) repo.setSetting('quiz.perMonthUsd', Math.max(0.5, Math.min(500, Number(patch.perMonthUsd) || 5)));
    return {ok: true};
  });
  handle('quiz.generate', ({roundIds}) => ({queued: quiz.generate(ids(roundIds))}));
  handle('quiz.list', ({courseId}) => repo.listQuizzes(id(courseId) ?? bad('授業が不正です')).map((z) => ({...z, source: JSON.parse(z.source_json ?? '{}'), source_json: undefined})));
  handle('quiz.questions', ({quizIds, courseId}) =>
    repo.listQuestions(quizIds ? {quizIds: ids(quizIds)} : {courseId: id(courseId) ?? bad('授業が不正です')}).map(parseQ)
  );
  handle('quiz.answer', ({questionId, answer, mode, seconds}) =>
    quiz.answer({
      questionId: id(questionId) ?? bad('問題が不正です'),
      answer: typeof answer === 'boolean' ? answer : str(String(answer ?? ''), 300) ?? '',
      mode: ['quiz', 'review', 'retry', 'exam', 'card'].includes(mode) ? mode : 'quiz',
      seconds: Number.isFinite(seconds) ? Math.round(seconds) : null
    })
  );
  handle('quiz.review', () => {
    const r = quiz.review();
    return {...r, questions: r.questions.map(parseQ)};
  });
  handle('question.update', ({questionId, patch}) => {
    const qid = id(questionId) ?? bad('問題が不正です');
    const q = repo.get('question', qid) ?? bad('問題がありません');
    const allowed = {};
    for (const k of ['q', 'a', 'n']) if (typeof patch[k] === 'string') allowed[k] = str(patch[k].trim(), k === 'n' ? 400 : k === 'q' ? 300 : 120) ?? bad(`${k} が長すぎます`);
    if (Array.isArray(patch.o)) allowed.o_json = JSON.stringify(patch.o.slice(0, 3).map((x) => str(String(x).trim(), 120) ?? bad('誤答が長すぎます')));
    if (patch.reviewed === true) allowed.review = null;
    if (typeof patch.report === 'string') allowed.report_reason = str(patch.report, 60) || null;
    if (patch.report === null) allowed.report_reason = null;
    if (patch.deleted === true) allowed.deleted = 1;
    const next = {...q, ...allowed, o: allowed.o_json ? JSON.parse(allowed.o_json) : JSON.parse(q.o_json ?? '[]')};
    if (allowed.q || allowed.a || allowed.o_json) {
      const errs = checkQuestion({...next, o: Array.isArray(next.o) ? next.o : [], src: {quote: 'x'.repeat(20)}}).filter((e) => !/引用/.test(e));
      if (errs.length) bad(errs.join('／'));
      allowed.review = null; // 本人が直した問題は「要確認」を外す
    }
    return parseQ(repo.updateQuestion(qid, allowed));
  });

  handle('app.openWindow', ({route}) => (openWindow(str(route, 100)), {ok: true}));
  void courseFolderName;
}
