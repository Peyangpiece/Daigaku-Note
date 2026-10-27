// スマホ連携（docs/MOBILE.md §2）のパソコン側の設定：入れる・切る、スマホを追加（QR）、つないだスマホの名前・外す
import qrcode from 'qrcode-generator';
import {pairUrl} from '../../shared/mobile-wire.js';
import {lanAddresses} from '../mobile/server.js';
import {PAIR_TTL_MS} from '../mobile/devices.js';
import {bad, id, str} from './common.js';

export function register({handle, ctx, repo}) {
  const mobile = () => ctx.mobile ?? bad('スマホ連携を準備できませんでした');
  const status = async () => ({
    enabled: mobile().server.running,
    port: mobile().server.port,
    hosts: lanAddresses(),
    devices: await mobile().devices.list()
  });

  handle('mobile.status', status);

  handle('mobile.enable', async ({on}) => {
    if (on) await mobile().server.start();
    else await mobile().server.stop();
    repo.setSetting('mobile.enabled', !!on);
    return status();
  });

  // スマホを追加：その端末だけの鍵を作り、入口の URL を QR にする（10 分・1 回だけ使える）
  handle('mobile.pair', async ({host}) => {
    const {server, devices} = mobile();
    if (!server.running) bad('先に「スマホとつなぐ」をオンにしてください');
    const hosts = lanAddresses();
    const h = hosts.includes(host) ? host : (hosts[0] ?? bad('Wi-Fi などのネットワークにつながっていません'));
    const {id: deviceId, key} = await devices.create();
    const url = pairUrl({host: h, port: server.port, deviceId, key});
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    // url は QR の中身そのもの（画面には出さない。通しテストが QR の代わりに使う）
    return {svg: qr.createSvgTag({cellSize: 6, margin: 2, scalable: true}), url, host: h, expiresIn: PAIR_TTL_MS};
  });

  handle('mobile.rename', async ({deviceId, name}) => {
    mobile().devices.rename(id(deviceId) ?? bad('スマホが不正です'), str(name, 100) ?? bad('名前が不正です'));
    return status();
  });

  handle('mobile.remove', async ({deviceId}) => {
    await mobile().devices.remove(id(deviceId) ?? bad('スマホが不正です'));
    return status();
  });
}
