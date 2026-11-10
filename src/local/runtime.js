// iPad のアプリの中で、パソコンの窓口（src/main/ipc）を動かす（docs/SYNC.md §8）。
// データベースは sql.js（src/shared/sqljs-db.js）、ファイルは vfs.js、Electron と Node は shims/ の代わり。
// パソコンにしかないもの（LMS の同期・ブラウザ・フォルダの見張り・スマホ・Google との連携）は、ここでは用意しない
// （使えば「iPad ではできない」）。戻り：{repo, ctx, handlers}
import {Repo} from '../main/db/repo.js';
import {registerIpc} from '../main/ipc/index.js';
import {FileManager} from '../main/sync/files.js';
import {createFolders} from '../main/folders.js';
import {SqlJsDatabase} from '../shared/sqljs-db.js';

const NOT_HERE = 'この操作は iPad ではできません（パソコンで開いてください）';
const notHere = () => {
  throw new Error(NOT_HERE);
};

/** db：SqlJsDatabase（または bytes から作る）。onChange：データベースを変えた（保存する） */
export function startLocal({SQL, bytes, db = null, log = console, onChange = () => {}}) {
  const database = db ?? new SqlJsDatabase(SQL, bytes);
  database.exec('PRAGMA foreign_keys=ON;');
  const repo = new Repo(database);
  const logger = {info: (m) => log.info?.(m), warn: (m) => log.warn?.(m), error: (m) => log.error?.(m)};
  const ctx = {db: database, repo, log: logger};
  ctx.secrets = {get: async () => null, set: async () => {}, remove: async () => {}};
  ctx.rootDir = () => repo.getSetting('storage.root') || '/app/desktop/パレットノート';
  ctx.files = new FileManager({
    repo,
    root: ctx.rootDir,
    trash: async () => notHere(),
    quarantine: async () => {},
    log: (m) => logger.info(m)
  });
  ctx.folders = createFolders({repo, rootDir: () => ctx.rootDir(), log: (m) => logger.info(m)});
  // パソコンにしかないもの
  ctx.registry = {list: () => [], get: () => null, connectors: () => []};
  ctx.engine = {run: notHere, status: () => ({running: false})};
  ctx.jobs = {enqueue: notHere, list: () => [], status: () => ({})};
  ctx.importer = {list: () => [], scan: notHere};
  ctx.browser = {state: 'none', message: ''};
  ctx.quiz = null;
  ctx.local = true;
  registerIpc(ctx);
  // 窓口を呼ぶ（パソコンの ipcMain.handle と同じく、失敗は {error} で返す）。変えたら onChange
  const call = async (ch, arg, sender = null) => {
    const fn = ctx.handlers.get(ch);
    if (!fn) return {error: NOT_HERE};
    try {
      const r = await fn(arg ?? {}, sender ? {senderFrame: sender, sender} : undefined);
      onChange(ch, r);
      return r;
    } catch (e) {
      logger.warn(`local ${ch}: ${e.message}`);
      return {error: e.message};
    }
  };
  return {repo, ctx, handlers: ctx.handlers, call, db: database};
}
