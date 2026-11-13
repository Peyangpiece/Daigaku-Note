// iPad のアプリで「パソコンなしで使う」とき、パソコンと同じ画面（src/pad/bridge.js）がパソコンの代わりに話す相手（docs/SYNC.md §8）。
// /m/app/client.js（スマホ・iPad がパソコンと話す部品）と同じ名前を出す。中身は、このアプリの中で動かすパソコンの窓口（runtime.js）。
// - データ：ドライブから読み込んで暗号化したまま置いたもの（ipad/src/cloud/pull.js）を、ここで開く
// - iPad で変えたデータベースは、暗号化して local-db に置く（ドライブへ返すのは段階 3）
import {createPadApi, createPadHub} from '../main/mobile/pad.js';
import {setPadTap} from '../main/frames.js';
import {originalPath, readBase} from '../main/pdf-save.js';
import {PAD_QUIET} from '../shared/pad-channels.js';
import {openBlob, openJson, sealBlob, sealJson} from '../shared/vault.js';
import {createPusher} from '../main/cloud/sync.js';
import {promises as fsp} from 'node:fs';
import {createDriveReader, refresh} from '/cloud/google.js';
import {deriveKeys} from '../shared/vault-keys.js';
import {startLocal} from './runtime.js';
import {SqlJsDatabase} from '../shared/sqljs-db.js';
import {sha256} from '@noble/hashes/sha2.js';
import {vfs} from './vfs.js';
import {store, fromB64, http} from '/cloud/native.js';

export class NotPaired extends Error {}
export class Busy extends Error {}
export class Unreachable extends Error {}

const CLOUD = 'palette.cloud'; // ipad/src/cloud/screen.js が覚えたもの（鍵など）
const LOCAL_META = 'palette.localdb'; // iPad で変えたデータベースの元（ドライブのデータベースのハッシュ）
export const LOCAL_DB = 'local-db';
const SAVE_DELAY = 1500;

const json = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? 'null');
  } catch {
    return null;
  }
};

export const standalone = () => true;
export const initPairing = () => 'stored';
export const paired = () => true;
export const forget = () => {};
export const hello = async () => ({ok: true});

/** 読み込んだデータを開いて、パソコンの窓口を動かす。戻り：{pad, local, notice} */
async function boot() {
  const cloud = json(CLOUD);
  if (!cloud?.key) throw new NotPaired('まだ合言葉を入れていません');
  const keys = deriveKeys(fromB64(cloud.key));
  // ドライブから読み込んだ目録（パソコンがないとき・まだ読み込んでいないときは null：iPad だけで始める）
  const mf = await store.get('manifest');
  const manifest = mf ? openJson(keys.enc, mf, 'manifest') : null;
  const readBlob = async (name) => {
    const b = await store.get(name);
    if (!b) throw new Error('ファイルがこの iPad にありません。もう一度ドライブから読み込んでください');
    return openBlob(keys.enc, b, name);
  };
  // iPad で変えたデータベースがあり、同じドライブのデータベースから始めたものならそれを使う
  const meta = json(LOCAL_META);
  const local = await store.get(LOCAL_DB);
  let bytes;
  let notice = '';
  let base = manifest?.db?.sha256 ?? null;
  if (local && (meta?.base ?? null) === base) bytes = openBlob(keys.enc, local, LOCAL_DB);
  else if (manifest) {
    if (local) notice = 'パソコンのデータが新しくなったので、iPad で書いたものの代わりにパソコンのものを開きました';
    bytes = await readBlob(manifest.db.name);
  } else bytes = null; // iPad だけで新しく始める（空のデータベース）
  // sql.js（index.html で読む sql-wasm-browser.js）
  const SQL = await window.initSqlJs({locateFile: (f) => `/m/p/node_modules/sql.js/dist/${f}`});
  // パソコンの場所 → ドライブから読み込んだもの
  vfs.mountPrefix('/app/node_modules', async (rel) => {
    const r = await fetch(`/m/p/node_modules/${rel}`);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  });
  let timer = null;
  const db = new SqlJsDatabase(SQL, bytes);
  await migrateLocal(db); // 新しく始める・アプリがデータより新しいときに、データベースの作りをそろえる
  const local_ = startLocal({db, log: console});
  const write = async () => {
    clearTimeout(timer);
    timer = null;
    try {
      await store.put(LOCAL_DB, sealBlob(keys.enc, local_.db.export(), LOCAL_DB));
      localStorage.setItem(LOCAL_META, JSON.stringify({base, at: new Date().toISOString()}));
      cloudApi.later(); // しばらくしたらドライブへ送る
    } catch (e) {
      console.warn('iPad のデータを保存できませんでした', e);
    }
  };
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(write, SAVE_DELAY);
  };
  // アプリを閉じる・ほかのアプリへ移るとき：待っている保存をすぐ書く（待ち時間のあいだに閉じると、直前の変更が残らなかった）
  const flush = () => {
    if (timer) write();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
  // ---- ドライブへ送る（docs/SYNC.md §11）：パソコンの送り出し（main/cloud/sync.js）をそのまま、この iPad の中で動かす ----
  const cloudApi = iPadCloud({
    cloud,
    db: local_.db,
    repo: local_.repo,
    onPushed: async (m) => {
      // 送ったものが、この iPad の元になる（次に開くときも iPad で変えたデータベースを使い、読み込みで読み直さない）
      base = m.db?.sha256 ?? base;
      await store.put('manifest', sealJson(keys.enc, m, 'manifest'));
      localStorage.setItem(LOCAL_META, JSON.stringify({base, at: new Date().toISOString()}));
    }
  });
  local_.ctx.cloud = cloudApi;
  const {repo} = local_;
  for (const [id, f] of Object.entries(manifest?.materials ?? {})) {
    const m = repo.get('material', id);
    if (!m?.path) continue;
    vfs.mount(m.path, () => readBlob(f.name), f.size);
    if (m.base_sha256)
      vfs.mount(originalPath('/app/userData/originals', m.base_sha256), () => readBlob(f.name), f.size);
  }
  for (const [rel, f] of Object.entries(manifest?.files ?? {}))
    vfs.mount(`/app/userData/${rel}`, () => readBlob(f.name), f.size);
  // iPad で書いたファイル（取り込んだ資料・ノート・写真など）：前に残したものを置き、書いたら残す
  await keepLocalFiles(keys);
  // 画面への知らせ（パソコンと同じ画面の知らせの待ち）
  const hub = createPadHub();
  setPadTap((ch, payload, except) => hub.push(ch, payload, except));
  const pad = createPadApi({
    handlers: local_.handlers,
    ctx: local_.ctx,
    repo,
    hub,
    remote: false, // この iPad の中で動かす（バックアップの読み込みも、この iPad のデータに対して使える）
    log: (m) => console.info(m)
  });
  return {pad, local: local_, save, notice, manifest};
}

