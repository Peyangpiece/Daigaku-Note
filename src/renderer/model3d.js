// 文房具の 3D モデル（GLB）の表示（SPEC §9.8「3D モデルの見た目」）。
// three.js は大きいので、モデルの品が画面に出たときにだけ読み込む（model3d-three.js）。
// 画面に出た要素を見張り、
//   - svg[data-model]（stationery.js の toolArt）：モデルを横から描いた画像を <image> に入れる（小さな表示。筆箱・一覧）
//   - .model-view[data-model]：ドラッグで回せる 3D 表示を中に作る（わたしの筆箱の札。data-model-zoom="1" なら
//     文房具の詳細ページの大きな表示：ホイールやピンチで近づけて細部を見られる）
//   - [data-model-reset]：同じ [data-model-box] の中の 3D 表示の向きと距離を戻す
// 描けないとき（WebGL が使えない・読み込めない）は、ふつうのペンの絵に置き換える
import {CATALOG, toolArt} from '../shared/stationery.js';

const handles = new WeakMap(); // .model-view → mount() の戻り（reset）

let three = null;
const loadThree = () => (three ??= import('./model3d-three.js'));
const snaps = new Map(); // 「model id|品の id」→ Promise<data URL>
// 同じ形（model）を品ごとの色で描く（公式の品は形の種類ごとに 1 つの GLB）。品の id がなければ GLB の色のまま
const itemOf = (el) => CATALOG.find((it) => it.id === el.dataset.item) ?? null;

const snapshot = (id, item) => {
  const key = `${id}|${item?.id ?? ''}`;
  if (!snaps.has(key)) {
    const p = loadThree().then((m) => m.snapshot(id, {item}));
    p.catch(() => snaps.delete(key));
    snaps.set(key, p);
  }
  return snaps.get(key);
};

/** 描けなかったとき：ふつうのペンの絵に置き換える */
function fallback(svg, id) {
  const item = itemOf(svg) ?? CATALOG.find((it) => it.model === id);
  if (!item || !svg.isConnected) return;
  svg.outerHTML = toolArt({...item, art: null}, {label: !!svg.querySelector('title')});
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
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-model-reset]');
    if (!b) return;
    const view = b.closest('[data-model-box]')?.querySelector('.model-view');
    if (view) handles.get(view)?.reset();
  });
}
