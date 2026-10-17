// 大学ノート メインプロセスの入口（DESIGN-M0 §3）。常駐・トレイ・窓・起動手順。
// M0 の骨格：DB・設定・ジョブ・スケジューラ・IPC をつなぐ。LMS 操作とファイル操作はここ（メイン）だけで行う。
import {app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell} from 'electron';
import {existsSync, mkdirSync} from 'node:fs';
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

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(here, '..', 'renderer', 'index.html');
const PRELOAD = path.join(here, '..', 'preload', 'preload.js');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null,
  tray = null;
const ctx = {}; // repo・files・engine・registry・secrets・log・jobs・scheduler

function ensureDirs(userData) {
  for (const d of ['work', 'logs', 'recipes', 'debug', 'backups', 'pw-browsers']) mkdirSync(path.join(userData, d), {recursive: true});
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
    backgroundColor: '#FBF8F1',
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
  win.on('closed', () => (win = null));
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
      recipeExecutorFactory: (recipe) => createRecipeExecutor(recipe, {session: ctx.session, secrets: ctx.secrets, log: (m) => log.info(m)})
    });
    ctx.engine = new SyncEngine({
      repo,
      files: ctx.files,
      log: (m) => log.info(m),
      onProgress: (p) => win?.webContents.send('sync.progress', p)
    });
    ctx.jobs = new JobRunner(ctx, {notify: (ch, payload) => win?.webContents.send(ch, payload)});
    ctx.scheduler = new Scheduler(ctx);
    registerIpc(ctx, {openWindow, getWindow: () => win});
    buildTray();
    const connections = repo.listConnections();
    openWindow(connections.length ? null : '/setup');
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

app.on('second-instance', () => openWindow());
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
  ctx.jobs?.stop();
  ctx.session?.shutdown();
});

export const __test = {existsSync};
