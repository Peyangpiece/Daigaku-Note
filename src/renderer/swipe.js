// トラックパッドの 2 本指の横スワイプで、一つ前の画面へ戻る・戻る前の画面へ進む（ブラウザの戻る・進むと同じ）。
// 画面の切り替えは #/… のアドレスなので、history.back()・history.forward() で app.js の hashchange が描き直す。
// 見分けは shared/swipe.js。指を動かしている間は、ノートのページ（#app）が指について横へずれながら捲れ、下に机が見える。
// 指を離したとき、十分に動かしていればそのまま捲り切って切り替え、新しいページは反対側から捲られて入ってくる。
// 足りなければ元の位置へ戻る。
// 次のときはスワイプにしない：ピンチ（ctrlKey 付きの wheel。PDF の拡大）、ほかの部品が受けた wheel（defaultPrevented）、
// 指の下にまだ横に動かせる所があるとき（拡大した PDF・横に長い表など。端まで動かしきってからのスワイプは戻る・進む）、
// 戻る先・進む先がないとき
import {SWIPE_DISTANCE, SWIPE_IDLE, createSwipe} from '../shared/swipe.js';

const swipe = createSwipe();
const TURN = 28; // 動かしきったときのページの傾き（度）
const OUT_MS = 200; // 捲り切る時間
const IN_MS = 240; // 新しいページが入ってくる時間
let endTimer = 0;
let busy = false; // 捲り切って入ってくるまで（その間の wheel は無視）

const page = () => document.getElementById('app');
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 指の下に、その向きへまだ横に動かせる所があるか（自分から上へ、ページ全体まで） */
function canScrollX(target, dx) {
  for (let el = target instanceof window.Element ? target : null; el; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth) continue;
    const ox = window.getComputedStyle(el).overflowX;
    if (el !== document.scrollingElement && ox !== 'auto' && ox !== 'scroll') continue;
    if (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
  }
  const root = document.scrollingElement;
  return dx < 0 ? root.scrollLeft > 0 : root.scrollLeft + root.clientWidth < root.scrollWidth - 1;
}

/** 戻る・進む先があるか（Navigation API があればそれで。なければあるものとする） */
const canGo = (dir) =>
  window.navigation ? (dir === 'back' ? window.navigation.canGoBack : window.navigation.canGoForward) : true;

/**
 * ページの位置と捲れ具合。p は -1.2〜1.2（負は戻る向き＝ページは右へ）。
 * ページは指と同じだけ横へずれ、進む向きの端が持ち上がるように傾く。端の影（--shade）も濃くなる
 */
function place(p, {ms = 0} = {}) {
  const el = page();
  if (!el) return;
  const root = document.documentElement;
  root.classList.add('is-page-turning');
  el.style.transition = ms ? `transform ${ms}ms ease-out, opacity ${ms}ms ease-out` : 'none';
  el.style.transformOrigin = p < 0 ? 'left center' : 'right center';
  el.style.transform = `perspective(1600px) translateX(${-p * SWIPE_DISTANCE}px) rotateY(${p * TURN}deg)`;
  el.style.setProperty('--shade', String(Math.min(1, Math.abs(p))));
  el.dataset.turn = p < 0 ? 'back' : 'forward';
}
/** ページを元に戻して、捲りの目印を外す */
function clear() {
  const el = page();
  document.documentElement.classList.remove('is-page-turning');
  if (!el) return;
  for (const k of ['transition', 'transform', 'transformOrigin', 'opacity']) el.style[k] = '';
  el.style.removeProperty('--shade');
  delete el.dataset.turn;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 指を離して足りなかったとき：元の位置へ戻す */
async function settle() {
  if (reduced()) return clear();
  place(0, {ms: 180});
  await wait(190);
  if (!busy) clear();
}

/** 捲り切って切り替え、新しいページを反対側から入れる */
async function turn(dir) {
  busy = true;
  const sign = dir === 'back' ? -1 : 1;
  if (!reduced()) {
    const el = page();
    place(sign * 2.6, {ms: OUT_MS});
    if (el) el.style.opacity = '0';
    await wait(OUT_MS);
  }
  if (dir === 'back') history.back();
  else history.forward();
  await wait(30); // hashchange で描き直すのを待つ
  if (!reduced()) {
    place(-sign * 0.9);
    const el = page();
    if (el) el.style.opacity = '0';
    void el?.offsetWidth;
    place(0, {ms: IN_MS});
    if (el) el.style.opacity = '1';
    await wait(IN_MS);
  }
  clear();
  busy = false;
}

window.addEventListener(
  'wheel',
  (e) => {
    if (busy || e.ctrlKey || e.defaultPrevented) return;
    const r = swipe.feed(e.deltaX, e.deltaY, e.timeStamp);
    clearTimeout(endTimer);
    endTimer = setTimeout(() => {
      const go = swipe.end();
      if (go) turn(go);
      else if (document.documentElement.classList.contains('is-page-turning')) settle();
    }, SWIPE_IDLE);
    if (!r) return;
    const dir = r.progress < 0 ? 'back' : 'forward';
    if (r.progress !== 0 && (canScrollX(e.target, e.deltaX) || !canGo(dir))) {
      swipe.cancel(); // このスワイプは横のスクロールとして使う（途中から戻る・進むにしない）
      if (document.documentElement.classList.contains('is-page-turning')) settle();
      return;
    }
    place(r.progress);
  },
  {passive: true}
);
