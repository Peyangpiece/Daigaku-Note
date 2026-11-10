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
      ${photoButton()}
      ${s ? '<button type="button" class="s-btn" data-v="retry">前のパソコンにもう一度つなぐ</button>' : ''}
    </div>`;
  app.querySelector('[data-v="scan"]').onclick = () => scan();
  bindPhoto();
  const retry = app.querySelector('[data-v="retry"]');
  if (retry) retry.onclick = () => start();
}

/** 見つけた QR の中身で、パソコンを開く。違う QR なら false */
function useQr(data) {
  const r = fromQr(data);
  if (!r) return false;
  stopCamera();
  remember(r.base);
  open(r.base, r.hash);
  return true;
}

/** 絵（動画の 1 コマ・写真）から QR を探す。大きな写真は縮めてから読む（jsQR は大きいと遅い） */
function readImage(source, w, h, max = 0) {
  const k = max && Math.max(w, h) > max ? max / Math.max(w, h) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return window.jsQR?.(img.data, img.width, img.height, {inversionAttempts: 'attemptBoth'})?.data ?? null;
}

/** 写真で読む：iPad のカメラの画面で撮る（アプリの中の映像が映らないときも使える） */
async function readPhoto(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // そのまま・縮めて、の順に試す（写真の中の QR が小さいときは、縮めると読めないことがある）
    for (const max of [1600, 2400, 1000]) {
      const data = readImage(img, img.naturalWidth, img.naturalHeight, max);
      if (data && useQr(data)) return;
      if (data)
        return render(
          'パレットノートの QR ではありませんでした。パソコンの 設定 → スマホ の「スマホを追加」の QR を撮ってください。'
        );
    }
    render('写真から QR を見つけられませんでした。QR が画面いっぱいに、ぼやけずに写るように撮ってください。');
  } catch {
    render('写真を読めませんでした。もう一度撮ってください。');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const photoButton = () =>
  '<label class="s-btn s-btn--file">写真を撮って読む<input type="file" accept="image/*" capture="environment" data-v="photo" /></label>';
const bindPhoto = () => {
  const input = app.querySelector('[data-v="photo"]');
  if (input) input.onchange = () => readPhoto(input.files?.[0]);
};

async function scan(facing = 'environment') {
  app.innerHTML = `<h1>パソコンの QR を読む</h1>
    <p class="s-muted">iPad の${facing === 'user' ? '画面の側' : '裏'}のカメラを、パソコンの画面の QR に向けてください。</p>
    <video class="s-video" autoplay playsinline muted></video>
    <p class="s-error" data-v="hint" hidden></p>
    <div class="s-row">
      ${photoButton()}
      <button type="button" class="s-btn" data-v="flip">${facing === 'user' ? '裏のカメラにする' : '画面の側のカメラにする'}</button>
      <button type="button" class="s-btn" data-v="cancel">やめる</button>
    </div>`;
  app.querySelector('[data-v="cancel"]').onclick = () => render();
  app.querySelector('[data-v="flip"]').onclick = () => {
    stopCamera();
    scan(facing === 'user' ? 'environment' : 'user');
  };
  bindPhoto();
  const video = app.querySelector('video');
  const hint = app.querySelector('[data-v="hint"]');
  if (!navigator.mediaDevices?.getUserMedia) {
    hint.hidden = false;
    hint.textContent = 'この画面ではカメラの映像を出せません。「写真を撮って読む」を使ってください。';
    return;
  }
  // 映像が来ない（許可の確認が出ない・カメラがふさがっている）ときは、写真で読むよう知らせる
  const slow = setTimeout(() => {
    if (!video.videoWidth) {
      hint.hidden = false;
      hint.textContent =
        'カメラの映像が届きません。iPad を立ててカメラを QR に向けるか、「写真を撮って読む」を使ってください。';
    }
  }, 4000);
  try {
    stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: facing}, audio: false});
  } catch {
    clearTimeout(slow);
    hint.hidden = false;
    hint.textContent =
      'カメラを使えませんでした。iPad の 設定 → パレットノート で「カメラ」をオンにするか、「写真を撮って読む」を使ってください。';
    return;
  }
  if (!video.isConnected) return stopCamera(); // 待つ間に「やめる」を押した
  video.srcObject = stream;
  await video.play().catch(() => {});
  const tick = () => {
    if (!stream || !video.isConnected) return;
    if (video.videoWidth) {
      hint.hidden = true;
      const data = readImage(video, video.videoWidth, video.videoHeight, 960);
      if (data && useQr(data)) return clearTimeout(slow);
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
