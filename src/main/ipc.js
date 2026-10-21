// IPC の契約（DESIGN-M0 §4）。レンダラから受け取る値は必ず検査する。パスは受け取らない。
import {ipcMain, dialog, shell, app, nativeImage} from 'electron';
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {isUlid, ulid} from '../shared/ids.js';
import {CLASSIC_ID, FORMAT, SHAPES, STICKER_MODES, isBuiltin, isHex, normalizeTemplate} from '../shared/skin.js';
import {checkDownloadDir, defaultRoot} from '../shared/paths.js';
import {courseFolderName} from '../shared/naming.js';
import {currentTerm, defaultTermDates, termFolder, termId} from '../shared/term.js';
import {PERIOD_PRESETS} from '../shared/schedule.js';
import {cleanUses, isRole} from '../shared/profile.js';
import {createRequire} from 'node:module';
import {isOpenable, sha256} from './sync/files.js';
import {renameCourse} from './folders.js';
import {exportAnnotatedPdf, isPng} from './pdf-export.js';
import {annoKey, overwritePdf, readBase} from './pdf-save.js';
import {checkQuestion} from '../shared/quiz.js';
import {annotationToClient, normalizeAnnotation} from '../shared/annotation.js';
import {normalizeBookmark} from '../shared/bookmark.js';

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
// pdf.js の補助データ（日本語の CMap・標準フォント・wasm）。レンダラは file:// を読まないので、ここから渡す
const PDFJS_DIR = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const PDFJS_ASSET = {cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm'};
// ログイン時に起動（Mac・Windows）。npm start の開発版で登録すると Electron 本体が登録されるので、アプリとして入れたときだけ
const loginItem = () => {
  const available = app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');
  return {available, on: available && app.getLoginItemSettings().openAtLogin === true};
};
const bad = (msg) => {
  throw new Error(msg);
};

export function registerIpc(ctx, {openWindow, getWindow = () => null}) {
  const {repo, registry, jobs, files, secrets, log, folders} = ctx;
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
    // 自分のフォルダの資料は、フォルダの中のどの下のフォルダにあるか（sub）も渡す。パスそのものは渡さない
    const sub = (c, m) => (c.kind === 'folder' && c.dir ? path.relative(c.dir, path.dirname(m.path)).split(path.sep).join('/') : '');
    const marks = repo.bookmarkCounts();
    const materials = Object.fromEntries(
      courses.map((c) => [c.id, repo.listMaterials(c.id).map(({path: p, ...m}) => ({...m, sub: sub(c, {path: p}), bookmarks: marks[m.sha256] ?? 0}))])
    );
    const today = new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Tokyo'});
    return {
      connections,
      terms,
      currentTermId: currentTerm(terms, today)?.id ?? terms.at(-1)?.id ?? null,
      courses: courses.map(({dir, ...c}) => (c.kind === 'folder' ? {...c, dirName: path.basename(dir ?? '')} : c)),
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
        ownColors: repo.getSetting('ui.ownColors', {}), // 授業ごとの「付箋を追加」の色（付箋の 5 色の何番目か）
        role: repo.getSetting('profile.role', null), // 使う人（profile.js の ROLES）。まだ選んでいなければ null
        uses: repo.getSetting('profile.uses', []), // 使い方（profile.js の USES の鍵）
        university: repo.getSetting('profile.university', ''),
        openAtLogin: loginItem()
      },
      skin: {
        global: repo.getSetting('skin.global', CLASSIC_ID),
        templates: repo.listSkinTemplates(),
        stickers: repo.listStickers(),
        recent: repo.getSetting('skin.recentColors', []),
        introduced: repo.getSetting('skin.introduced', false)
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
    // LMS をつなぐ前にフォルダのために作った仮の学期が同じ時期にあれば、フォルダをこの学期へ移して仮の学期を消す
    for (const t of repo.listTerms())
      if (t.source === 'auto' && t.id !== row.id && t.start_date <= end && start <= t.end_date) {
        for (const c of repo.listCourses({termId: t.id})) repo.updateCourse(c.id, {term_id: row.id});
        repo.remove('term', t.id);
      }
    return {ok: true, term: row};
  });

  handle('course.update', async ({courseId, patch}) => {
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
    // 名前を変えられるのは、LMS を使わない授業（手動でつくった授業）だけ。LMS の授業名は同期で LMS に合わせる
    if (patch.name !== undefined) {
      const conn = repo.get('connection', repo.get('course', cid)?.connection_id);
      if (conn?.kind !== 'manual') bad('LMS の授業の名前は変えられません');
      const name = (str(patch.name, 200) ?? '').trim().slice(0, 80) || bad('名前を入れてください');
      await renameCourse({repo, courseDir: (t, c) => files.courseDir(t, c)}, cid, name); // パソコンの授業フォルダの名前も変える
    }
    return {course: repo.updateCourse(cid, allowed)};
  });

  // 回の名前（付箋の題）：自分で変える。空なら LMS の題に戻す
  handle('round.update', ({roundId, title}) => {
    const rid = id(roundId) ?? bad('回が不正です');
    if (!repo.get('round', rid)) bad('回がありません');
    return {round: repo.updateRound(rid, {title_user: (str(title, 200) ?? '').trim().slice(0, 80) || null})};
  });

  // ---- 着せ替え（SPEC-KISEKAE.md）：テンプレートは値だけを持つ。保存のたびに normalizeTemplate を通す ----
  const templateExists = (tid) => isBuiltin(tid) || repo.listSkinTemplates().some((t) => t.id === tid);
  handle('skin.save', ({template}) => {
    const tid = template?.id && isUlid(template.id) && !isBuiltin(template.id) ? template.id : ulid();
    const prev = repo.listSkinTemplates().find((t) => t.id === tid);
    const t = normalizeTemplate({...template, author: template?.author ?? 'わたし'}, {id: tid});
    if (prev) t.createdAt = prev.createdAt;
    // 貼ったシールの画像の大きさは、シール帳の記録から入れる（書き出したファイルを読む側が使う）
    for (const sid of Object.keys(t.assets)) {
      const row = repo.get('sticker', sid);
      if (row) t.assets[sid] = {mime: 'image/png', w: row.w, h: row.h};
    }
    return {template: repo.saveSkinTemplate(t)};
  });
  handle('skin.remove', ({id: tid}) => {
    if (!isUlid(tid)) bad('はじめからあるテンプレートは消せません');
    if (repo.getSetting('skin.global', CLASSIC_ID) === tid) repo.setSetting('skin.global', CLASSIC_ID);
    repo.removeSkinTemplate(tid);
    return {ok: true};
  });
  // 当てる：courseId があればその授業（templateId が null なら「全体と同じ」）、なければ全体
  handle('skin.apply', ({courseId, templateId, stickerMode}) => {
    if (templateId != null && !templateExists(templateId)) bad('テンプレートが見つかりません');
    if (courseId) {
      const cid = id(courseId) ?? bad('授業が不正です');
      const patch = {};
      if (templateId !== undefined) patch.skin_template_id = templateId ?? null;
      if (STICKER_MODES.includes(stickerMode)) patch.sticker_mode = stickerMode;
      return {course: repo.updateCourse(cid, patch)};
    }
    repo.setSetting('skin.global', templateId ?? CLASSIC_ID);
    return {ok: true};
  });
  handle('skin.recentColor', ({color}) => {
    if (!isHex(color)) bad('色が不正です');
    const list = [color.toLowerCase(), ...repo.getSetting('skin.recentColors', []).filter((c) => c !== color.toLowerCase())].slice(0, 8);
    repo.setSetting('skin.recentColors', list);
    return {recent: list};
  });
  handle('skin.introduced', () => {
    repo.setSetting('skin.introduced', true);
    return {ok: true};
  });

  // シールの素：レンダラで長辺 512px 以内の PNG に描き直したもの（画像の中の付加情報を落とす）を受け取り、
  // アプリのデータの場所の stickers/<SHA-256>.png に置く。名前は中身から決まるので、同じ画像は 1 つになる
  const stickersDir = () => path.join(app.getPath('userData'), 'stickers');
  const stickerFile = (sid) => path.join(stickersDir(), `${sid}.png`);
  const isSha = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  handle('sticker.add', async ({bytes, shape}) => {
    const buf = bytes instanceof Uint8Array ? bytes : bad('画像が不正です');
    if (!isPng(buf) || buf.length > 2 * 1024 * 1024) bad('画像が不正です（PNG・2MB まで）');
    const w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
    const h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
    if (!(w >= 1 && w <= 512 && h >= 1 && h <= 512)) bad('画像の大きさが不正です（長辺 512px まで）');
    const sid = sha256(buf);
    await fsp.mkdir(stickersDir(), {recursive: true});
    await fsp.writeFile(stickerFile(sid), buf);
    if (!repo.get('sticker', sid))
      repo.insert('sticker', {id: sid, w, h, shape: SHAPES.includes(shape) ? shape : 'cut', favorite: 0, created_at: new Date().toISOString()});
    return {sticker: repo.get('sticker', sid)};
  });
  handle('sticker.update', ({id: sid, shape, favorite, folder}) => {
    if (!isSha(sid) || !repo.get('sticker', sid)) bad('シールが見つかりません');
    const patch = {};
    if (SHAPES.includes(shape)) patch.shape = shape;
    if (typeof favorite === 'boolean') patch.favorite = favorite ? 1 : 0;
    // シール帳のフォルダ分け（名前。空なら分けない）
    if (typeof folder === 'string') patch.folder = folder.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 20) || null;
    repo.update('sticker', sid, patch);
    return {sticker: repo.get('sticker', sid)};
  });
  handle('sticker.remove', async ({id: sid}) => {
    if (!isSha(sid)) bad('シールが見つかりません');
    repo.remove('sticker', sid);
    await fsp.rm(stickerFile(sid), {force: true});
    return {ok: true};
  });
  // ---- テンプレートの書き出し・読み込み（SPEC-KISEKAE §7）。1 つの JSON ファイル（.dnskin）に、テンプレートと
  // 取り込んだ画像（PNG・base64）をまとめる。読み込むときは画像を描き直して（付加情報を落とし、壊れた画像を弾く）シール帳に入れる ----
  handle('skin.export', async ({id: tid}) => {
    const t = repo.listSkinTemplates().find((x) => x.id === tid) ?? bad('テンプレートが見つかりません');
    const assetsData = {};
    for (const sid of Object.keys(t.assets ?? {})) {
      const buf = await fsp.readFile(stickerFile(sid)).catch(() => null);
      if (buf) assetsData[sid] = buf.toString('base64');
    }
    const safe = t.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'テンプレート';
    const win = getWindow();
    const opts = {
      title: 'テンプレートを書き出す',
      defaultPath: path.join(app.getPath('documents'), `${safe}.dnskin`),
      filters: [{name: '大学ノートのテンプレート', extensions: ['dnskin']}]
    };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return {ok: false};
    await fsp.writeFile(r.filePath, JSON.stringify({...t, assetsData}, null, 2));
    return {ok: true, name: path.basename(r.filePath)};
  });
  handle('skin.import', async () => {
    const win = getWindow();
    const opts = {title: 'テンプレートを読み込む', properties: ['openFile'], filters: [{name: '大学ノートのテンプレート', extensions: ['dnskin', 'json']}]};
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths?.[0]) return {ok: false};
    const stat = await fsp.stat(r.filePaths[0]);
    if (stat.size > 20 * 1024 * 1024) bad('ファイルが大きすぎます（20MB まで）');
    let raw;
    try {
      raw = JSON.parse(await fsp.readFile(r.filePaths[0], 'utf8'));
    } catch {
      bad('テンプレートのファイルとして読めませんでした');
    }
    if (raw?.format !== FORMAT) bad('大学ノートのテンプレートではありません');
    normalizeTemplate(raw); // 形と版を先に確かめる（新しすぎる版はここで断る）
    // 画像を描き直してシール帳に入れる。中身から名前（SHA-256）が決まるので、名前を付け替える
    const renamed = {};
    await fsp.mkdir(stickersDir(), {recursive: true});
    for (const [old, b64] of Object.entries(raw.assetsData ?? {}).slice(0, 60)) {
      if (!isSha(old) || typeof b64 !== 'string') continue;
      const buf = Buffer.from(b64, 'base64');
      if (!isPng(buf) || buf.length > 2 * 1024 * 1024) continue;
      let img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) continue;
      const {width, height} = img.getSize();
      if (Math.max(width, height) > 512) img = img.resize(width >= height ? {width: 512} : {height: 512});
      const png = img.toPNG();
      const sid = sha256(png);
      await fsp.writeFile(stickerFile(sid), png);
      const size = img.getSize();
      if (!repo.get('sticker', sid)) repo.insert('sticker', {id: sid, w: size.width, h: size.height, shape: 'cut', favorite: 0, created_at: new Date().toISOString()});
      renamed[old] = sid;
    }
    // 画像のないシールは捨てる（はじめから入っているシールと、もうシール帳にある画像はそのまま）
    const fix = (sid) => (isSha(sid) ? (renamed[sid] ?? (repo.get('sticker', sid) ? sid : null)) : sid);
    const stickers = (Array.isArray(raw.stickers) ? raw.stickers : []).map((s) => ({...s, asset: fix(s?.asset)})).filter((s) => s.asset);
    const tape = {...(raw.parts?.tape ?? {}), image: raw.parts?.tape?.image ? fix(raw.parts.tape.image) : null};
    // 同じ識別番号の自作テンプレートがあれば、置き換えるか別のものとして加えるかを選ぶ
    let tid = isUlid(raw.id) && !isBuiltin(raw.id) ? raw.id : ulid();
    if (repo.listSkinTemplates().some((t) => t.id === tid)) {
      const box = {
        type: 'question',
        message: `「${String(raw.name ?? '').slice(0, 40)}」と同じテンプレートがすでにあります`,
        detail: '置き換えると、それを使っている授業の見た目も変わります。',
        buttons: ['置き換える', '別のものとして加える', 'やめる'],
        defaultId: 1,
        cancelId: 2
      };
      const {response} = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box);
      if (response === 2) return {ok: false};
      if (response === 1) tid = ulid();
    }
    const t = normalizeTemplate({...raw, parts: {...raw.parts, tape}, stickers}, {id: tid});
    for (const sid of Object.keys(t.assets)) {
      const row = repo.get('sticker', sid);
      if (row) t.assets[sid] = {mime: 'image/png', w: row.w, h: row.h};
    }
    return {ok: true, template: repo.saveSkinTemplate(t)};
  });

  // シールの画像（data: URL）。CSP で file:// を読まないので、ここから渡す
  handle('sticker.data', async ({ids}) => {
    const out = {};
    for (const sid of Array.isArray(ids) ? ids.slice(0, 200) : []) {
      if (!isSha(sid)) continue;
      const buf = await fsp.readFile(stickerFile(sid)).catch(() => null);
      if (buf) out[sid] = `data:image/png;base64,${buf.toString('base64')}`;
    }
    return {data: out};
  });

  handle('sync.run', async ({connectionId, courseId, full}) => {
    if (courseId && repo.get('course', id(courseId) ?? bad('授業が不正です'))?.kind === 'folder') return folders.scan(courseId);
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
  // アプリ内の PDF ビューア（SPEC §9）。編集できるのは PDF だけ。中身はバイト列で渡し、パスはレンダラに出さない
  const pdfMaterial = (materialId) => {
    const m = repo.get('material', id(materialId) ?? bad('資料が不正です')) ?? bad('資料がありません');
    if (!/\.pdf$/i.test(m.path)) bad('アプリ内で開けるのは PDF だけです');
    if (m.status !== 'ok') bad('このファイルは見つかりません');
    return m;
  };
  // 上書き保存した PDF の元の写し（注釈はいつもこの写しの上に描く）
  const originalsDir = () => path.join(app.getPath('userData'), 'originals');
  handle('pdf.open', async ({materialId}) => {
    const m = pdfMaterial(materialId);
    // 上書き保存したことがあれば、注釈を描き込む前の写しを開く（描き込み済みの上に注釈を重ねて 2 重にしない）
    const base = await readBase(m, originalsDir()).catch(() => bad('ファイルを読めませんでした（移動または削除された可能性があります）'));
    if (!base.pristine) log.warn(`元の PDF の写しがありません：${m.name}（描き込み済みのファイルを開きます）`);
    const bytes = base.bytes;
    repo.updateMaterial(m.id, {read_at: new Date().toISOString()});
    return {
      material: {id: m.id, name: m.name, course_id: m.course_id, round_id: m.round_id},
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      annotations: repo.listAnnotations(annoKey(m)).map(annotationToClient),
      bookmarks: repo.listBookmarks(annoKey(m)).map(bookmarkToClient)
    };
  });
  // しおり（名前・ページ・位置）。追加・名前の変更・移動は同じ窓口（id がなければ追加）
  const bookmarkToClient = ({id: bid, page, y, name}) => ({id: bid, page, y, name});
  handle('bookmark.save', ({materialId, bookmark}) => {
    const m = pdfMaterial(materialId);
    const bid = bookmark?.id == null ? null : (id(bookmark.id) ?? bad('しおりが不正です'));
    return {bookmark: bookmarkToClient(repo.saveBookmark(annoKey(m), bid, normalizeBookmark(bookmark)))};
  });
  handle('bookmark.remove', ({materialId, bookmarkId}) => {
    const m = pdfMaterial(materialId);
    repo.removeBookmark(annoKey(m), id(bookmarkId) ?? bad('しおりが不正です'));
    return {ok: true};
  });
  handle('pdf.asset', async ({kind, filename}) => {
    const dir = PDFJS_ASSET[kind] ?? bad('種類が不正です');
    const name = str(filename, 100);
    if (!name || !/^[\w.+-]+$/.test(name) || name.startsWith('.')) bad('ファイル名が不正です');
    const buf = await fsp.readFile(path.join(PDFJS_DIR, dir, name));
    return {bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)};
  });
  handle('annotation.save', ({materialId, annotation}) => {
    const m = pdfMaterial(materialId);
    const aid = annotation?.id == null ? null : id(annotation.id) ?? bad('注釈が不正です');
    const row = repo.saveAnnotation(annoKey(m), aid, normalizeAnnotation(annotation));
    return {annotation: annotationToClient(row)};
  });
  handle('annotation.remove', ({materialId, annotationId}) => {
    const m = pdfMaterial(materialId);
    repo.removeAnnotation(annoKey(m), id(annotationId) ?? bad('注釈が不正です'));
    return {ok: true};
  });
  // 文字入れの画像（レンダラが描いた PNG）。DB にある文字入れの分だけ受け取る
  const textImages = (rows, texts) => {
    const textIds = new Set(rows.filter((r) => r.kind === 'text').map((r) => r.id));
    const images = new Map();
    let total = 0;
    for (const t of Array.isArray(texts) ? texts : []) {
      const tid = id(t?.id);
      if (!tid || !textIds.has(tid)) continue;
      if (!isPng(t.png)) bad('文字入れの画像が不正です');
      total += t.png.length;
      if (total > 200 * 1024 * 1024) bad('文字入れが多すぎて書き出せません');
      images.set(tid, t.png);
    }
    return images;
  };
  // 上書き保存：注釈を描き込んだ PDF でファイルを置き換える（Finder で開いても注釈が見える）。元の写しはアプリの中に取っておく
  handle('pdf.save', async ({materialId, texts}) => {
    const m = pdfMaterial(materialId);
    const rows = repo.listAnnotations(annoKey(m)).map(annotationToClient);
    const r = await overwritePdf({repo, material: m, annotations: rows, images: textImages(rows, texts), originalsDir: originalsDir()});
    if (r.changed) getWindow()?.webContents.send('state.changed', {});
    return {ok: true, changed: r.changed, name: m.name};
  });
  // 注釈付きで別名で書き出す（§9.7）。注釈の位置と中身は DB のものを使い、レンダラからは文字入れの画像だけ受け取る
  handle('pdf.export', async ({materialId, options, texts}) => {
    const m = pdfMaterial(materialId);
    const markers = options?.markers === 'black' ? 'black' : 'blue';
    const notes = options?.notes !== false;
    const rows = repo.listAnnotations(annoKey(m)).map(annotationToClient);
    const images = textImages(rows, texts);
    const base = await readBase(m, originalsDir()).catch(() => bad('元の PDF を読めませんでした'));
    if (!base.pristine) bad('元の PDF の写しが見つからないため書き出せません');
    const src = base.bytes;
    const out = Buffer.from(await exportAnnotatedPdf(src, rows, {images, markers, notes}));
    const dir = path.dirname(m.path);
    const opts = {
      title: '注釈付きで書き出す',
      defaultPath: path.join(dir, `${m.name.replace(/\.pdf$/i, '')}_注釈.pdf`),
      filters: [{name: 'PDF', extensions: ['pdf']}]
    };
    const win = getWindow();
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return {canceled: true};
    const file = /\.pdf$/i.test(r.filePath) ? r.filePath : `${r.filePath}.pdf`;
    if (path.resolve(file) === path.resolve(m.path)) bad('元の PDF には上書きできません。別の名前にしてください');
    const taken = repo.findMaterialByPath(file);
    if (taken && taken.source !== 'export') bad('資料のファイルには上書きできません。別の名前にしてください');
    await fsp.writeFile(file, out);
    // 元の資料と同じ回フォルダに置いたときは、授業画面の一覧にも出す（注釈の対象にはしない）
    if (path.dirname(path.resolve(file)) === path.resolve(dir)) {
      const h = sha256(out);
      if (taken) repo.updateMaterial(taken.id, {sha256: h, size: out.length});
      else if (!repo.findMaterialByHash(m.course_id, h))
        repo.createMaterial({
          course_id: m.course_id,
          round_id: m.round_id,
          round_from: 'user',
          name: path.basename(file),
          path: file,
          sha256: h,
          size: out.length,
          mime: 'application/pdf',
          source: 'export',
          status: 'ok',
          read_at: new Date().toISOString()
        });
      win?.webContents.send('state.changed', {});
    }
    return {ok: true, name: path.basename(file)};
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
    if (repo.get('course', m.course_id)?.kind === 'folder') bad('自分のフォルダの中では移せません（Finder で動かしてください）');
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
    if (course.kind === 'folder') return {course, term, round: folders.roundOf(course)}; // フォルダの中にコピーする
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
          out.dup.push({name, where: place.course.kind === 'folder' ? 'このフォルダ' : where ? (where.number === 0 ? 'その他' : `第${where.number}回`) : '「付箋を追加」'});
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
    if (m.source === 'folder') bad('パソコンのフォルダにあるファイルは、Finder（エクスプローラー）で消してください');
    if (m.source !== 'upload') bad('LMS から取った資料は外せません');
    if (m.status === 'ok') await files.trash(m.path);
    repo.remove('material', m.id);
    return {ok: true};
  });

  // 自分のフォルダ：作る（保存先の中に新しく）・パソコンのフォルダを登録する（選ぶ窓はメインで開く。パスは受け取らない）
  handle('folder.create', async ({name, scope, mode}) => {
    if (!['term', 'always'].includes(scope)) bad('フォルダの種類が不正です');
    if (mode === 'new') {
      const course = await folders.create({name: str(name, 200) ?? bad('フォルダの名前を入れてください'), scope, mode});
      return {courseId: course.id};
    }
    if (mode !== 'link') bad('フォルダの作り方が不正です');
    const win = getWindow();
    const opts = {title: '大学ノートに登録するフォルダ', properties: ['openDirectory']};
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths.length) return {canceled: true};
    const course = await folders.create({name: str(name, 200) ?? '', scope, mode, dir: r.filePaths[0]});
    const scanned = await folders.scan(course.id);
    return {courseId: course.id, ...scanned};
  });
  handle('folder.scan', async ({courseId}) => folders.scan(id(courseId) ?? bad('フォルダが不正です')));
  // 自分のフォルダの中の下のフォルダ（付箋 1 枚）の名前を変える：パソコンのフォルダの名前を変えて、読み直す（中身の記録は SHA-256 で付いていく）
  handle('folder.renameSub', async ({courseId, sub, name}) => {
    const c = folders.folderCourse(id(courseId) ?? bad('フォルダが不正です'));
    return {ok: true, ...(await folders.renameSub(c.id, str(sub, 1000) ?? bad('フォルダが不正です'), str(name, 200) ?? ''))};
  });
  handle('folder.reveal', async ({courseId}) => {
    const c = folders.folderCourse(id(courseId) ?? bad('フォルダが不正です'));
    const e = await shell.openPath(c.dir);
    if (e) bad(`フォルダを開けませんでした（${e}）`);
    return {ok: true};
  });
  handle('folder.update', async ({courseId, name, scope}) => {
    let c = folders.folderCourse(id(courseId) ?? bad('フォルダが不正です'));
    const patch = {};
    if (name !== undefined) c = await folders.rename(c.id, str(name, 200) ?? ''); // パソコンのフォルダの名前も変える
    if (scope !== undefined) {
      if (!['term', 'always'].includes(scope)) bad('フォルダの種類が不正です');
      patch.scope = scope;
      // 今学期のフォルダにするときは、いまの学期に付け直す（前の学期のフォルダを今学期へ戻すとき）
      if (scope === 'term') patch.term_id = folders.termNow()?.id ?? c.term_id;
    }
    return {course: repo.updateCourse(c.id, patch)};
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
    // 使う人・使い方・大学名（大学名はいまは記録するだけ）。人を変えたら、その人の使い方に合わないものは外す
    if (isRole(patch.role)) {
      repo.setSetting('profile.role', patch.role);
      repo.setSetting('profile.uses', cleanUses(patch.role, patch.uses ?? repo.getSetting('profile.uses', [])));
    } else if (patch.uses !== undefined) repo.setSetting('profile.uses', cleanUses(repo.getSetting('profile.role', null), patch.uses));
    if (typeof patch.university === 'string') repo.setSetting('profile.university', patch.university.trim().slice(0, 60));
    // 「付箋を追加」の色：付箋の 5 色の何番目か（0〜4）。null で元の白に戻す
    if (patch.ownColor && typeof patch.ownColor === 'object') {
      const cid = id(patch.ownColor.courseId) ?? bad('授業が不正です');
      const i = patch.ownColor.index;
      if (i !== null && !(Number.isInteger(i) && i >= 0 && i < 5)) bad('色が不正です');
      const map = {...repo.getSetting('ui.ownColors', {})};
      if (i === null) delete map[cid];
      else map[cid] = i;
      repo.setSetting('ui.ownColors', map);
    }
    if (patch.resetRoot === true) repo.setSetting('storage.root', null);
    if (patch.skipSetup === true) repo.setSetting('setup.skipped', true); // 初回のセットアップを終えた（次から起動時に出さない。LMS は任意で、設定からつなぐ）
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
