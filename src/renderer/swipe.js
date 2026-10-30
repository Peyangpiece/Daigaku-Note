// トラックパッドの 2 本指の横スワイプで、一つ前の画面へ戻る・戻る前の画面へ進む（ブラウザの戻る・進むと同じ）。
// 画面の切り替えは #/… のアドレスなので、history.back()・history.forward() で app.js の hashchange が描き直す。
// 見分けは shared/swipe.js。指を動かしている間は、ノートのページ（#app）が指と同じだけ横へスライドし、下に机が見える。
// 指を離したとき、十分に動かしていればそのまま画面の外までスライドして切り替える。足りなければ元の位置へ戻る（横に動くだけ）。
// ずれた所には、行き先のページ（前に開いていたときの写し）が並んで見え、一緒にスライドしてくる。
//   写しは、ページを離れる直前（Navigation API の navigate）に #app を複製して、履歴の項目（key）ごとに取っておく。
//   写しがない行き先（アプリを開く前の履歴など）は、これまでどおり机が見え、新しいページは反対側からスライドして入ってくる。
// 次のときはスワイプにしない：ピンチ（ctrlKey 付きの wheel。PDF の拡大）、ほかの部品が受けた wheel（defaultPrevented）、
// 指の下にまだ横に動かせる所があるとき（拡大した PDF・横に長い表など。端まで動かしきってからのスワイプは戻る・進む）、
// 戻る先・進む先がないとき
import {SWIPE_DISTANCE, SWIPE_IDLE, createSwipe} from '../shared/swipe.js';

const swipe = createSwipe();
const OUT_MS = 180; // 画面の外までスライドする時間
const IN_MS = 220; // 新しいページがスライドして入ってくる時間
let endTimer = 0;
let lastWheel = 0; // いちばん新しい wheel を受けた時刻
let busy = false; // スライドして切り替わるまで（その間の wheel は無視）
const SHOTS_MAX = 5; // 取っておく写しの数（古いものから捨てる）
const SHOTS_NEAR = 2; // 今の項目から前後いくつまでの写しを取っておくか（スワイプで行けるのは隣だけ。少し余裕を持つ）
const shots = new Map(); // 履歴の項目の key → {node, x, y, w, viewer}
let under = null; // いま並べている行き先の写し {el, dir, shot}

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

// ---- 行き先のページの写し ----
/** いまのページ（#app）の写しを、今の履歴の項目に取っておく。見えている canvas（PDF のページ）だけ絵を写す */
function shoot() {
  const app = page();
  const key = window.navigation?.currentEntry?.key;
  if (!app || !key) return;
  const node = app.cloneNode(true);
  node.removeAttribute('id');
  for (const el of node.querySelectorAll('[id]')) el.removeAttribute('id');
  node.style.transform = '';
  node.style.transition = '';
  const src = app.querySelectorAll('canvas');
  const dst = node.querySelectorAll('canvas');
  src.forEach((c, i) => {
    const r = c.getBoundingClientRect();
    const seen = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    try {
      if (seen && c.width && c.height) dst[i].getContext('2d').drawImage(c, 0, 0);
      else dst[i].width = dst[i].height = 0; // 見えていないページは写さない（大きな PDF でメモリを使いすぎない）
    } catch {
      dst[i].width = dst[i].height = 0;
    }
  });
  shots.delete(key);
  shots.set(key, {
    node,
    x: window.scrollX,
    y: window.scrollY,
    w: app.offsetWidth,
    viewer: document.documentElement.classList.contains('paper-canvas')
  });
  // 遠い履歴の写しは捨てる（画面全体の複製で、PDF の絵も含むためメモリを使う）
  const nav = window.navigation;
  const i = nav?.currentEntry?.index ?? -1;
  if (i >= 0) {
    const near = new Set(
      nav
        .entries()
        .slice(Math.max(0, i - SHOTS_NEAR), i + SHOTS_NEAR + 1)
        .map((e) => e.key)
    );
    for (const k of [...shots.keys()]) if (!near.has(k)) shots.delete(k);
  }
  while (shots.size > SHOTS_MAX) shots.delete(shots.keys().next().value);
}
window.navigation?.addEventListener('navigate', shoot);

