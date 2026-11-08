// スマホでアナログノートをその場で読む（docs/SPEC-SCAN.md §3）。パソコンで「アナログノート…」の窓を開いているあいだ、
// スマホのカメラの映像を見続け、Palette スキャンノートの四隅の目印と形式のコードが読めて紙が止まったら、
// いちばん細かい映像をパソコンへ送る（パソコンの窓が線を取り出してページを並べ、読めたかを返す）。撮るボタンは押さなくてよい。
// カメラの映像を使えるのは https のページだけ（パソコンの「スマホとつなぐ」の QR から開いたページ。main/mobile/tls-cert.js）
import {call} from './client.js';
import {esc, toast} from './ui.js';
import {findMarkers, pageTransform, readCode} from '/m/shared/scan-read.js';
import {createLiveScan} from '/m/shared/scan-live.js';
import {FORMATS} from '/m/shared/notebooks.js';

const LIVE_SIDE = 720; // その場で見る映像の長い辺（目印とコードはこの大きさで読める。スマホでも軽い）
const LIVE_MS = 250; // 映像を見る間隔
const SEND_SIDE = 3200; // パソコンへ送る映像の長い辺

/** 映像（video）を、長い辺 max px までの canvas にする */
function frame(video, max) {
  const k = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * k);
  c.height = Math.round(video.videoHeight * k);
  c.getContext('2d', {willReadFrequently: true}).drawImage(video, 0, 0, c.width, c.height);
  return c;
}

