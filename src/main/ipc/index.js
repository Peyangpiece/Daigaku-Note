// レンダラとの窓口（DESIGN-M0 §4）。handle は失敗を {error} に包んで返す。窓口は関心ごとに ipc/*.js に分かれ、ここが順に register する
import {BrowserWindow, ipcMain} from 'electron';
import {createSerial} from '../serial.js';
import {createScanRelay} from '../scan-relay.js';
import {sendAll, tapPad} from '../frames.js';
import {PAD_QUIET} from '../../shared/pad-channels.js';
import * as stateIpc from './state.js';
import * as connectionsIpc from './connections.js';
import * as termsIpc from './terms.js';
import * as skinsIpc from './skins.js';
import * as stationeryIpc from './stationery.js';
import * as materialsIpc from './materials.js';
import * as pdfIpc from './pdf.js';
import * as notesIpc from './notes.js';
import * as quizIpc from './quiz.js';
import * as settingsIpc from './settings.js';
import * as appIpc from './app.js';
import * as mobileIpc from './mobile.js';
import * as importsIpc from './imports.js';
import * as cloudIpc from './cloud.js';
import * as searchIpc from './search.js';

export function registerIpc(ctx, {getWindow = () => null} = {}) {
  const {repo, registry, jobs, files, secrets, log, folders} = ctx;
  // 窓口の中身はスマホ連携（mobile/api.js）からも呼ぶので、名前で引けるように持っておく
  const handlers = new Map();
  ctx.handlers = handlers;
  const handle = (channel, fn) => {
    handlers.set(channel, fn);
    return ipcMain.handle(channel, async (_e, arg) => {
      try {
        const r = await fn(arg ?? {}, _e);
        // パソコンの画面で変えた：パソコンと同じ画面の iPad に「変わった」を知らせる（docs/MOBILE.md §8）
        if (!PAD_QUIET.has(channel) && !r?.error) tapPad('state.changed', {});
        return r;
      } catch (e) {
        log.warn(`ipc ${channel}: ${e.message}`);
        return {error: e.message};
      }
    });
  };
  // ほかの画面に知らせる（同じ資料を窓の中の左右に並べて開いているときなど）。from は送ってきた画面（WebFrameMain。e.senderFrame）。
  // スマホからは from なし＝すべての窓のすべての画面
  const notifyOthers = (from, channel, payload) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) sendAll(w.webContents, channel, payload, from);
    tapPad(channel, payload, from);
  };
  ctx.notifyOthers = notifyOthers;
  // ノートごとの順番待ち：ページの足し引き・描き直し・消す・上書き保存を重ねない（ipc/notes.js・ipc/pdf.js）
  ctx.noteSerial ??= createSerial();
  // アナログノートをスマホで撮る：取り込みの窓とスマホの間の受け渡し（scan-relay.js）
  ctx.scanRelay ??= createScanRelay();
  const c = {handle, ctx, repo, registry, jobs, files, secrets, log, folders, getWindow, notifyOthers, quiz: ctx.quiz};
  for (const m of [
    stateIpc,
    connectionsIpc,
    termsIpc,
    skinsIpc,
    stationeryIpc,
    materialsIpc,
    pdfIpc,
    notesIpc,
    quizIpc,
    settingsIpc,
    appIpc,
    mobileIpc,
    importsIpc,
    cloudIpc,
    searchIpc
  ])
    m.register(c);
}
