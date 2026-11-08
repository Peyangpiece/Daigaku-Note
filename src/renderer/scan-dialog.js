// アナログノートの取り込み（docs/SPEC-SCAN.md）：回の付箋の「＋ ノート」のメニューのいちばん下「アナログノート」から開く。
// その場で読む：カメラ（Mac の連携カメラで iPhone も）の映像を見続け、Palette スキャンノートの四隅の目印と形式のコードが読めて
// 紙が止まったら、自分で取り込む（shared/scan-live.js）。取り込んだ紙がカメラから外れたら、次のページを待つ。
// 読み取り（数秒）は Web Worker（scan-worker.js）で行い、その間も映像と枠を止めない。
// カメラがないときは、スマホで撮って送る（スマホ連携。つないでいなければ、この窓で QR を出してつなぐ）。
// 1 枚ごとに書いた線を写真のまま取り出して（shared/scan-read.js）、デジタルの紙の上に並べて見せる。
// 線は描き直さない。使ったボールペンの太さ（0.3・0.5・0.7）より外（写真のぼけ・にじみで太って見える分）だけを切る。
// スマホで撮った写真は、この窓が開いているあいだ受けて読む（main/scan-relay.js）。
// 「かすれと色を整える」（はじめはオン）：線ごとに黒・青・赤・鉛筆の 1 色にし、線の中のかすれを埋める（形・太さはそのまま）。
// 「取り込む」で回のノートに、デジタルの Palette ノートの紙（B5。罫は刷った紙と同じ位置）のページを足し、線を同じ位置に貼る（上から書き足せる）
import {esc, toast} from './ui-kit.js';
import {navigate, reload} from './store.js';
import {readScan, findMarkers, inkImage, pageTransform, readCode} from '../shared/scan-read.js';
import {createLiveScan} from '../shared/scan-live.js';
import {FORMATS, analogDesign, pageSvg} from '../shared/notebooks.js';
import {PEN_SIZES, sizeWidth} from '../shared/stationery.js';

const api = window.daigaku;
const MM = 72 / 25.4;
const MAX_SIDE = 3200; // 読む画像の長い辺（大きい写真は縮めてから読む）
const LIVE_SIDE = 960; // その場で見る映像の長い辺（目印とコードはこの大きさで読める）
const LIVE_MS = 200; // 映像を見る間隔
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

