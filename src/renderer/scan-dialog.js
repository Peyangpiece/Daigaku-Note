// アナログノートの取り込み（docs/SPEC-SCAN.md）：回の付箋の「＋ ノート」のメニューのいちばん下「アナログノート」から開く。
// カメラ（Mac の連携カメラで iPhone も使える）で Palette スキャンノートを撮るか、写真・スキャンの画像を選ぶ。
// 1 枚ごとに四隅の目印・形式のコードを読み、書いた線を写真のまま取り出して（shared/scan-read.js）、デジタルの紙の上に並べて見せる。
// 線は描き直さない。使ったボールペンの太さ（0.3・0.5・0.7）より外（写真のぼけ・にじみで太って見える分）だけを切る。
// 「かすれと色を整える」（はじめはオン）：線ごとに黒・青・赤・鉛筆の 1 色にし、線の中のかすれを埋める（形・太さはそのまま）。
// 「取り込む」で回のノートに、デジタルの Palette ノートの紙（B5。罫は刷った紙と同じ位置）のページを足し、線を同じ位置に貼る（上から書き足せる）
import {esc, toast} from './ui-kit.js';
import {navigate, reload} from './store.js';
import {readScan, findMarkers, inkImage} from '../shared/scan-read.js';
import {FORMATS, analogDesign, pageSvg} from '../shared/notebooks.js';
import {PEN_SIZES, sizeWidth} from '../shared/stationery.js';

const api = window.daigaku;
const MM = 72 / 25.4;
const MAX_SIDE = 3200; // 読む画像の長い辺（大きい写真は縮めてから読む）
const SIZE_KEY = 'scan.penSize'; // 選んだボールペンの太さ（この窓を次に開いたときも同じ）
const TIDY_KEY = 'scan.tidy'; // かすれと色を整えるか（はじめは整える）
/** ボールペンの線の太さ（mm）：アプリのボールペンと同じ（0.3 → 0.26 mm・0.5 → 0.39 mm・0.7 → 0.53 mm） */
const lineMm = (size) => sizeWidth(size) / MM;

const savedTidy = () => {
  try {
    return localStorage.getItem(TIDY_KEY) !== '0';
  } catch {
    return true;
  }
};

const savedSize = () => {
  try {
    const v = localStorage.getItem(SIZE_KEY);
    return PEN_SIZES.includes(v) ? v : '0.5';
  } catch {
    return '0.5';
  }
};

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

/** 取り出した線を、ボールペンの太さで切って PNG に（tidy：かすれと色を整える）。戻り {bytes, url} */
async function inkPng(ink, size, tidy) {
  const im = inkImage(ink, lineMm(size), {tidy});
  const c = document.createElement('canvas');
  c.width = im.width;
  c.height = im.height;
  c.getContext('2d').putImageData(new ImageData(im.data, im.width, im.height), 0, 0);
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  return {bytes: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob)};
}

/**
 * 取り込みの窓を開く。materialId（ノート）を渡すとそのノートに足す（PDF の編集画面の「アナログノート…」）。
 * なければ courseId・roundId・sub の回のノートに足す（なければ作る。回の付箋の「＋ ノート」のメニュー）
 */
export async function openScan({courseId, roundId, sub = '', materialId = null, onDone = null}) {
  const pages = []; // {format, w, h, ink, url, bytes}（url・bytes は今の太さで切った線の画像）
  let size = savedSize();
  let tidy = savedTidy();
  const d = document.createElement('dialog');
  d.className = 'scan-dialog';
  d.innerHTML = `
    <div class="scan-dialog__head">
      <h2>アナログノート</h2>
      <select class="scan-dialog__cam" aria-label="カメラ" hidden></select>
      <select class="scan-dialog__size" aria-label="使ったボールペンの太さ">${PEN_SIZES.map((v) => `<option value="${v}"${v === size ? ' selected' : ''}>ボールペン ${v} mm</option>`).join('')}</select>
      <label class="scan-dialog__tidy"><input type="checkbox"${tidy ? ' checked' : ''} /> かすれと色を整える</label>
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
          `<li class="scan-dialog__page"><span class="scan-dialog__thumb${p.w > p.h ? ' is-wide' : ''}">${pageSvg(analogDesign(p.format), {width: p.w > p.h ? 150 : 106, thumb: true})}<img src="${p.url}" alt="" /></span><span class="scan-dialog__label">${i + 1}. ${esc(FORMATS[p.format].name)}</span><button type="button" class="btn btn--small btn--quiet" data-scan="remove" data-i="${i}" aria-label="${i + 1} ページ目を外す">外す</button></li>`
      )
      .join('');
    const b = $('[data-scan="import"]');
    b.disabled = !pages.length;
    b.textContent = pages.length ? `取り込む（${pages.length} ページ）` : '取り込む';
  };

  /** 1 枚を読む（目印・形式・線） */
  const take = async (img) => {
    const r = readScan(img);
    if (r.error) return say(r.error, true);
    pages.push({format: r.format, w: r.w, h: r.h, ink: r.ink, ...(await inkPng(r.ink, size, tidy))});
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
  // 太さ・整えるかを変えたら、読んだページの線を作り直す（写真は読み直さない）
  const recut = async () => {
    busy = true;
    try {
      for (const p of pages) {
        URL.revokeObjectURL(p.url);
        Object.assign(p, await inkPng(p.ink, size, tidy));
      }
      renderPages();
    } finally {
      busy = false;
    }
  };
  const remember = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // 覚えられなくても、この窓では選んだものを使う
    }
  };
  $('.scan-dialog__size').addEventListener('change', (e) => {
    size = PEN_SIZES.includes(e.target.value) ? e.target.value : '0.5';
    remember(SIZE_KEY, size);
    recut();
  });
  $('.scan-dialog__tidy input').addEventListener('change', (e) => {
    tidy = e.target.checked;
    remember(TIDY_KEY, tidy ? '1' : '0');
    recut();
  });
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
  // ノートがなければ、最初の紙と同じ形式のデジタルの紙（B5）で作る（上の欄の字は刷らない）
  const note = materialId
    ? {materialId, created: false}
    : await api['note.open']({courseId, roundId, sub, paper: analogDesign(pages[0].format)});
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
