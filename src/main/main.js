// 大学ノート メインプロセスの入口（DESIGN-M0 §3）。常駐・トレイ・窓・起動手順。
// M0 の骨格：DB・設定・ジョブ・スケジューラ・IPC をつなぐ。LMS 操作とファイル操作はここ（メイン）だけで行う。
import {app, BrowserWindow, Menu, Tray, dialog, nativeImage, nativeTheme, net, shell} from 'electron';
import {existsSync, mkdirSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from './db/db.js';
import {Repo} from './db/repo.js';
import {createSecrets} from './secrets.js';
import {createLogger} from './log.js';
import {registerIpc} from './ipc.js';
import {JobRunner} from './jobs.js';
import {Scheduler} from './scheduler.js';
import {FileManager} from './sync/files.js';
import {SyncEngine} from './sync/engine.js';
import {createRegistry, loadRecipes} from './connectors/index.js';
import {createRecipeExecutor} from './connectors/recipe-executor.js';
import {createBrowserSession} from './browser/session.js';
import {ensureChromium} from './browser/install.js';
import {createQuarantine} from './sync/quarantine.js';
import {defaultRoot} from '../shared/paths.js';
import {createUpdater} from './updater.js';
import {createFolders} from './folders.js';
import {createQuizService} from './quiz/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(here, '..', 'renderer', 'index.html');
const PRELOAD = path.join(here, '..', 'preload', 'preload.js');

/**
 * 開発中（npm start）のコードの版：src の中でいちばん新しい更新時刻。配布物では使わない。
 * 大学ノートは窓を閉じても常駐するので、git pull のあとに npm start しても古いほうが動き続けていた。
 * 2 つ目の起動が新しいコードなら、動いているほうを再起動する
 */
function devBuild() {
  if (app.isPackaged) return null;
  let latest = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, {withFileTypes: true})) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html|css|json)$/.test(e.name)) latest = Math.max(latest, statSync(p).mtimeMs);
    }
  };
  try {
    walk(path.join(here, '..'));
  } catch {
    return null;
  }
  return String(Math.round(latest));
}
const BUILD = devBuild();

// 2 つ目の起動はすぐに終わる（app.quit() は非同期で、そのまま起動の処理が進んでデータベースまで開いていた）
const primary = app.requestSingleInstanceLock({build: BUILD});
if (!primary) app.exit(0);

let win = null,
  tray = null;
const ctx = {}; // repo・files・engine・registry・secrets・log・jobs・scheduler

function ensureDirs(userData) {
  for (const d of ['work', 'logs', 'recipes', 'debug', 'backups', 'pw-browsers']) mkdirSync(path.join(userData, d), {recursive: true});
}

// 読み込み前の窓の色。設定のテーマ（なければ OS）に合わせ、暗い配色で白く光らないようにする（tokens.css の --paper）
function windowBackground() {
  const theme = ctx.repo?.getSetting('ui.theme', 'system') ?? 'system';
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#1F2430' : '#FBF8F1';
}

function openWindow(route = null) {
  if (win && !win.isDestroyed()) {
    if (route) win.webContents.send('route', route);
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: '大学ノート',
    autoHideMenuBar: true,
    backgroundColor: windowBackground(),
    webPreferences: {preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false}
  });
  win.loadFile(RENDERER, route ? {hash: route} : undefined);
  // ほかのサイトへは移動しない。リンクは既定のブラウザで
  win.webContents.setWindowOpenHandler(({url}) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return {action: 'deny'};
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  // 右クリックのメニュー：入力欄では切り取り・コピー・貼り付け・すべて選択、選んだ文字ではコピー
  win.webContents.on('context-menu', (_e, params) => {
    const menu = editContextMenu(params);
    if (menu) menu.popup({window: win});
  });
  win.on('closed', () => (win = null));
}

/** 右クリックのメニュー（Electron は既定では出さない）。出すものがなければ null */
function editContextMenu({isEditable, selectionText, editFlags}) {
  if (isEditable)
    return Menu.buildFromTemplate([
      {role: 'undo', label: '取り消す', enabled: editFlags.canUndo},
      {role: 'redo', label: 'やり直す', enabled: editFlags.canRedo},
      {type: 'separator'},
      {role: 'cut', label: '切り取り', enabled: editFlags.canCut},
      {role: 'copy', label: 'コピー', enabled: editFlags.canCopy},
      {role: 'paste', label: '貼り付け', enabled: editFlags.canPaste},
      {type: 'separator'},
      {role: 'selectAll', label: 'すべて選択', enabled: editFlags.canSelectAll}
    ]);
  if (selectionText?.trim()) return Menu.buildFromTemplate([{role: 'copy', label: 'コピー'}]);
  return null;
}

