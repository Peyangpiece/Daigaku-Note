// IPC の窓口：アプリとバックアップ（app.*・backup.*）。index.js が register を呼ぶ（SPEC §12・DESIGN-M0 §4）
import {dialog, shell, app} from 'electron';
import {promises as fsp} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {todayJst} from '../../shared/schedule.js';
import {exportBackup, stageRestore} from '../backup.js';
import {latestVersion} from '../db/db.js';

export function register({handle, ctx, log}) {
  // 設定の「情報」：第三者のライセンスの一覧（配布物の THIRD-PARTY-NOTICES.md）、データとログの場所を開く
  handle('app.notices', async () => ({
    text: await fsp.readFile(path.join(app.getAppPath(), 'THIRD-PARTY-NOTICES.md'), 'utf8')
  }));

  handle('app.openDataDir', async () => ({ok: !(await shell.openPath(app.getPath('userData')))}));

  handle('app.relaunch', () => {
    app.relaunch();
    app.exit(0);
    return {ok: true};
  });

  // 設定 → データ：バックアップの書き出し・読み込み（SPEC §12.3）。読み込みは次の起動で入れ替える（main.js の applyStagedRestore）
  handle('backup.export', async () => {
    const r = await dialog.showSaveDialog({
      title: 'バックアップを書き出す',
      defaultPath: path.join(app.getPath('documents'), `daigaku-note-${todayJst()}.sqlite`),
      filters: [{name: 'パレットノートのバックアップ', extensions: ['sqlite']}]
    });
    if (r.canceled || !r.filePath) return {ok: false};
    const out = exportBackup(ctx.db, r.filePath);
    log.info(`バックアップを書き出しました: ${out.file}（${out.size} バイト）`);
    return {ok: true, file: out.file, size: out.size};
  });

  const stage = async (src, label) => {
    const {DatabaseSync} = await import('node:sqlite');
    const staged = stageRestore({
      userData: app.getPath('userData'),
      src,
      open: (f) => new DatabaseSync(f, {readOnly: true}),
      maxVersion: latestVersion()
    });
    log.info(`バックアップの読み込みを予約しました: ${label}（版 ${staged.version}）。次の起動で入れ替えます`);
    return {ok: true, version: staged.version};
  };

  handle('backup.import', async () => {
    const r = await dialog.showOpenDialog({
      title: 'バックアップを読み込む',
      properties: ['openFile'],
      filters: [{name: 'パレットノートのバックアップ', extensions: ['sqlite']}]
    });
    if (r.canceled || !r.filePaths?.[0]) return {ok: false};
    return stage(r.filePaths[0], r.filePaths[0]);
  });

  // iPad（パソコンと同じ画面。docs/MOBILE.md §8）：保存・選ぶ窓を出さず、中身を渡す・受ける（iPad の側で保存する・選ぶ）
  const tempDir = () => fsp.mkdtemp(path.join(os.tmpdir(), 'palette-backup-'));
  ctx.backupExportData = async () => {
    const dir = await tempDir();
    try {
      const name = `daigaku-note-${todayJst()}.sqlite`;
      const out = exportBackup(ctx.db, path.join(dir, name));
      log.info(`バックアップを iPad へ書き出しました（${out.size} バイト）`);
      return {ok: true, name, bytes: new Uint8Array(await fsp.readFile(out.file))};
    } finally {
      await fsp.rm(dir, {recursive: true, force: true}).catch(() => {});
    }
  };
  ctx.backupImportData = async ({bytes}) => {
    if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('ファイルの中身が不正です');
    const dir = await tempDir();
    try {
      const file = path.join(dir, 'restore.sqlite');
      await fsp.writeFile(file, bytes);
      return await stage(file, 'iPad から受け取ったファイル');
    } finally {
      await fsp.rm(dir, {recursive: true, force: true}).catch(() => {});
    }
  };

  handle('backup.openDir', async () => ({
    ok: !(await shell.openPath(path.join(app.getPath('userData'), 'backups')))
  }));

  handle('app.openLogs', async () => ({ok: !(await shell.openPath(path.join(app.getPath('userData'), 'logs')))}));
}
