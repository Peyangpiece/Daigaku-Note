// 並べ替えの画面（右クリック →「並べ替え」）：並ぶもの全部が小刻みに揺れ、ドラッグで入れ替える。右上の ✓ で終わる。
// 揺れは CSS の rotate（個別の回転）、ドラッグと入れ替えの動きは translate（個別の移動）で付ける。
// 付箋の傾き（transform）と重ならないように、transform は使わない。Esc で並べ替えをやめる（元の並びに戻す）

let active = null;

/** 並べ替えの最中か（最中は、同じ画面の描き直しを待たせる） */
export const isReordering = () => !!active;

const DRAG_START = 5; // これだけ動かしたらドラッグを始める（px）
const SWAP_MS = 220; // 入れ替えの動きの長さ

/**
 * container の中の itemSelector を並べ替える。keyOf(要素) が並びの鍵。
 * 終わる（✓）と onDone(鍵の並び)、やめる（Esc・画面を移る）と onCancel()。
 * grab：長押しで始めたとき、押している要素をそのまま持ち上げる {el, pointerId, x, y, onStill?}（指を離さずに動かせる）。
 *   動かさずに離したら並べ替えをやめて onStill()（長押しのメニューを出すなど）
 */
export function startReorder(
  container,
  {itemSelector, keyOf = (el) => el.dataset.sortKey, onDone, onCancel, hint, grab = null}
) {
  stopReorder();
  const items = () => [...container.querySelectorAll(`:scope > ${itemSelector}`)];
  if (items().length < 2) return false;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  container.classList.add('reorder');
  document.body.classList.add('reordering');
  items().forEach((el, i) => {
    el.classList.add('reorder__item');
    // 揺れの向きと始まりを 1 枚ずつずらす（全部が同じに揺れると機械的に見える）
    el.style.setProperty('--jiggle-delay', `${-((i * 97) % 260)}ms`);
    el.style.setProperty('--jiggle-dir', i % 2 ? '-1' : '1');
  });
  // 中のファイルのドラッグ（別の付箋へ移す）は止める
  const draggables = [...container.querySelectorAll('[draggable="true"]')];
  draggables.forEach((el) => el.setAttribute('draggable', 'false'));

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'reorder-done';
  done.setAttribute('aria-label', '並べ替えを終える');
  done.title = '並べ替えを終える（Esc でやめる）';
  done.innerHTML = '<span aria-hidden="true">✓</span>';
  document.body.append(done);
  const tip = document.createElement('p');
  tip.className = 'reorder-tip';
  tip.setAttribute('role', 'status');
  tip.textContent = hint ?? 'ドラッグして並べ替えます。終わったら右上の ✓ を押します';
  document.body.append(tip);

  let drag = null;
  const keys = () => items().map(keyOf);
  const before = keys();

  /** FLIP：動かす前の位置を覚え、動かしたあと前の位置から今の位置へ滑らせる */
  function flip(change, except) {
    const others = items().filter((el) => el !== except);
    const first = new Map(others.map((el) => [el, el.getBoundingClientRect()]));
    change();
    for (const el of others) {
      const a = first.get(el);
      el.style.transition = 'none';
      el.style.translate = 'none';
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (!dx && !dy) continue;
      el.style.translate = `${dx}px ${dy}px`;
      if (reduce) {
        el.style.translate = '';
        continue;
      }
      requestAnimationFrame(() => {
        el.style.transition = `translate ${SWAP_MS}ms cubic-bezier(.2,.8,.2,1)`;
        el.style.translate = '';
      });
    }
  }

  /** ドラッグ中の要素を指の下に置く（並びの中の今の場所からのずれで） */
  function follow(x, y) {
    const el = drag.el;
    el.style.translate = 'none';
    const r = el.getBoundingClientRect();
    el.style.translate = `${x - drag.grabX - r.left}px ${y - drag.grabY - r.top}px`;
  }

  /** 指の下にあるほかの要素と入れ替える */
  function swapAt(x, y) {
    const list = items();
    const target = list.find((el) => {
      if (el === drag.el) return false;
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    if (!target) return;
    // 入れ替えた直後は、滑ってくる要素の上で行ったり来たりしないように少し待つ
    if (target === drag.last && Date.now() - drag.lastAt < SWAP_MS + 60) return;
    const from = list.indexOf(drag.el);
    const to = list.indexOf(target);
    flip(() => (from < to ? target.after(drag.el) : target.before(drag.el)), drag.el);
    drag.last = target;
    drag.lastAt = Date.now();
    follow(x, y);
  }

  /** 持ち上げる（ドラッグの始まり） */
  function lift(el, pointerId) {
    drag.moving = true;
    el.classList.add('reorder__item--drag');
    el.style.transition = 'none';
    try {
      container.setPointerCapture?.(pointerId);
    } catch {
      /* 捕まえられなくても動く */
    }
  }
  // タッチで動かしている間は、画面が流れないようにする（長押しのあとの動きは、touch-action では止まらない）
  const noScroll = (e) => drag?.moving && e.cancelable && e.preventDefault();

  const onDown = (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest?.(itemSelector);
    if (!el || el.parentElement !== container) return;
    const r = el.getBoundingClientRect();
    drag = {el, id: e.pointerId, x0: e.clientX, y0: e.clientY, grabX: e.clientX - r.left, grabY: e.clientY - r.top};
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_START) return;
      lift(drag.el, e.pointerId);
    }
    if (drag.held && !drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) >= DRAG_START)
      drag.moved = true;
    follow(e.clientX, e.clientY);
    swapAt(e.clientX, e.clientY);
    // 端に来たら画面を送る
    const edge = 48;
    if (e.clientY < edge) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
  };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const el = drag.el;
    const moving = drag.moving;
    const still = drag.held && !drag.moved;
    drag = null;
    if (!moving) return;
    // 長押しして動かさずに離した：並べ替えはやめて、長押しのいつもの動き（付箋のメニュー）にする
    if (still && grab?.onStill) {
      finish(null);
      grab.onStill();
      return;
    }
    // 指を離したら、並びの中の場所へ滑って戻る
    el.classList.remove('reorder__item--drag');
    el.style.transition = reduce ? 'none' : `translate ${SWAP_MS}ms cubic-bezier(.2,.8,.2,1)`;
    el.style.translate = '';
  };
  // 並べ替えの最中は、中のボタン・リンク・ファイルを押しても動かさない（✓ だけが効く）
  const block = (e) => {
    if (done.contains(e.target)) return;
    if (container.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  };
  const onLeave = () => finish(false);

  /** save：true で覚える（onDone）、false でやめる（onCancel）、null は何も呼ばない（並びは変わっていない） */
  function finish(save) {
    if (active !== stop) return;
    active = null;
    container.removeEventListener('pointerdown', onDown);
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('pointerup', onUp);
    container.removeEventListener('pointercancel', onUp);
    document.removeEventListener('touchmove', noScroll);
    document.removeEventListener('click', block, true);
    document.removeEventListener('dblclick', block, true);
    document.removeEventListener('contextmenu', block, true);
    document.removeEventListener('dragstart', block, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('hashchange', onLeave);
    container.classList.remove('reorder');
    document.body.classList.remove('reordering');
    for (const el of items()) {
      el.classList.remove('reorder__item', 'reorder__item--drag');
      el.style.removeProperty('--jiggle-delay');
      el.style.removeProperty('--jiggle-dir');
      el.style.translate = '';
      el.style.transition = '';
    }
    draggables.forEach((el) => el.setAttribute('draggable', 'true'));
    done.remove();
    tip.remove();
    const after = keys();
    if (save) onDone?.(after, after.join('\n') !== before.join('\n'));
    else if (save === false) onCancel?.();
  }
  const stop = () => finish(false);
  active = stop;
  done.addEventListener('click', () => finish(true));
  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);
  document.addEventListener('touchmove', noScroll, {passive: false});
  document.addEventListener('click', block, true);
  document.addEventListener('dblclick', block, true);
  document.addEventListener('contextmenu', block, true);
  document.addEventListener('dragstart', block, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hashchange', onLeave);
  // 長押しで始めた：押している要素を、指の下でそのまま持ち上げる
  if (grab?.el && grab.el.parentElement === container) {
    const r = grab.el.getBoundingClientRect();
    drag = {
      el: grab.el,
      id: grab.pointerId,
      x0: grab.x,
      y0: grab.y,
      grabX: grab.x - r.left,
      grabY: grab.y - r.top,
      held: true
    };
    lift(grab.el, grab.pointerId);
    follow(grab.x, grab.y);
  } else done.focus();
  return true;
}

/** 並べ替えをやめる（元の並びに戻すのは onCancel の役目） */
export function stopReorder() {
  active?.();
}