// ---- ドライブへ送る（iPad の設定 → データ の「いま送る」・変えてからしばらくして自動で）----
const PUSH_DELAY = 60_000;
const DEVICE_KEY = 'palette.device';
const deviceName = () => {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => x.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_KEY, id);
  }
  return `iPad-${id}`;
};
const LAST = 'palette.cloud.last'; // 最後に送った結果（設定の画面に出す）

const PC_HELD =
  'ドライブにはパソコンが送ったデータがあります。上書きしないように、iPad からは送りません。最初の画面の「ドライブから読み込む」で、パソコンのデータを読み込んでから続けてください';
let warned = false;

function iPadCloud({cloud, db, repo, onPushed}) {
  let access = null;
  let busy = null;
  let timer = null;
  const getToken = async (fresh) => {
    if (!fresh && access && access.expiresAt - Date.now() > 60_000) return access.accessToken;
    if (!cloud.refreshToken) throw new Error('Google にログインしていません');
    access = await refresh(http, {refreshToken: cloud.refreshToken});
    return access.accessToken;
  };
  const master = fromB64(cloud.key);
  const record = (last) => localStorage.setItem(LAST, JSON.stringify(last));
  const api = {
    async status() {
      let last = null;
      try {
        last = JSON.parse(localStorage.getItem(LAST) ?? 'null');
      } catch {
        last = null;
      }
      return {
        ready: true,
        linked: true,
        locked: false,
        passphrase: true,
        email: cloud.email ?? null,
        linkedAt: null,
        last,
        busy: !!busy,
        fingerprint: cloud.fp ?? null,
        ipad: true
      };
    },
    push() {
      busy ??= (async () => {
        const at = new Date().toISOString();
        try {
          const pusher = createPusher({
            drive: createDriveReader({http, getToken}),
            master,
            exportDb: (file) => fsp.writeFile(file, db.export()),
            materials: () => Object.values(repo.listMaterialsAll()).flat(),
            // パソコンと同じく、PDF は書き込みを描き込む前の元の PDF を送る（main.js の readMaterial。上書き保存の写しがあればそれ）
            readMaterial: async (m) =>
              /\.pdf$/i.test(m.path) ? (await readBase(m, '/app/userData/originals')).bytes : fsp.readFile(m.path),
            userData: '/app/userData',
            device: deviceName(),
            origin: 'ipad',
            // パソコンが送ったデータがあるときは、iPad からは送らない（上書きして消さない）
            allow: (prev) => (prev && prev.origin !== 'ipad' ? PC_HELD : null)
          });
          const r = await pusher.push();
          await onPushed(r.manifest);
          record({at, ok: true, uploaded: r.uploaded, bytes: r.bytes, removed: r.removed});
          return r;
        } catch (e) {
          record({at, ok: false, message: e.message});
          throw e;
        } finally {
          busy = null;
        }
      })();
      return busy;
    },
    /** 変えてからしばらくしたら送る（送れなければ、次に変えたときにまた試す） */
    later() {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          api.push().catch((e) => {
            console.warn('ドライブへ送れませんでした', e.message);
            // パソコンのデータがあって送れないまま書き続けると、次に読み込んだときに消える。気づけるよう、開いているあいだに 1 度だけ知らせる
            if (e.message === PC_HELD && !warned) {
              warned = true;
              alert(
                'この iPad で書いたものを、ドライブへ送れていません（ドライブにパソコンが送ったデータがあるため）。このまま書き続けると、次に「ドライブから読み込む」をしたときに消えます。最初の画面の「ドライブから読み込む」で、パソコンのデータを読み込んでから続けてください。'
              );
            }
          }),
        PUSH_DELAY
      );
    },
    keyQr: async () => {
      throw new Error('iPad に鍵を渡す QR は、パソコンの画面で出してください');
    }
  };
  return api;
}

