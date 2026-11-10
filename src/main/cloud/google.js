// Google との連携（docs/SYNC.md §2）：インストール型のアプリの OAuth 2.0（PKCE・ループバック）と、ドライブの appDataFolder の読み書き。
// fetch・ブラウザを開く関数は外から渡す（テストで差し替える）
import http from 'node:http';
import {createHash, randomBytes} from 'node:crypto';
import {GOOGLE_SCOPES} from '../../shared/google-client.js';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** id_token の中のメールアドレス（トークンの窓口から TLS で受け取ったものなので、署名は確かめない） */
export function emailOf(idToken) {
  try {
    return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email ?? null;
  } catch {
    return null;
  }
}

/** ログインのページの URL */
export function authUrl({clientId, redirectUri, challenge, state}) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline', // 更新用のトークン（パソコンが閉じていた間のあとも使う）
    prompt: 'consent'
  });
  return `${AUTH}?${q}`;
}

const PAGE = (msg) =>
  `<!doctype html><meta charset="utf-8"><title>パレットノート</title><body style="font-family:sans-serif;padding:40px;line-height:1.8"><h2>${msg}</h2><p>このページを閉じて、パレットノートに戻ってください。</p></body>`;

/**
 * 既定のブラウザで Google のログインを開き、このパソコンの 127.0.0.1 の一時の口で受け取る。
 * 戻り：{refreshToken, accessToken, expiresAt, email}
 */
export async function loginLoopback({
  clientId,
  clientSecret,
  openExternal,
  fetch = globalThis.fetch,
  timeoutMs = LOGIN_TIMEOUT_MS
}) {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  let server;
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('ログインが終わりませんでした（5 分）。もう一度試してください')),
      timeoutMs
    );
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/') return void res.writeHead(404).end();
      const done = (status, msg, result) => {
        res.writeHead(status, {'Content-Type': 'text/html; charset=utf-8'}).end(PAGE(msg));
        clearTimeout(timer);
        result();
      };
      if (url.searchParams.get('state') !== state) return void res.writeHead(400).end();
      if (url.searchParams.get('error'))
        return done(200, 'Google との連携をやめました', () => reject(new Error('Google との連携をやめました')));
      const c = url.searchParams.get('code');
      if (!c) return void res.writeHead(400).end();
      done(200, 'Google と連携しました', () => resolve(c));
    });
    server.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}`;
      server.redirectUri = redirectUri;
      Promise.resolve(openExternal(authUrl({clientId, redirectUri, challenge, state}))).catch(reject);
    });
  }).finally(() => server?.close());
  const r = await post(fetch, TOKEN, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: server.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier
  });
  if (!r.refresh_token) throw new Error('Google から更新用のトークンが来ませんでした。もう一度試してください');
  return {
    refreshToken: r.refresh_token,
    accessToken: r.access_token,
    expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000,
    email: emailOf(r.id_token)
  };
}

async function post(fetch, url, form) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams(form).toString()
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(
      body.error === 'invalid_grant'
        ? 'Google との連携が切れました。設定 → データ で連携し直してください'
        : `Google の窓口で失敗しました（${body.error ?? res.status}）`
    );
    e.code = body.error ?? String(res.status);
    throw e;
  }
  return body;
}

/** 更新用のトークンで、使うためのトークンを取り直す */
export async function refreshAccess({clientId, clientSecret, refreshToken, fetch = globalThis.fetch}) {
  const r = await post(fetch, TOKEN, {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  return {accessToken: r.access_token, expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000};
}

/** トークンを取り消す（連携を外す）。失敗しても続ける */
export async function revoke(token, fetch = globalThis.fetch) {
  await fetch(`${REVOKE}?token=${encodeURIComponent(token)}`, {method: 'POST'}).catch(() => {});
}

/**
 * ドライブの appDataFolder（このアプリだけの見えない領域）。getToken() は使うためのトークン（期限が切れていれば取り直す）。
 * 401 のときは 1 度だけトークンを取り直して送り直す。429・5xx は少し待って 3 回まで
 */
export function createDrive({
  getToken,
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms))
}) {
  const call = async (url, init = {}, raw = false) => {
    for (let i = 0, fresh = false; ; i++) {
      const token = await getToken(fresh);
      const res = await fetch(url, {...init, headers: {...(init.headers ?? {}), Authorization: `Bearer ${token}`}});
      if (res.status === 401 && !fresh) {
        fresh = true;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && i < 3) {
        await sleep(500 * 2 ** i);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Google ドライブで失敗しました（${res.status}）${body ? `：${body.slice(0, 200)}` : ''}`);
      }
      if (raw) return new Uint8Array(await res.arrayBuffer());
      return res.status === 204 ? null : res.json();
    }
  };
  const multipart = (meta, bytes) => {
    const boundary = `palette${randomBytes(12).toString('hex')}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--`);
    return {body: Buffer.concat([head, Buffer.from(bytes), tail]), type: `multipart/related; boundary=${boundary}`};
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
        const r = await call(`${DRIVE}/files?${q}`);
        out.push(...(r.files ?? []).map((f) => ({id: f.id, name: f.name, size: Number(f.size) || 0})));
        page = r.nextPageToken ?? '';
      } while (page);
      return out;
    },
    /** 置く。id があればその中身を入れ替える。戻り：{id} */
    async put(name, bytes, id = null) {
      const {body, type} = multipart(id ? {} : {name, parents: ['appDataFolder']}, bytes);
      const url = id
        ? `${UPLOAD}/files/${id}?uploadType=multipart&fields=id`
        : `${UPLOAD}/files?uploadType=multipart&fields=id`;
      return call(url, {method: id ? 'PATCH' : 'POST', headers: {'Content-Type': type}, body});
    },
    get: (id) => call(`${DRIVE}/files/${id}?alt=media`, {}, true),
    remove: (id) => call(`${DRIVE}/files/${id}`, {method: 'DELETE'})
  };
}
