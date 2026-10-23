// アプリの自動更新（SPEC §14.5）。GitHub Releases（Peyangpiece/Daigaku-Note）の最新版を、起動時と 1 時間ごと、
// トレイの「新しい版を確認」で確かめる。配布物の版の情報（latest.yml・latest-mac.yml）は electron-updater が HTTPS で読む。
// - Windows：裏でダウンロードし、終わったら「再起動して更新」を聞く。「あとで」でも終了するときに入れ替わる
// - Mac：Apple の署名がないので electron-updater では入れ替えられない。「今すぐ更新」で .dmg を落として sha512 を確かめ、
//   大学ノートを終了してから入れ替え、開き直す（mac-update.js）。入れ替えられない場所にあれば .dmg を開いて手順を案内する
// 入れ替える前に「どの版になるはずか」を書いておき、次の起動で版が変わっていなければ失敗を知らせる
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  accessSync,
  appendFileSync,
  constants as fsConstants,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import {rename} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {
  MAC_SIGNING_LEAF,
  REPLACE_SCRIPT,
  appBundle,
  canReplace,
  installerDigest,
  isNewer,
  macInstallerName,
  macInstallerUrl
} from './mac-update.js';

const RELEASES_PAGE = 'https://github.com/Peyangpiece/Daigaku-Note/releases/latest';
const CHECK_EVERY = 60 * 60 * 1000;

/**
 * @param {object} deps
 * @param {import('electron').App} deps.app
 * @param {import('electron').Dialog} deps.dialog
 * @param {import('electron').Shell} deps.shell
 * @param {import('electron').Net} deps.net
 * @param {() => void} deps.refreshTray  トレイのメニューを作り直す
 * @param {() => void} deps.allowQuit    「処理中ですが終了しますか」を出さずに終了させる
 */
