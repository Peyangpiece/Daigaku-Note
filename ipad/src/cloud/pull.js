// iPad アプリ：Google ドライブから、パソコンが置いたもの（目録・データベース・資料・アプリのファイル）を読み込んで、この iPad に置く
// （docs/SYNC.md §4）。暗号化したまま置き、使うときに開く。変わったもの・まだないものだけ読む。副作用は渡した drive・store だけ
import {openBlob, openJson} from '../shared/vault.js';
import {deriveKeys} from '../shared/vault-keys.js';

export const MANIFEST = 'manifest';
export const LOCAL_MANIFEST = 'manifest'; // この iPad に置いた目録（暗号化したまま）
/** iPad が自分で作ったもの（iPad で変えたデータベース・iPad で書いたファイル）。ドライブから読み込むときに消さない */
export const ownName = (name) => name.startsWith('local-') || name.startsWith('w-');

/** 目録が指すもの：[{name, kind}]（データベース・資料・アプリのファイル。同じ名前は 1 つ） */
export function wanted(manifest) {
  const out = new Map();
  if (manifest?.db?.name) out.set(manifest.db.name, 'db');
  for (const m of Object.values(manifest?.materials ?? {})) if (m?.name) out.set(m.name, 'material');
  for (const f of Object.values(manifest?.files ?? {})) if (f?.name) out.set(f.name, 'file');
  return [...out].map(([name, kind]) => ({name, kind}));
}

/**
 * 読み込む。store：{list(): string[], get(name): Uint8Array|null, put(name, bytes), remove(name)}
 * onProgress({done, total, bytes})。戻り：{manifest, downloaded, removed, bytes, materials}
 */
export async function pull({drive, store, master, onProgress = () => {}}) {
  const keys = deriveKeys(master);
  const remote = await drive.list();
  const byName = new Map(remote.map((f) => [f.name, f]));
  const mf = byName.get(MANIFEST);
  if (!mf)
    throw new Error('Google ドライブにまだデータがありません。パソコンの 設定 → データ で「いま送る」を押してください');
  const blob = await drive.get(mf.id);
  let manifest;
  try {
    manifest = openJson(keys.enc, blob, MANIFEST);
  } catch {
    throw new Error('鍵が合いません。パソコンの「iPad に鍵を渡す」の QR を読み直してください');
  }
  // 前に読んだ目録（データベースが変わったかを見る）
  const old = await store.get(LOCAL_MANIFEST);
  let prev = null;
  try {
    prev = old ? openJson(keys.enc, old, MANIFEST) : null;
  } catch {
    prev = null;
  }
  const have = new Set(await store.list());
  const list = wanted(manifest);
  const todo = list.filter(
    ({name, kind}) => !have.has(name) || (kind === 'db' && prev?.db?.sha256 !== manifest.db?.sha256)
  );
  let bytes = 0;
  let done = 0;
  onProgress({done, total: todo.length, bytes});
  for (const {name} of todo) {
    const f = byName.get(name);
    if (!f)
      throw new Error(
        'Google ドライブのデータが欠けています。パソコンで「いま送る」を押してから、もう一度読み込んでください'
      );
    const b = await drive.get(f.id);
    openBlob(keys.enc, b, name); // 開けるか確かめる（壊れた・すり替えたものは置かない）
    await store.put(name, b);
    bytes += b.length;
    done++;
    onProgress({done, total: todo.length, bytes});
  }
  // 目録を置き換えてから、目録から外れたものを消す（途中で切れても、そのときの目録が指すものはそろっている）
  await store.put(LOCAL_MANIFEST, blob);
  const keep = new Set([LOCAL_MANIFEST, ...list.map((x) => x.name)]);
  let removed = 0;
  for (const name of have)
    if (!keep.has(name) && !ownName(name)) {
      await store.remove(name);
      removed++;
    }
  return {manifest, downloaded: todo.length, removed, bytes, materials: Object.keys(manifest.materials ?? {}).length};
}
