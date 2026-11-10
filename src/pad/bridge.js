// パソコンと同じ画面（iPad。docs/MOBILE.md §8）：パソコンの画面（src/renderer）が使う window.daigaku を、iPad のブラウザで作る。
// - 窓口（daigaku['state.get'] など）は、スマホと同じ暗号化した窓口（/m/api の pad.call）でパソコンへ送り、答えをそのまま返す
// - 知らせ（daigaku.on('state.changed') など）は、pad.poll で長く待って受け取り、画面（並べた左右の iframe も）へ配る
// - パソコンの選ぶ・保存する窓を出す窓口（PAD_LOCAL）は、iPad でファイルを選ぶ・保存する・開くに置き換える
// - 指で長押ししたら右クリック（contextmenu）にする（パソコンの画面は右クリックのメニューを使う）
import {Busy, NotPaired, Unreachable, call, initPairing, paired} from '/m/app/client.js';
import {PAD_DENY, PAD_FILE_MAX, PAD_POLL_MS, PALM_SIZE, contactSize} from '/m/p/src/shared/pad-channels.js';

const PHONE_VIEW = 'daigaku-note.view'; // 'phone'：スマホの画面を選んだ（/m/ から自分で /m/p/ へ移らない）
const CONCURRENCY = 3; // 同時に送る窓口の要求（パソコンは 4 件まで受ける。1 つは知らせの待ちに）
const FILE_MAX_MB = Math.round(PAD_FILE_MAX / 1024 / 1024);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tagOf = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};

// ---- 案内の画面・帯・シート（パソコンの画面の外に出す。見た目は pad.css）----
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
const escHtml = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]
  );

/** app.js を読む前の案内（つないでいない・オンにしていない・届かない） */
function gate(title, text, buttons) {
  document.querySelector('.pad-gate')?.remove();
  const box = el(
    `<div class="pad-gate" role="dialog" aria-modal="true"><div class="pad-gate__box"><h2>${escHtml(title)}</h2><p>${escHtml(text)}</p><div class="pad-gate__row"></div></div></div>`
  );
  const row = box.querySelector('.pad-gate__row');
  for (const [label, fn, primary] of buttons) {
    const b = el(
      `<button type="button" class="pad-btn${primary ? ' pad-btn--primary' : ''}">${escHtml(label)}</button>`
    );
    b.onclick = fn;
    row.append(b);
  }
  document.body.append(box);
}
const toPhone = () => {
  try {
    localStorage.setItem(PHONE_VIEW, 'phone');
  } catch {
    // 覚えられなくても移る
  }
  location.href = '/m/';
};

/** 上の帯：パソコンとつながっていない間 */
let banner = null;
function offline(on) {
  if (on && !banner) {
    banner = el(
      '<div class="pad-banner" role="status">パソコンとつながっていません。パソコンのパレットノートが開いていて、同じ Wi-Fi にあるか確かめてください（つながるまで試し続けます）</div>'
    );
    document.body.append(banner);
  } else if (!on && banner) {
    banner.remove();
    banner = null;
  }
}

/** 下から出るシート。buttons は [label, value, {primary, file, href, download}]。押したものの value で終わる */
function sheet(text, buttons) {
  return new Promise((resolve) => {
    const box = el(
      `<div class="pad-sheet" role="dialog" aria-modal="true"><div class="pad-sheet__box"><p>${escHtml(text)}</p><div class="pad-sheet__row"></div></div></div>`
    );
    const done = (v) => {
      box.remove();
      resolve(v);
    };
    const row = box.querySelector('.pad-sheet__row');
    for (const [label, value, opt = {}] of buttons) {
      const cls = `pad-btn${opt.primary ? ' pad-btn--primary' : ''}`;
      if (opt.file) {
        // ファイルを選ぶ：ボタンの中の input を指で押す（iPad はそうしないと選ぶ画面を開かない）
        const b = el(
          `<label class="${cls}">${escHtml(label)}<input type="file" class="pad-file" ${opt.file.multiple ? 'multiple' : ''} ${opt.file.accept ? `accept="${escHtml(opt.file.accept)}"` : ''}></label>`
        );
        b.querySelector('input').onchange = (e) => done([...e.target.files]);
        row.append(b);
      } else if (opt.href) {
        const b = el(
          `<a class="${cls}" href="${escHtml(opt.href)}" ${opt.download ? `download="${escHtml(opt.download)}"` : 'target="_blank" rel="noopener"'}>${escHtml(label)}</a>`
        );
        b.onclick = () => setTimeout(() => done(value), 0);
        row.append(b);
      } else {
        const b = el(`<button type="button" class="${cls}">${escHtml(label)}</button>`);
        b.onclick = () => done(value);
        row.append(b);
      }
    }
    document.body.append(box);
  });
}