/** 戻る・進む先の履歴の項目の写し（なければ null） */
function shotOf(dir) {
  const nav = window.navigation;
  const i = nav?.currentEntry?.index;
  if (i == null || i < 0) return null;
  const entry = nav.entries()[dir === 'back' ? i - 1 : i + 1];
  return (entry && shots.get(entry.key)) ?? null;
}
/** 行き先の写しを、いまのページの横（戻るは左、進むは右）に並べる。写しがなければ何もしない */
function showUnder(dir) {
  if (under?.dir === dir) return;
  hideUnder();
  const shot = reduced() ? null : shotOf(dir);
  if (!shot) return;
  const el = document.createElement('div');
  el.className = 'swipe-under paper';
  el.setAttribute('aria-hidden', 'true');
  el.inert = true;
  Object.assign(shot.node.style, {
    position: 'absolute',
    left: `${-shot.x}px`,
    top: `${-shot.y}px`,
    width: `${shot.w}px`,
    margin: '0'
  });
  el.append(shot.node);
  document.body.append(el);
  under = {el, dir, shot};
}
function hideUnder() {
  under?.el.remove();
  under = null;
}

/** ページの横の位置（px。正は右へ）。ms を付けるとその時間で動かす。行き先の写しも隣に並んで動く */
function slide(x, {ms = 0} = {}) {
  const el = page();
  if (!el) return;
  document.documentElement.classList.add('is-page-sliding');
  const transition = ms ? `transform ${ms}ms cubic-bezier(0.2, 0.7, 0.3, 1)` : 'none';
  el.style.transition = transition;
  el.style.transform = `translateX(${x}px)`;
  if (under) {
    const w = document.documentElement.clientWidth; // ページの幅（スクロールバーを除く）。隙間なく並べる
    under.el.style.transition = transition;
    under.el.style.transform = `translateX(${under.dir === 'back' ? x - w : x + w}px)`;
  }
}
/** 指の動き（progress。負は戻る向き）に合わせた位置：指と同じだけ動く */
function follow(p) {
  if (p) showUnder(p < 0 ? 'back' : 'forward');
  slide(-p * SWIPE_DISTANCE);
}
/** ページを元に戻して、スライドの目印を外す */
function clear() {
  const el = page();
  document.documentElement.classList.remove('is-page-sliding');
  hideUnder();
  if (!el) return;
  el.style.transition = '';
  el.style.transform = '';
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** 画面が切り替わる（hashchange。app.js がその場で描き直す）のを待つ。来なければ ms で諦める */
const changed = (ms = 400) =>
  new Promise((r) => {
    const t = setTimeout(r, ms);
    window.addEventListener(
      'hashchange',
      () => {
        clearTimeout(t);
        r();
      },
      {once: true}
    );
  });

/** 指を離して足りなかったとき：元の位置へ戻す */
async function settle() {
  if (reduced()) return clear();
  slide(0, {ms: 180});
  await wait(190);
  if (!busy) clear();
}

/**
 * 画面の外までスライドして切り替える（戻るは右へ、進むは左へ流れる）。行き先の写しが並んでいれば、写しがちょうど画面に
 * 収まったところで本物のページに差し替える。写しがなければ、新しいページを反対側からスライドして入れる
 */
async function turn(dir) {
  busy = true;
  const w = document.documentElement.clientWidth;
  const to = dir === 'back' ? w : -w; // いまのページが出ていく先
  if (!reduced()) {
    showUnder(dir);
    slide(to, {ms: OUT_MS});
    await wait(OUT_MS);
  }
  const shot = under?.dir === dir ? under.shot : null;
  const done = changed();
  if (dir === 'back') history.back();
  else history.forward();
  await done; // 描き直しは hashchange の中でその場で終わる
  if (shot) {
    // 写しと同じ見た目のまま差し替える：スクロールの位置も写しと同じに（編集画面は PDF を読み込んでから自分で合わせる）
    if (!shot.viewer) window.scrollTo(shot.x, shot.y);
    if (shot.viewer && under) {
      // 編集画面は PDF を読み込むまで少しかかるので、写しを上に残して薄く消す
      const el = under.el;
      under = null;
      clear();
      el.style.transition = '';
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 600);
    } else clear();
    busy = false;
    return;
  }
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
    const at = (lastWheel = window.performance.now());
    clearTimeout(endTimer);
    // 指を離したかは、次の描画の前にもう一度確かめる：重い描画（行き先の写しを初めて描くなど）で待たされた wheel は、
    // タイマーより後に届くことがある。描画の前には届いた wheel が先に配られるので、それが来ていれば続きとみる
    endTimer = setTimeout(
      () =>
        requestAnimationFrame(() => {
          if (lastWheel !== at) return;
          const go = swipe.end();
          if (go) turn(go);
          else if (document.documentElement.classList.contains('is-page-sliding')) settle();
        }),
      SWIPE_IDLE
    );
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
