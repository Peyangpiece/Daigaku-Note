// iPad のデータをこのパソコンに取り込む（docs/SYNC.md §12）。iPad だけで使っていた人が、あとでパソコンを使い始めるとき。
// ドライブの目録（iPad が送ったもの）から、データベース・資料・アプリのファイルを読み、このパソコンの場所に置き直す。
// データベースは backup.js の読み込み（復元）と同じく、次の起動で入れ替える（いまのものは before-restore として残す）。
// このパソコンだけの設定（保存先・Google との連携・フォルダの見張り・スマホ・LMS の同期など）は、パソコンのものを残す
import {existsSync, promises as fsp} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openBlob, openJson} from '../../shared/vault.js';
import {deriveKeys} from './keys.js';
import {APP_DIRS, MANIFEST} from './sync.js';
import {originalPath} from '../pdf-save.js';
import {stageRestore} from '../backup.js';

/** iPad の中の資料の保存先（src/local/runtime.js の rootDir の既定） */
export const IPAD_ROOT = '/app/desktop/パレットノート';
/** 取り込んだあと、このパソコンの値を残す設定（このパソコンだけのもの）。名前の頭で見る */
export const DEVICE_SETTINGS = [
  'storage.',
  'cloud.',
  'folder.',
  'import.',
  'mobile.',
  'lms.',
  'sync.',
  'scheduler.',
  'setup.',
  'quiz.cli',
  'quiz.engine'
];
/** 取り込んだ目録の時刻（この時刻の iPad のデータは取り込み済み。パソコンから送ってよい） */
export const ADOPTED = 'cloud.adopted';
const DROP_SETTINGS = ['pdf.saving']; // iPad で途中だった PDF の置き換え（パソコンでは意味がない）

const sha = (b) => createHash('sha256').update(b).digest('hex');
const deviceKey = (k) => DEVICE_SETTINGS.some((p) => k.startsWith(p));
/** 名前に使えない文字を除く（Windows でも置けるように） */
const safePart = (s) =>
  String(s)
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '') || '_';

/** iPad の場所 → このパソコンの場所。iPad の保存先の下なら同じ並びで、それ以外は 保存先/iPad/ の下に置く */
export function mapPath(ipadPath, {ipadRoot = IPAD_ROOT, root}) {
  // .. は先に解いてから見る（iPad の保存先の外を指すものは 保存先/iPad/ へ）
  const parts = path.posix
    .normalize(`/${String(ipadPath ?? '').replace(/\\/g, '/')}`)
    .split('/')
    .filter((x) => x && x !== '.' && x !== '..');
  const base = ipadRoot.split('/').filter(Boolean);
  const under = base.length < parts.length && base.every((x, i) => parts[i] === x);
  const rel = under ? parts.slice(base.length) : ['iPad', parts.at(-1) ?? 'file'];
  return path.join(root, ...rel.map(safePart));
}

/** 同じ名前に違う中身があれば「名前 (iPad).拡張子」にする。同じ中身ならそのまま使う */
async function freePath(file, bytes) {
  const hash = sha(bytes);
  const ext = path.extname(file);
  const stem = file.slice(0, file.length - ext.length);
  for (let i = 0; i < 100; i++) {
    const p = i === 0 ? file : `${stem} (iPad${i === 1 ? '' : ` ${i}`})${ext}`;
    const cur = await fsp.readFile(p).catch(() => null);
    if (!cur) return {file: p, write: true};
    if (sha(cur) === hash) return {file: p, write: false};
  }
  throw new Error(`置く場所が見つかりません：${file}`);
}

/**
 * ドライブの iPad のデータを取り込む準備をする（データベースは次の起動で入れ替わる）。
 * @param {{drive, master: Uint8Array, userData: string, root: string, settings: Array<[string, any]>,
 *   open: (file: string) => DatabaseSync, maxVersion?: number, log?, onProgress?}} deps
 *   root：このパソコンの資料の保存先。settings：このパソコンのいまの設定 [[名前, 値]]
 * 戻り：{materials, files, version, at, device}
 */
