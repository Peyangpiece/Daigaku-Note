// パレットノート メインプロセスの入口（DESIGN-M0 §3）。常駐・トレイ・窓・起動手順。
// M0 の骨格：DB・設定・ジョブ・スケジューラ・IPC をつなぐ。LMS 操作とファイル操作はここ（メイン）だけで行う。
import {app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, nativeTheme, net, shell} from 'electron';
import {existsSync, mkdirSync, readdirSync, statSync, promises as fsp} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {openDatabase} from './db/db.js';
import {syncRoundDates} from './terms.js';
import {Repo} from './db/repo.js';
import {createSecrets} from './secrets.js';
import {createLogger} from './log.js';
import {registerIpc} from './ipc/index.js';
import {createDevices} from './mobile/devices.js';
import {createMobileApi} from './mobile/api.js';
import {sendMain, setPadTap} from './frames.js';
import {createMobileServer, lanAddresses} from './mobile/server.js';
import {createPadApi, createPadHub} from './mobile/pad.js';
import {certFor} from './mobile/tls-cert.js';
import {JobRunner} from './jobs.js';
import {Scheduler} from './scheduler.js';
import {FileManager} from './sync/files.js';
import {SyncEngine} from './sync/engine.js';
import {createRegistry, loadRecipes} from './connectors/index.js';
import {createRecipeExecutor} from './connectors/recipe-executor.js';
import {createBrowserSession} from './browser/session.js';
import {ensureChromium} from './browser/install.js';
import {createQuarantine} from './sync/quarantine.js';
import {LEGACY_NAME, defaultRoot} from '../shared/paths.js';
import {createUpdater} from './updater.js';
import {createFolders} from './folders.js';
import {createQuizService} from './quiz/service.js';
import {runSelfTest, selfTestPath} from './self-check.js';
import {applyStagedRestore, exportBackup, runBackup} from './backup.js';
import {readBase} from './pdf-save.js';
import {createCloud} from './cloud/index.js';
import {createNotifier} from './notify.js';
import {createImporter} from './import-watch.js';
import {asciiUserAgent} from './user-agent.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(here, '..', 'renderer', 'index.html');
const PRELOAD = path.join(here, '..', 'preload', 'preload.js');