/** 読み取り役（Web Worker）。作れないときは、この画面で読む（遅いが同じ結果） */
function createReader() {
  let worker = null;
  try {
    worker = new Worker(new URL('./scan-worker.js', import.meta.url), {type: 'module'});
  } catch {
    worker = null;
  }
  const waiting = new Map();
  let seq = 0;
  if (worker) {
    worker.onmessage = (e) => {
      waiting.get(e.data.id)?.(e.data.r);
      waiting.delete(e.data.id);
    };
    worker.onerror = () => {
      for (const done of waiting.values()) done({error: '読み取れませんでした。もう一度カメラに向けてください'});
      waiting.clear();
      worker = null;
    };
  }
  return {
    /** 1 枚を読む。戻り readScan と同じ */
    read(image) {
      if (!worker) return Promise.resolve(readScan(image));
      const id = ++seq;
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        worker.postMessage({id, image: {width: image.width, height: image.height, data: image.data}}, [
          image.data.buffer
        ]);
      });
    },
    close() {
      worker?.terminate();
      worker = null;
    }
  };
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
      <button type="button" class="btn btn--small" data-scan="mode">スマホで撮る</button>
      <select class="scan-dialog__size" aria-label="使ったボールペンの太さ">${PEN_SIZES.map((v) => `<option value="${v}"${v === size ? ' selected' : ''}>ボールペン ${v} mm</option>`).join('')}</select>
      <label class="scan-dialog__tidy"><input type="checkbox"${tidy ? ' checked' : ''} /> かすれと色を整える</label>
      <button type="button" class="btn btn--small btn--quiet" data-scan="close">やめる</button>
    </div>
    <div class="scan-dialog__body">
      <div class="scan-dialog__view">
        <div class="scan-dialog__phonebox" hidden></div>
        <video playsinline muted></video>
        <canvas class="scan-dialog__overlay"></canvas>
        <p class="scan-dialog__status" role="status"></p>
        <button type="button" class="scan-dialog__shot" data-scan="shot" aria-label="いま読む" title="いま読む（止まるのを待たずに）" disabled></button>
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
  let remote = null; // スマホで撮る：{id, mobile}（scan-relay.js）
  let offPhoto = () => {};
  let poll = 0;
  const reader = createReader();
  const close = () => {
    stop();
    reader.close();
    offPhoto();
    clearInterval(poll);
    if (remote) api['scan.remoteClose']({id: remote.id});
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

  /** 1 枚を読む（目印・形式・線）。戻り {ok, message} */
  const take = async (img) => {
    const r = await reader.read(img);
    if (!d.isConnected) return {ok: false, message: '取り込みの窓が閉じられました'};
    if (r.error) {
      say(r.error, true);
      return {ok: false, message: r.error};
    }
    pages.push({format: r.format, w: r.w, h: r.h, ink: r.ink, ...(await inkPng(r.ink, size, tidy))});
    renderPages();
    const message = `${pages.length} ページ目：${FORMATS[r.format].name}を読みました`;
    say(message);
    return {ok: true, message};
  };

  // スマホで撮る（docs/SPEC-SCAN.md §3）：この窓が開いているあいだ、スマホのパレットノートは撮る画面に切り替わり、
  // 撮った写真を 1 枚ずつ送ってくる。順に読み、読めたかをスマホに返す。スマホがつながっていなければ、ここでつなぐ（QR）
  let phoneQueue = Promise.resolve();
  const phoneBox = $('.scan-dialog__phonebox');
  let qr = null; // 出している QR（スマホを追加）
  const drawPhone = (st = {}) => {
    if (!remote) return;
    const linked = st.enabled && st.devices > 0;
    if (qr) {
      phoneBox.innerHTML = `
        <h3>スマホとつなぐ</h3>
        <div class="scan-dialog__qr">${qr.svg}</div>
        <p>スマホのカメラでこの QR を読んでください。開いたページが、そのまま撮る画面になります（同じ Wi-Fi のスマホ。QR は 10 分のあいだ 1 回だけ使えます）</p>
        <button type="button" class="btn btn--small btn--quiet" data-scan="qr-cancel">やめる</button>`;
      return;
    }
    if (!linked) {
      phoneBox.innerHTML = `
        <h3>スマホがつながっていません</h3>
        <p>スマホのカメラで撮るには、このパソコンとスマホをつなぎます（同じ Wi-Fi で。1 回つなげば次からはいりません）</p>
        <button type="button" class="btn btn--primary" data-scan="pair">スマホとつなぐ</button>`;
      return;
    }
    phoneBox.innerHTML = `
      <h3>スマホで撮ってください</h3>
      <p>${
        st.phoneSeen
          ? 'スマホが撮る画面を開いています。「撮る」を押して、四隅の黒い目印が全部写るように撮ってください'
          : 'スマホのパレットノートを開くと、撮る画面に切り替わります（開いていれば、そのまま切り替わります）'
      }</p>
      <p class="scan-dialog__phone-state${st.phoneSeen ? ' is-on' : ''}">${st.phoneSeen ? '● スマホとつながっています' : '○ スマホを待っています'}</p>
      <button type="button" class="btn btn--small btn--quiet" data-scan="pair">別のスマホをつなぐ</button>`;
  };
  let last = {};
  const refreshPhone = async () => {
    if (!remote) return;
    const st = await api['scan.remoteState']({id: remote.id});
    if (!st || st.error || !d.isConnected) return;
    // QR を読んでつながったら、QR を閉じる
    if (qr && st.devices > (last.devices ?? 0)) qr = null;
    const changed = JSON.stringify(st) !== JSON.stringify(last);
    last = st;
    if (changed || !phoneBox.innerHTML) drawPhone(st);
  };
  const pair = async () => {
    phoneBox.innerHTML = '<p>準備しています…</p>';
    if (!last.enabled) {
      const on = await api['mobile.enable']({on: true});
      if (!on || on.error) {
        qr = null;
        drawPhone(last);
        return say(on?.error ?? 'スマホとつなぐ準備ができませんでした', true);
      }
    }
    const r = await api['mobile.pair']({});
    if (!r || r.error) {
      qr = null;
      drawPhone(last);
      return say(r?.error ?? 'QR を作れませんでした', true);
    }
    qr = r;
    drawPhone(last);
    await refreshPhone();
  };
  const openRemote = async () => {
    const r = await api['scan.remoteOpen']({courseId, roundId, materialId});
    if (!r || r.error || !d.isConnected) return;
    remote = r;
    await refreshPhone();
    poll = setInterval(refreshPhone, 2000);
  };
  offPhoto = api.on('scan.photo', ({id, photoId, bytes}) => {
    if (!remote || id !== remote.id) return;
    phoneQueue = phoneQueue.then(async () => {
      let result;
      say('スマホの写真を読んでいます…');
      try {
        const bmp = await createImageBitmap(new Blob([bytes]));
        result = await take(toImageData(bmp, bmp.width, bmp.height));
        bmp.close?.();
      } catch {
        say('スマホの写真を開けませんでした', true);
        result = {ok: false, message: '写真を開けませんでした'};
      }
      await api['scan.remoteReply']({photoId, result: {...result, pages: pages.length}});
    });
  });

  // その場で読む（shared/scan-live.js）：映像を 200 ms ごとに見て、紙の枠と形式を重ね、止まったら自分で取り込む
  const live = createLiveScan();
  let reading = false;
  let flash = 0; // 取り込んだときに枠を光らせる（残りの回数）
  const LIVE_SAY = {
    none: 'Palette スキャンノートをカメラに向けてください。四隅の黒い目印が全部写ると、自分で読み取ります',
    nocode: '紙の下のコードが読めません。もう少し近づけるか、明るいところで向けてください'
  };
  // カメラを始める。使えなければスマホの案内に切り替える
  const start = async (deviceId) => {
    stop();
    const ok = await api['camera.access']?.({});
    const fail = () => {
      setMode('phone');
      say('このパソコンのカメラを使えません。スマホで撮ってください', true);
    };
    if (ok && ok.ok === false) return fail();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(deviceId ? {deviceId: {exact: deviceId}} : {}),
          width: {ideal: 3840},
          height: {ideal: 2160}
        }
      });
    } catch {
      return fail();
    }
    if (!d.isConnected) return stop();
    video.srcObject = stream;
    await video.play().catch(() => {});
    $('[data-scan="shot"]').disabled = false;
    // カメラの一覧（初めてのときは、許可のあとで名前が分かる。Mac の連携カメラの iPhone もここに出る）
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((x) => x.kind === 'videoinput');
    const now = stream.getVideoTracks()[0]?.getSettings().deviceId;
    camSel.innerHTML = cams
      .map(
        (c, i) =>
          `<option value="${esc(c.deviceId)}"${c.deviceId === now ? ' selected' : ''}>${esc(c.label || `カメラ ${i + 1}`)}</option>`
      )
      .join('');
    camSel.hidden = cams.length < 2;
    say(LIVE_SAY.none);
    timer = setInterval(watch, LIVE_MS);
  };
  /** いまの映像をいちばん細かく読む（取り込む）。読んでいる間に次の紙が止まったら、読み終えてから続けて読む */
  let queued = false;
  const capture = async () => {
    if (!video.videoWidth) return;
    if (reading) {
      queued = true;
      return;
    }
    reading = true;
    say('読み取っています…');
    try {
      const r = await take(toImageData(video, video.videoWidth, video.videoHeight));
      if (r.ok) {
        flash = 4;
        say(`${r.message}。次のページは、この紙をカメラから外してから向けてください`);
      } else live.retry();
    } finally {
      reading = false;
    }
    if (queued && d.isConnected && !video.hidden) {
      queued = false;
      capture();
    }
  };
  const watch = () => {
    if (!video.videoWidth || video.hidden) return;
    const img = toImageData(video, video.videoWidth, video.videoHeight, LIVE_SIDE);
    const marks = findMarkers(img);
    const t = marks && pageTransform(marks);
    const code = t && readCode(img, t);
    const step = live.step(marks ? {marks, format: code?.format ?? null} : null);
    if (step.phase === 'capture') capture();
    // 枠：見えた紙の四隅を結ぶ。止まるのを待つ間は、緑が四隅から伸びる。取り込んだら光る
    overlay.width = img.width;
    overlay.height = img.height;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, img.width, img.height);
    if (!reading && !flash) {
      if (step.phase === 'none') say(LIVE_SAY.none);
      else if (step.phase === 'nocode') say(LIVE_SAY.nocode);
      else if (step.phase === 'steady') say(`${FORMATS[code.format].name}　そのまま動かさないでください`);
    }
    if (!marks) return;
    const quad = [marks.tl, marks.tr, marks.br, marks.bl];
    const line = Math.max(3, img.width / 220);
    const path = () => {
      ctx.beginPath();
      for (const [i, p] of quad.entries()) (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...p);
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    if (flash > 0) {
      flash--;
      path();
      ctx.fillStyle = `rgba(47, 179, 106, ${0.12 * flash})`;
      ctx.fill();
    }
    path();
    ctx.lineWidth = line;
    ctx.strokeStyle =
      step.phase === 'nocode' ? '#e0a526' : step.phase === 'done' ? '#2fb36a' : 'rgba(255,255,255,0.85)';
    ctx.stroke();
    if (step.phase === 'steady' || step.phase === 'capture') {
      // 止まるのを待つ：四隅から辺の長さの progress/2 ずつ緑を伸ばす
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
    // 形式の名前（コードから）を紙の上の辺に
    if (code) {
      const label = step.phase === 'done' ? `✓ ${FORMATS[code.format].name}` : FORMATS[code.format].name;
      ctx.font = `600 ${Math.round(img.width / 40)}px system-ui, sans-serif`;
      const [x, y] = marks.tl;
      const wText = ctx.measureText(label).width;
      const pad = img.width / 120;
      ctx.fillStyle = step.phase === 'done' ? '#2fb36a' : 'rgba(29,31,34,0.8)';
      ctx.fillRect(x, y - img.width / 40 - pad * 2.4, wText + pad * 2, img.width / 40 + pad * 1.6);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + pad, y - pad * 1.4);
    }
  };
  /** カメラで読む（'camera'）か、スマホで撮る（'phone'）か */
  const setMode = (mode) => {
    const cam = mode === 'camera';
    for (const el of [video, overlay, $('[data-scan="shot"]')]) el.hidden = !cam;
    phoneBox.hidden = cam;
    $('[data-scan="mode"]').textContent = cam ? 'スマホで撮る' : 'このパソコンのカメラ';
    if (!cam) {
      stop();
      camSel.hidden = true;
      overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
    }
  };

  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-scan]');
    if (!b || busy) return;
    const what = b.dataset.scan;
    if (what === 'close') return close();
    if (what === 'pair') return pair();
    if (what === 'qr-cancel') {
      qr = null;
      return drawPhone(last);
    }
    if (what === 'mode') {
      // このパソコンのカメラ（その場で読む）と、スマホで撮る を切り替える
      if (video.hidden) {
        setMode('camera');
        return start();
      }
      setMode('phone');
      return say('');
    }
    if (what === 'remove') {
      const [p] = pages.splice(Number(b.dataset.i), 1);
      URL.revokeObjectURL(p?.url);
      return renderPages();
    }
    if (what === 'shot') {
      // 止まるのを待たずに、いま読む（同じ紙をもう一度読みたいときも）
      if (!video.videoWidth || reading) return;
      return capture();
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
  renderPages();
  openRemote();
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
