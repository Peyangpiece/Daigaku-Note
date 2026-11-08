// アナログノートの取り込み（docs/SPEC-SCAN.md）：回の付箋の「＋ ノート」のメニューのいちばん下「アナログノート」から開く。
// カメラ（Mac の連携カメラで iPhone も使える）で Palette スキャンノートを撮るか、写真・スキャンの画像を選ぶ。
// 1 枚ごとに四隅の目印・形式のコードを読み、書いた線だけを取り出して（shared/scan-read.js）、並べて見せる。
// 「取り込む」で回のノートに、刷った紙と同じ紙（B5）のページを足し、取り出した線を同じ位置に貼る（貼りもの。上から書き足せる）
import {esc, toast} from './ui-kit.js';
import {navigate, reload} from './store.js';
import {readScan, findMarkers} from '../shared/scan-read.js';
import {FORMATS, pageSvg, scanDesign} from '../shared/notebooks.js';

const api = window.daigaku;
const MM = 72 / 25.4;
const MAX_SIDE = 3200; // 読む画像の長い辺（大きい写真は縮めてから読む）
const INK_SCALE = 8; // 取り出した線の細かさ（px/mm）

/** 画像（video・ImageBitmap・img）を、長い辺 max px までの ImageData にする */
function toImageData(src, sw, sh, max = MAX_SIDE) {
  const k = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * k);
  c.height = Math.round(sh * k);
  const ctx = c.getContext('2d', {willReadFrequently: true});
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** 取り出した線（RGBA）を PNG のバイト列に */
async function inkPng(ink) {
  const c = document.createElement('canvas');
  c.width = ink.width;
  c.height = ink.height;
  c.getContext('2d').putImageData(new ImageData(ink.data, ink.width, ink.height), 0, 0);
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  return {bytes: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob)};
}

/**
 * 取り込みの窓を開く。materialId（ノート）を渡すとそのノートに足す（PDF の編集画面の「アナログノート…」）。
 * なければ courseId・roundId・sub の回のノートに足す（なければ作る。回の付箋の「＋ ノート」のメニュー）
 */