export function createUpdater({app, dialog, shell, net, refreshTray = () => {}, allowQuit = () => {}}) {
  const userData = app.getPath('userData');
  const logFile = path.join(userData, 'logs', 'updater.log');
  const expectFile = path.join(userData, 'update-expected.json');
  const seenFile = path.join(userData, 'update-notified.json');
  const updatesDir = path.join(userData, 'updates');
  const isMac = process.platform === 'darwin';
  const state = {newer: null, prepared: null, downloading: null, files: {}};
  let updater = null,
    timer = null;

  const log = (level, ...parts) => {
    try {
      mkdirSync(path.dirname(logFile), {recursive: true});
      if (existsSync(logFile) && statSync(logFile).size > 1e6) writeFileSync(logFile, '');
      appendFileSync(logFile, `${new Date().toISOString()} ${level.padEnd(5)} ${parts.map(String).join(' ')}\n`);
    } catch {
      /* 記録できなくても止めない */
    }
  };
  const readJson = (f) => {
    try {
      return JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      return null;
    }
  };
  const writeJson = (f, v) => {
    try {
      writeFileSync(f, JSON.stringify(v));
    } catch {
      /* 無視 */
    }
  };
  const message = (opts) => {
    app.focus?.({steal: true}); // 常駐アプリは前面にないので、案内がほかのアプリの裏に隠れないように
    return dialog.showMessageBox(opts);
  };

  function expectUpdate(version) {
    log('INFO', `${version} に入れ替えます（いまの版 ${app.getVersion()}）`);
    writeJson(expectFile, {from: app.getVersion(), to: version, at: new Date().toISOString()});
  }

  /** 前回「入れ替える」と書いた版になっているか。なっていなければ手動の手順を案内する */
  async function checkExpected() {
    const e = readJson(expectFile);
    if (!e) return;
    try {
      unlinkSync(expectFile);
    } catch {
      /* 無視 */
    }
    if (!e.to || !isNewer(e.to, app.getVersion())) return log('INFO', `${app.getVersion()} に入れ替わりました`);
    log('ERROR', `${e.to} に入れ替わっていません（いまの版 ${app.getVersion()}）`);
    const r = await message({
      type: 'warning',
      buttons: ['ダウンロードのページを開く', '更新の記録を開く', '閉じる'],
      defaultId: 0,
      cancelId: 2,
      message: `新しい版 ${e.to} に入れ替えられませんでした`,
      detail: isMac
        ? `いまの版は ${app.getVersion()} のままです。ダウンロードのページから daigaku-note-${e.to}-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}.dmg を落として開き、大学ノートを終了してから「アプリケーション」へドラッグして入れ替えてください。資料と注釈はそのまま残ります。`
        : `いまの版は ${app.getVersion()} のままです。トレイの大学ノートから「終了」を選んでから、ダウンロードのページの daigaku-note-${e.to}-win-x64.exe を実行してください。資料と注釈はそのまま残ります。`
    });
    if (r.response === 0) shell.openExternal(RELEASES_PAGE);
    else if (r.response === 1) shell.openPath(logFile);
  }

  /** 入れ終わった版の .dmg を片付ける（いまの版より新しいものは残す） */
  function cleanupDownloads() {
    try {
      for (const f of readdirSync(updatesDir)) {
        const v = f.match(/^daigaku-note-(\d+\.\d+\.\d+)-mac-/)?.[1];
        if (f.endsWith('.download') || (v && !isNewer(v, app.getVersion())))
          rmSync(path.join(updatesDir, f), {force: true});
      }
    } catch {
      /* フォルダがなければ何もしない */
    }
  }

  // ---- Windows ----
  async function offerInstall(version, manual = false) {
    if (!isNewer(version, app.getVersion())) return;
    state.prepared = version;
    refreshTray();
    if (!manual && readJson(seenFile)?.ready === version) return; // 版ごとに 1 回だけ聞く
    writeJson(seenFile, {ready: version});
    const r = await message({
      type: 'info',
      buttons: ['今すぐ再起動して更新', 'あとで'],
      defaultId: 0,
      cancelId: 1,
      message: `大学ノートの新しい版 ${version} の準備ができました`,
      detail: `いまの版は ${app.getVersion()} です。更新すると大学ノートがいったん閉じて、自動で開き直します。資料と注釈はそのまま残ります。「あとで」を選んでも、次に大学ノートを終了したときに入れ替わります。`
    });
    if (r.response === 0) installNow();
  }
  function installNow() {
    if (!state.prepared) return;
    expectUpdate(state.prepared);
    allowQuit();
    updater.quitAndInstall(false, true);
  }

  // ---- Mac ----
  async function announce(version, manual = false) {
    state.newer = version;
    refreshTray();
    if (!manual && readJson(seenFile)?.announced === version) return; // 版ごとに 1 回だけ聞く（あとはトレイから）
    writeJson(seenFile, {announced: version});
    const r = await message({
      type: 'info',
      buttons: ['今すぐ更新', 'あとで'],
      defaultId: 0,
      cancelId: 1,
      message: `大学ノートの新しい版 ${version} があります`,
      detail: `いまの版は ${app.getVersion()} です。「今すぐ更新」を押すと、新しい版をダウンロードし、大学ノートをいったん終了して入れ替えてから、自動で開き直します（数分かかることがあります）。資料と注釈はそのまま残ります。あとで更新するときは、メニューバーの大学ノートから「新しい版 ${version} に更新」を選べます。`
    });
    if (r.response === 0) updateMac(version);
  }

  const sha512Of = async (f) => {
    const h = createHash('sha512');
    for await (const c of createReadStream(f)) h.update(c);
    return h.digest('base64');
  };

  /** .dmg を落とす。同じ名前のものが sha512 も合えばそれを使う。途中のものは .download で置き、確かめてから名前を変える */
  async function download(version, sha512) {
    mkdirSync(updatesDir, {recursive: true});
    const file = path.join(updatesDir, macInstallerName(version, process.arch));
    const part = `${file}.download`;
    if (existsSync(file)) {
      if ((await sha512Of(file)) === sha512) return file;
      rmSync(file, {force: true});
    }
    const res = await net.fetch(macInstallerUrl(version, process.arch));
    if (!res.ok || !res.body) throw new Error(`ダウンロードできませんでした（${res.status}）`);
    const total = Number(res.headers.get('content-length')) || 0;
    let got = 0;
    try {
      await pipeline(
        Readable.fromWeb(res.body),
        async function* (src) {
          for await (const c of src) {
            got += c.length;
            const pct = total ? Math.floor((got / total) * 100) : null;
            if (state.downloading && pct !== state.downloading.pct) {
              state.downloading.pct = pct;
              refreshTray();
            }
            yield c;
          }
        },
        createWriteStream(part)
      );
      if (total && got !== total) throw new Error('ダウンロードが途中で切れました');
      if ((await sha512Of(part)) !== sha512) throw new Error('ダウンロードした .dmg が配布物と一致しません');
      await rename(part, file);
    } catch (e) {
      rmSync(part, {force: true});
      throw e;
    }
    return file;
  }

  async function updateMac(version) {
    if (state.downloading) return;
    const sha512 = installerDigest(state.files[version], macInstallerName(version, process.arch));
    state.downloading = {version, pct: null};
    refreshTray();
    let file;
    try {
      if (!sha512) throw new Error('配布物の情報に .dmg を確かめる値（sha512）がありません');
      file = await download(version, sha512);
      log('INFO', `${path.basename(file)} をダウンロードしました`);
    } catch (e) {
      log('ERROR', '新しい版をダウンロードできません', e.message);
      const r = await message({
        type: 'warning',
        buttons: ['ダウンロードのページを開く', '閉じる'],
        defaultId: 0,
        cancelId: 1,
        message: `新しい版 ${version} をダウンロードできませんでした`,
        detail: `${e.message}\nインターネットへの接続を確かめて、メニューバーの大学ノートから「新しい版 ${version} に更新」をもう一度お試しください。`
      });
      if (r.response === 0) shell.openExternal(RELEASES_PAGE);
      return;
    } finally {
      state.downloading = null;
      refreshTray();
    }
    const bundle = appBundle(app.getPath('exe'));
    const writable = (d) => {
      try {
        accessSync(d, fsConstants.W_OK);
        return true;
      } catch {
        return false;
      }
    };
    if (canReplace(bundle, writable)) {
      expectUpdate(version);
      try {
        spawn(
          '/bin/sh',
          ['-c', REPLACE_SCRIPT, 'sh', String(process.pid), file, bundle, version, logFile, sha512, MAC_SIGNING_LEAF],
          {
            detached: true,
            stdio: 'ignore'
          }
        ).unref();
        allowQuit();
        app.quit();
        return;
      } catch (e) {
        log('ERROR', '入れ替えを始められません', e.message);
        rmSync(expectFile, {force: true});
      }
    } else log('INFO', `${bundle ?? app.getPath('exe')} は自動で入れ替えられない場所のため、手動の手順を案内します`);
    await shell.openPath(file);
    const r = await message({
      type: 'info',
      buttons: ['大学ノートを終了する', 'あとで'],
      defaultId: 0,
      cancelId: 1,
      message: `新しい版 ${version} をダウンロードしました`,
      detail:
        '大学ノートが「アプリケーション」フォルダの外にあるため、自動では入れ替えられません。開いたウインドウで、大学ノートのアイコンを「Applications」にドラッグしてください。入れ替える前に大学ノートを終了します。資料と注釈はそのまま残ります。'
    });
    if (r.response === 0) {
      allowQuit();
      app.quit();
    }
  }

  // ---- 共通 ----
  async function check(manual = false) {
    if (!updater) {
      if (manual)
        message(
          process.windowsStore
            ? {
                type: 'info',
                message: 'Microsoft Store の大学ノートは、Store が更新します',
                detail: 'Microsoft Store の「ライブラリ」から更新を確かめられます。'
              }
            : {
                type: 'info',
                message: '開発中の大学ノートは更新を確かめません',
                detail: '配布物（.dmg・.exe）から入れたときに働きます。'
              }
        );
      return;
    }
    try {
      const r = await updater.checkForUpdates();
      r?.downloadPromise?.catch(() => {}); // 失敗は error のイベントで記録する
      const v = r?.updateInfo?.version;
      if (v && isNewer(v, app.getVersion())) {
        state.files[v] = r.updateInfo.files;
        if (isMac) await announce(v, manual);
        else if (manual && state.prepared === v) await offerInstall(v, true);
        else if (manual)
          message({
            type: 'info',
            message: `新しい版 ${v} をダウンロードしています`,
            detail: '終わったら、再起動して更新するかをお聞きします。'
          });
      } else if (manual)
        message({type: 'info', message: '大学ノートは最新の版です', detail: `いまの版は ${app.getVersion()} です。`});
    } catch (e) {
      log('WARN', '新しい版を確認できません', e.message);
      if (manual)
        message({
          type: 'warning',
          message: '新しい版を確認できませんでした',
          detail: String(e.message).split('\n')[0].slice(0, 200)
        });
    }
  }

  async function start() {
    cleanupDownloads();
    await checkExpected();
    if (!app.isPackaged) return log('INFO', '開発中のため更新を確かめません');
    // Microsoft Store の版（MSIX）は Store が更新する。自分で入れ替えると Store の版とずれる
    if (process.windowsStore) return log('INFO', 'Microsoft Store の版のため、更新は Store に任せます');
    const {default: pkg} = await import('electron-updater');
    updater = pkg.autoUpdater;
    updater.logger = {
      info: (m) => log('INFO', m),
      warn: (m) => log('WARN', m),
      error: (m) => log('ERROR', m),
      debug: () => {}
    };
    updater.on('error', (e) => log('ERROR', e?.message ?? e));
    if (isMac) updater.autoDownload = false;
    else updater.on('update-downloaded', (i) => offerInstall(i.version));
    check();
    timer = setInterval(() => check(), CHECK_EVERY);
  }

  /** トレイのメニューに足す項目 */
  function menuItems() {
    const items = [];
    if (state.downloading)
      items.push({
        label: `新しい版 ${state.downloading.version} をダウンロード中${state.downloading.pct == null ? '…' : `（${state.downloading.pct}%）`}`,
        enabled: false
      });
    else if (isMac && state.newer && isNewer(state.newer, app.getVersion()))
      items.push({label: `新しい版 ${state.newer} に更新`, click: () => updateMac(state.newer)});
    if (!isMac && state.prepared) items.push({label: `再起動して ${state.prepared} に更新`, click: installNow});
    items.push({label: '新しい版を確認', click: () => check(true)});
    return items;
  }

  return {start, check, menuItems, stop: () => clearInterval(timer), logFile};
}
