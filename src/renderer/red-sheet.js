// 赤シート（PDF の編集画面・机）：画面の上に赤を乗算で重ねる下敷き（白い紙 → 赤、黒い文字 → 黒、水色のマーカー → 黒）。
// ドラッグで動かし、右下の角のつまみで大きさを変える（ペン・指・マウスどれでも。CSS の resize はマウスでしか使えず、つまみも見えないため）。
// 矢印キーで動かし、Shift＋矢印キーで大きさを変える。大きさは次に出すときのために覚える（このパソコンの中だけ）

const MIN_W = 120;
const MIN_H = 60;
const KEY = 'redSheet.size';

function savedSize() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return Number.isFinite(v?.width) && Number.isFinite(v?.height) ? v : null;
  } catch {
    return null;
  }
}
function saveSize(width, height) {
  try {
    localStorage.setItem(KEY, JSON.stringify({width: Math.round(width), height: Math.round(height)}));
  } catch {
    // 覚えられなくても使える
  }
}

/**
 * 赤シートの要素を作る（置くのは呼ぶ側）。rect は最初の位置と大きさ（覚えた大きさがあればそちらを使う）。
 * onChange は動かしたとき・大きさを変えたときに呼ぶ
 */
export function createRedSheet({left, top, width, height}, {onChange = () => {}} = {}) {
  const el = document.createElement('div');
  el.className = 'red-sheet';
  el.setAttribute('role', 'region');
  el.setAttribute(
    'aria-label',
    '赤シート（ドラッグで動かす。右下の角で大きさを変える。矢印キーで動かし、Shift＋矢印キーで大きさを変える）'
  );
  el.tabIndex = 0;
  el.innerHTML = '<span class="red-sheet__grip" data-grip="se" aria-hidden="true"></span>';
  const size = savedSize();
  const w = Math.max(MIN_W, Math.min(size?.width ?? width, window.innerWidth));
  const h = Math.max(MIN_H, Math.min(size?.height ?? height, window.innerHeight));
  const place = (r) => {
    Object.assign(el.style, {
      left: `${Math.round(r.left)}px`,
      top: `${Math.round(r.top)}px`,
      width: `${Math.round(r.width)}px`,
      height: `${Math.round(r.height)}px`
    });
    onChange();
  };
  place({left, top: Math.min(top, window.innerHeight - h - 8), width: w, height: h});

  /** 右下のつまみ（se）で、左上を動かさずに大きさを変える。つまみがなければ動かす（n・w も扱えるが、つまみは右下だけ） */
  const resized = (r, grip, dx, dy) => {
    if (!grip) return {...r, left: r.left + dx, top: r.top + dy};
    let {left: l, top: t, width: wd, height: ht} = r;
    if (grip.includes('e')) wd = Math.max(MIN_W, r.width + dx);
    if (grip.includes('w')) {
      wd = Math.max(MIN_W, r.width - dx);
      l = r.left + r.width - wd;
    }
    if (grip.includes('s')) ht = Math.max(MIN_H, r.height + dy);
    if (grip.includes('n')) {
      ht = Math.max(MIN_H, r.height - dy);
      t = r.top + r.height - ht;
    }
    return {left: l, top: t, width: wd, height: ht};
  };
  const rectOf = () => {
    const b = el.getBoundingClientRect();
    return {left: b.left, top: b.top, width: b.width, height: b.height};
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.focus({preventScroll: true});
    const grip = e.target.closest('[data-grip]')?.dataset.grip ?? null;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // もう離れていた
    }
    const start = rectOf();
    const sx = e.clientX,
      sy = e.clientY;
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      place(resized(start, grip, ev.clientX - sx, ev.clientY - sy));
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (grip) saveSize(el.offsetWidth, el.offsetHeight);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });

  el.addEventListener('keydown', (e) => {
    const d = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.altKey ? 2 : 20;
    place(resized(rectOf(), e.shiftKey ? 'se' : null, d[0] * step, d[1] * step));
    if (e.shiftKey) saveSize(el.offsetWidth, el.offsetHeight);
  });
  return el;
}
