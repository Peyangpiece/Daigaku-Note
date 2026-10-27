// レンダラとの窓口（DESIGN-M0 §4）。handle は失敗を {error} に包んで返す。窓口は関心ごとに ipc/*.js に分かれ、ここが順に register する
import {ipcMain} from 'electron';
import * as stateIpc from './state.js';
import * as connectionsIpc from './connections.js';
import * as termsIpc from './terms.js';
import * as skinsIpc from './skins.js';
import * as stationeryIpc from './stationery.js';
import * as materialsIpc from './materials.js';
import * as pdfIpc from './pdf.js';
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
        return await fn(arg ?? {});
      } catch (e) {
        log.warn(`ipc ${channel}: ${e.message}`);
        return {error: e.message};
      }
    });
  };
  const c = {handle, ctx, repo, registry, jobs, files, secrets, log, folders, getWindow, quiz: ctx.quiz};
  for (const m of [
    stateIpc,
    connectionsIpc,
    termsIpc,
    skinsIpc,
    stationeryIpc,
    materialsIpc,
    pdfIpc,
    quizIpc,
    settingsIpc,
    appIpc,
    mobileIpc
  ])
    m.register(c);
}
