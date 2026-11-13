// iPad アプリの「パソコンなしで使う（Google ドライブ）」の画面（docs/SYNC.md 段階 2）：
// 1. Google にログインする（パソコンと同じアカウント） 2. パソコンの「iPad に鍵を渡す」の QR を読む 3. ドライブから読み込む
// 覚えるもの（この iPad のアプリの中）：更新用のトークン・メールアドレス・鍵・鍵の印・最後に読み込んだ結果
import {fingerprint, readKeyQr} from '../shared/vault-keys.js';
import {
  KEYRING,
  keyringBytes,
  makeKeyring,
  openKeyring,
  passphraseProblem,
  readKeyringBytes
} from '../shared/keyring.js';
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
      <p class="s-muted">Google にログインし、合言葉を入れると使えます。データは暗号化して、あなたの Google ドライブ（このアプリだけの見えない領域）に置きます。パソコンのパレットノートがあれば、同じデータを使えます（パソコンで 設定 → データ の「Google と連携する」と「合言葉を決める」を済ませておきます）。</p>
      ${message ? `<p class="${error ? 's-error' : ''}">${esc(message)}</p>` : ''}
      <ol class="s-steps">
        <li class="${step > 1 ? 's-done' : ''}">Google にログインする（パソコンと同じアカウント）${s.email ? `：<strong>${esc(s.email)}</strong>` : ''}</li>
        <li class="${step > 2 ? 's-done' : ''}">合言葉を入れる（初めてなら決める）${s.fp ? `：鍵の印 <code>${esc(s.fp)}</code>` : ''}</li>
        <li>ドライブから読み込む${s.last ? `：${esc(when(s.last.at))} に読み込みました（資料 ${s.last.materials} 件）` : ''}</li>
      </ol>
      <div class="s-row" data-v="actions">
        ${step === 1 ? '<button type="button" class="s-btn s-btn--primary" data-v="login">Google にログイン</button>' : ''}
        ${step === 2 ? keyStep() : ''}
        ${step === 3 && (s.last || s.fresh) ? '<button type="button" class="s-btn s-btn--primary" data-v="open">ノートを開く</button>' : ''}
        ${step === 3 ? `<button type="button" class="s-btn ${s.last || s.fresh ? '' : 's-btn--primary'}" data-v="pull">ドライブから読み込む</button>` : ''}
        <button type="button" class="s-btn" data-v="back">戻る</button>
      </div>
      <p class="s-muted" data-v="progress"></p>
      ${step === 3 && unsent() ? `<p class="s-error">この iPad で書いたものを、まだドライブへ送れていません：${esc(unsent())}</p>` : ''}
      ${
        step === 3
          ? s.fresh && !s.last
            ? '<p class="s-muted">このアカウントでは初めてなので、iPad だけで新しく始めます（「ノートを開く」）。PDF などは iPad のファイルから取り込みます。manabo からの自動取得と、Claude Code での問題作成はパソコンだけでできます。</p>'
            : '<p class="s-muted">iPad で書いたものは、まだパソコンには戻りません（次の版で戻せるようにします）。パソコンで新しく送ったものを読み込むと、iPad で書いたものはパソコンのものに置き換わります。</p>'
          : ''
      }
      ${s.refreshToken ? '<div class="s-row"><button type="button" class="s-btn" data-v="reset">この iPad から外す</button></div>' : ''}`;
    const on = (v, fn) => {
      const b = app.querySelector(`[data-v="${v}"]`);
      if (b) b.onclick = fn;
    };
    on('back', back);
    on('login', doLogin);
    on('key', () => scan(app, keyQr));
    if (step === 2) {
      bindPhoto(app, keyQr);
      if (!remote) probe();
    }
    on('unlock', doUnlock);
    on('create', doCreate);
    on('recheck', () => {
      remote = null;
      render();
    });
    on('pull', doPull);
    on('open', () => location.assign(LOCAL_APP));
    on('reset', doReset);
  };

  // ---- 合言葉（docs/SYNC.md §9）----
  let remote = null; // ドライブの様子：{kind: 'checking' | 'ring' | 'pc' | 'empty' | 'error', ring?, message?}
  const drive = () => createDriveReader({http, getToken});
  async function probe() {
    remote = {kind: 'checking'};
    try {
      const list = await drive().list();
      const ring = list.find((f) => f.name === KEYRING);
      if (ring) remote = {kind: 'ring', ring: readKeyringBytes(await drive().get(ring.id)), id: ring.id};
      else remote = {kind: list.some((f) => f.name === 'manifest') ? 'pc' : 'empty'};
    } catch (e) {
      remote = {kind: 'error', message: e.message};
    }
    render();
  }
  const qrButtons = () =>
    `<button type="button" class="s-btn" data-v="key">パソコンの鍵の QR を読む</button>${photoButton()}`;
  const pass = (v, label) =>
    `<label class="s-field">${label}<input type="password" class="s-input" data-v="${v}" maxlength="200" autocomplete="off" /></label>`;
  function keyStep() {
    const k = remote?.kind;
    if (!k || k === 'checking') return '<p class="s-muted">ドライブを確かめています…</p>';
    if (k === 'error')
      return `<p class="s-error">${esc(remote.message)}</p><button type="button" class="s-btn" data-v="recheck">もう一度確かめる</button>`;
    if (k === 'ring')
      return `<div class="s-col">${pass('pass', '合言葉')}<div class="s-row"><button type="button" class="s-btn s-btn--primary" data-v="unlock">鍵を受け取る</button>${qrButtons()}</div></div>`;
    if (k === 'pc')
      return `<p>このアカウントのドライブには、パソコンが送ったデータがあります。パソコンの 設定 → データ で「合言葉を決める…」を押してから、もう一度確かめてください（パソコンの「iPad に鍵を渡す」の QR を読んでもかまいません）。</p><div class="s-row"><button type="button" class="s-btn s-btn--primary" data-v="recheck">もう一度確かめる</button>${qrButtons()}</div>`;
    return `<div class="s-col"><p>このアカウントでは初めてです。合言葉を決めてください（10 文字以上。長く、ほかで使っていないもの。パソコンを持っていなくても使えます）。<strong>合言葉を忘れると、ドライブのデータは誰にも開けません。</strong>パソコンのパレットノートをあとで使うときも、同じ合言葉を入れます。</p>${pass('pass', '合言葉')}${pass('pass2', 'もう一度')}<div class="s-row"><button type="button" class="s-btn s-btn--primary" data-v="create">合言葉を決める</button></div></div>`;
  }
  const passValue = (v) => app.querySelector(`[data-v="${v}"]`)?.value ?? '';
  const busy = (text) => {
    for (const b of app.querySelectorAll('button')) b.disabled = true;
    const p = app.querySelector('[data-v="progress"]');
    if (p) p.textContent = text;
  };
  async function doUnlock() {
    const p = passValue('pass');
    if (!p) return render('合言葉を入れてください。', true);
    busy('合言葉を確かめています…（少しかかります）');
    try {
      const master = await openKeyring(remote.ring, p);
      save({key: toB64(master), fp: fingerprint(master)});
      render('鍵を受け取りました。');
    } catch (e) {
      render(e.message, true);
    }
  }
  async function doCreate() {
    const p = passValue('pass');
    const problem = passphraseProblem(p);
    if (problem) return render(problem, true);
    if (p !== passValue('pass2')) return render('2 回入れた合言葉が違います。', true);
    busy('合言葉で鍵を包んでいます…（少しかかります）');
    try {
      const master = globalThis.crypto.getRandomValues(new Uint8Array(32));
      const ring = await makeKeyring(master, p, {device: 'iPad'});
      await drive().putText(KEYRING, new TextDecoder().decode(keyringBytes(ring)));
      save({key: toB64(master), fp: fingerprint(master), fresh: true});
      remote = null;
      render('合言葉を決めました。');
    } catch (e) {
      render(e.message, true);
    }
  }

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
      remote = null;
      render('ログインしました。');
    } catch (e) {
      render(e.message, true);
    }
  }

  /** ノートの画面（src/local/client.js）が最後にドライブへ送れなかったときの理由。送れていれば・試していなければ null */
  const unsent = () => {
    try {
      const last = JSON.parse(localStorage.getItem('palette.cloud.last') ?? 'null');
      return last && last.ok === false ? String(last.message ?? '送れませんでした') : null;
    } catch {
      return null;
    }
  };

  async function doPull() {
    const s = load();
    const master = masterOf(s);
    if (!master) return render('鍵がありません。鍵の QR を読んでください。', true);
    // この iPad で書いたものをドライブへ送れていない（パソコンのデータがあるので止めている）ときは、読み込むと消える。先に確かめる
    if (
      unsent() &&
      !confirm(
        'この iPad で書いたものの中に、まだドライブへ送れていないものがあります。ドライブから読み込むと、それらはドライブのデータに置き換わって消えます（控えは残りません）。読み込みますか？'
      )
    )
      return;
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
        'この iPad から Google のログインと鍵、読み込んだデータを外しますか？ この iPad で書いて、まだドライブへ送っていないものは消えます。パソコンとドライブのデータは消えません。'
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