/** ファイルを選ぶ（やめたら []） */
async function pickFiles(text, {multiple = false, accept = ''} = {}) {
  const r = await sheet(text, [
    ['ファイルを選ぶ', null, {primary: true, file: {multiple, accept}}],
    ['やめる', []]
  ]);
  return Array.isArray(r) ? r : [];
}

/** パソコンから受け取ったファイルを、iPad で開く・保存する。押せば true */
async function offerFile({name, bytes, mime}, mode) {
  const url = URL.createObjectURL(new Blob([bytes], {type: mime || 'application/octet-stream'}));
  try {
    const ok = await sheet(
      mode === 'open' ? `「${name}」を開きます` : `「${name}」を iPad に保存します（「ファイル」アプリなどへ）`,
      [
        [
          mode === 'open' ? '開く' : '保存する',
          true,
          {primary: true, href: url, download: mode === 'open' ? '' : name}
        ],
        ['やめる', false]
      ]
    );
    return ok === true;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000); // 開いた先が読み終えるまで少し残す
  }
}

const readFile = async (f) => new Uint8Array(await f.arrayBuffer());
const tooBig = (f) => f.size > PAD_FILE_MAX;

// ---- パソコンとのやりとり ----
/** 送る数をそろえる（CONCURRENCY 件まで。込み合っていれば少し待って送り直す） */
let running = 0;
const waiting = [];
async function slot(fn) {
  if (running >= CONCURRENCY) await new Promise((r) => waiting.push(r));
  running++;
  try {
    for (let i = 0; ; i++)
      try {
        return await fn();
      } catch (e) {
        if (!(e instanceof Busy) || i >= 20) throw e;
        await sleep(200 + i * 150);
      }
  } finally {
    running--;
    waiting.shift()?.();
  }
}

let gone = false; // パソコンで外された
function lost() {
  if (gone) return;
  gone = true;
  gate(
    'この iPad はパソコンから外されました',
    'もう一度使うときは、パソコンの 設定 → スマホ の「スマホを追加」で出した QR を、ホーム画面の「パレットノート」から読んでください。',
    [['つなぎ直す', () => (location.href = '/m/'), true]]
  );
}

/** パソコンの画面の窓口を呼ぶ。失敗はパソコンの画面と同じく {error} で返す（投げない） */
async function rpc(client, frame, ch, arg) {
  try {
    const v = await slot(() => call('pad.call', {ch, arg: arg ?? {}, client, frame}));
    if (v?.notFull) return {error: v.error};
    return v?.r;
  } catch (e) {
    if (e instanceof NotPaired) {
      lost();
      return {error: 'この iPad はパソコンから外されました'};
    }
    if (e instanceof Unreachable) {
      offline(true);
      return {
        error: 'パソコンとつながっていません。パソコンのパレットノートが開いていて、同じ Wi-Fi にあるか確かめてください'
      };
    }
    return {error: e.message};
  }
}

/** 窓口の答えを足し合わせる（ファイルを 1 つずつ送ったとき：数は足し、並びはつなぐ） */
function merge(a, b) {
  if (!a) return b;
  const out = {...a};
  for (const [k, v] of Object.entries(b ?? {}))
    out[k] =
      typeof v === 'number' && typeof a[k] === 'number' ? a[k] + v : Array.isArray(v) ? [...(a[k] ?? []), ...v] : v;
  return out;
}

