// レンダラとの窓口（DESIGN-M0 §4）。handle は失敗を {error} に包んで返す。窓口は関心ごとに ipc/*.js に分かれ、ここが順に register する
import {BrowserWindow, ipcMain} from 'electron';
import {createSerial} from '../serial.js';
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

export function registerIpc(ctx, {getWindow = () => null} = {}) {
  const {repo, registry, jobs, files, secrets, log, folders} = ctx;
  // 窓口の中身はスマホ連携（mobile/api.js）からも呼ぶので、名前で引けるように持っておく
  const handlers = new Map();
  ctx.handlers = handlers;
  const handle = (channel, fn) => {
    handlers.set(channel, fn);
    return ipcMain.handle(channel, async (_e, arg) => {
      try {
        return await fn(arg ?? {}, _e);
      } catch (e) {
        log.warn(`ipc ${channel}: ${e.message}`);
        return {error: e.message};
      }
    });
  };
  // ほかの窓に知らせる（同じ資料を 2 つの窓で開いているとき。from は送ってきた窓の webContents。スマホからは from なし＝全部の窓）
  const notifyOthers = (from, channel, payload) => {
    for (const w of BrowserWindow.getAllWindows())
      if (!w.isDestroyed() && w.webContents !== from) w.webContents.send(channel, payload);
  };
  ctx.notifyOthers = notifyOthers;
  // ノートごとの順番待ち：ページの足し引き・描き直し・消す・上書き保存を重ねない（ipc/notes.js・ipc/pdf.js）
  ctx.noteSerial ??= createSerial();
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
    mobileIpc
  ])
    m.register(c);
}