export async function openScan({courseId, roundId, sub = '', materialId = null, onDone = null}) {
  const pages = []; // {format, w, h, bytes, url}
  const d = document.createElement('dialog');
  d.className = 'scan-dialog';
  d.innerHTML = `
    <div class="scan-dialog__head">
      <h2>アナログノート</h2>
      <select class="scan-dialog__cam" aria-label="カメラ" hidden></select>
      <button type="button" class="btn btn--small" data-scan="file">画像から…</button>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden />
      <button type="button" class="btn btn--small btn--quiet" data-scan="close">やめる</button>
    </div>
    <div class="scan-dialog__body">
      <div class="scan-dialog__view">
        <video playsinline muted></video>
        <canvas class="scan-dialog__overlay"></canvas>
        <p class="scan-dialog__status" role="status"></p>
        <button type="button" class="scan-dialog__shot" data-scan="shot" aria-label="撮る" disabled></button>
      </div>
      <ol class="scan-dialog__pages" aria-label="取り込むページ"></ol>
    </div>
    <div class="scan-dialog__foot">
      <button type="button" class="btn btn--primary" data-scan="import" disabled>取り込む</button>
    </div>`;
  document.body.append(d);
  d.showModal();
  const $ = (s) => d.querySelector(s);
  const video = $('video');
  const overlay = $('.scan-dialog__overlay');
  const status = $('.scan-dialog__status');
  const camSel = $('.scan-dialog__cam');
  let stream = null;
  let timer = 0;
  let busy = false;

  const say = (text, error = false) => {
    status.textContent = text;
    status.classList.toggle('is-error', error);
  };
  const stop = () => {
    clearInterval(timer);
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = null;
  };
  const close = () => {
    stop();
    for (const p of pages) URL.revokeObjectURL(p.url);
    d.close();
    d.remove();
  };
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });

  const renderPages = () => {
    $('.scan-dialog__pages').innerHTML = pages
      .map(
        (p, i) =>
          `<li class="scan-dialog__page"><span class="scan-dialog__thumb${p.w > p.h ? ' is-wide' : ''}">${pageSvg(scanDesign(p.format), {width: p.w > p.h ? 150 : 106, thumb: true})}<img src="${p.url}" alt="" /></span><span class="scan-dialog__label">${i + 1}. ${esc(FORMATS[p.format].name)}</span><button type="button" class="btn btn--small btn--quiet" data-scan="remove" data-i="${i}" aria-label="${i + 1} ページ目を外す">外す</button></li>`
      )
      .join('');
    const b = $('[data-scan="import"]');
    b.disabled = !pages.length;
    b.textContent = pages.length ? `取り込む（${pages.length} ページ）` : '取り込む';
  };

  /** 1 枚を読む（目印・形式・線） */
  const take = async (img) => {
    const r = readScan(img, {scale: INK_SCALE});
    if (r.error) return say(r.error, true);
    const png = await inkPng(r.ink);
    pages.push({format: r.format, w: r.w, h: r.h, ...png});
    renderPages();
    say(`${FORMATS[r.format].name}を読みました`);
  };

  // カメラ：目印が写っているかを見て、枠を重ねて見せる
  const start = async (deviceId) => {
    stop();
    const ok = await api['camera.access']?.({});
    if (ok && ok.ok === false) return say('カメラを使えません。「画像から…」で写真を選べます', true);
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(deviceId ? {deviceId: {exact: deviceId}} : {}),
          width: {ideal: 3840},
          height: {ideal: 2160}
        }
      });
    } catch {
      return say('カメラを使えません。「画像から…」で写真を選べます', true);
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    $('[data-scan="shot"]').disabled = false;
    // カメラの一覧（初めてのときは、許可のあとで名前が分かる）
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((x) => x.kind === 'videoinput');
    const now = stream.getVideoTracks()[0]?.getSettings().deviceId;
    camSel.innerHTML = cams
      .map(
        (c, i) =>
          `<option value="${esc(c.deviceId)}"${c.deviceId === now ? ' selected' : ''}>${esc(c.label || `カメラ ${i + 1}`)}</option>`
      )
      .join('');
    camSel.hidden = cams.length < 2;
    say('紙の四隅の黒い目印が全部写るように撮ってください');
    timer = setInterval(watch, 500);
  };
  const watch = () => {
    if (busy || !video.videoWidth) return;
    const img = toImageData(video, video.videoWidth, video.videoHeight, 800);
    const m = findMarkers(img);
    overlay.width = img.width;
    overlay.height = img.height;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, img.width, img.height);
    if (!m) return;
    ctx.strokeStyle = '#2fb36a';
    ctx.lineWidth = Math.max(3, img.width / 200);
    ctx.beginPath();
    for (const [i, p] of [m.tl, m.tr, m.br, m.bl].entries()) (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...p);
    ctx.closePath();
    ctx.stroke();
  };

  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-scan]');
    if (!b || busy) return;
    const what = b.dataset.scan;
    if (what === 'close') return close();
    if (what === 'file') return $('input[type=file]').click();
    if (what === 'remove') {
      const [p] = pages.splice(Number(b.dataset.i), 1);
      URL.revokeObjectURL(p?.url);
      return renderPages();
    }
    if (what === 'shot') {
      if (!video.videoWidth) return;
      busy = true;
      say('読んでいます…');
      try {
        await take(toImageData(video, video.videoWidth, video.videoHeight));
      } finally {
        busy = false;
      }
      return;
    }
    if (what === 'import') {
      busy = true;
      b.disabled = true;
      say('取り込んでいます…');
      try {
        const done = await importPages({courseId, roundId, sub, materialId}, pages);
        if (done) {
          const n = pages.length;
          close();
          await reload();
          toast(`アナログノートを ${n} ページ取り込みました`);
          // 開いているノートから取り込んだときは、その画面にページと線を足す（onDone）。ほかはノートを開く
          if (onDone) await onDone(done.added);
          else navigate(`/viewer/${done.materialId}`);
        }
      } finally {
        busy = false;
        if (d.isConnected) b.disabled = !pages.length;
      }
    }
  });
  camSel.addEventListener('change', () => start(camSel.value));
  $('input[type=file]').addEventListener('change', async (e) => {
    busy = true;
    try {
      for (const file of e.target.files) {
        say(`${file.name} を読んでいます…`);
        let bmp;
        try {
          bmp = await createImageBitmap(file);
        } catch {
          say(`${file.name} を開けませんでした`, true);
          continue;
        }
        await take(toImageData(bmp, bmp.width, bmp.height));
        bmp.close?.();
      }
    } finally {
      busy = false;
      e.target.value = '';
    }
  });
  renderPages();
  start();
}

/** 回のノートにページを足し、取り出した線を貼る。戻り：{materialId, added}（added：{pages, first, bytes}）か null（知らせは出した） */
async function importPages({courseId, roundId, sub, materialId}, pages) {
  const fail = (r) => (toast(r?.error ?? '取り込めませんでした', {error: true}), null);
  // ノートがなければ、最初の紙と同じスキャン用の紙で作る（上の欄の字は刷らない）
  const note = materialId
    ? {materialId, created: false}
    : await api['note.open']({courseId, roundId, sub, paper: scanDesign(pages[0].format)});
  if (!note || note.error) return fail(note);
  const added = await api['note.addScanPages']({
    materialId: note.materialId,
    formats: pages.map((p) => p.format),
    fresh: !!note.created
  });
  if (!added || added.error) return fail(added);
  for (const [i, p] of pages.entries()) {
    const photo = await api['photo.add']({bytes: p.bytes});
    if (!photo || photo.error) return fail(photo);
    const r = await api['annotation.save']({
      materialId: note.materialId,
      annotation: {
        page: added.first + i,
        kind: 'stamp',
        rect: {x: 0, y: 0, w: p.w * MM, h: p.h * MM},
        body: '',
        style: {type: 'photo', ref: photo.id, scan: true}
      }
    });
    if (!r || r.error) return fail(r);
  }
  return {materialId: note.materialId, added};
}
