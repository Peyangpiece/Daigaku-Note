// 文房具の 3D モデル（GLB）の表示（SPEC §9.8「3D モデルの見た目」）。
// three.js は大きいので、モデルの品が画面に出たときにだけ読み込む（model3d-three.js）。
// 画面に出た要素を見張り、
//   - svg[data-model]（stationery.js の toolArt）：モデルを横から描いた画像を <image> に入れる（小さな表示。筆箱・一覧）
//   - .model-view[data-model]：ドラッグで回せる 3D 表示を中に作る（ショップ・わたしの筆箱の大きな札）
// 描けないとき（WebGL が使えない・読み込めない）は、ふつうのペンの絵に置き換える
import {CATALOG, toolArt} from '../shared/stationery.js';

let three = null;
const loadThree = () => (three ??= import('./model3d-three.js'));
const snaps = new Map(); // model id → Promise<data URL>

const snapshot = (id) => {
  if (!snaps.has(id)) {
    const p = loadThree().then((m) => m.snapshot(id));
    p.catch(() => snaps.delete(id));
    snaps.set(id, p);
  }
  return snaps.get(id);
};

/** 描けなかったとき：ふつうのペンの絵に置き換える */
function fallback(svg, id) {
  const item = CATALOG.find((it) => it.model === id);
  if (!item || !svg.isConnected) return;
  svg.outerHTML = toolArt({...item, art: null}, {label: !!svg.querySelector('title')});
}

function hydrateArt(svg) {
  svg.dataset.modelReady = '1';
  const id = svg.dataset.model;
  snapshot(id).then(
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
    (m) => m.mount(el, el.dataset.model),
    (e) => {
      console.warn('3D モデルを描けません', el.dataset.model, e);
      el.classList.add('is-failed');
      const item = CATALOG.find((it) => it.model === el.dataset.model);
      if (item) el.innerHTML = toolArt({...item, art: null});
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

/** 画面に出たモデルの品を見張って描く（起動時に 1 回呼ぶ） */
export function watchModels() {
  hydrate(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) hydrate(n);
  }).observe(document.body, {childList: true, subtree: true});
}
