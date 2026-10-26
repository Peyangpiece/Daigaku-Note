// IPC の窓口：文房具（stationery.*）。index.js が register を呼ぶ（SPEC §12・DESIGN-M0 §4）
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {CATALOG, arrange, purchase} from '../../shared/stationery.js';
import {spend} from '../../shared/points.js';
import {here, bad} from './common.js';

export function register({handle, repo}) {
  // ---- 文房具（SPEC §15）：ショップで入手する（いまは無料の品だけ）・筆箱の中身とペンケースを変える ----
  // レジ：カートの品をまとめて買う（α 版はデモ決済。実際の請求はなく、注文の記録を設定に残す）
  handle('stationery.purchase', ({itemIds, payment}) => {
    const {stationery: st, order} = purchase(
      repo.getSetting('stationery', null),
      Array.isArray(itemIds) ? itemIds : [],
      payment && typeof payment === 'object' ? {method: String(payment.method ?? ''), last4: payment.last4} : null
    );
    // ポイントの品の分を残高から引く（足りなければここで止まり、何も保存しない）
    const points = spend(repo.getSetting('points', null), order.points, {
      note: order.items
        .filter((it) => it.points)
        .map((it) => it.name)
        .join('・')
    });
    repo.setSetting('points', points);
    repo.setSetting('stationery', st);
    const orders = [order, ...repo.getSetting('stationery.orders', [])].slice(0, 200);
    repo.setSetting('stationery.orders', orders);
    return {stationery: st, order, orders, points};
  });

  handle('stationery.arrange', ({slots, caseId, refills}) => {
    const st = arrange(repo.getSetting('stationery', null), {slots, caseId, refills});
    repo.setSetting('stationery', st);
    return {stationery: st};
  });

  // 3D モデルの品の GLB（renderer/assets/stationery/<model>.glb）。レンダラは file:// を fetch できないので、ここで読んで渡す
  const modelsDir = path.join(here, '..', 'renderer', 'assets', 'stationery');

  handle('stationery.model', async ({model}) => {
    const id = String(model ?? '');
    if (!/^[a-z0-9-]+$/.test(id) || !CATALOG.some((it) => it.model === id)) bad('そのモデルはありません');
    const bytes = await fsp.readFile(path.join(modelsDir, `${id}.glb`));
    return {bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)};
  });
}
