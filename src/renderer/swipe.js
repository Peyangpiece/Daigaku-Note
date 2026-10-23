// トラックパッドの 2 本指の横スワイプで、一つ前の画面へ戻る・戻る前の画面へ進む（ブラウザの戻る・進むと同じ）。
// 画面の切り替えは #/… のアドレスなので、history.back()・history.forward() で app.js の hashchange が描き直す。
// 見分けは shared/swipe.js。指を動かしている間は、ノートのページ（#app）が指と同じだけ横へスライドし、下に机が見える。
// 指を離したとき、十分に動かしていればそのまま画面の外までスライドして切り替え、新しいページは反対側からスライドして入ってくる。
// 足りなければ元の位置へ戻る（傾けたり捲ったりはしない。横に動くだけ）。
// 次のときはスワイプにしない：ピンチ（ctrlKey 付きの wheel。PDF の拡大）、ほかの部品が受けた wheel（defaultPrevented）、
// 指の下にまだ横に動かせる所があるとき（拡大した PDF・横に長い表など。端まで動かしきってからのスワイプは戻る・進む）、
// 戻る先・進む先がないとき
import {SWIPE_DISTANCE, SWIPE_IDLE, createSwipe} from '../shared/swipe.js';

const swipe = createSwipe();
const OUT_MS = 180; // 画面の外までスライドする時間
const IN_MS = 220; // 新しいページがスライドして入ってくる時間
let endTimer = 0;
let busy = false; // スライドして切り替わるまで（その間の wheel は無視）

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

/** ページの横の位置（px。正は右へ）。ms を付けるとその時間で動かす */
function slide(x, {ms = 0} = {}) {
  const el = page();
  if (!el) return;
  document.documentElement.classList.add('is-page-sliding');
  el.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.2, 0.7, 0.3, 1)` : 'none';
  el.style.transform = `translateX(${x}px)`;
}
/** 指の動き（progress。負は戻る向き）に合わせた位置：指と同じだけ動く */
const follow = (p) => slide(-p * SWIPE_DISTANCE);
/** ページを元に戻して、スライドの目印を外す */
function clear() {
  const el = page();
  document.documentElement.classList.remove('is-page-sliding');
  if (!el) return;
  el.style.transition = '';
  el.style.transform = '';
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 指を離して足りなかったとき：元の位置へ戻す */
async function settle() {
  if (reduced()) return clear();
  slide(0, {ms: 180});
  await wait(190);
  if (!busy) clear();
}

/** 画面の外までスライドして切り替え、新しいページを反対側からスライドして入れる（戻るは右へ、進むは左へ流れる） */
async function turn(dir) {
  busy = true;
  const w = window.innerWidth;
  const to = dir === 'back' ? w : -w; // いまのページが出ていく先
  if (!reduced()) {
    slide(to, {ms: OUT_MS});
    await wait(OUT_MS);
  }
  if (dir === 'back') history.back();
  else history.forward();
  await wait(30); // hashchange で描き直すのを待つ
  if (!reduced()) {
    slide(-to); // 新しいページは反対側の画面の外から
    void page()?.offsetWidth;
    slide(0, {ms: IN_MS});
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
      else if (document.documentElement.classList.contains('is-page-sliding')) settle();
    }, SWIPE_IDLE);
    if (!r) return;
    const dir = r.progress < 0 ? 'back' : 'forward';
    if (r.progress !== 0 && (canScrollX(e.target, e.deltaX) || !canGo(dir))) {
      swipe.cancel(); // このスワイプは横のスクロールとして使う（途中から戻る・進むにしない）
      if (document.documentElement.classList.contains('is-page-sliding')) settle();
      return;
    }
    follow(r.progress);
  },
  {passive: true}
);
