// IPC の窓口：授業資料の自動取り込みの振り分け待ち（import.*。v0.17.0）。見張りは ctx.importer（import-watch.js）
import {id, bad} from './common.js';

export function register({handle, ctx}) {
  const importer = () => ctx.importer ?? bad('取り込みの準備ができていません');
  handle('import.list', () => importer().list());
  handle('import.accept', async ({id: itemId, courseId, roundId = null}) => {
    const r = await importer().accept(
      id(itemId) ?? bad('振り分け待ちが不正です'),
      id(courseId) ?? bad('授業を選んでください'),
      roundId === null ? null : (id(roundId) ?? bad('回が不正です'))
    );
    ctx.notifyOthers?.(null, 'state.changed', {});
    return r;
  });
  // 設定する前からダウンロードにあったファイル（今学期の期間にダウンロードしたものだけ）を取り込む
  handle('import.scan', async () => {
    if (!ctx.importer) bad('取り込みの準備ができていません');
    const r = await ctx.importer.scanExisting();
    ctx.notifyOthers?.(null, 'state.changed', {});
    return r;
  });
  handle('import.dismiss', ({id: itemId}) => {
    const r = importer().dismiss(id(itemId) ?? bad('振り分け待ちが不正です'));
    ctx.notifyOthers?.(null, 'state.changed', {});
    return r;
  });
}