/** iPad の側で受ける窓口（PAD_LOCAL）。send(ch, arg) はパソコンへ送る */
const LOCAL = {
  async 'material.upload'(arg, send) {
    const files = await pickFiles('パレットノートに入れるファイルを選んでください', {multiple: true});
    if (!files.length) return {added: 0, dup: [], failed: [], canceled: true};
    let out = null;
    for (const f of files) {
      if (tooBig(f)) {
        out = merge(out, {added: 0, dup: [], failed: [{name: f.name, message: `iPad からは ${FILE_MAX_MB}MB まで`}]});
        continue;
      }
      const r = await send('material.uploadData', {...arg, files: [{name: f.name, data: await readFile(f)}]});
      out = r?.error ? merge(out, {added: 0, dup: [], failed: [{name: f.name, message: r.error}]}) : merge(out, r);
    }
    return out;
  },
  async 'material.open'({materialId}, send) {
    const r = await send('material.data', {materialId});
    if (r?.error) return r;
    await offerFile(r, 'open');
    return {ok: true};
  },
  async 'pdf.export'(arg, send) {
    const r = await send('pdf.exportData', arg);
    if (r?.error) return r;
    return (await offerFile({...r, mime: 'application/pdf'}, 'save')) ? {ok: true, name: r.name} : {canceled: true};
  },
  async 'term.readCalendar'({year}, send) {
    const [f] = await pickFiles('学年暦のファイル（PDF・Word・テキスト）を選んでください', {
      accept: '.pdf,.docx,.txt,.md,application/pdf,text/plain'
    });
    if (!f) return {ok: false};
    if (f.size > 50 * 1024 * 1024) return {error: 'ファイルが大きすぎます（50MB まで）'};
    return send('term.readCalendarData', {year, name: f.name, bytes: await readFile(f)});
  },
  async 'backup.export'(_arg, send) {
    const r = await send('backup.exportData', {});
    if (r?.error) return r;
    return (await offerFile({...r, mime: 'application/octet-stream'}, 'save'))
      ? {ok: true, file: r.name, size: r.bytes.length}
      : {ok: false};
  },
  async 'backup.import'(_arg, send) {
    const [f] = await pickFiles('パレットノートのバックアップ（.sqlite）を選んでください');
    if (!f) return {ok: false};
    if (tooBig(f)) return {error: `iPad から読み込めるのは ${FILE_MAX_MB}MB までです。パソコンで読み込んでください`};
    return send('backup.importData', {bytes: await readFile(f)});
  },
  /** 持ち物の 3D モデル（アプリに入っている部品。資料ではない）：暗号化した窓口を通さず、ブラウザが直接読んで覚える */
  async 'stationery.model'({model}) {
    const id = String(model ?? '');
    if (!/^[a-z0-9-]+$/.test(id)) return {error: 'そのモデルはありません'};
    const res = await fetch(`/m/p/src/renderer/assets/stationery/${id}.glb`).catch(() => null);
    if (!res?.ok) return {error: res ? 'そのモデルはありません' : 'パソコンとつながっていません'};
    return {bytes: new Uint8Array(await res.arrayBuffer())};
  },
  async 'shell.openExternal'({url}) {
    const u = String(url ?? '');
    if (!/^https:\/\/[^\s]+$/i.test(u)) return {error: 'URL が不正です'};
    if (!window.open(u, '_blank', 'noopener'))
      await sheet(`次のページを開きます：${u}`, [
        ['開く', true, {primary: true, href: u}],
        ['やめる', false]
      ]);
    return {ok: true};
  }
};

// ---- 知らせ ----
const frames = new Map(); // 画面の番号 → {win, listeners: Map(channel → Set(fn))}

// ペンで書いている間は「変わった」（state.changed）を待たせ、手を止めてから 1 回にまとめて渡す。受け取った画面は状態を全部読み直す
// （パソコンから暗号化した状態を受け取り、iPad で解いて読む）ので、書いている最中に重なると線が遅れる。上書き保存のたびに来る
const PEN_QUIET_MS = 2000;
const penState = {down: 0, at: -Infinity}; // すべての画面のペン（down は押している数）
const penBusy = () => penState.down > 0 || performance.now() - penState.at < PEN_QUIET_MS;
let heldChange = null; // 待たせている state.changed（最後のもの）
let heldTimer = 0;
function holdChange(ev) {
  heldChange = ev;
  if (heldTimer) return;
  const check = () => {
    if (penBusy()) return void (heldTimer = setTimeout(check, 500));
    heldTimer = 0;
    const e = heldChange;
    heldChange = null;
    if (e) deliver(e);
  };
  heldTimer = setTimeout(check, 500);
}

function dispatch(ev) {
  if (ev.ch === 'state.changed' && penBusy()) return holdChange(ev);
  deliver(ev);
}

function deliver(ev) {
  for (const [id, f] of frames) {
    if (f.win.closed) {
      frames.delete(id);
      continue;
    }
    if ((ev.to && ev.to !== id) || ev.skip === id) continue;
    for (const fn of f.listeners.get(ev.ch) ?? [])
      try {
        fn(ev.payload);
      } catch (e) {
        console.error(e);
      }
  }
}
const everyone = (ch, payload = {}) => dispatch({ch, payload});