/**
 * アプリのメニュー。macOS では、ここに「編集」がないと ⌘C・⌘V・⌘X・⌘A が入力欄で効かない。
 * Electron の既定のメニューに頼らず、はっきり作る（名前も「Electron」ではなく「大学ノート」に）
 */
function buildAppMenu() {
  const mac = process.platform === 'darwin';
  const zoom = (dir) => (_item, w) => w?.webContents.send('zoom', dir);
  const template = [
    ...(mac
      ? [
          {
            label: '大学ノート',
            submenu: [
              {role: 'about', label: '大学ノートについて'},
              {type: 'separator'},
              {label: '設定…', accelerator: 'Cmd+,', click: () => openWindow('/settings')},
              {type: 'separator'},
              {role: 'hide', label: '大学ノートを隠す'},
              {role: 'hideOthers', label: 'ほかを隠す'},
              {role: 'unhide', label: 'すべて表示'},
              {type: 'separator'},
              {role: 'quit', label: '大学ノートを終了'}
            ]
          }
        ]
      : [{label: 'ファイル', submenu: [{label: '設定', accelerator: 'Ctrl+,', click: () => openWindow('/settings')}, {type: 'separator'}, {role: 'quit', label: '終了'}]}]),
    {
      label: '編集',
      submenu: [
        {role: 'undo', label: '取り消す'},
        {role: 'redo', label: 'やり直す'},
        {type: 'separator'},
        {role: 'cut', label: '切り取り'},
        {role: 'copy', label: 'コピー'},
        {role: 'paste', label: '貼り付け'},
        {role: 'pasteAndMatchStyle', label: 'ペーストしてスタイルを合わせる'},
        {role: 'selectAll', label: 'すべて選択'}
      ]
    },
    {
      label: '表示',
      submenu: [
        {role: 'reload', label: '再読み込み'},
        {role: 'toggleDevTools', label: '開発者ツール'},
        {type: 'separator'},
        // 拡大・縮小は画面に任せる（PDF の編集画面では PDF だけを拡大し、ツールバーや背景は拡大しない。app.js）
        {label: '実際のサイズ', accelerator: 'CmdOrCtrl+0', click: zoom('reset')},
        {label: '拡大', accelerator: 'CmdOrCtrl+Plus', click: zoom('in')},
        {label: '拡大', accelerator: 'CmdOrCtrl+=', click: zoom('in'), visible: false, acceleratorWorksWhenHidden: true},
        {label: '拡大', accelerator: 'CmdOrCtrl+;', click: zoom('in'), visible: false, acceleratorWorksWhenHidden: true}, // JIS キーボードの「＋」のキー
        {label: '縮小', accelerator: 'CmdOrCtrl+-', click: zoom('out')},
        {type: 'separator'},
        {role: 'togglefullscreen', label: 'フルスクリーン'}
      ]
    },
    {role: 'windowMenu', label: 'ウインドウ'}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(here, '..', 'renderer', 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  const refresh = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {label: '大学ノートを開く', click: () => openWindow()},
        {label: '今すぐ同期', click: () => ctx.jobs.enqueue('sync', {})},
        {label: '資料のフォルダを開く', click: () => shell.openPath(ctx.rootDir())},
        {type: 'separator'},
        {label: '設定', click: () => openWindow('/settings')},
        ...(ctx.updater?.menuItems() ?? []),
        {label: ctx.status ?? '', enabled: false},
        {label: `バージョン ${app.getVersion()}`, enabled: false},
        {type: 'separator'},
        {label: '終了', click: () => app.quit()}
      ])
    );
  refresh();
  tray.setToolTip('大学ノート');
  tray.on('click', () => openWindow());
  ctx.refreshTray = refresh;
}

