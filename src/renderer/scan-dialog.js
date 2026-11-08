// アナログノートの取り込み（docs/SPEC-SCAN.md）：回の付箋の「＋ ノート」のメニューのいちばん下「アナログノート」から開く。
// 読み取るのはスマホのカメラ（スマホのブラウザで、その場で読む。mobile/scan.js）。パソコンのカメラは使わない。
// この窓を開いているあいだ、スマホは撮る画面に切り替わり、Palette スキャンノートが止まったら映像を送ってくる（main/scan-relay.js）。
// スマホがつながっていなければ、この窓で QR を出してつなぐ（https のページ。スマホのブラウザでカメラを使える）。
// 送られた映像は Web Worker（scan-worker.js）で読み、書いた線を写真のまま取り出して（shared/scan-read.js）、デジタルの紙の上に並べる。
// 線は描き直さない。使ったボールペンの太さ（0.3・0.5・0.7）より外（写真のぼけ・にじみで太って見える分）だけを切る。
// 「かすれと色を整える」（はじめはオン）：線ごとに黒・青・赤・鉛筆の 1 色にし、線の中のかすれを埋める（形・太さはそのまま）。
// 「取り込む」で回のノートに、デジタルの Palette ノートの紙（B5。罫は刷った紙と同じ位置）のページを足し、線を同じ位置に貼る（上から書き足せる）
import {esc, toast} from './ui-kit.js';
import {navigate, reload} from './store.js';
import {readScan, inkImage} from '../shared/scan-read.js';
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

/** 画像（ImageBitmap など）を、長い辺 max px までの ImageData にする */
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
      <select class="scan-dialog__size" aria-label="使ったボールペンの太さ">${PEN_SIZES.map((v) => `<option value="${v}"${v === size ? ' selected' : ''}>ボールペン ${v} mm</option>`).join('')}</select>
      <label class="scan-dialog__tidy"><input type="checkbox"${tidy ? ' checked' : ''} /> かすれと色を整える</label>
      <button type="button" class="btn btn--small btn--quiet" data-scan="close">やめる</button>
    </div>
    <div class="scan-dialog__body">
      <div class="scan-dialog__view">
        <div class="scan-dialog__phonebox"><p>準備しています…</p></div>
        <p class="scan-dialog__status" role="status"></p>
      </div>
      <ol class="scan-dialog__pages" aria-label="取り込むページ"></ol>
    </div>
    <div class="scan-dialog__foot">
      <button type="button" class="btn btn--primary" data-scan="import" disabled>取り込む</button>
    </div>`;
  document.body.append(d);
  d.showModal();
  const $ = (s) => d.querySelector(s);
  const status = $('.scan-dialog__status');
  let busy = false;

  const say = (text, error = false) => {
    status.textContent = text;
    status.classList.toggle('is-error', error);
  };
  let remote = null; // スマホで撮る：{id, mobile}（scan-relay.js）
  let offPhoto = () => {};
  let poll = 0;
  const reader = createReader();
  const close = () => {
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
        <p>スマホのカメラでこの QR を読んでください。開いたページで、そのまま読み取りが始まります（同じ Wi-Fi のスマホ。QR は 10 分のあいだ 1 回だけ使えます）</p>
        <p class="scan-dialog__note">初めて開くと「この接続ではプライバシーが保護されません」などと出ます。このパソコンが作った証明書のためです。「詳細を表示」→「このWebサイトを閲覧」（Android は「詳細設定」→「アクセスする」）で進んでください</p>
        <button type="button" class="btn btn--small btn--quiet" data-scan="qr-cancel">やめる</button>`;
      return;
    }
    if (!linked) {
      phoneBox.innerHTML = `
        <h3>スマホがつながっていません</h3>
        <p>スマホのカメラで読み取ります。このパソコンとスマホをつないでください（同じ Wi-Fi で。1 回つなげば次からはいりません）</p>
        <button type="button" class="btn btn--primary" data-scan="pair">スマホとつなぐ</button>`;
      return;
    }
    phoneBox.innerHTML = `
      <h3>${st.phoneSeen ? 'スマホのカメラを紙に向けてください' : 'スマホのパレットノートを開いてください'}</h3>
      <p>${
        st.phoneSeen
          ? 'Palette スキャンノートの四隅の黒い目印が全部写るように向けると、紙が止まったところで自分で読み取ります。読んだページは右に並びます'
          : 'スマホのパレットノートを開くと、カメラが開いて読み取りが始まります（開いていれば、そのまま切り替わります）。カメラが開かないときは、下の「QR を出す」で、つなぎ直してください'
      }</p>
      <p class="scan-dialog__phone-state${st.phoneSeen ? ' is-on' : ''}">${st.phoneSeen ? '● スマホとつながっています' : '○ スマホを待っています'}</p>
      <button type="button" class="btn btn--small btn--quiet" data-scan="pair">QR を出す（スマホをつなぐ）</button>`;
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
      say('スマホから届いた紙を読んでいます…');
      try {
        const bmp = await createImageBitmap(new Blob([bytes]));
        result = await take(toImageData(bmp, bmp.width, bmp.height));
        bmp.close?.();
      } catch {
        say('スマホから届いた映像を開けませんでした', true);
        result = {ok: false, message: 'パソコンで映像を開けませんでした。もう一度向けてください'};
      }
      await api['scan.remoteReply']({photoId, result: {...result, pages: pages.length}});
    });
  });

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
    if (what === 'remove') {
      const [p] = pages.splice(Number(b.dataset.i), 1);
      URL.revokeObjectURL(p?.url);
      return renderPages();
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
