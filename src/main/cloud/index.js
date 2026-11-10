// Google ドライブでそろえる（docs/SYNC.md）：連携する・外す・送る。連携しているあいだは 30 分ごとに変わったものを送る。
// トークンと鍵は secrets.js（OS の仕組みで暗号化）に置く：cloud.google（更新用のトークン）・cloud.key（中身を包む元の鍵）
import os from 'node:os';
import {GOOGLE_DESKTOP, googleReady} from '../../shared/google-client.js';
import {fromB64, toB64} from '../../shared/mobile-wire.js';
import {createDrive, loginLoopback, refreshAccess, revoke} from './google.js';
import {fingerprint, keyQr, newMasterKey} from './keys.js';
import {createPusher} from './sync.js';
import {loadClientSecret} from './client-secret.js';

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
    return createPusher({drive, master, exportDb, materials, readMaterial, userData, device: os.hostname(), log, now});
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