app.whenReady().then(async () => {
  if (!primary) return;
  const userData = app.getPath('userData');
  ensureDirs(userData);
  const log = createLogger(path.join(userData, 'logs'));
  ctx.log = log;
  try {
    const {db} = await openDatabase(path.join(userData, 'daigaku-note.sqlite'));
    const repo = new Repo(db);
    ctx.repo = repo;
    ctx.secrets = createSecrets(path.join(userData, 'secrets.json'), log);
    ctx.rootDir = () => repo.getSetting('storage.root') || defaultRoot(app.getPath('desktop'));
    ctx.files = new FileManager({
      repo,
      root: ctx.rootDir,
      trash: (f) => shell.trashItem(f),
      quarantine: createQuarantine(),
      log: (m) => log.info(m)
    });
    // Playwright：Chromium は userData/pw-browsers に初回起動時に取り込む（§8.5）。取り込みは M0 後半の browser/install.js
    ctx.session = createBrowserSession({secrets: ctx.secrets, log: (m) => log.info(m), browsersPath: path.join(userData, 'pw-browsers')});
    ctx.registry = createRegistry({
      secrets: ctx.secrets,
      log: (m) => log.info(m),
      recipes: loadRecipes([path.join(here, '..', '..', 'recipes'), path.join(userData, 'recipes')]),
      recipeExecutorFactory: (recipe) => createRecipeExecutor(recipe, {session: ctx.session, secrets: ctx.secrets, log: (m) => log.info(m), debug: {dir: path.join(userData, 'debug')}})
    });
    ctx.folders = createFolders({repo, rootDir: () => ctx.rootDir(), log: (m) => log.info(m)});
    ctx.engine = new SyncEngine({
      repo,
      files: ctx.files,
      log: (m) => log.info(m),
      onProgress: (p) => win?.webContents.send('sync.progress', p)
    });
    // 同じ LMS の接続が 2 つ以上あれば 1 つにまとめる（セットアップのやり直しで増え、授業が 2 つずつ並んでいた）
    await ctx.engine
      .mergeDuplicateConnections()
      .then((r) => r.merged && log.info(`同じ LMS の接続を ${r.merged} 件まとめ、重なった授業 ${r.removedCourses} 件を 1 つにしました`))
      .catch((e) => log.error(`接続をまとめられませんでした: ${e.message}`));
    ctx.jobs = new JobRunner(ctx, {notify: (ch, payload) => win?.webContents.send(ch, payload)});
    ctx.scheduler = new Scheduler(ctx);
    ctx.quiz = createQuizService({repo, secrets: ctx.secrets, log: (m) => log.info(m), notify: (ch, payload) => win?.webContents.send(ch, payload)});
    registerIpc(ctx, {openWindow, getWindow: () => win});
    buildAppMenu();
    buildTray();
    // アプリの自動更新（SPEC §14.5）。更新のために終了するときは「処理中ですが終了しますか」を出さない
    ctx.updater = createUpdater({app, dialog, shell, net, refreshTray: () => ctx.refreshTray?.(), allowQuit: () => (ctx.quitConfirmed = true)});
    ctx.updater.start().catch((e) => log.warn(`更新の確認を始められません: ${e.message}`));
    const connections = repo.listConnections();
    // LMS の登録は任意。つないでいなくても、セットアップを一度飛ばしたか自分のフォルダがあればホームを開く
    openWindow(connections.length || repo.getSetting('setup.skipped') || repo.listCourses().length ? null : '/setup');
    ctx.scheduler.start();
    // Chromium の取り込みが終わるまでジョブは待つ（画面操作型の接続がなくても、あとで追加できるよう先に用意する）
    ctx.browser = {state: 'pending', message: ''};
    ctx.installBrowser = () =>
      ensureChromium(path.join(userData, 'pw-browsers'), {
        onStatus: (s) => {
          ctx.status = s;
          ctx.refreshTray?.();
          win?.webContents.send('state.changed', {status: s});
        },
        log: (m) => log.info(m)
      })
        .then((r) => {
          ctx.browser = {state: 'ready', message: ''};
          log.info(`Chromium の用意ができました（${r}）`);
        })
        .catch((e) => {
          ctx.browser = {state: 'failed', message: e.message};
          log.error(`Chromium の取り込みに失敗: ${e.message}`);
        })
        .finally(() => {
          // 起動したとき（更新のあとも）は、同期の予定を待たずにログインまで済ませる
          ctx.jobs.enqueue('login', {});
          ctx.jobs.start();
          win?.webContents.send('state.changed', {browser: ctx.browser});
        });
    ctx.installBrowser();
    log.info(`起動 ${app.getVersion()}（データ: ${userData}）`);
  } catch (e) {
    log.error(`起動に失敗: ${e.stack || e.message}`);
    dialog.showErrorBox('大学ノート', `起動できませんでした。\n${e.message}`);
    app.quit();
  }
});

app.on('second-instance', (_e, _argv, _cwd, data) => {
  if (BUILD && data?.build && data.build !== BUILD) {
    ctx.log?.info('新しいコードで起動し直します（npm start のやり直し）');
    app.relaunch();
    app.exit(0);
    return;
  }
  openWindow();
});
app.on('activate', () => openWindow());
app.on('window-all-closed', () => {
  /* 常駐するので終了しない */
});
app.on('before-quit', (e) => {
  if (ctx.jobs?.running && !ctx.quitConfirmed) {
    e.preventDefault();
    dialog
      .showMessageBox({type: 'question', buttons: ['終了する', 'キャンセル'], defaultId: 1, message: '同期などの処理中です。終了しますか？'})
      .then(({response}) => {
        if (response === 0) {
          ctx.quitConfirmed = true;
          app.quit();
        }
      });
    return;
  }
  ctx.scheduler?.stop();
  ctx.updater?.stop();
  ctx.jobs?.stop();
  ctx.session?.shutdown();
});

export const __test = {existsSync};