export async function adoptIpad({
  drive,
  master,
  userData,
  root,
  settings,
  open,
  maxVersion = Infinity,
  log = () => {},
  onProgress = () => {}
}) {
  const keys = deriveKeys(master);
  const remote = await drive.list();
  const byName = new Map(remote.map((f) => [f.name, f]));
  const mf = byName.get(MANIFEST);
  if (!mf) throw new Error('Google ドライブにデータがありません');
  const manifest = openJson(keys.enc, await drive.get(mf.id), MANIFEST);
  if (manifest.origin !== 'ipad') throw new Error('ドライブのデータは iPad が送ったものではありません');
  const read = async (name) => {
    const f = byName.get(name);
    if (!f)
      throw new Error(
        'Google ドライブのデータが欠けています。iPad で「いま送る」を押してから、もう一度取り込んでください'
      );
    return openBlob(keys.enc, await drive.get(f.id), name);
  };
  const total = 1 + Object.keys(manifest.materials ?? {}).length + Object.keys(manifest.files ?? {}).length;
  let done = 0;
  const step = () => onProgress({done: ++done, total});

  // データベース：userData に写して、場所と設定を直してから、読み込みの予約をする
  const tmp = path.join(userData, 'palette-adopt.sqlite');
  await fsp.writeFile(tmp, await read(manifest.db.name));
  step();
  try {
    const db = open(tmp);
    let materials = 0;
    try {
      const ipadRoot = db.prepare("SELECT value FROM settings WHERE key = 'storage.root'").get()?.value;
      const rootOf = ipadRoot ? JSON.parse(ipadRoot) || IPAD_ROOT : IPAD_ROOT;
      const row = db.prepare('SELECT id, path, base_sha256 FROM material WHERE id = ?');
      const setPath = db.prepare('UPDATE material SET path = ?, sha256 = ? WHERE id = ?');
      for (const [id, f] of Object.entries(manifest.materials ?? {})) {
        const m = row.get(id);
        if (!m?.path || !f?.name) {
          step();
          continue;
        }
        const bytes = await read(f.name);
        const want = mapPath(m.path, {ipadRoot: rootOf, root});
        await fsp.mkdir(path.dirname(want), {recursive: true});
        const {file, write} = await freePath(want, bytes);
        if (write) await fsp.writeFile(file, bytes);
        // 送ったのは書き込みを描き込む前の元の PDF。上書き保存のための写しも置く（pdf-save.js）
        if (m.base_sha256 && sha(bytes) === m.base_sha256) {
          const orig = originalPath(path.join(userData, 'originals'), m.base_sha256);
          if (!existsSync(orig)) {
            await fsp.mkdir(path.dirname(orig), {recursive: true});
            await fsp.writeFile(orig, bytes);
          }
        }
        setPath.run(file, sha(bytes), id);
        materials++;
        step();
      }
      // このパソコンだけの設定は、パソコンのものを残す
      const keys_ = db
        .prepare('SELECT key FROM settings')
        .all()
        .map((r) => r.key);
      const del = db.prepare('DELETE FROM settings WHERE key = ?');
      for (const k of keys_) if (deviceKey(k) || DROP_SETTINGS.includes(k)) del.run(k);
      const put = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      );
      for (const [k, v] of settings) if (deviceKey(k) && k !== ADOPTED) put.run(k, JSON.stringify(v));
      put.run(ADOPTED, JSON.stringify(manifest.at));
    } finally {
      db.close?.();
    }
    // アプリの中のファイル（貼った写真・シール・ノートの上の欄の画像）
    let files = 0;
    for (const [rel, f] of Object.entries(manifest.files ?? {})) {
      const [dir, name, ...rest] = String(rel).split('/');
      if (!APP_DIRS.includes(dir) || !name || rest.length || name.startsWith('.') || name === '..') {
        log(`cloud: 取り込まないファイル：${rel}`);
        step();
        continue;
      }
      await fsp.mkdir(path.join(userData, dir), {recursive: true});
      await fsp.writeFile(path.join(userData, dir, safePart(name)), await read(f.name));
      files++;
      step();
    }
    const staged = stageRestore({userData, src: tmp, open, maxVersion});
    log(`cloud: iPad のデータを取り込む準備をしました（資料 ${materials}・ファイル ${files}）。次の起動で入れ替えます`);
    return {materials, files, version: staged.version, at: manifest.at, device: manifest.device ?? null};
  } finally {
    await fsp.rm(tmp, {force: true}).catch(() => {});
  }
}
