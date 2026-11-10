// Google ドライブへ送る（docs/SYNC.md 段階 1）：データベースの写しと資料・アプリのファイルを暗号化して、変わったものだけ送る。
// 送る順は 資料 → データベース → 目録（目録は最後。途中で切れても前の目録がそのまま使える）。目録から外れたものは最後に消す
import {promises as fsp} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openJson, sealBlob, sealJson} from '../../shared/vault.js';
import {blobName, deriveKeys} from './keys.js';

export const MANIFEST = 'manifest';
export const DB_NAME = 'db';
export const MANIFEST_VERSION = 1;
/** iPad でも要る、アプリの中のファイル（userData の下）：貼った写真・シール・ノートの上の欄の画像 */
export const APP_DIRS = ['photos', 'stickers', 'notes'];

const sha = (b) => createHash('sha256').update(b).digest('hex');

/**
 * @param {{drive, master: Uint8Array, exportDb: (file: string) => void, materials: () => Array,
 *   readMaterial: (m) => Promise<Uint8Array>, userData: string, device: string, log?, now?}} deps
 *   exportDb：データベースの写しを file に書く（backup.js の exportBackup）
 *   readMaterial：資料の中身（PDF は書き込みを描き込む前の元の PDF。pdf-save.js の readBase）
 */
export function createPusher({
  drive,
  master,
  exportDb,
  materials,
  readMaterial,
  userData,
  device,
  log = () => {},
  now = () => new Date()
}) {
  const keys = deriveKeys(master);

  /** ドライブの目録を読む（なければ null。読めなければ Error：ほかの鍵で作ったもの） */
  const readManifest = async (remote) => {
    const f = remote.find((x) => x.name === MANIFEST);
    if (!f) return null;
    const blob = await drive.get(f.id);
    return openJson(keys.enc, blob, MANIFEST);
  };

  /** アプリの中のファイル：[{rel, file}] */
  const appFiles = async () => {
    const out = [];
    for (const dir of APP_DIRS) {
      const names = await fsp.readdir(path.join(userData, dir)).catch(() => []);
      for (const n of names) if (!n.startsWith('.')) out.push({rel: `${dir}/${n}`, file: path.join(userData, dir, n)});
    }
    return out;
  };

  return {
    /** いまの目録（画面に出す。ドライブに何もなければ null） */
    async status() {
      const remote = await drive.list();
      const m = await readManifest(remote);
      return {
        manifest: m && {at: m.at, device: m.device, materials: Object.keys(m.materials ?? {}).length},
        remote: remote.length
      };
    },

    /** 送る。戻り：{uploaded, removed, bytes, skipped} */
    async push() {
      const remote = await drive.list();
      const byName = new Map(remote.map((f) => [f.name, f]));
      const prev = await readManifest(remote); // ほかの鍵で作ったものなら、ここで止まる（消さない）
      let uploaded = 0;
      let bytes = 0;
      const put = async (name, plain) => {
        const blob = sealBlob(keys.enc, plain, name);
        const r = await drive.put(name, blob, byName.get(name)?.id ?? null);
        byName.set(name, {id: r.id, name, size: blob.length});
        uploaded++;
        bytes += blob.length;
      };
      const putFile = async (plain, src) => {
        const name = blobName(keys.name, plain);
        if (!byName.has(name)) await put(name, plain); // 同じ中身はもう置いてある
        return {name, size: plain.length, src};
      };
      /** 前に送ったときから変わっていなければ（src が同じで、ドライブにある）、読まずに前のものを使う */
      const unchanged = (old, src) => (old && old.src === src && byName.has(old.name) ? old : null);

      // 資料
      const mats = {};
      // 資料の並び。授業ごとにまとめた形（{授業の id: [資料…]}）を渡されても受ける
      const list = materials();
      for (const m of Array.isArray(list) ? list : Object.values(list ?? {}).flat()) {
        if (m.status !== 'ok' || !m.path) continue;
        const src = m.base_sha256 || m.sha256 || null; // 中身のハッシュ（PDF は元の PDF のもの）
        const same = src && unchanged(prev?.materials?.[m.id], src);
        if (same) {
          mats[m.id] = same;
          continue;
        }
        let plain;
        try {
          plain = await readMaterial(m);
        } catch (e) {
          log(`cloud: 資料を読めませんでした（${m.name}）：${e.message}`);
          continue;
        }
        mats[m.id] = await putFile(plain, src);
      }
      // アプリの中のファイル
      const files = {};
      for (const {rel, file} of await appFiles()) {
        const st = await fsp.stat(file).catch(() => null);
        if (!st?.isFile()) continue;
        const src = `${st.size}-${Math.floor(st.mtimeMs)}`;
        const same = unchanged(prev?.files?.[rel], src);
        if (same) {
          files[rel] = same;
          continue;
        }
        const plain = await fsp.readFile(file).catch(() => null);
        if (plain) files[rel] = await putFile(plain, src);
      }
      // データベースの写し（変わっていなければ送らない）
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'palette-cloud-'));
      let dbHash;
      try {
        const file = path.join(dir, 'db.sqlite');
        exportDb(file);
        const plain = await fsp.readFile(file);
        dbHash = sha(plain);
        if (prev?.db?.sha256 !== dbHash || !byName.has(DB_NAME)) await put(DB_NAME, plain);
      } finally {
        await fsp.rm(dir, {recursive: true, force: true}).catch(() => {});
      }
      const manifest = {
        version: MANIFEST_VERSION,
        at: now().toISOString(),
        device,
        db: {name: DB_NAME, sha256: dbHash},
        materials: mats,
        files
      };
      const same =
        prev &&
        prev.db?.sha256 === manifest.db.sha256 &&
        JSON.stringify(prev.materials) === JSON.stringify(mats) &&
        JSON.stringify(prev.files ?? {}) === JSON.stringify(files);
      if (!same) {
        const blob = sealJson(keys.enc, manifest, MANIFEST);
        const r = await drive.put(MANIFEST, blob, byName.get(MANIFEST)?.id ?? null);
        byName.set(MANIFEST, {id: r.id, name: MANIFEST});
        uploaded++;
        bytes += blob.length;
      }
      // 目録から外れたものを消す
      const keep = new Set([
        MANIFEST,
        DB_NAME,
        ...Object.values(mats).map((x) => x.name),
        ...Object.values(files).map((x) => x.name)
      ]);
      let removed = 0;
      for (const f of byName.values())
        if (!keep.has(f.name)) {
          await drive.remove(f.id).catch((e) => log(`cloud: 消せませんでした（${f.name}）：${e.message}`));
          removed++;
        }
      return {uploaded, removed, bytes, skipped: same};
    },

    /** ドライブのこのアプリの中身を全部消す（作り直す・連携をやめるとき） */
    async wipe() {
      for (const f of await drive.list()) await drive.remove(f.id);
    }
  };
}
