// iPad アプリの最初の画面（docs/MOBILE.md §8・docs/SYNC.md）。2 つの使い方を選ぶ：
// - パソコンにつなぐ：パソコンの QR を読んで、パソコンの「パソコンと同じ画面」をアプリの中で開く
//   - 一度つないだら、パソコンの入口（http://<LAN の番号>:<番号>）を覚え、次からはすぐ開く（届かなければこの画面で知らせる）
//   - アプリはパソコンが作った証明書の https を開けないので、QR の hp（http の入口の番号）で http を開く。中身は端末ごとの鍵で暗号化している
//   - 鍵は開いた先（パソコンのページ）がアプリの中に覚える。ここでは QR の # をそのまま渡す（パソコンのページが鍵を入れ替える）
// - パソコンなしで使う（Google ドライブ）：cloud/screen.js
import {fromQr} from './qr.js';
import {bindPhoto, photoButton, scan, stopCamera} from './scanner.js';
import {cloudReady, openCloud} from './cloud/screen.js';

const KEY = 'palette.pc';
const app = document.getElementById('app');
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]
  );

const saved = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
};
const remember = (base) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({base}));
  } catch {
    // 覚えられなくても、いまは開ける
  }
};

/** パソコンに届くか（中身は読まない） */
async function reachable(base) {
  try {
    await fetch(`${base}/m/`, {mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(4000)});
    return true;
  } catch {
    return false;
  }
}

const open = (base, hash = '') => location.replace(`${base}/m/${hash}`);

/** パソコンにつなぐ QR の読み方 */
const pcQr = {
  title: 'パソコンの QR を読む',
  wrong:
    'パレットノートの QR ではありませんでした。パソコンの 設定 → スマホ の「スマホを追加」の QR を撮ってください。',
  accept(data) {
    const r = fromQr(data);
    if (!r) return false;
    stopCamera();
    remember(r.base);
    open(r.base, r.hash);
    return true;
  },
  back: (message) => render(message)
};

function render(message = '') {
  stopCamera();
  const s = saved();
  app.innerHTML = `
    <h1>パレットノート</h1>
    ${message ? `<p class="s-error">${esc(message)}</p>` : ''}
    <h2>パソコンにつなぐ</h2>
    <p>パソコンの 設定 → スマホ の「スマホを追加」で QR を出し、下のボタンから読んでください。つないだあと、パソコンでこの iPad の「パソコンと同じ画面を使う」をオンにします。</p>
    <p class="s-muted">パソコンのパレットノートが開いていて、同じ Wi-Fi にあるあいだ使えます。</p>
    <div class="s-row">
      <button type="button" class="s-btn s-btn--primary" data-v="scan">パソコンの QR を読む</button>
      ${photoButton()}
      ${s ? '<button type="button" class="s-btn" data-v="retry">前のパソコンにもう一度つなぐ</button>' : ''}
    </div>
    <h2>パソコンなしで使う（Google ドライブ）</h2>
    <p>パソコンが Google ドライブに置いたデータを、この iPad に読み込みます${cloudReady() ? '（準備ができています）' : ''}。</p>
    <div class="s-row">
      <button type="button" class="s-btn" data-v="cloud">パソコンなしで使う</button>
    </div>`;
  app.querySelector('[data-v="scan"]').onclick = () => scan(app, pcQr);
  bindPhoto(app, pcQr);
  const retry = app.querySelector('[data-v="retry"]');
  if (retry) retry.onclick = () => start();
  app.querySelector('[data-v="cloud"]').onclick = () => openCloud(app, () => render());
}

async function start() {
  const s = saved();
  if (!s?.base) return render();
  app.innerHTML = '<p class="s-muted">パソコンにつないでいます…</p>';
  if (await reachable(s.base)) return open(s.base);
  render(
    'パソコンに届きません。パソコンのパレットノートが開いていて、「スマホとつなぐ」がオンで、同じ Wi-Fi にあるか確かめてください。パソコンなしで使うこともできます。'
  );
}

start();
