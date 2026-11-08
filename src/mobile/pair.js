// スマホのページを使い始める（docs/MOBILE.md §2）：先にホーム画面に追加し、追加したアイコンから開いて、パソコンの QR を読んでつなぐ。
// - QR をスマホのカメラで読んでブラウザで開いたとき：ホーム画面に追加する案内（renderInstall）。ここではつながない
//   （iPhone はホーム画面のアイコンをブラウザと別に覚えるので、ブラウザでつなぐとアイコンからは使えず、1 回きりの QR も使い切るため）
// - アイコンから開いて、まだつないでいないとき：カメラでパソコンの QR を読む（renderPairScan）。読めたらつなぎ、
//   パソコンで「アナログノート…」を開いていれば、そのまま読み取りが始まる
const JSQR = '/m/vendor/jsqr/jsQR.js';
let installPrompt = null; // Android の Chrome：「ホーム画面に追加」を出せる（beforeinstallprompt）
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});

const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** ホーム画面に追加する案内 */
export function renderInstall(app, {fromQr = true} = {}) {
  const ios = isIos();
  const steps = ios
    ? '<li>下（iPad は上）の共有ボタン（四角から上向きの矢印）を押す</li><li>「ホーム画面に追加」を選ぶ（なければ、一覧を下へ送る）</li><li>右上の「追加」を押す</li>'
    : '<li>右上のメニュー（︙）を押す</li><li>「ホーム画面に追加」か「アプリをインストール」を選ぶ</li><li>「追加」「インストール」を押す</li>';
  app.innerHTML = `
    <div class="m-install">
      <img class="m-install__icon" src="/m/app/icon-192.png" alt="" width="96" height="96" />
      <h1>パレットノートをホーム画面に追加してください</h1>
      ${installPrompt && !ios ? '<button type="button" class="m-btn m-btn--primary m-btn--wide" data-v="install">ホーム画面に追加</button>' : `<ol class="m-steps">${steps}</ol>`}
      <div class="m-card">
        <p><strong>追加したら、ホーム画面の「パレットノート」のアイコンから開いてください。</strong>カメラが開くので、${fromQr ? 'いま読んだ' : ''}パソコンの QR をもう一度読むと、つながります。</p>
        <p class="m-muted">${fromQr ? 'この QR はまだ使っていません（10 分のあいだ使えます）。時間が過ぎたら、パソコンで「QR を出す」を押し直してください。' : 'パソコンのパレットノートの「アナログノート…」の窓か、設定 → スマホとつなぐ で QR を出してください。'}</p>
      </div>
    </div>`;
  app.querySelector('[data-v="install"]')?.addEventListener('click', async () => {
    const p = installPrompt;
    installPrompt = null;
    await p?.prompt();
    renderInstall(app, {fromQr});
  });
}

/** jsQR（QR を読む）を読み込む。window.jsQR */
const loadJsQr = () =>
  window.jsQR
    ? Promise.resolve(window.jsQR)
    : new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = JSQR;
        s.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error('QR を読む準備ができませんでした')));
        s.onerror = () => reject(new Error('QR を読む準備ができませんでした'));
        document.head.append(s);
      });

/**
 * パソコンの QR をカメラで読む。読めたら onUrl(url) を呼ぶ（つなげる形の URL のときだけ）。後片付けの関数を返す。
 * 別のパソコン（入口の番号が違う）の QR は、このアイコンでは使えないので知らせる
 */
export async function renderPairScan(app, onUrl) {
  app.innerHTML = `
    <header class="m-head"><h1>パソコンとつなぐ</h1></header>
    <div class="m-scan__view">
      <video playsinline muted autoplay></video>
      <div class="m-pair__frame" aria-hidden="true"></div>
      <p class="m-scan__status" role="status">カメラを開いています…</p>
    </div>
    <div class="m-card"><p>パソコンのパレットノートの「アナログノート…」の窓（または 設定 → スマホとつなぐ）に出ている QR を、枠の中に写してください。</p></div>`;
  const video = app.querySelector('video');
  const say = (t) => (app.querySelector('.m-scan__status').textContent = t);
  let stream = null;
  let timer = 0;
  const stop = () => {
    clearInterval(timer);
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = null;
  };
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    say('このページではカメラを使えません。パソコンの QR をスマホのカメラで読んで開き直してください');
    return stop;
  }
  let jsQR;
  try {
    [jsQR, stream] = await Promise.all([
      loadJsQr(),
      navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: {ideal: 'environment'}}})
    ]);
  } catch (e) {
    say(
      e?.name === 'NotAllowedError'
        ? 'カメラを使えませんでした。設定で、このアプリにカメラを許可してください'
        : e.message
    );
    return stop;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  say('パソコンの QR を写してください');
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', {willReadFrequently: true});
  let done = false;
  timer = setInterval(() => {
    if (done || !video.videoWidth) return;
    const k = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
    c.width = Math.round(video.videoWidth * k);
    c.height = Math.round(video.videoHeight * k);
    ctx.drawImage(video, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const code = jsQR(img.data, img.width, img.height, {inversionAttempts: 'dontInvert'});
    if (!code?.data) return;
    let u;
    try {
      u = new URL(code.data);
    } catch {
      return say('パレットノートの QR ではありません。パソコンの「スマホとつなぐ」の QR を写してください');
    }
    if (!/#d=/.test(u.hash))
      return say('パレットノートの QR ではありません。パソコンの「スマホとつなぐ」の QR を写してください');
    if (u.origin !== location.origin)
      return say(
        'パソコンの入口（ネットワークの番号）が変わっています。この QR をスマホのカメラで読んで開き、もう一度ホーム画面に追加してください'
      );
    done = true;
    stop();
    say('つないでいます…');
    onUrl(code.data);
  }, 200);
  return stop;
}
