// iPad アプリの最初の画面（docs/MOBILE.md §8）：パソコンの QR を読んで、パソコンの「パソコンと同じ画面」をアプリの中で開く。
// - 一度つないだら、パソコンの入口（http://<LAN の番号>:<番号>）を覚え、次からはすぐ開く（届かなければこの画面で知らせる）
// - アプリはパソコンが作った証明書の https を開けないので、QR の hp（http の入口の番号）で http を開く。中身は端末ごとの鍵で暗号化している
// - 鍵は開いた先（パソコンのページ）がアプリの中に覚える。ここでは QR の # をそのまま渡す（パソコンのページが鍵を入れ替える）
import {fromQr} from './qr.js';

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

let stream = null;
const stopCamera = () => {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
};

function render(message = '') {
  stopCamera();
  const s = saved();
  app.innerHTML = `
    <h1>パレットノート</h1>
    <p>パソコンのパレットノートとつなぎます。パソコンの 設定 → スマホ の「スマホを追加」で QR を出し、下のボタンから読んでください。つないだあと、パソコンでこの iPad の「パソコンと同じ画面を使う」をオンにします。</p>
    <p class="s-muted">パソコンのパレットノートが開いていて、同じ Wi-Fi にあるあいだ使えます。</p>
    ${message ? `<p class="s-error">${esc(message)}</p>` : ''}
    <div class="s-row">
      <button type="button" class="s-btn s-btn--primary" data-v="scan">パソコンの QR を読む</button>
      ${s ? '<button type="button" class="s-btn" data-v="retry">前のパソコンにもう一度つなぐ</button>' : ''}
    </div>`;
  app.querySelector('[data-v="scan"]').onclick = scan;
  const retry = app.querySelector('[data-v="retry"]');
  if (retry) retry.onclick = () => start();
}

async function scan() {
  app.innerHTML = `<h1>パソコンの QR を読む</h1><video class="s-video" playsinline muted></video><div class="s-row"><button type="button" class="s-btn" data-v="cancel">やめる</button></div>`;
  app.querySelector('[data-v="cancel"]').onclick = () => render();
  const video = app.querySelector('video');
  try {
    stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}, audio: false});
  } catch {
    return render('カメラを使えませんでした。iPad の 設定 → パレットノート で「カメラ」をオンにしてください。');
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const tick = () => {
    if (!stream) return;
    if (video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR?.(img.data, img.width, img.height);
      if (code?.data) {
        const r = fromQr(code.data);
        if (r) {
          stopCamera();
          remember(r.base);
          return open(r.base, r.hash);
        }
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
}

async function start() {
  const s = saved();
  if (!s?.base) return render();
  app.innerHTML = '<p class="s-muted">パソコンにつないでいます…</p>';
  if (await reachable(s.base)) return open(s.base);
  render(
    'パソコンに届きません。パソコンのパレットノートが開いていて、「スマホとつなぐ」がオンで、同じ Wi-Fi にあるか確かめてください。'
  );
}

start();