async function pollLoop(client) {
  let after = 0;
  let wasOffline = false;
  for (;;) {
    if (gone) return;
    try {
      const r = await call('pad.poll', {client, after, wait: PAD_POLL_MS});
      if (wasOffline || banner) {
        wasOffline = false;
        offline(false);
        everyone('state.changed'); // つながらない間に変わった分を読み直す
      }
      if (r?.busy) {
        await sleep(3000);
        continue;
      }
      for (const ev of r?.events ?? []) dispatch(ev);
      if (Number.isSafeInteger(r?.last)) after = r.last;
      if (r?.reset) everyone('state.changed');
    } catch (e) {
      if (e instanceof NotPaired) return lost();
      if (e instanceof Unreachable) {
        wasOffline = true;
        offline(true);
      } else if (/パソコンと同じ画面/.test(e.message)) {
        // パソコンでオフにされた
        gone = true;
        return gate('パソコンと同じ画面は、オフになりました', e.message, [['スマホの画面で開く', toPhone, true]]);
      }
      await sleep(3000);
    }
  }
}

// ---- 窓口の入れ物（画面ごと。並べた左右の iframe は、上の画面の bridge を使う）----
function makeApi(client, win) {
  const frame = tagOf();
  const listeners = new Map();
  frames.set(frame, {win, listeners});
  win.addEventListener('pagehide', () => frames.delete(frame));
  const send = (ch, arg) => rpc(client, frame, ch, arg);
  let held = null;
  // 1 倍のときは zoom を外す（Safari は zoom があると描き方の速い道を使わないことがある）
  const zoom = (z) => (win.document.documentElement.style.zoom = Math.abs(z - 1) < 0.001 ? '' : String(z));
  const base = {
    on(ch, fn) {
      let set = listeners.get(ch);
      if (!set) listeners.set(ch, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    // アプリ全体の拡大（パソコンの preload の appZoom と同じ。PDF の編集画面のあいだは 100%）
    appZoom(cmd) {
      const cur = Number(win.document.documentElement.style.zoom) || 1;
      if (cmd === 'hold') {
        if (held === null) held = cur;
        zoom(1);
      } else if (cmd === 'release') {
        if (held !== null) zoom(held);
        held = null;
      } else zoom(cmd === 'reset' ? 1 : Math.max(0.5, Math.min(2.5, cur + (cmd === 'in' ? 0.1 : -0.1))));
    },
    /** iPad で開いている（パソコンの画面が、iPad だけの案内を出すのに使う） */
    pad: {toPhone}
  };
  return new Proxy(base, {
    get(t, ch) {
      if (typeof ch !== 'string' || Object.hasOwn(t, ch)) return t[ch];
      return (arg) => {
        if (Object.hasOwn(PAD_DENY, ch)) return Promise.resolve({error: PAD_DENY[ch]});
        if (Object.hasOwn(LOCAL, ch)) return LOCAL[ch](arg ?? {}, send);
        return send(ch, arg);
      };
    }
  });
}

// ---- 手のひら：文字を選ばない ----
/** 文字を打つ欄（ここだけは文字を選べる） */
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const PEN_RECENT_MS = 1500; // ペンを離してからこれだけの間に触れた指は手のひらとみなす

/**
 * ペンで書いている間に手のひらが触れると、iPad はページの文字を選び始める（画面全体が選ばれる）。
 * 文字を打つ欄の外では文字を選ばせない（pad.css の user-select と同じ。CSS の効かない所の分）。マウス（トラックパッド）で選ぶのは許す
 */
function palmGuard(win, pen) {
  let last = 'touch';
  win.addEventListener(
    'pointerdown',
    (e) => {
      // pad.css：マウスのときだけ PDF の文字を選べる。変わったときだけ書く（書くたびにページ全体の見た目を計算し直し、書き始めが遅れる）
      if (e.pointerType !== last) win.document.documentElement.dataset.padInput = e.pointerType;
      last = e.pointerType;
      if (e.pointerType === 'pen') {
        if (!pen.down) penState.down++;
        pen.down = true;
      }
    },
    {capture: true, passive: true}
  );
  for (const t of ['pointerup', 'pointercancel'])
    win.addEventListener(
      t,
      (e) => {
        if (e.pointerType !== 'pen') return;
        if (pen.down) penState.down = Math.max(0, penState.down - 1);
        pen.down = false;
        pen.at = penState.at = performance.now();
      },
      {capture: true, passive: true}
    );
  win.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'pen') pen.at = penState.at = performance.now(); // 浮かせたペン（近づけると動きが来る iPad もある）
    },
    {capture: true, passive: true}
  );
  win.document.addEventListener(
    'selectstart',
    (e) => {
      if (last === 'mouse' || e.target?.closest?.(EDITABLE) || e.target?.parentElement?.closest?.(EDITABLE)) return;
      e.preventDefault();
    },
    true
  );
}

