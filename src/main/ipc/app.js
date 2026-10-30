// IPC の窓口：アプリとバックアップ（app.*・backup.*）。index.js が register を呼ぶ（SPEC §12・DESIGN-M0 §4）
import {dialog, shell, app} from 'electron';
import {promises as fsp} from 'node:fs';
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
      filters: [{name: '大学ノートのバックアップ', extensions: ['sqlite']}]
    });
    if (r.canceled || !r.filePath) return {ok: false};
    const out = exportBackup(ctx.db, r.filePath);
    log.info(`バックアップを書き出しました: ${out.file}（${out.size} バイト）`);
    return {ok: true, file: out.file, size: out.size};
  });

  handle('backup.import', async () => {
    const r = await dialog.showOpenDialog({
      title: 'バックアップを読み込む',
      properties: ['openFile'],
      filters: [{name: '大学ノートのバックアップ', extensions: ['sqlite']}]
    });
    if (r.canceled || !r.filePaths?.[0]) return {ok: false};
    const {DatabaseSync} = await import('node:sqlite');
    const staged = stageRestore({
      userData: app.getPath('userData'),
      src: r.filePaths[0],
      open: (f) => new DatabaseSync(f, {readOnly: true}),
      maxVersion: latestVersion()
    });
    log.info(`バックアップの読み込みを予約しました: ${r.filePaths[0]}（版 ${staged.version}）。次の起動で入れ替えます`);
    return {ok: true, version: staged.version};
  });

  handle('backup.openDir', async () => ({
    ok: !(await shell.openPath(path.join(app.getPath('userData'), 'backups')))
  }));

  handle('app.openLogs', async () => ({ok: !(await shell.openPath(path.join(app.getPath('userData'), 'logs')))}));
}
