// iPad アプリの「パソコンなしで使う（Google ドライブ）」の画面（docs/SYNC.md 段階 2）：
// 1. Google にログインする（パソコンと同じアカウント） 2. パソコンの「iPad に鍵を渡す」の QR を読む 3. ドライブから読み込む
// 覚えるもの（この iPad のアプリの中）：更新用のトークン・メールアドレス・鍵・鍵の印・最後に読み込んだ結果
import {fingerprint, readKeyQr} from '../shared/vault-keys.js';
import {bindPhoto, photoButton, scan, stopCamera} from '../scanner.js';
import {codeOf, createDriveReader, exchange, refresh, revoke, startLogin} from './google.js';
import {pull} from './pull.js';
import {fromB64, http, login, store, toB64} from './native.js';

const KEY = 'palette.cloud';
/** パソコンなしで使う画面（パソコンの画面を、このアプリの中の窓口で動かす。build-www.mjs が入れる） */
export const LOCAL_APP = '/m/p/src/renderer/index.html';
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]
  );
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? {};
  } catch {
    return {};
  }
};
const save = (patch) => {
  const next = {...load(), ...patch};
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
};
const masterOf = (s) => (s.key ? fromB64(s.key) : null);

/** ログインして鍵もある（ドライブから読み込める） */
export const cloudReady = () => {
  const s = load();
  return !!(s.refreshToken && s.key);
};

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const when = (iso) => (iso ? new Date(iso).toLocaleString('ja-JP', {dateStyle: 'short', timeStyle: 'short'}) : '');

/** この画面を開く。back：最初の画面に戻る */
export function openCloud(app, back) {
  let access = null; // {accessToken, expiresAt}
  const getToken = async (fresh) => {
    if (!fresh && access && access.expiresAt - Date.now() > 60_000) return access.accessToken;
    const s = load();
    if (!s.refreshToken) throw new Error('Google にログインしていません');
    access = await refresh(http, {refreshToken: s.refreshToken});
    return access.accessToken;
  };

  const render = (message = '', error = false) => {
    stopCamera();
    const s = load();
    const step = !s.refreshToken ? 1 : !s.key ? 2 : 3;
    app.innerHTML = `
      <h1>パソコンなしで使う</h1>
      <p class="s-muted">パソコンが Google ドライブに置いたデータ（暗号化したもの）を、この iPad に読み込みます。パソコンで、設定 → データ の「Google と連携する」を済ませておいてください。</p>
      ${message ? `<p class="${error ? 's-error' : ''}">${esc(message)}</p>` : ''}
      <ol class="s-steps">
        <li class="${step > 1 ? 's-done' : ''}">Google にログインする（パソコンと同じアカウント）${s.email ? `：<strong>${esc(s.email)}</strong>` : ''}</li>
        <li class="${step > 2 ? 's-done' : ''}">パソコンの 設定 → データ の「iPad に鍵を渡す」の QR を読む${s.fp ? `：鍵の印 <code>${esc(s.fp)}</code>` : ''}</li>
        <li>ドライブから読み込む${s.last ? `：${esc(when(s.last.at))} に読み込みました（資料 ${s.last.materials} 件）` : ''}</li>
      </ol>
      <div class="s-row" data-v="actions">
        ${step === 1 ? '<button type="button" class="s-btn s-btn--primary" data-v="login">Google にログイン</button>' : ''}
        ${step === 2 ? `<button type="button" class="s-btn s-btn--primary" data-v="key">鍵の QR を読む</button>${photoButton()}` : ''}
        ${step === 3 && s.last ? '<button type="button" class="s-btn s-btn--primary" data-v="open">ノートを開く</button>' : ''}
        ${step === 3 ? `<button type="button" class="s-btn ${s.last ? '' : 's-btn--primary'}" data-v="pull">ドライブから読み込む</button>` : ''}
        <button type="button" class="s-btn" data-v="back">戻る</button>
      </div>
      <p class="s-muted" data-v="progress"></p>
      ${step === 3 ? '<p class="s-muted">iPad で書いたものは、まだパソコンには戻りません（次の版で戻せるようにします）。パソコンで新しく送ったものを読み込むと、iPad で書いたものはパソコンのものに置き換わります。</p>' : ''}
      ${s.refreshToken ? '<div class="s-row"><button type="button" class="s-btn" data-v="reset">この iPad から外す</button></div>' : ''}`;
    const on = (v, fn) => {
      const b = app.querySelector(`[data-v="${v}"]`);
      if (b) b.onclick = fn;
    };
    on('back', back);
    on('login', doLogin);
    on('key', () => scan(app, keyQr));
    if (step === 2) bindPhoto(app, keyQr);
    on('pull', doPull);
    on('open', () => location.assign(LOCAL_APP));
    on('reset', doReset);
  };

  /** 鍵の QR の読み方 */
  const keyQr = {
    title: '鍵の QR を読む',
    wrong: '鍵の QR ではありませんでした。パソコンの 設定 → データ の「iPad に鍵を渡す」で出した QR を撮ってください。',
    accept(data) {
      const master = readKeyQr(data);
      if (!master) return false;
      save({key: toB64(master), fp: fingerprint(master)});
      render('鍵を受け取りました。パソコンの画面の鍵の印と同じか確かめてください。');
      return true;
    },
    back: (message) => render(message, !!message)
  };

  async function doLogin() {
    const {url, verifier, state} = startLogin();
    render('Safari の画面で Google にログインしてください…');
    try {
      const back = await login(url);
      if (!back) return render('ログインをやめました。', true);
      const code = codeOf(back, state);
      if (!code) return render('Google のログインの戻りが不正です。もう一度試してください。', true);
      const r = await exchange(http, {code, verifier});
      access = {accessToken: r.accessToken, expiresAt: r.expiresAt};
      save({refreshToken: r.refreshToken, email: r.email});
      render('ログインしました。');
    } catch (e) {
      render(e.message, true);
    }
  }

  async function doPull() {
    const s = load();
    const master = masterOf(s);
    if (!master) return render('鍵がありません。鍵の QR を読んでください。', true);
    for (const b of app.querySelectorAll('[data-v="actions"] button')) b.disabled = true;
    const progress = app.querySelector('[data-v="progress"]');
    progress.textContent = 'ドライブを確かめています…';
    try {
      const drive = createDriveReader({http, getToken});
      const r = await pull({
        drive,
        store,
        master,
        onProgress: ({done, total, bytes}) => {
          progress.textContent = total ? `読み込んでいます… ${done} / ${total}（${mb(bytes)}）` : '';
        }
      });
      save({last: {at: new Date().toISOString(), materials: r.materials, bytes: r.bytes}});
      render(
        r.downloaded
          ? `読み込みました（新しく ${r.downloaded} 件・${mb(r.bytes)}${r.removed ? `・消したもの ${r.removed} 件` : ''}）。`
          : '新しいものはありませんでした。'
      );
    } catch (e) {
      render(e.message, true);
    }
  }

  async function doReset() {
    if (
      !confirm(
        'この iPad から Google のログインと鍵、読み込んだデータを外しますか？ パソコンとドライブのデータは消えません。'
      )
    )
      return;
    const s = load();
    if (s.refreshToken) await revoke(http, s.refreshToken);
    await store.clear();
    localStorage.removeItem(KEY);
    access = null;
    render('外しました。');
  }

  render();
}
