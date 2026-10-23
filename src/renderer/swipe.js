// トラックパッドの 2 本指の横スワイプで、一つ前の画面へ戻る・戻る前の画面へ進む（ブラウザの戻る・進むと同じ）。
// 画面の切り替えは #/… のアドレスなので、history.back()・history.forward() で app.js の hashchange が描き直す。
// 見分けは shared/swipe.js。動かしている間は、画面の端に矢印の丸が出て、届くと色が付く。
// 次のときはスワイプにしない：ピンチ（ctrlKey 付きの wheel。PDF の拡大）、ほかの部品が受けた wheel（defaultPrevented）、
// 指の下にまだ横に動かせる所があるとき（拡大した PDF・横に長い表など。端まで動かしきってからのスワイプは戻る・進む）、
// 戻る先・進む先がないとき
import {createSwipe} from '../shared/swipe.js';

const swipe = createSwipe();
let hint = null;
let hideTimer = 0;

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

/** 画面の端の矢印の丸。progress は -1〜1（負は戻る＝左端、正は進む＝右端） */
function show(progress, ready = false) {
  if (!hint) {
    hint = document.createElement('div');
    hint.className = 'swipe-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
    document.body.append(hint);
  }
  const back = progress < 0;
  const p = Math.min(1, Math.abs(progress));
  hint.classList.toggle('is-forward', !back);
  hint.classList.toggle('is-ready', ready);
  hint.style.setProperty('--p', String(p));
  hint.hidden = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => (hint.hidden = true), ready ? 350 : 200);
}

window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.defaultPrevented) return;
    const r = swipe.feed(e.deltaX, e.deltaY, e.timeStamp);
    if (!r.go && !r.progress) return;
    const dir = r.progress < 0 ? 'back' : 'forward';
    if (canScrollX(e.target, e.deltaX) || !canGo(dir)) {
      swipe.cancel(); // このスワイプは横のスクロールとして使う（途中から戻る・進むにしない）
      return;
    }
    if (!r.go) return show(r.progress);
    show(r.progress, true);
    if (r.go === 'back') history.back();
    else history.forward();
  },
  {passive: true}
);