// ---- データベースの作り（マイグレーション。iPad で新しく始める・アプリがデータより新しいとき）----
const MIG_DIR = '/app/migrations';
async function migrateLocal(db) {
  const list = await (await fetch('/m/p/src/local/migrations.json')).json();
  for (const {name, sql} of list) vfs.write(`${MIG_DIR}/${name}`, new TextEncoder().encode(sql), {quiet: true});
  const {migrate} = await import('../main/db/db.js');
  return migrate(db, MIG_DIR);
}

// ---- iPad で書いたファイルを残す（暗号化して Data/drive/ に。一覧は local-files）----
export const LOCAL_FILES = 'local-files';
const TMP = /^\/app\/(tmp|migrations)\//;
async function keepLocalFiles(keys) {
  const enc = new TextEncoder();
  const list = await store.get(LOCAL_FILES);
  const index = list ? JSON.parse(new TextDecoder().decode(openBlob(keys.enc, list, LOCAL_FILES))) : {};
  const nameOf = (p) => {
    const h = sha256(enc.encode(p)).slice(0, 16);
    return `w-${Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('')}`;
  };
  for (const [p, f] of Object.entries(index))
    vfs.mount(p, async () => openBlob(keys.enc, await store.get(f.name), f.name), f.size);
  let chain = Promise.resolve();
  const saveIndex = () => store.put(LOCAL_FILES, sealBlob(keys.enc, enc.encode(JSON.stringify(index)), LOCAL_FILES));
  vfs.setHooks({
    write(p, bytes) {
      if (TMP.test(p)) return;
      chain = chain
        .then(async () => {
          const name = nameOf(p);
          await store.put(name, sealBlob(keys.enc, bytes, name));
          index[p] = {name, size: bytes.length};
          await saveIndex();
        })
        .catch((e) => console.warn('iPad にファイルを残せませんでした', e));
    },
    remove(p) {
      if (!index[p]) return;
      chain = chain
        .then(async () => {
          const {name} = index[p];
          delete index[p];
          await store.remove(name);
          await saveIndex();
        })
        .catch((e) => console.warn('iPad のファイルを消せませんでした', e));
    }
  });
}

let ready = null;
export const localApp = () => (ready ??= boot());

/** パソコンと話す call と同じ形：pad.status・pad.call・pad.poll */
export async function call(ch, arg = {}) {
  const app = await localApp();
  if (ch === 'hello') return {ok: true};
  if (ch === 'pad.status') return {full: true};
  if (ch === 'pad.poll') return app.pad.poll('local', arg);
  if (ch === 'pad.call') {
    const r = await app.pad.call(arg);
    if (!PAD_QUIET.has(arg.ch) || /^(annotation|bookmark|note|photo|pdf\.textStyle)/.test(arg.ch ?? '')) app.save();
    return r;
  }
  throw new Error('この操作は iPad ではできません');
}