// ---- 指の長押し → 右クリック（パソコンの画面の右クリックのメニュー）----
function longPress(win, pen) {
  let timer = null;
  let start = null;
  let fired = false;
  const clear = () => {
    clearTimeout(timer);
    timer = null;
  };
  // 手のひらかもしれない：ペンを使っている・使った直後、またはペンで書く画面（一度ペンを使ったページ。PDF の編集画面の data-pen）
  const palm = (target) =>
    pen.down || performance.now() - pen.at < PEN_RECENT_MS || !!target.closest?.('[data-pen="seen"]');
  const doc = win.document;
  doc.addEventListener(
    'pointerdown',
    (e) => {
      fired = false;
      if (e.pointerType !== 'touch' || !e.isPrimary) return;
      if (e.target.closest?.(EDITABLE) || palm(e.target) || contactSize(e) >= PALM_SIZE) return;
      start = {x: e.clientX, y: e.clientY, sx: e.screenX, sy: e.screenY, target: e.target};
      clear();
      timer = setTimeout(() => {
        timer = null;
        if (palm(start.target)) return; // 押している間にペンを下ろした
        fired = true;
        start.target.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: start.x,
            clientY: start.y,
            screenX: start.sx,
            screenY: start.sy,
            button: 2
          })
        );
      }, 550);
    },
    {capture: true, passive: true}
  );
  doc.addEventListener(
    'pointermove',
    (e) => {
      // 動いた・触れた面が大きくなった（手のひら）：長押しにしない
      if (timer && start && (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10 || contactSize(e) >= PALM_SIZE))
        clear();
    },
    {capture: true, passive: true}
  );
  for (const t of ['pointerup', 'pointercancel']) doc.addEventListener(t, clear, {capture: true, passive: true});
  // 長押しでメニューを出したあとの click（指を離した）は捨てる（メニューの下のボタンを押したことにしない）
  doc.addEventListener(
    'click',
    (e) => {
      if (!fired) return;
      fired = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );
}

// ---- iPad の拡大鏡・画面全体の拡大を出さない ----
/** ペンで書く道具のときのページ（viewer.css で touch-action: none。指はスクロールせず、ペンは線を書く） */
const DRAW_SURFACE =
  ".viewer-pages:is([data-tool='ink'], [data-tool='line'], [data-tool='eraser'], [data-tool='mask']) .pdf-page";
const PRESSABLE = `${EDITABLE}, button, a[href], label, summary`;

/**
 * 書く道具のページで、ペン先や手のひらを止めて置くと、iPad は長押しとみなして拡大鏡（文字を選ぶためのルーペ）を出す。
 * user-select: none では止まらないので、そこでの touchstart の既定の動き（長押しの拡大鏡・吹き出し・クリックへの読み替え）を止める。
 * 線を書く・指で動かす・ピンチは pointer と touch の知らせで受けているので、そのまま届く（既定の動きだけが止まる）。
 * あわせて、ピンチで画面全体（ツールバーごと）が拡大されないようにする（PDF の拡大は viewer が自分で受ける）
 */
function noLoupe(win) {
  const doc = win.document;
  doc.addEventListener(
    'touchstart',
    (e) => {
      const t = e.target;
      if (!e.cancelable || !t?.closest?.(DRAW_SURFACE) || t.closest(PRESSABLE)) return;
      e.preventDefault();
    },
    {capture: true, passive: false}
  );
  for (const t of ['gesturestart', 'gesturechange'])
    doc.addEventListener(t, (e) => e.preventDefault(), {passive: false});
}

// ---- 触れた面の大きさの記録（手のひらの見分けの境目を合わせるため。パソコンのログに残す）----
const TOUCH_LOG_EVERY = 30; // これだけ触れたら送る
const touchLog = {open: new Map(), sizes: [], palm: 0, pens: 0, sending: false};
let client0 = null; // 上の画面のやりとりの番号（installBridge が入れる。並べた左右の iframe では送らない）
const logFrame = tagOf();

