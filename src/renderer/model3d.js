// 文房具の 3D モデル（GLB）の表示（SPEC §9.8「3D モデルの見た目」）。
// three.js は大きいので、モデルの品が画面に出たときにだけ読み込む（model3d-three.js）。
// 画面に出た要素を見張り、
//   - svg[data-model]（stationery.js の toolArt）：モデルを横から描いた画像を <image> に入れる（小さな表示。筆箱・一覧）
//   - .model-view[data-model]：ドラッグで回せる 3D 表示を中に作る（わたしの筆箱の札。data-model-zoom="1" なら
//     文房具の詳細ページの大きな表示：ホイールやピンチで近づけて細部を見られる）
//   - [data-model-reset]：同じ [data-model-box] の中の 3D 表示の向きと距離を戻す
// 描けないとき（WebGL が使えない・読み込めない）は、ふつうのペン（ペンケース）の絵に置き換える
import {CATALOG, caseArt, toolArt} from '../shared/stationery.js';

const handles = new WeakMap(); // .model-view → mount() の戻り（reset）

let three = null;
const loadThree = () => (three ??= import('./model3d-three.js'));
const snaps = new Map(); // 「model id|品の id」→ Promise<data URL>
// 同じ形（model）を品ごとの色で描く（公式の品は形の種類ごとに 1 つの GLB）。品の id がなければ GLB の色のまま
const itemOf = (el) => CATALOG.find((it) => it.id === el.dataset.item) ?? null;

/** 描けないときの絵（ペンケースはペンケースの絵） */
const plainArt = (item, opts) =>
  item.type === 'case' ? caseArt({...item, art: null}) : toolArt({...item, art: null}, opts);

const snapshot = (id, item) => {
  const key = `${id}|${item?.id ?? ''}`;
  if (!snaps.has(key)) {
    // ペンケースの絵は 200×80（斜め上から）、ペンは 200×28（真横から）
    const size = item?.type === 'case' ? {w: 1200, h: 480} : {};
    const p = loadThree().then((m) => m.snapshot(id, {item, ...size}));
    p.catch(() => snaps.delete(key));
    snaps.set(key, p);
  }
  return snaps.get(key);
};

/** 描けなかったとき：ふつうのペンの絵に置き換える */
function fallback(svg, id) {
  const item = itemOf(svg) ?? CATALOG.find((it) => it.model === id);
  if (!item || !svg.isConnected) return;
  svg.outerHTML = plainArt(item, {label: !!svg.querySelector('title')});
}

function hydrateArt(svg) {
  svg.dataset.modelReady = '1';
  const id = svg.dataset.model;
  snapshot(id, itemOf(svg)).then(
    (url) => svg.querySelector('image[data-model-img]')?.setAttribute('href', url),
    (e) => {
      console.warn('3D モデルを描けません', id, e);
      fallback(svg, id);
    }
  );
}

function hydrateView(el) {
  el.dataset.modelReady = '1';
  loadThree().then(
    (m) => handles.set(el, m.mount(el, el.dataset.model, {zoom: el.dataset.modelZoom === '1', item: itemOf(el)})),
    (e) => {
      console.warn('3D モデルを描けません', el.dataset.model, e);
      el.classList.add('is-failed');
      const item = itemOf(el) ?? CATALOG.find((it) => it.model === el.dataset.model);
      if (item) el.innerHTML = plainArt(item);
    }
  );
}

function hydrate(root) {
  if (root.nodeType !== 1) return;
  const arts = root.matches('svg[data-model]') ? [root] : root.querySelectorAll('svg[data-model]');
  for (const svg of arts) if (!svg.dataset.modelReady) hydrateArt(svg);
  const views = root.matches('.model-view[data-model]') ? [root] : root.querySelectorAll('.model-view[data-model]');
  for (const el of views) if (!el.dataset.modelReady) hydrateView(el);
}

/** 明るい色か（相対輝度が 0.4 より上。白い字が読みにくくなる明るさ） */
function lightColor(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return false;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}

const trays = new WeakMap(); // 筆箱の要素 → {draw, ro}

/**
 * 筆箱の横のペンケース：選んでいるペンケース（item）の 3D モデルの材質で、開いたケースを真上から描き、
 * 筆箱（side）の背景にする。中のペンを並べる所（box）が裏地の見える内側になる。大きさが変わったら描き直す。
 * 描けないとき・3D モデルでない品は、CSS の色のまま
 */
export function dressCase(side, box, item) {
  let t = trays.get(side);
  if (!t) {
    let raf = 0;
    t = {draw: () => {}, ro: null};
    t.ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => t.draw());
    });
    t.ro.observe(side);
    t.ro.observe(box);
    trays.set(side, t);
  }
  // 明るいケース（缶・クリア・パステル）では、上の見出しを濃い字にする（白い字が読めないため）
  side.classList.toggle('is-light', lightColor(item?.base));
  t.draw = () => {
    if (!item || item.art !== 'model' || !side.isConnected) {
      side.classList.remove('has-3d');
      return;
    }
    const w = side.offsetWidth;
    const h = side.offsetHeight;
    if (!w || !h) return;
    const inner = {x: box.offsetLeft, y: box.offsetTop, w: box.offsetWidth, h: box.offsetHeight};
    const key = JSON.stringify([item.id, w, h, inner]);
    if (side.dataset.trayKey === key) return;
    side.dataset.trayKey = key;
    loadThree()
      .then((m) => m.caseTray(item.model, {item, w, h, inner, dpr: Math.min(2, window.devicePixelRatio || 1)}))
      .then(
        (url) => {
          if (side.dataset.trayKey !== key) return;
          side.style.setProperty('--case-img', `url("${url}")`);
          side.classList.add('has-3d');
        },
        (e) => {
          console.warn('筆箱のペンケースを 3D で描けません', item.model, e);
          side.classList.remove('has-3d');
        }
      );
  };
  t.draw();
}

/** 画面に出たモデルの品を見張って描く（起動時に 1 回呼ぶ） */
export function watchModels() {
  hydrate(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) hydrate(n);
  }).observe(document.body, {childList: true, subtree: true});
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-model-reset]');
    if (!b) return;
    const view = b.closest('[data-model-box]')?.querySelector('.model-view');
    if (view) handles.get(view)?.reset();
  });
}
