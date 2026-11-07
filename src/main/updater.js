// アプリの自動更新（SPEC §14.5）。GitHub Releases（Peyangpiece/Daigaku-Note）の最新版を、起動時と 1 時間ごと、
// トレイの「新しい版を確認」で確かめる。配布物の版の情報（latest.yml・latest-mac.yml）は electron-updater が HTTPS で読む。
// - Windows：裏でダウンロードし、終わったら「再起動して更新」を聞く。「あとで」でも終了するときに入れ替わる
// - Mac：Apple の署名がないので electron-updater では入れ替えられない。「今すぐ更新」で .dmg を落として sha512 を確かめ、
//   パレットノートを終了してから入れ替え、開き直す（mac-update.js）。入れ替えられない場所にあれば .dmg を開いて手順を案内する
// 入れ替える前に「どの版になるはずか」を書いておき、次の起動で版が変わっていなければ失敗を知らせる
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  accessSync,
  appendFileSync,
  constants as fsConstants,
  createReadStream,
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
import https from 'node:https';
import path from 'node:path';
import {Readable} from 'node:stream';
import {
  downloadResumable,
  MAC_SIGNING_LEAF,
  MAC_TEAM_ID,
  developerIdRequirement,
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

  let replacer = null; // 入れ替えのスクリプト（アプリの終了を待っている）

  /**
   * 入れ替えをやめる（終了しないことになったとき。v0.18.4）。待っているスクリプトを止め、入れ替えの予定を消す。
   * 次の確認（1 時間ごと）でもう一度試す
   */
  function postpone() {
    if (!replacer) return false;
    try {
      replacer.kill();
    } catch {
      /* もう終わっている */
    }
    replacer = null;
    rmSync(expectFile, {force: true});
    log('WARN', '終了しないことになったため、入れ替えはあとでもう一度試します');
    return true;
  }

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
        ? `いまの版は ${app.getVersion()} のままです。ダウンロードのページから daigaku-note-${e.to}-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}.dmg を落として開き、パレットノートを終了してから「アプリケーション」へドラッグして入れ替えてください。資料と注釈はそのまま残ります。`
        : `いまの版は ${app.getVersion()} のままです。トレイのパレットノートから「終了」を選んでから、ダウンロードのページの daigaku-note-${e.to}-win-x64.exe を実行してください。資料と注釈はそのまま残ります。`
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
      message: `パレットノートの新しい版 ${version} の準備ができました`,
      detail: `いまの版は ${app.getVersion()} です。更新するとパレットノートがいったん閉じて、自動で開き直します。資料と注釈はそのまま残ります。「あとで」を選んでも、次にパレットノートを終了したときに入れ替わります。`
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
      message: `パレットノートの新しい版 ${version} があります`,
      detail: `いまの版は ${app.getVersion()} です。「今すぐ更新」を押すと、新しい版をダウンロードし、パレットノートをいったん終了して入れ替えてから、自動で開き直します（数分かかることがあります）。資料と注釈はそのまま残ります。あとで更新するときは、メニューバーのパレットノートから「新しい版 ${version} に更新」を選べます。`
    });
    if (r.response === 0) updateMac(version);
  }

  const sha512Of = async (f) => {
    const h = createHash('sha512');
    for await (const c of createReadStream(f)) h.update(c);
    return h.digest('base64');
  };

  /** Electron の net（Chromium の通信。HTTP/2）で取る。from > 0 なら続き（Range） */
  async function openNet(url, from) {
    const res = await net.fetch(url, from > 0 ? {headers: {Range: `bytes=${from}-`}} : {});
    return {
      status: res.status,
      length: Number(res.headers.get('content-length')) || 0,
      stream: res.body ? Readable.fromWeb(res.body) : Readable.from([])
    };
  }
  /** Node の https（HTTP/1.1）で取る。GitHub の配布物は別のホストへ転送するので、5 回までたどる */
  function openNode(url, from, hops = 0) {
    return new Promise((resolve, reject) => {
      const req = https.get(
        url,
        {headers: {'User-Agent': 'PaletteNote-Updater', ...(from > 0 ? {Range: `bytes=${from}-`} : {})}},
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) {
            res.resume();
            return resolve(openNode(new URL(res.headers.location, url).toString(), from, hops + 1));
          }
          resolve({status: res.statusCode, length: Number(res.headers['content-length']) || 0, stream: res});
        }
      );
      req.on('error', reject);
    });
  }

  /** .dmg を落とす。同じ名前のものが sha512 も合えばそれを使う。途中のものは .download で置き、確かめてから名前を変える */
  async function download(version, sha512) {
    mkdirSync(updatesDir, {recursive: true});
    const file = path.join(updatesDir, macInstallerName(version, process.arch));
    const part = `${file}.download`;
    if (existsSync(file)) {
      if ((await sha512Of(file)) === sha512) return file;
      rmSync(file, {force: true});
    }
    // 公開した直後の 400 や、途中で切れたとき（HTTP/2 の通信の誤りなど）は、間をあけて続きから取り直す。
    // 3 回目からは Node の https（HTTP/1.1）で取る。待っているあいだはメニューに「待っています」と出す
    const url = macInstallerUrl(version, process.arch);
    try {
      const {size} = await downloadResumable(
        ({attempt, from}) => (attempt < 2 ? openNet(url, from) : openNode(url, from)),
        part,
        {
          onWait: (n, ms, e) => {
            log(
              'INFO',
              `新しい版の配布物を取れません（${e.message}）。${Math.round(ms / 1000)} 秒後に取り直します（${n} 回目）`
            );
            if (state.downloading) {
              state.downloading.waiting = true;
              refreshTray();
            }
          },
          onProgress: (got, total) => {
            if (!state.downloading) return;
            state.downloading.waiting = false;
            const pct = total ? Math.floor((got / total) * 100) : null;
            if (pct !== state.downloading.pct) {
              state.downloading.pct = pct;
              refreshTray();
            }
          }
        }
      );
      if (!size) throw new Error('ダウンロードが空でした');
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
        detail: `${e.message}\nインターネットへの接続を確かめて、メニューバーのパレットノートから「新しい版 ${version} に更新」をもう一度お試しください。`
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
        replacer = spawn(
          '/bin/sh',
          [
            '-c',
            REPLACE_SCRIPT,
            'sh',
            String(process.pid),
            file,
            bundle,
            version,
            logFile,
            sha512,
            MAC_SIGNING_LEAF,
            developerIdRequirement(MAC_TEAM_ID)
          ],
          {
            detached: true,
            stdio: 'ignore'
          }
        );
        replacer.unref();
        allowQuit();
        app.quit();
        // 終了が止められたとき（保存していない変更の確かめで「キャンセル」など）は記録に残す（入れ替えは postpone で取りやめる）
        setTimeout(() => replacer && log('WARN', '終了が止められたため、まだ入れ替えていません'), 10000).unref();
        return;
      } catch (e) {
        log('ERROR', '入れ替えを始められません', e.message);
        rmSync(expectFile, {force: true});
      }
    } else log('INFO', `${bundle ?? app.getPath('exe')} は自動で入れ替えられない場所のため、手動の手順を案内します`);
    await shell.openPath(file);
    const r = await message({
      type: 'info',
      buttons: ['パレットノートを終了する', 'あとで'],
      defaultId: 0,
      cancelId: 1,
      message: `新しい版 ${version} をダウンロードしました`,
      detail:
        'パレットノートが「アプリケーション」フォルダの外にあるため、自動では入れ替えられません。開いたウインドウで、パレットノートのアイコンを「Applications」にドラッグしてください。入れ替える前にパレットノートを終了します。資料と注釈はそのまま残ります。'
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
                message: 'Microsoft Store のパレットノートは、Store が更新します',
                detail: 'Microsoft Store の「ライブラリ」から更新を確かめられます。'
              }
            : {
                type: 'info',
                message: '開発中のパレットノートは更新を確かめません',
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
        message({
          type: 'info',
          message: 'パレットノートは最新の版です',
          detail: `いまの版は ${app.getVersion()} です。`
        });
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
        label: state.downloading.waiting
          ? `新しい版 ${state.downloading.version} の準備を待っています…`
          : `新しい版 ${state.downloading.version} をダウンロード中${state.downloading.pct == null ? '…' : `（${state.downloading.pct}%）`}`,
        enabled: false
      });
    else if (isMac && state.newer && isNewer(state.newer, app.getVersion()))
      items.push({label: `新しい版 ${state.newer} に更新`, click: () => updateMac(state.newer)});
    if (!isMac && state.prepared) items.push({label: `再起動して ${state.prepared} に更新`, click: installNow});
    items.push({label: '新しい版を確認', click: () => check(true)});
    return items;
  }

  return {start, check, menuItems, stop: () => clearInterval(timer), logFile, postpone, replacing: () => !!replacer};
}