/**
 * 開発中（npm start）のコードの版：src の中でいちばん新しい更新時刻。配布物では使わない。
 * パレットノートは窓を閉じても常駐するので、git pull のあとに npm start しても古いほうが動き続けていた。
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

// 配布物の動作確認（--self-test=<結果のパス>）。窓は開かず、確かめて終わる（self-check.js）
// 名前を「パレットノート」に変えた（v0.18.0）。データのフォルダ（userData）は名前から決まるので、前の名前のフォルダが
// あればそのまま使う（変わると、授業・ノート・設定が見えなくなる）。新しく入れた人は「パレットノート」。
// --user-data-dir で場所を指したとき（テストなど）は触らない。1 つだけ起動する仕組み（下）が userData を使うので、その前に決める
const LEGACY_DATA = path.join(app.getPath('appData'), LEGACY_NAME);
const fromLegacy = !app.commandLine.hasSwitch('user-data-dir') && existsSync(LEGACY_DATA);
if (fromLegacy) app.setPath('userData', LEGACY_DATA);

const SELF_TEST = selfTestPath();

// 通信の名乗りを英字だけにする（日本語のアプリ名が入ると、GitHub から更新の .dmg を取れなかった。user-agent.js）
app.userAgentFallback = asciiUserAgent(app.userAgentFallback);

// 2 つ目の起動はすぐに終わる（app.quit() は非同期で、そのまま起動の処理が進んでデータベースまで開いていた）
const primary = SELF_TEST ? false : app.requestSingleInstanceLock({build: BUILD});
if (!primary && !SELF_TEST) app.exit(0);

let win = null,
  tray = null;
const ctx = {}; // repo・files・engine・registry・secrets・log・jobs・scheduler

function ensureDirs(userData) {
  for (const d of ['work', 'logs', 'recipes', 'debug', 'backups', 'pw-browsers'])
    mkdirSync(path.join(userData, d), {recursive: true});
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
    minWidth: 640,
    minHeight: 640,
    title: 'パレットノート',
    autoHideMenuBar: true,
    backgroundColor: windowBackground(),
    // nodeIntegrationInSubFrames：PDF とノートを並べるとき（#/split）、左右の編集画面は窓の中の iframe（同じ index.html）。
    // その iframe にも preload（window.daigaku）を入れる。Node は入れない（sandbox のまま）。ほかのサイトは読み込まない（guardWindow）
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true
    }
  });
  win.loadFile(RENDERER, route ? {hash: route} : undefined);
  guardWindow(win);
  win.on('closed', () => {
    win = null;
  });
}

/** 窓の守り：ほかのサイト・ファイルへ移らない、右クリックのメニュー、画面のプロセスが落ちたら開き直す */
function guardWindow(w) {
  const win = w;
  // ほかのサイトへは移動しない。リンクは既定のブラウザで
  win.webContents.setWindowOpenHandler(({url}) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return {action: 'deny'};
  });
  // 移れるのはアプリ自身の画面（index.html。# の後ろは画面の中の経路）だけ。ほかのファイルへも移らない
  // （日本語の入ったパスの書き方の違いで外れないよう、%xx を戻して比べる）
  const plain = (u) => {
    try {
      return decodeURI(String(u).split(/[?#]/)[0]); // ? の後ろ（並べた画面の pane=embed）と # の後ろは比べない
    } catch {
      return String(u).split(/[?#]/)[0];
    }
  };
  const home = plain(pathToFileURL(RENDERER).href);
  win.webContents.on('will-navigate', (e, url) => {
    if (plain(url) !== home) e.preventDefault();
  });
  // 窓の中の iframe（PDF とノートを並べた左右の画面）も、アプリ自身の画面だけ
  win.webContents.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && plain(e.url) !== home) e.preventDefault();
  });
  // 右クリックのメニュー：入力欄では切り取り・コピー・貼り付け・すべて選択、選んだ文字ではコピー
  win.webContents.on('context-menu', (_e, params) => {
    const menu = editContextMenu(params);
    if (menu) menu.popup({window: win});
  });
  // 画面のプロセスが落ちたら、記録して開き直す（白い窓のまま止まらないように）
  win.webContents.on('render-process-gone', (_e, d) => {
    ctx.log?.error(`画面が落ちました: ${d.reason}（${d.exitCode}）`);
    if (d.reason !== 'clean-exit' && d.reason !== 'killed' && win && !win.isDestroyed()) win.reload();
  });
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
 * Electron の既定のメニューに頼らず、はっきり作る（名前も「Electron」ではなく「パレットノート」に）
 */
function buildAppMenu() {
  const mac = process.platform === 'darwin';
  const zoom = (dir) => (_item, w) => w?.webContents.send('zoom', dir);
  const template = [
    ...(mac
      ? [
          {
            label: 'パレットノート',
            submenu: [
              {role: 'about', label: 'パレットノートについて'},
              {type: 'separator'},
              {label: '設定…', accelerator: 'Cmd+,', click: () => openWindow('/settings')},
              {type: 'separator'},
              {role: 'hide', label: 'パレットノートを隠す'},
              {role: 'hideOthers', label: 'ほかを隠す'},
              {role: 'unhide', label: 'すべて表示'},
              {type: 'separator'},
              {role: 'quit', label: 'パレットノートを終了'}
            ]
          }
        ]
      : [
          {
            label: 'ファイル',
            submenu: [
              {label: '設定', accelerator: 'Ctrl+,', click: () => openWindow('/settings')},
              {type: 'separator'},
              {role: 'quit', label: '終了'}
            ]
          }
        ]),
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
        {role: 'reload', label: '再読み込み', accelerator: 'CmdOrCtrl+Shift+R'}, // ⌘R は PDF の編集画面の赤シートに使う
        {role: 'toggleDevTools', label: '開発者ツール'},
        {type: 'separator'},
        // 拡大・縮小は画面に任せる（PDF の編集画面では PDF だけを拡大し、ツールバーや背景は拡大しない。app.js）
        {label: '実際のサイズ', accelerator: 'CmdOrCtrl+0', click: zoom('reset')},
        {label: '拡大', accelerator: 'CmdOrCtrl+Plus', click: zoom('in')},
        {
          label: '拡大',
          accelerator: 'CmdOrCtrl+=',
          click: zoom('in'),
          visible: false,
          acceleratorWorksWhenHidden: true
        },
        {
          label: '拡大',
          accelerator: 'CmdOrCtrl+;',
          click: zoom('in'),
          visible: false,
          acceleratorWorksWhenHidden: true
        }, // JIS キーボードの「＋」のキー
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
  const icon = nativeImage.createFromPath(
    path.join(here, '..', 'renderer', 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png')
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  const refresh = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {label: 'パレットノートを開く', click: () => openWindow()},
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
  tray.setToolTip('パレットノート');
  tray.on('click', () => openWindow());
  ctx.refreshTray = refresh;
}

app.whenReady().then(async () => {
  if (SELF_TEST) return runSelfTest(SELF_TEST);
  if (!primary) return;
  const userData = app.getPath('userData');
  ensureDirs(userData);
  const log = createLogger(path.join(userData, 'logs'));
  ctx.log = log;
  // 捕まえ損ねた例外・Promise の失敗は、黙って止まらず記録する（知らせは 1 回だけ。続けて出して邪魔しない）
  let told = false;
  process.on('uncaughtException', (e) => {
    log.error(`捕まえていない例外: ${e?.stack || e}`);
    if (!told) {
      told = true;
      dialog.showErrorBox(
        'パレットノート',
        `内部で問題が起きました。続けて使えますが、おかしければ開き直してください。\n${e?.message ?? e}`
      );
    }
  });
  process.on('unhandledRejection', (e) => log.error(`処理の失敗を受け取っていません: ${e?.stack || e}`));
  try {
    const dbFile = path.join(userData, 'daigaku-note.sqlite');
    // 設定 → データ の「読み込む」で選んだバックアップがあれば、ここで入れ替える（いまのものは before-restore として残す）
    if (applyStagedRestore({userData, dbFile}))
      log.info('バックアップを読み込みました（前のデータベースは before-restore として残しています）');
    const {db} = await openDatabase(dbFile);
    ctx.db = db;
    const repo = new Repo(db);
    ctx.repo = repo;
    // 回の日付を学期の設定（学年暦の授業回・休講日・振替授業日）にそろえる（前の版の計算で入った日付を直す）
    const redated = syncRoundDates(repo);
    if (redated) log.info(`回の日付を ${redated} 件、学年暦に合わせました`);
    ctx.secrets = createSecrets(path.join(userData, 'secrets.json'), log);
    // 前の名前のときに既定の保存先（デスクトップ/大学ノート）を使っていた人は、そのフォルダを保存先として覚える（v0.18.0）
    if (fromLegacy && !repo.getSetting('storage.root', null)) {
      const old = path.join(app.getPath('desktop'), LEGACY_NAME);
      if (existsSync(old)) {
        repo.setSetting('storage.root', old);
        log.info(`保存先を前の名前のフォルダのままにしました: ${old}`);
      }
    }
    ctx.rootDir = () => repo.getSetting('storage.root') || defaultRoot(app.getPath('desktop'));
    // Windows：名前を変えると実行ファイルの名前も変わる。ログイン時に開く設定が前の実行ファイルを指していたら、今のものに直す
    if (process.platform === 'win32') {
      try {
        const ls = app.getLoginItemSettings();
        const exe = path.basename(process.execPath).toLowerCase();
        const stale = (ls.launchItems ?? []).some(
          (i) => i.enabled && i.path && path.basename(i.path).toLowerCase() !== exe
        );
        if (stale && !ls.executableWillLaunchAtLogin) app.setLoginItemSettings({openAtLogin: true});
      } catch (e) {
        log.warn(`ログイン時に開く設定を直せませんでした: ${e.message}`);
      }
    }
    ctx.files = new FileManager({
      repo,
      root: ctx.rootDir,
      trash: (f) => shell.trashItem(f),
      quarantine: createQuarantine(),
      log: (m) => log.info(m)
    });
    // Playwright：Chromium は userData/pw-browsers に初回起動時に取り込む（§8.5）。取り込みは M0 後半の browser/install.js
    ctx.session = createBrowserSession({
      secrets: ctx.secrets,
      log: (m) => log.info(m),
      browsersPath: path.join(userData, 'pw-browsers')
    });
    ctx.registry = createRegistry({
      secrets: ctx.secrets,
      log: (m) => log.info(m),
      // レシピは同梱のものだけ読む。userData/recipes の更新は、署名の検証（SPEC §6.15）ができるまで読まない
      recipes: loadRecipes([path.join(here, '..', '..', 'recipes')]),
      recipeExecutorFactory: (recipe) =>
        createRecipeExecutor(recipe, {
          session: ctx.session,
          secrets: ctx.secrets,
          log: (m) => log.info(m),
          debug: {dir: path.join(userData, 'debug')}
        })
    });
    try {
      if (readdirSync(path.join(userData, 'recipes')).some((f) => f.endsWith('.json')))
        log.warn('userData/recipes のレシピは、署名の検証ができるまで読みません（同梱のレシピだけを使います）');
    } catch {
      /* フォルダがなければ何もしない */
    }
    ctx.folders = createFolders({repo, rootDir: () => ctx.rootDir(), log: (m) => log.info(m)});
    ctx.engine = new SyncEngine({
      repo,
      files: ctx.files,
      log: (m) => log.info(m),
      onProgress: (p) => sendMain(win?.webContents, 'sync.progress', p)
    });
    // 同じ LMS の接続が 2 つ以上あれば 1 つにまとめる（セットアップのやり直しで増え、授業が 2 つずつ並んでいた）
    await ctx.engine
      .mergeDuplicateConnections()
      .then(
        (r) =>
          r.merged &&
          log.info(`同じ LMS の接続を ${r.merged} 件まとめ、重なった授業 ${r.removedCourses} 件を 1 つにしました`)
      )
      .catch((e) => log.error(`接続をまとめられませんでした: ${e.message}`));
    // 接続を消してつなぎ直したときに 2 つずつできた授業を 1 つにし、結び付きが外れた授業をつなぎ直す（v0.18.10）
    await ctx.engine
      .adoptOrphanCourses()
      .then(
        (r) =>
          r.adopted &&
          log.info(`前の授業 ${r.adopted} 件をつなぎ直し、重なった授業 ${r.removedCourses} 件を 1 つにしました`)
      )
      .catch((e) => log.error(`前の授業をつなぎ直せませんでした: ${e.message}`));
    // レンダラへの知らせ。窓が前面になくても分かるよう、新しい資料・ログインの必要・クイズの完成・同期の失敗は OS の通知にも出す（notify.js）
    const notifier = createNotifier({repo, Notification, openWindow, log: (m) => log.warn(m)});
    ctx.notifier = notifier; // スケジューラの「今日の復習」の知らせ（§12.1）
    const notify = (ch, payload) => {
      sendMain(win?.webContents, ch, payload);
      notifier.onEvent(ch, payload);
    };
    ctx.backup = async () => runBackup({db, dir: path.join(userData, 'backups')});
    ctx.jobs = new JobRunner(ctx, {notify});
    ctx.scheduler = new Scheduler(ctx);
    ctx.quiz = createQuizService({repo, secrets: ctx.secrets, log: (m) => log.info(m), notify});
    // 授業資料の自動取り込み（ダウンロード・取り込みフォルダの見張り。設定でオンにしたときだけ。import-watch.js）
    ctx.importer = createImporter({
      repo,
      files: ctx.files,
      folders: ctx.folders,
      rootDir: () => ctx.rootDir(),
      downloadsDir: () => app.getPath('downloads'),
      notify: (ch, payload) => {
        notify(ch, payload);
        sendMain(win?.webContents, 'state.changed', {});
      },
      log: (m) => log.info(m)
    });
    ctx.importer.refresh().catch((e) => log.warn(`取り込みの見張りを始められませんでした: ${e.message}`));
    registerIpc(ctx, {getWindow: () => win});
    // Google ドライブでそろえる（docs/SYNC.md）。連携しているあいだは 30 分ごとに変わったものを送る
    ctx.cloud = createCloud({
      repo,
      secrets: ctx.secrets,
      exportDb: (file) => exportBackup(ctx.db, file),
      materials: () => repo.listMaterialsAll(),
      readMaterial: async (m) =>
        /\.pdf$/i.test(m.path) ? (await readBase(m, path.join(userData, 'originals'))).bytes : fsp.readFile(m.path),
      userData,
      openExternal: (url) => shell.openExternal(url),
      log: (m) => log.info(m)
    });
    ctx.cloud.start();
    // スマホ連携（docs/MOBILE.md）。オンにしてあれば、同じ Wi-Fi のスマホに向けて始める
    {
      const devices = createDevices({repo, secrets: ctx.secrets});
      const api = createMobileApi({
        handlers: ctx.handlers,
        repo,
        scan: ctx.scanRelay,
        getWindow: () => win,
        broadcast: (ch, payload) => ctx.notifyOthers(null, ch, payload)
      });
      // パソコンと同じ画面（iPad。docs/MOBILE.md §8）：パソコンの画面の窓口を通し、画面への知らせを iPad にも渡す
      const padHub = createPadHub();
      setPadTap((ch, payload, except) => padHub.push(ch, payload, except));
      const pad = createPadApi({handlers: ctx.handlers, ctx, repo, hub: padHub, log: (m) => log.info(m)});
      const server = createMobileServer({
        devices,
        api,
        pad,
        // https の証明書（スマホのブラウザでカメラを使う）。秘密の鍵は秘密の保管（secrets.js）に置く
        tls: async () => {
          const old = await ctx.secrets.get('mobile.tls').catch(() => null);
          const r = certFor(lanAddresses(), old);
          if (r.save) await ctx.secrets.set('mobile.tls', r.save).catch(() => {});
          return {key: r.key, cert: r.cert};
        },
        log: (m) => log.info(m),
        // 前と違う所・ブラウザからつながった：本人でなければ鍵を盗まれたおそれがあるので知らせる（段階 1 の暫定の見張り）
        onMoved: (d) =>
          notifier.show({
            title: 'スマホが前と違う所からつながりました',
            body: `${d.name}：${d.uaChanged ? 'ブラウザが変わりました' : `${d.from} → ${d.to}`}。心当たりがなければ、設定 → スマホとつなぐ で外してください`,
            route: '/settings',
            oncePerDay: `mobile-moved:${d.id}:${d.to}`
          })
      });
      ctx.mobile = {devices, api, server, padHub};
      if (repo.getSetting('mobile.enabled', false))
        server.start().catch((e) => log.warn(`スマホ連携を始められませんでした：${e.message}`));
    }
    buildAppMenu();
    buildTray();
    // アプリの自動更新（SPEC §14.5）。更新のために終了するときは「処理中ですが終了しますか」を出さない
    ctx.updater = createUpdater({
      app,
      dialog,
      shell,
      net,
      refreshTray: () => ctx.refreshTray?.(),
      allowQuit: () => (ctx.quitConfirmed = true)
    });
    ctx.updater.start().catch((e) => log.warn(`更新の確認を始められません: ${e.message}`));
    const connections = repo.listConnections();
    // LMS の登録は任意。つないでいなくても、セットアップを一度飛ばしたか自分のフォルダがあればホームを開く
    openWindow(connections.length || repo.getSetting('setup.skipped') || repo.listCourses().length ? null : '/setup');
    ctx.scheduler.start();
    // Chromium の取り込みが終わるまでジョブは待つ
    ctx.browser = {state: 'pending', message: ''};
    ctx.installBrowser = () =>
      ensureChromium(path.join(userData, 'pw-browsers'), {
        onStatus: (s) => {
          ctx.status = s;
          ctx.refreshTray?.();
          sendMain(win?.webContents, 'state.changed', {status: s});
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
          sendMain(win?.webContents, 'state.changed', {browser: ctx.browser});
        });
    // Chromium（約 150 MB）は LMS をつないでいるときだけ取り込む。つないでいなければ、つないだとき（ipc.js の setup.createConnection）に取り込む
    if (connections.length) ctx.installBrowser();
    else {
      ctx.browser = {state: 'none', message: ''};
      ctx.jobs.start();
    }
    log.info(`起動 ${app.getVersion()}（データ: ${userData}）`);
  } catch (e) {
    log.error(`起動に失敗: ${e.stack || e.message}`);
    dialog.showErrorBox('パレットノート', `起動できませんでした。\n${e.message}`);
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
// 画面が終了・再読み込みを止めたとき（着せ替えの「作る」画面の保存していない変更など）。前は何も出さずに止まり、
// 自動更新の終了まで止まって入れ替えられなかった（0.18.1 → 0.18.3）。保存せずに閉じるかを聞く（v0.18.4）
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-prevent-unload', (ev) => {
    const updating = ctx.updater?.replacing?.() ?? false;
    const owner = BrowserWindow.fromWebContents(wc);
    const r = dialog.showMessageBoxSync(...(owner ? [owner] : []), {
      type: 'question',
      buttons: ['保存せずに閉じる', 'キャンセル'],
      defaultId: 1,
      cancelId: 1,
      message: '保存していない変更があります',
      detail: updating
        ? '閉じると、新しい版に入れ替えます。キャンセルすると、入れ替えはあとでもう一度試します。'
        : '保存せずに閉じますか？'
    });
    if (r === 0)
      ev.preventDefault(); // 閉じる（変更は捨てる）
    else {
      ctx.quitConfirmed = false;
      if (updating) ctx.updater.postpone();
      ctx.log?.info('保存していない変更があるため、閉じるのをやめました');
    }
  });
});

app.on('window-all-closed', () => {
  /* 常駐するので終了しない */
});
app.on('before-quit', (e) => {
  if (ctx.jobs?.running && !ctx.quitConfirmed) {
    e.preventDefault();
    dialog
      .showMessageBox({
        type: 'question',
        buttons: ['終了する', 'キャンセル'],
        defaultId: 1,
        message: '同期などの処理中です。終了しますか？'
      })
      .then(({response}) => {
        if (response === 0) {
          ctx.quitConfirmed = true;
          app.quit();
        }
      });
    return;
  }
});
// 止めるのは、窓がすべて閉じて本当に終了するとき（before-quit の時点で止めると、画面が終了を止めたときに
// 同期・更新の確認などが止まったまま動き続けていた。v0.18.4）
app.on('will-quit', () => {
  ctx.scheduler?.stop();
  ctx.updater?.stop();
  ctx.jobs?.stop();
  ctx.session?.shutdown();
  ctx.mobile?.server.stop();
});

export const __test = {existsSync};
