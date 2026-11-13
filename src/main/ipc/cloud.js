// IPC の窓口：Google ドライブでそろえる（cloud.*。docs/SYNC.md）。index.js が register を呼ぶ
import qrcode from 'qrcode-generator';
import {bad} from './common.js';

export function register({handle, ctx}) {
  const cloud = () => ctx.cloud ?? bad('Google との連携を準備できませんでした');
  handle('cloud.status', () => cloud().status());
  handle('cloud.link', async () => ({...(await cloud().link()), status: await cloud().status()}));
  handle('cloud.unlink', async () => ({...(await cloud().unlink()), status: await cloud().status()}));
  handle('cloud.push', async () => ({...(await cloud().push()), status: await cloud().status()}));
  // iPad に鍵を渡す QR（パソコンの画面でだけ。iPad からは PAD_DENY で断る）
  handle('cloud.keyQr', async () => {
    const text = await cloud().keyQr();
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return {
      svg: qr.createSvgTag({cellSize: 6, margin: 2, scalable: true}),
      fingerprint: (await cloud().status()).fingerprint
    };
  });
  handle('cloud.setPassphrase', async ({passphrase}) => ({
    ...(await cloud().setPassphrase(passphrase)),
    status: await cloud().status()
  }));
  handle('cloud.unlock', async ({passphrase}) => ({
    ...(await cloud().unlock(passphrase)),
    status: await cloud().status()
  }));
  // iPad のデータを取り込む（次の起動で入れ替わる。画面で開き直すかを聞く）
  handle('cloud.adoptIpad', async () => cloud().adoptIpad());
  // ドライブのほかのパソコンのデータを、このパソコンのデータで置き換える（画面で確かめてから。iPad からは PAD_DENY で断る）
  handle('cloud.replace', async () => ({...(await cloud().replace()), status: await cloud().status()}));
  handle('cloud.wipe', async () => ({...(await cloud().wipe()), status: await cloud().status()}));
}