/** いちばん細かい 1 枚：撮る機能（ImageCapture。Android の Chrome）があればカメラの最大の大きさで、なければ映像から */
async function still(track, video) {
  if (typeof ImageCapture === 'function') {
    try {
      const blob = await new ImageCapture(track).takePhoto();
      const bmp = await createImageBitmap(blob);
      const k = Math.min(1, SEND_SIDE / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close?.();
      return c;
    } catch {
      // 映像から取る
    }
  }
  return frame(video, SEND_SIDE);
}

const jpeg = async (canvas) => {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new Error('映像を写せませんでした');
  return new Uint8Array(await blob.arrayBuffer());
};

/**
 * 撮る画面。app に描き、後片付けの関数を返す。onSession(id)：パソコンの取り込みを見た（ホームへ戻ったとき連れ戻さないため）
 */
export async function renderLiveScan(app, {onSession = () => {}} = {}) {
  app.innerHTML = `
    <header class="m-head"><a class="m-btn" href="#/">← ホーム</a><h1>アナログノート</h1></header>
    <section class="m-scan" data-v="scan"><p class="m-muted">パソコンを確かめています…</p></section>`;
  const box = app.querySelector('[data-v="scan"]');
  let session = null;
  let stream = null;
  let timer = 0;
  let poll = 0;
  let reading = false;
  let queued = false;
  let flash = 0;
  const live = createLiveScan();
  const stopCamera = () => {
    clearInterval(timer);
    timer = 0;
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = null;
  };

  const waiting = () => {
    stopCamera();
    box.innerHTML =
      '<div class="m-card"><p>パソコンのパレットノートで、回の「＋ ノート」→「アナログノート…」を押してください。押すと、ここでカメラが開いて読み取りが始まります。</p></div>';
  };
  const noCamera = (why) => {
    stopCamera();
    box.innerHTML = `<div class="m-card"><h2>${esc(session?.label ?? '')}</h2><p>${esc(why)}</p></div>`;
  };

  const startCamera = async () => {
    // カメラの映像は https のページでだけ使える。前の QR（http）でつないだスマホは、パソコンの QR を読み直す
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      return noCamera(
        'このページではカメラを使えません。パソコンの「アナログノート…」の窓の「スマホとつなぐ」で出る QR を、このスマホのカメラで読み直してください（新しいつなぎ方で開き直します）'
      );
    box.innerHTML = `
      <div class="m-scan__view">
        <video playsinline muted autoplay></video>
        <canvas class="m-scan__overlay"></canvas>
        <p class="m-scan__status" role="status">カメラを開いています…</p>
      </div>
      <div class="m-scan__foot"><strong>${esc(session.label)}</strong><span data-v="count"></span></div>`;
    const video = box.querySelector('video');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {facingMode: {ideal: 'environment'}, width: {ideal: 3840}, height: {ideal: 2160}}
      });
    } catch {
      return noCamera('カメラを使えませんでした。ブラウザの設定で、このページにカメラを許可してください');
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    timer = setInterval(() => watch(video), LIVE_MS);
  };

  const say = (text) => {
    const el = box.querySelector('.m-scan__status');
    if (el) el.textContent = text;
  };

  /** いまの紙をパソコンへ送り、読めたかを受け取る。読んでいる間に次の紙が止まったら、読み終えてからその紙をもう一度待つ */
  const capture = async (video) => {
    if (reading) {
      queued = true;
      return;
    }
    reading = true;
    say('パソコンで読み取っています…');
    try {
      const data = await jpeg(await still(stream.getVideoTracks()[0], video));
      const r = await call('scan.send', {id: session.id, data});
      if (r.ok) {
        flash = 4;
        const c = box.querySelector('[data-v="count"]');
        if (c) c.textContent = `パソコンに ${r.pages} ページ`;
        navigator.vibrate?.(60);
        say(`${r.message}。次のページへめくってください`);
      } else {
        live.retry();
        say(r.message);
      }
    } catch (e) {
      live.retry();
      say(e.message);
      toast(e.message, {error: true});
    } finally {
      reading = false;
    }
    // 読んでいる間に次の紙が止まっていた：その紙をもう一度待つ（止まったら送る。読み終えたときには紙が替わっているかもしれないので、いまの映像は送らない）
    if (queued) {
      queued = false;
      live.retry();
    }
  };

  const watch = (video) => {
    if (!video.videoWidth || !session) return;
    const c = frame(video, LIVE_SIDE);
    const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const marks = findMarkers(img);
    const t = marks && pageTransform(marks);
    const code = t && readCode(img, t);
    const step = live.step(marks ? {marks, format: code?.format ?? null} : null);
    if (step.phase === 'capture') capture(video);
    const glow = flash > 0 ? flash-- : 0; // 取り込んだ知らせ（約 1 秒）。紙を外しても数える
    const overlay = box.querySelector('.m-scan__overlay');
    if (!overlay) return;
    overlay.width = img.width;
    overlay.height = img.height;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, img.width, img.height);
    if (!reading && !glow) {
      if (step.phase === 'none')
        say('Palette スキャンノートにカメラを向けてください。四隅の黒い目印が全部写ると、自分で読み取ります');
      else if (step.phase === 'nocode') say('紙の下のコードが読めません。もう少し近づけるか、明るいところで');
      else if (step.phase === 'steady') say(`${FORMATS[code.format].name}　そのまま動かさないでください`);
      else if (step.phase === 'done') say('読み取りました。次のページへめくってください');
    }
    if (!marks) return;
    const quad = [marks.tl, marks.tr, marks.br, marks.bl];
    const line = Math.max(3, img.width / 120);
    const path = () => {
      ctx.beginPath();
      for (const [i, p] of quad.entries()) (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...p);
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    if (glow > 0) {
      path();
      ctx.fillStyle = `rgba(47, 179, 106, ${0.14 * glow})`;
      ctx.fill();
    }
    path();
    ctx.lineWidth = line;
    ctx.strokeStyle = step.phase === 'nocode' ? '#e0a526' : step.phase === 'done' ? '#2fb36a' : 'rgba(255,255,255,0.9)';
    ctx.stroke();
    if (step.phase === 'steady' || step.phase === 'capture') {
      ctx.strokeStyle = '#2fb36a';
      ctx.lineWidth = line * 1.6;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = quad[i];
        const b = quad[(i + 1) % 4];
        const f = step.progress / 2;
        ctx.moveTo(...a);
        ctx.lineTo(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
        ctx.moveTo(...b);
        ctx.lineTo(b[0] + (a[0] - b[0]) * f, b[1] + (a[1] - b[1]) * f);
      }
      ctx.stroke();
    }
    if (code) {
      const label = step.phase === 'done' ? `✓ ${FORMATS[code.format].name}` : FORMATS[code.format].name;
      const fs = Math.round(img.width / 22);
      ctx.font = `600 ${fs}px system-ui, sans-serif`;
      const [x, y] = marks.tl;
      const pad = fs / 3;
      const w = ctx.measureText(label).width;
      ctx.fillStyle = step.phase === 'done' ? '#2fb36a' : 'rgba(29,31,34,0.8)';
      ctx.fillRect(x, y - fs - pad * 2.4, w + pad * 2, fs + pad * 1.6);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + pad, y - pad * 1.4);
    }
  };

  // パソコンの窓が開いた・閉じた・開き直されたかを 2 秒ごとに見る（watching：パソコンに「スマホとつながっています」と出す）
  const check = async () => {
    let next = null;
    try {
      next = (await call('scan.waiting', {watching: true})).session;
    } catch {
      next = null;
    }
    if (next?.id === session?.id) return;
    session = next;
    if (!session) return waiting();
    onSession(session.id);
    live.retry();
    await startCamera();
  };
  await check();
  if (!session) waiting();
  poll = setInterval(check, 2000);
  return () => {
    clearInterval(poll);
    stopCamera();
  };
}
