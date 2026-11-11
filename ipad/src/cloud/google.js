// iPad アプリの Google との連携（docs/SYNC.md §2）：iOS のクライアントの OAuth 2.0（PKCE）と、ドライブの appDataFolder を読む。
// 通信（http）・乱数は外から渡す（テストで差し替える）。iOS のクライアントは秘密を使わない（Google の決まり）
import {sha256} from '@noble/hashes/sha2.js';
import {GOOGLE_IOS, GOOGLE_SCOPES} from '../shared/google-client.js';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export const b64url = (b) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const randomB64 = (n) => b64url(globalThis.crypto.getRandomValues(new Uint8Array(n)));

/** ログインの始まり：ブラウザで開く URL と、戻ってきたときに使う verifier・state */
export function startLogin({client = GOOGLE_IOS} = {}) {
  const verifier = randomB64(48);
  const state = randomB64(16);
  const challenge = b64url(sha256(new TextEncoder().encode(verifier)));
  const q = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent'
  });
  return {url: `${AUTH}?${q}`, verifier, state};
}

/** 戻ってきた URL（com.googleusercontent.apps…:/oauth2redirect?code=…）から code を取り出す。断られた・state が違うときは Error */
export function codeOf(url, state, client = GOOGLE_IOS) {
  const u = String(url ?? '');
  if (!u.startsWith(client.redirectUri)) return null; // ほかの URL（関係ない）
  const q = new URLSearchParams(u.slice(u.indexOf('?') + 1));
  if (q.get('error'))
    throw new Error(
      q.get('error') === 'access_denied'
        ? 'Google のログインがやめられました'
        : `Google のログインに失敗しました（${q.get('error')}）`
    );
  if (q.get('state') !== state) throw new Error('Google のログインの戻りが不正です。もう一度試してください');
  return q.get('code') ?? null;
}

/** id_token の中のメールアドレス（トークンの窓口から TLS で受け取ったものなので、署名は確かめない） */
export function emailOf(idToken) {
  try {
    const p = String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(p + '='.repeat((4 - (p.length % 4)) % 4))))).email ?? null;
  } catch {
    return null;
  }
}

const form = async (http, url, data) => {
  const r = await http.post(url, new URLSearchParams(data).toString());
  if (r.status < 200 || r.status >= 300) {
    const msg = r.json?.error_description || r.json?.error || `HTTP ${r.status}`;
    throw new Error(`Google のトークンを受け取れませんでした（${msg}）`);
  }
  return r.json;
};

/** code を、使うためのトークンと更新用のトークンに替える。戻り：{refreshToken, accessToken, expiresAt, email} */
export async function exchange(http, {code, verifier, client = GOOGLE_IOS}) {
  const r = await form(http, TOKEN, {
    client_id: client.clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: client.redirectUri
  });
  if (!r.refresh_token) throw new Error('Google から更新用のトークンが届きませんでした。もう一度ログインしてください');
  return {
    refreshToken: r.refresh_token,
    accessToken: r.access_token,
    expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000,
    email: emailOf(r.id_token)
  };
}

/** 更新用のトークンで、使うためのトークンを取り直す */
export async function refresh(http, {refreshToken, client = GOOGLE_IOS}) {
  const r = await form(http, TOKEN, {
    client_id: client.clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  return {accessToken: r.access_token, expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000};
}

/** トークンを取り消す（失敗しても続ける） */
export const revoke = (http, token) => http.post(`${REVOKE}?token=${encodeURIComponent(token)}`, '').catch(() => {});

/**
 * ドライブの appDataFolder を読む（パソコンが置いたもの）。getToken(fresh) は使うためのトークン。
 * 401 は 1 度だけ取り直して送り直す。429・5xx は少し待って 3 回まで
 */
export function createDriveReader({http, getToken, sleep = (ms) => new Promise((r) => setTimeout(r, ms))}) {
  const call = async (url, binary, send = null) => {
    for (let i = 0, fresh = false; ; i++) {
      const token = await getToken(fresh);
      const auth = {Authorization: `Bearer ${token}`};
      const r = send
        ? await http.send(send.method, url, {...auth, 'Content-Type': send.type}, send.body)
        : await http.get(url, auth, binary);
      if (r.status === 401 && !fresh) {
        fresh = true;
        continue;
      }
      if ((r.status === 429 || r.status >= 500) && i < 3) {
        await sleep(500 * 2 ** i);
        continue;
      }
      if (r.status < 200 || r.status >= 300) throw new Error(`Google ドライブで失敗しました（${r.status}）`);
      return binary ? r.bytes : r.json;
    }
  };
  return {
    /** 置いてあるもの：[{id, name, size}] */
    async list() {
      const out = [];
      let page = '';
      do {
        const q = new URLSearchParams({
          spaces: 'appDataFolder',
          fields: 'nextPageToken,files(id,name,size)',
          pageSize: '1000',
          ...(page ? {pageToken: page} : {})
        });
        const r = await call(`${DRIVE}/files?${q}`, false);
        out.push(...(r.files ?? []).map((f) => ({id: f.id, name: f.name, size: Number(f.size) || 0})));
        page = r.nextPageToken ?? '';
      } while (page);
      return out;
    },
    get: (id) => call(`${DRIVE}/files/${id}?alt=media`, true),
    /** 中身（バイト列）を置く（iPad から送る。id があれば入れ替える）。戻り：{id} */
    put(name, bytes, id = null) {
      const b = `palette${Math.random().toString(36).slice(2)}${Date.now()}`;
      const meta = JSON.stringify(id ? {} : {name, parents: ['appDataFolder']});
      const te = new TextEncoder();
      const head = te.encode(
        `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/octet-stream\r\n\r\n`
      );
      const tail = te.encode(`\r\n--${b}--`);
      const body = new Uint8Array(head.length + bytes.length + tail.length);
      body.set(head);
      body.set(bytes, head.length);
      body.set(tail, head.length + bytes.length);
      const url = id
        ? `${UPLOAD}/files/${id}?uploadType=multipart&fields=id`
        : `${UPLOAD}/files?uploadType=multipart&fields=id`;
      return call(url, false, {method: id ? 'PATCH' : 'POST', type: `multipart/related; boundary=${b}`, body});
    },
    /** 消す */
    remove: (id) => call(`${DRIVE}/files/${id}`, false, {method: 'DELETE', type: 'application/json', body: undefined}),
    /** 文字の中身を置く（合言葉で包んだ鍵など。id があれば入れ替える）。戻り：{id} */
    putText(name, text, id = null) {
      const b = `palette${Math.random().toString(36).slice(2)}${Date.now()}`;
      const meta = JSON.stringify(id ? {} : {name, parents: ['appDataFolder']});
      const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${b}--`;
      const url = id
        ? `${UPLOAD}/files/${id}?uploadType=multipart&fields=id`
        : `${UPLOAD}/files?uploadType=multipart&fields=id`;
      return call(url, false, {method: id ? 'PATCH' : 'POST', type: `multipart/related; boundary=${b}`, body});
    }
  };
}
