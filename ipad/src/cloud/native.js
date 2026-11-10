// iPad アプリの、iOS の機能を使う部分（Capacitor のプラグイン）。テストでは使わない（google.js・pull.js は http・store を受け取る）
// - http：fetch で送り、ブラウザの決まり（CORS）で止められたら、アプリの通信（CapacitorHttp）で送り直す
// - store：アプリの中の書類の場所（Directory.Data の drive/）に、ドライブから読んだものを暗号化したまま置く
// - login：Safari の画面で Google にログインし、アプリに戻ってきた URL を受け取る
import {GOOGLE_IOS} from '../shared/google-client.js';

const plugins = () => window.Capacitor?.Plugins ?? {};
const DIR = 'DATA';
const BASE = 'drive';

// ---- バイト列と base64（Capacitor のプラグインは base64 でやりとりする） ----
export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const fromB64 = (b64) => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

const native = async (opts) => {
  const H = plugins().CapacitorHttp;
  if (!H) throw new Error('通信できませんでした。ネットワークにつながっているか確かめてください');
  return H.request(opts);
};

/** 通信。戻り：{status, json, bytes} */
export const http = {
  async get(url, headers = {}, binary = false) {
    try {
      const r = await fetch(url, {headers, cache: 'no-store'});
      return {
        status: r.status,
        json: binary ? null : await r.json().catch(() => null),
        bytes: binary ? new Uint8Array(await r.arrayBuffer()) : null
      };
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      const r = await native({url, method: 'GET', headers, responseType: binary ? 'arraybuffer' : 'json'});
      return {
        status: r.status,
        json: binary ? null : typeof r.data === 'string' ? JSON.parse(r.data || 'null') : r.data,
        bytes: binary ? fromB64(r.data ?? '') : null
      };
    }
  },
  async post(url, body) {
    const headers = {'Content-Type': 'application/x-www-form-urlencoded'};
    try {
      const r = await fetch(url, {method: 'POST', headers, body});
      return {status: r.status, json: await r.json().catch(() => null)};
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      const r = await native({url, method: 'POST', headers, data: body});
      return {status: r.status, json: typeof r.data === 'string' ? JSON.parse(r.data || 'null') : r.data};
    }
  }
};

const fs = () => plugins().Filesystem ?? null;

/** ドライブから読んだものを置く所 */
export const store = {
  async list() {
    const f = fs();
    if (!f) throw new Error('この iPad にファイルを置けません');
    try {
      const r = await f.readdir({path: BASE, directory: DIR});
      return (r.files ?? []).map((x) => (typeof x === 'string' ? x : x.name));
    } catch {
      return []; // まだ何も置いていない
    }
  },
  async get(name) {
    try {
      const r = await fs().readFile({path: `${BASE}/${name}`, directory: DIR});
      return fromB64(r.data);
    } catch {
      return null;
    }
  },
  async put(name, bytes) {
    await fs().writeFile({path: `${BASE}/${name}`, directory: DIR, data: toB64(bytes), recursive: true});
  },
  async remove(name) {
    await fs()
      .deleteFile({path: `${BASE}/${name}`, directory: DIR})
      .catch(() => {});
  },
  async clear() {
    await fs()
      ?.rmdir({path: BASE, directory: DIR, recursive: true})
      .catch(() => {});
  }
};

/**
 * Google のログインの画面（Safari）を開き、アプリに戻ってきた URL を待つ。戻り：戻ってきた URL。
 * 閉じた（やめた）ときは null
 */
export function login(url) {
  const {Browser, App} = plugins();
  if (!Browser || !App)
    return Promise.reject(new Error('この版のアプリでは Google にログインできません。アプリを新しくしてください'));
  return new Promise((resolve, reject) => {
    let done = false;
    const subs = [];
    const finish = (v, err = null) => {
      if (done) return;
      done = true;
      for (const s of subs) Promise.resolve(s).then((h) => h?.remove?.());
      Browser.close().catch(() => {});
      if (err) reject(err);
      else resolve(v);
    };
    subs.push(
      App.addListener('appUrlOpen', (ev) => {
        if (String(ev?.url ?? '').startsWith(GOOGLE_IOS.redirectUri)) finish(ev.url);
      })
    );
    subs.push(Browser.addListener('browserFinished', () => setTimeout(() => finish(null), 800)));
    Browser.open({url, presentationStyle: 'popover'}).catch((e) => finish(null, e));
  });
}
