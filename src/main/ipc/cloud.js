// IPC の窓口：Google ドライブでそろえる（cloud.*。docs/SYNC.md）。index.js が register を呼ぶ
import {bad} from './common.js';

export function register({handle, ctx}) {
  const cloud = () => ctx.cloud ?? bad('Google との連携を準備できませんでした');
  handle('cloud.status', () => cloud().status());
  handle('cloud.link', async () => ({...(await cloud().link()), status: await cloud().status()}));
  handle('cloud.unlink', async () => ({...(await cloud().unlink()), status: await cloud().status()}));
  handle('cloud.push', async () => ({...(await cloud().push()), status: await cloud().status()}));
  handle('cloud.wipe', async () => ({...(await cloud().wipe()), status: await cloud().status()}));
}