/** 触れるごとの最大の大きさを集め、たまったらパソコンへ送る（送れなくても捨てる。操作には関わらない） */
function sizeLog(win) {
  const doc = win.document;
  // ペン（Apple Pencil など）として届いた数も数える（ペンが指として届く iPad・ペンでは、手のひらの見分けが効かないため）
  doc.addEventListener('pointerdown', (e) => e.pointerType === 'pen' && touchLog.pens++, {
    capture: true,
    passive: true
  });
  const seen = (e) => {
    if (e.pointerType !== 'touch') return;
    const n = contactSize(e);
    touchLog.open.set(e.pointerId, Math.max(touchLog.open.get(e.pointerId) ?? 0, n));
  };
  doc.addEventListener('pointerdown', seen, {capture: true, passive: true});
  doc.addEventListener('pointermove', seen, {capture: true, passive: true});
  const done = (e) => {
    if (e.pointerType !== 'touch' || !touchLog.open.has(e.pointerId)) return;
    const n = touchLog.open.get(e.pointerId);
    touchLog.open.delete(e.pointerId);
    touchLog.sizes.push(n);
    if (n >= PALM_SIZE) touchLog.palm++;
    if (touchLog.sizes.length < TOUCH_LOG_EVERY || touchLog.sending || !client0) return;
    const sizes = touchLog.sizes.splice(0);
    const palm = touchLog.palm;
    const pens = touchLog.pens;
    touchLog.palm = touchLog.pens = 0;
    touchLog.sending = true;
    rpc(client0, logFrame, 'pad.touchLog', {sizes, palm, pens}).finally(() => (touchLog.sending = false));
  };
  doc.addEventListener('pointerup', done, {capture: true, passive: true});
  doc.addEventListener('pointercancel', done, {capture: true, passive: true});
}

/** 手のひらの守りと、指の長押し（画面ごと。並べた左右の画面は、それぞれのペンの使い方を見る） */
function guard(win) {
  const pen = {down: false, at: -Infinity};
  palmGuard(win, pen);
  longPress(win, pen);
  noLoupe(win);
  sizeLog(win);
}

/** 用意する。パソコンの画面を読んでよければ true */
export async function installBridge() {
  // 並べた左右の iframe：上の画面のやりとりを使う（知らせの待ちを 1 つにする）
  const top = window.parent !== window ? window.parent.__padBridge : null;
  if (top) {
    window.daigaku = top.forFrame(window);
    guard(window);
    return true;
  }
  const state = initPairing();
  if (state !== 'stored' || !paired()) {
    gate(
      'この iPad はまだパソコンとつながっていません',
      'パソコンの 設定 → スマホ の「スマホを追加」で QR を出し、ホーム画面に追加した「パレットノート」から読んでつないでください。つないだあと、パソコンでこの iPad の「パソコンと同じ画面を使う」をオンにします。',
      [['つなぐ画面へ', () => (location.href = '/m/'), true]]
    );
    return false;
  }
  for (;;) {
    let st;
    try {
      st = await call('pad.status');
    } catch (e) {
      if (e instanceof NotPaired) {
        lost();
        return false;
      }
      const retry = new Promise((r) =>
        gate(
          'パソコンとつながっていません',
          e instanceof Unreachable
            ? 'パソコンのパレットノートが開いていて、「スマホとつなぐ」がオンで、同じ Wi-Fi にあるか確かめてください。'
            : e.message,
          [
            ['もう一度試す', r, true],
            ['スマホの画面で開く', toPhone]
          ]
        )
      );
      await retry;
      document.querySelector('.pad-gate')?.remove();
      continue;
    }
    if (!st?.full) {
      const retry = new Promise((r) =>
        gate(
          'パソコンと同じ画面は、まだ使えません',
          'パソコンの 設定 → スマホ で、この端末の「パソコンと同じ画面を使う」をオンにしてから、もう一度試してください。',
          [
            ['もう一度試す', r, true],
            ['スマホの画面で開く', toPhone]
          ]
        )
      );
      await retry;
      document.querySelector('.pad-gate')?.remove();
      continue;
    }
    break;
  }
  try {
    localStorage.removeItem(PHONE_VIEW); // この画面を選んだ（次から /m/ を開いてもここへ来る）
  } catch {
    // 覚えられなくてもよい
  }
  const client = tagOf();
  client0 = client;
  window.__padBridge = {forFrame: (win) => makeApi(client, win)};
  window.daigaku = makeApi(client, window);
  guard(window);
  pollLoop(client);
  return true;
}
