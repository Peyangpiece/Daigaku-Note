// ノートの試し書き（docs/SPEC-NOTEBOOK.md §2）：ノートのページを実際の大きさ（CSS の mm）で開き、ペンで書ける。
// ショップのノートの詳細ページと、マイノートの調節の画面の「試し書き」から開く。原稿用紙は A4 横なので横長に開く。
// ページの絵は shared/notebooks.js の pageSvg（PDF と同じ計算）。書いた線は、アプリを開いている間だけ紙ごとに覚える（保存しない）
import {esc} from '../ui-kit.js';
import {createCapture, drawMode, streamlineOf, strokePath, syntheticMove} from '../../shared/ink.js';
import {cleanDesign, pageGeometry, pageSvg} from '../../shared/notebooks.js';

/** 書く道具：色と太さ（mm）。ボールペンの 0.5 mm くらいの線 */
const PENS = [
  {id: 'black', name: '黒', color: '#1f2328', width: 0.5},
  {id: 'blue', name: '青', color: '#1f4fb8', width: 0.5},
  {id: 'red', name: '赤', color: '#d0322d', width: 0.5},
  {id: 'pencil', name: 'シャープ', color: '#5b5f66', width: 0.4}
];
const ZOOMS = [1, 1.5, 2];

// 紙ごとの書いた線（この画面を閉じても、アプリを開いている間は残す）
const inks = new Map();
let now = null; // 開いている試し書き {key, design, pen, zoom}

const keyOf = (design) => JSON.stringify(cleanDesign(design));

/** 試し書きを開く。title は窓の上に出す名前 */
export function openNoteTry(design, title) {
  closeNoteTry();
  const d = cleanDesign(design);
  const key = keyOf(d);
  if (!inks.has(key)) inks.set(key, []);
  now = {key, design: d, pen: PENS[0], zoom: 1, back: document.activeElement};
  const {w, h} = pageGeometry(d);
  const el = document.createElement('div');
  el.className = 'nbt';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', `${title}の試し書き`);
  el.innerHTML = `
    <div class="nbt__bar">
      <div class="nbt__title"><b>${esc(title)}</b><span class="muted">試し書き・実際の大きさ（${w > h ? 'A4 横' : 'A4 縦'}）</span></div>
      <div class="nbt__tools" role="group" aria-label="ペン">${PENS.map(
        (p, i) =>
          `<button type="button" class="nbt__pen${i === 0 ? ' is-on' : ''}" data-nbt="pen" data-id="${p.id}" aria-pressed="${i === 0}" title="${p.name}"><span style="background:${p.color}"></span>${p.name}</button>`
      ).join('')}</div>
      <div class="nbt__tools" role="group" aria-label="大きさ">${ZOOMS.map(
        (z, i) =>
          `<button type="button" class="shop-chip${i === 0 ? ' is-on' : ''}" data-nbt="zoom" data-z="${z}" aria-pressed="${i === 0}">${z === 1 ? '実際の大きさ' : `${z} 倍`}</button>`
      ).join('')}</div>
      <div class="nbt__tools">
        <button type="button" class="btn btn--small" data-nbt="undo">1 つ戻す</button>
        <button type="button" class="btn btn--small" data-nbt="clear">全部消す</button>
        <button type="button" class="btn btn--small btn--primary" data-nbt="close">閉じる</button>
      </div>
    </div>
    <div class="nbt__desk">
      <div class="nbt__sheet" style="--w:${w}mm; --h:${h}mm">
        ${pageSvg(d, {mm: true})}
        <svg class="nbt__ink" viewBox="0 0 ${w} ${h}" role="img" aria-label="ノートのページ（なぞると書けます）"><g>${inks
          .get(key)
          .join('')}</g></svg>
      </div>
    </div>
    <p class="nbt__hint muted">ページの上をなぞると書けます。書いたものは保存しません（アプリを閉じると消えます）。画面の設定によって、実際の紙と少しちがう大きさに見えることがあります。</p>`;
  document.body.append(el);
  document.body.classList.add('nbt-open');
  el.querySelector('[data-nbt="close"]').focus();
}

export function closeNoteTry() {
  const el = document.querySelector('.nbt');
  if (!el) return;
  el.remove();
  document.body.classList.remove('nbt-open');
  const back = now?.back;
  now = null;
  if (back?.isConnected) back.focus();
}

function setZoom(z) {
  const sheet = document.querySelector('.nbt__sheet');
  if (!sheet || !now) return;
  now.zoom = z;
  sheet.style.setProperty('--z', z);
}

// ---- 書く（座標は mm） ----
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !now) return;
  const svg = e.target.closest('.nbt__ink');
  if (!svg) return;
  e.preventDefault();
  const rect = svg.getBoundingClientRect();
  const {w, h} = pageGeometry(now.design);
  const pen = now.pen;
  const pressure = drawMode(null, e.pointerType);
  const cap = createCapture({minGap: 0.08, streamline: streamlineOf(null, e.pointerType)});
  const group = svg.querySelector('g');
  group.insertAdjacentHTML('beforeend', '<path/>');
  let el = group.lastElementChild;
  let frame = 0;
  const at = (ev) => [((ev.clientX - rect.left) * w) / rect.width, ((ev.clientY - rect.top) * h) / rect.height];
  const p = (ev) => (pressure === true ? (ev.pressure > 0 ? ev.pressure : 0.5) : 0.5);
  const html = (pts) => `<path fill="${pen.color}" d="${strokePath(pts, pen.width, {pressure})}"/>`;
  const draw = () => {
    frame = 0;
    el.outerHTML = html(cap.points);
    el = group.lastElementChild;
  };
  cap.add(...at(e), p(e));
  draw();
  svg.setPointerCapture(e.pointerId);
  const move = (ev) => {
    if (ev.pointerId !== e.pointerId || syntheticMove(ev)) return;
    for (const c of ev.getCoalescedEvents?.() ?? [ev]) cap.add(...at(c), p(c));
    frame ||= requestAnimationFrame(draw);
  };
  const end = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    svg.removeEventListener('pointermove', move);
    svg.removeEventListener('pointerup', end);
    svg.removeEventListener('pointercancel', end);
    cancelAnimationFrame(frame);
    const done = html(cap.finish(...at(ev), p(ev)));
    el.outerHTML = done;
    inks.get(now.key)?.push(done);
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('.nbt [data-nbt]');
  if (!b || !now) return;
  const what = b.dataset.nbt;
  const group = document.querySelector('.nbt__ink g');
  if (what === 'close') closeNoteTry();
  else if (what === 'undo') {
    inks.get(now.key).pop();
    group?.lastElementChild?.remove();
  } else if (what === 'clear') {
    inks.set(now.key, []);
    if (group) group.innerHTML = '';
  } else if (what === 'pen' || what === 'zoom') {
    if (what === 'pen') now.pen = PENS.find((p) => p.id === b.dataset.id) ?? PENS[0];
    else setZoom(Number(b.dataset.z));
    for (const c of b.parentElement.querySelectorAll('button')) {
      c.classList.toggle('is-on', c === b);
      c.setAttribute('aria-pressed', String(c === b));
    }
  }
});
document.addEventListener('keydown', (e) => {
  if (now && e.key === 'Escape') {
    e.stopPropagation();
    closeNoteTry();
  }
});
// 画面が変わったら閉じる（ほかのページに試し書きを残さない）
window.addEventListener('hashchange', closeNoteTry);
