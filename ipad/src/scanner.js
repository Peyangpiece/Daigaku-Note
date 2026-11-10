// iPad アプリ：QR を読む画面（パソコンにつなぐ QR・鍵を受け取る QR の両方で使う）。カメラの映像か、iPad のカメラで撮った写真から読む
let stream = null;
export const stopCamera = () => {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
};

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

/**
 * 読み方：{accept(data) → 使ったら true, back(message?) → 前の画面に戻る, wrong：違う QR だったときの言葉}
 * 写真で読む：iPad のカメラの画面で撮る（アプリの中の映像が映らないときも使える）
 */
async function readPhoto(file, how) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // そのまま・縮めて、の順に試す（写真の中の QR が小さいときは、縮めると読めないことがある）
    for (const max of [1600, 2400, 1000]) {
      const data = readImage(img, img.naturalWidth, img.naturalHeight, max);
      if (data && how.accept(data)) return;
      if (data) return how.back(how.wrong);
    }
    how.back('写真から QR を見つけられませんでした。QR が画面いっぱいに、ぼやけずに写るように撮ってください。');
  } catch {
    how.back('写真を読めませんでした。もう一度撮ってください。');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const photoButton = () =>
  '<label class="s-btn s-btn--file">写真を撮って読む<input type="file" accept="image/*" capture="environment" data-v="photo" /></label>';
export const bindPhoto = (root, how) => {
  const input = root.querySelector('[data-v="photo"]');
  if (input) input.onchange = () => readPhoto(input.files?.[0], how);
};

/** カメラの映像で読む画面。how に加えて title（見出し） */
export async function scan(root, how, facing = 'environment') {
  root.innerHTML = `<h1>${how.title}</h1>
    <p class="s-muted">iPad の${facing === 'user' ? '画面の側' : '裏'}のカメラを、パソコンの画面の QR に向けてください。</p>
    <video class="s-video" autoplay playsinline muted></video>
    <p class="s-error" data-v="hint" hidden></p>
    <div class="s-row">
      ${photoButton()}
      <button type="button" class="s-btn" data-v="flip">${facing === 'user' ? '裏のカメラにする' : '画面の側のカメラにする'}</button>
      <button type="button" class="s-btn" data-v="cancel">やめる</button>
    </div>`;
  root.querySelector('[data-v="cancel"]').onclick = () => {
    stopCamera();
    how.back();
  };
  root.querySelector('[data-v="flip"]').onclick = () => {
    stopCamera();
    scan(root, how, facing === 'user' ? 'environment' : 'user');
  };
  const done = (data) => {
    if (!how.accept(data)) return false;
    stopCamera();
    return true;
  };
  bindPhoto(root, {...how, accept: done});
  const video = root.querySelector('video');
  const hint = root.querySelector('[data-v="hint"]');
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
      if (data && done(data)) return clearTimeout(slow);
    }
    requestAnimationFrame(tick);
  };
  tick();
}
