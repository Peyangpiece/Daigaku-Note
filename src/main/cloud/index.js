// Google ドライブでそろえる（docs/SYNC.md）：連携する・外す・送る。連携しているあいだは 30 分ごとに変わったものを送る。
// トークンと鍵は secrets.js（OS の仕組みで暗号化）に置く：cloud.google（更新用のトークン）・cloud.key（中身を包む元の鍵）
import os from 'node:os';
import {GOOGLE_DESKTOP, googleReady} from '../../shared/google-client.js';
import {fromB64, toB64} from '../../shared/mobile-wire.js';
import {createDrive, loginLoopback, refreshAccess, revoke} from './google.js';
import {fingerprint, keyQr, newMasterKey} from './keys.js';
import {createPusher} from './sync.js';
import {loadClientSecret} from './client-secret.js';
import {KEYRING, keyringBytes, makeKeyring, openKeyring, readKeyringBytes} from '../../shared/keyring.js';

export const PUSH_EVERY_MS = 30 * 60 * 1000;

/**
 * @param {{repo, secrets, exportDb, materials, readMaterial, userData, openExternal, log?, fetch?, config?, onChange?}} deps
 *   onChange：状態が変わった（画面に出し直す）
 */
export function createCloud({
  repo,
  secrets,
  exportDb,
  materials,
  readMaterial,
  userData,
  openExternal,
  log = () => {},
  fetch = globalThis.fetch,
  config = {...GOOGLE_DESKTOP, clientSecret: GOOGLE_DESKTOP.clientSecret || loadClientSecret()},
  onChange = () => {},
  now = () => new Date()
}) {
  let access = null; // {accessToken, expiresAt}
  let busy = null; // 送っている最中の Promise
  let timer = null;

  const account = () => repo.getSetting('cloud.account', null);
  const masterKey = async () => {
    const k = await secrets.get('cloud.key');
    return k ? fromB64(k) : null;
  };
  const getToken = async (fresh = false) => {
    if (!fresh && access && access.expiresAt - Date.now() > 60_000) return access.accessToken;
    const saved = await secrets.get('cloud.google');
    if (!saved?.refreshToken) throw new Error('Google と連携していません');
    access = await refreshAccess({...config, refreshToken: saved.refreshToken, fetch});
    return access.accessToken;
  };
  const drive = createDrive({getToken, fetch});
  const pusher = async () => {
    const master = await masterKey();
    if (!master) throw new Error('暗号化の鍵がありません。連携し直してください');
    return createPusher({
      drive,
      master,
      exportDb,
      materials,
      readMaterial,
      userData,
      device: os.hostname(),
      log,
      now,
      // iPad が送ったデータ（iPad だけで始めたなど）があるときは、パソコンからは送らない（上書きして消さない。取り込みは docs/SYNC.md §11）
      allow: (prev) =>
        prev?.origin === 'ipad'
          ? 'ドライブには iPad で書いたデータがあります。上書きしないように、このパソコンからは送りません（iPad のデータをパソコンに取り込む機能は、次の版で入ります）'
          : null
    });
  };
  /** ドライブの合言葉で包んだ鍵（なければ null）：{id, ring} */
  const remoteKeyring = async () => {
    const f = (await drive.list()).find((x) => x.name === KEYRING);
    if (!f) return null;
    return {id: f.id, ring: readKeyringBytes(await drive.get(f.id))};
  };
  const record = (last) => {
    repo.setSetting('cloud.last', last);
    onChange();
  };

  const api = {
    async status() {
      const master = await masterKey().catch(() => null);
      return {
        ready: googleReady(config),
        linked: !!account(),
        // 鍵がない（ドライブの合言葉で包んだ鍵を、合言葉で開く前）
        locked: !!account() && !master,
        passphrase: !!repo.getSetting('cloud.keyring', null),
        email: account()?.email ?? null,
        linkedAt: account()?.linkedAt ?? null,
        last: repo.getSetting('cloud.last', null),
        busy: !!busy,
        fingerprint: master ? fingerprint(master) : null
      };
    },

    /** ブラウザで Google にログインして連携する。ドライブにほかの鍵で作ったものがあれば conflict（消すかどうかは画面で聞く） */
    async link() {
      if (!googleReady(config)) throw new Error('Google との連携は準備中です');
      const r = await loginLoopback({...config, openExternal, fetch});
      await secrets.set('cloud.google', {refreshToken: r.refreshToken});
      access = {accessToken: r.accessToken, expiresAt: r.expiresAt};
      if (!(await masterKey())) await secrets.set('cloud.key', toB64(newMasterKey()));
      repo.setSetting('cloud.account', {email: r.email, linkedAt: now().toISOString()});
      // ほかの端末（iPad だけで始めた・ほかのパソコン）が合言葉で鍵を置いていたら、その鍵を使う（合言葉を聞く）
      const remote = await remoteKeyring().catch(() => null);
      const mine = await masterKey();
      if (remote && (!mine || fingerprint(mine) !== remote.ring.fp)) {
        repo.setSetting('cloud.keyring', {at: remote.ring.at, fp: remote.ring.fp});
        if (mine) await secrets.remove('cloud.key');
        onChange();
        return {ok: true, email: r.email, needPassphrase: true};
      }
      if (remote) repo.setSetting('cloud.keyring', {at: remote.ring.at, fp: remote.ring.fp});
      onChange();
      try {
        await (await pusher()).status();
      } catch (e) {
        if (/鍵が違う|暗号化した中身ではありません/.test(e.message)) return {ok: true, conflict: true, email: r.email};
        throw e;
      }
      api.push().catch(() => {}); // 最初の送り出しは裏で
      return {ok: true, email: r.email};
    },

    /** 合言葉を決める・変える（鍵を合言葉で包んでドライブに置く。iPad は Google のログインと合言葉だけで使える） */
    async setPassphrase(passphrase) {
      if (!account()) throw new Error('Google と連携していません');
      const master = await masterKey();
      if (!master) throw new Error('暗号化の鍵がありません。合言葉を入れるか、連携し直してください');
      const ring = await makeKeyring(master, passphrase, {device: os.hostname(), now: now()});
      const old = await remoteKeyring().catch(() => null);
      await drive.put(KEYRING, keyringBytes(ring), old?.id ?? null);
      repo.setSetting('cloud.keyring', {at: ring.at, fp: ring.fp});
      onChange();
      return {ok: true};
    },

    /** 合言葉でドライブの鍵を開き、このパソコンで使う */
    async unlock(passphrase) {
      if (!account()) throw new Error('Google と連携していません');
      const remote = await remoteKeyring();
      if (!remote) throw new Error('ドライブに合言葉の鍵がありません');
      const master = await openKeyring(remote.ring, passphrase);
      await secrets.set('cloud.key', toB64(master));
      onChange();
      api.push().catch(() => {});
      return {ok: true};
    },

    /** iPad に鍵を渡す QR の中身（連携していて、鍵があるときだけ） */
    async keyQr() {
      if (!account()) throw new Error('Google と連携していません');
      const master = await masterKey();
      if (!master) throw new Error('暗号化の鍵がありません。連携し直してください');
      return keyQr(master);
    },

    /** 連携を外す（ドライブのデータと鍵は残す。同じアカウントで連携し直せば続きから） */
    async unlink() {
      const saved = await secrets.get('cloud.google').catch(() => null);
      if (saved?.refreshToken) await revoke(saved.refreshToken, fetch);
      await secrets.remove('cloud.google');
      repo.removeSetting('cloud.account');
      access = null;
      onChange();
      return {ok: true};
    },

    /** 送る（送っている最中なら、それが終わるのを待つ） */
    push() {
      if (!account()) return Promise.reject(new Error('Google と連携していません'));
      busy ??= (async () => {
        onChange();
        const at = now().toISOString();
        try {
          const r = await (await pusher()).push();
          record({at, ok: true, uploaded: r.uploaded, bytes: r.bytes, removed: r.removed});
          if (r.uploaded) log(`cloud: ${r.uploaded} 件を送りました（${r.bytes} バイト）`);
          return r;
        } catch (e) {
          record({at, ok: false, message: e.message});
          log(`cloud: 送れませんでした：${e.message}`);
          throw e;
        } finally {
          busy = null;
          onChange();
        }
      })();
      return busy;
    },

    /** ドライブのこのアプリの中身を消し、鍵を作り直す（ほかの鍵で作ったものがあって読めないとき・やり直すとき） */
    async wipe() {
      if (!account()) throw new Error('Google と連携していません');
      await busy?.catch(() => {});
      for (const f of await drive.list()) await drive.remove(f.id);
      await secrets.set('cloud.key', toB64(newMasterKey()));
      repo.removeSetting('cloud.last');
      repo.removeSetting('cloud.keyring'); // 合言葉の鍵も消えた（決め直す）
      onChange();
      return {ok: true};
    },

    /** 連携しているあいだ、30 分ごとに送る */
    start(everyMs = PUSH_EVERY_MS) {
      clearInterval(timer);
      timer = setInterval(() => {
        if (account() && googleReady(config)) api.push().catch(() => {});
      }, everyMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    }
  };
  return api;
}
