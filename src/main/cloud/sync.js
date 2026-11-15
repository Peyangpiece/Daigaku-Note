// Google ドライブへ送る（docs/SYNC.md 段階 1）：データベースの写しと資料・アプリのファイルを暗号化して、変わったものだけ送る。
// 送る順は 資料 → データベース → 目録（目録は最後。途中で切れても前の目録がそのまま使える）。目録から外れたものは最後に消す
import {promises as fsp} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openJson, sealBlob, sealJson} from '../../shared/vault.js';
import {blobName, deriveKeys} from './keys.js';
import {KEYRING} from '../../shared/keyring.js';

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
  origin = 'pc', // 送った端末の種類（'pc'・'ipad'）。目録に書く
  root = null, // 資料の保存先（目録に書く。ほかのパソコンが取り込むときに、同じ並びで置き直すため）
  // このデータが、ドライブのどの目録から始めたものか：{base: 目録の時刻, baseContent: その目録の中身の印}（目録に書く。docs/SYNC.md §14）。
  // 受け取る側は、自分の中身の印が baseContent と同じなら（そのあと自分では何も書いていない）、何も消さずに取り込める
  baseOf = () => null,
  contentOf = () => null, // このデータベースの中身の印（content.js。パソコンだけが書く）
  log = () => {},
  now = () => new Date(),
  // 送ってよいか：ドライブの今の目録（なければ null）を見て、だめなら理由の文字を返す（ほかの端末のデータを上書きしない。docs/SYNC.md §11）
  allow = () => null
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
      const stop = allow(prev);
      if (stop) throw new Error(stop);
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
      const content = contentOf();
      const manifest = {
        version: MANIFEST_VERSION,
        at: now().toISOString(),
        device,
        origin,
        ...(root ? {root: typeof root === 'function' ? root() : root} : {}),
        ...(content ? {content} : {}),
        ...Object.fromEntries(Object.entries(baseOf(prev) ?? {}).filter(([, v]) => v != null)),
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
        KEYRING, // 合言葉で包んだ鍵（docs/SYNC.md §9）は消さない
        ...Object.values(mats).map((x) => x.name),
        ...Object.values(files).map((x) => x.name)
      ]);
      let removed = 0;
      for (const f of byName.values())
        if (!keep.has(f.name)) {
          await drive.remove(f.id).catch((e) => log(`cloud: 消せませんでした（${f.name}）：${e.message}`));
          removed++;
        }
      // at：いまドライブにある目録の時刻（変わっていなければ前のまま。この端末が送った・確かめた目録の印に使う）
      return {uploaded, removed, bytes, skipped: same, manifest, at: same ? prev.at : manifest.at};
    },

    /** ドライブのこのアプリの中身を全部消す（作り直す・連携をやめるとき） */
    async wipe() {
      for (const f of await drive.list()) await drive.remove(f.id);
    }
  };
}

/**
 * 送ってよいか（docs/SYNC.md §14）：ドライブの目録（prev）が、この iPad のデータが始まった目録（from）のままなら送る。
 * 時刻が違っても、データベースがそのまま、またはパソコンが書いた中身の印（content）が同じなら（パソコンでは使っただけ：同期の記録など）送ってよい
 */
export function canPush(prev, from) {
  if (!prev) return true;
  if (!from) return false; // iPad だけで始めたのに、ドライブにほかの端末のデータがある
  if (prev.at === from.at) return true;
  // データベースがそのまま（前の版の iPad は、変わったものがなく目録を書かなかったときも、新しい時刻で覚えていた）
  if (prev.db?.sha256 && prev.db.sha256 === from.db?.sha256) return true;
  return !!prev.content && prev.content === from.content;
}
