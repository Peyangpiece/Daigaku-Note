// ショップの詳細ページの「試し書き」（SPEC §15）。お店に置いてある試し書きの紙のように、罫線のある白い正方形の付箋に書ける。
// 付箋は木のメモトレー（縁を残して彫ったくぼみ・右上に金の台のペン立て）に載せてある。
// ボールペン：白紙の付箋に、ペンの色・太さ・書き味（筆圧で太さが変わる。shared/ink.js）で書く。
// マーカー・文字隠しペン：付箋の真ん中に「大学ノート」と印字してあり、その上に引ける。
// 赤シート：文字隠しペンと、赤シートで消える色（赤・橙・桃）のボールペンでは、付箋の横に置く（shared/stationery.js の needsRedSheet）。
//   ドラッグで動かして付箋に重ねると、重なったところだけ「赤シートを通した見え方」の写しに切り替わる。
//   写しは付箋の中身を赤の成分だけの濃淡にしたもの（SVG のフィルタ）。赤い光しか通らないので、明るい赤・橙・桃の線は紙と同じ明るさになって消え、
//   赤の成分が 0 の文字隠しペンは黒くなって下の字が読めなくなる。その上に赤シートの赤を乗算で重ねる（編集画面の赤シートと同じ色）
// 付箋の右下はめくれていて、押すか左上へ引くと、はがれて下の新しい紙になる。書いた線はこの画面を開いている間だけ覚える（保存しない）
import {esc} from '../app.js';
import {createCapture, strokePath} from '../../shared/ink.js';
import {TOOL_TYPES, fadesUnderRedSheet, itemOf, needsRedSheet} from '../../shared/stationery.js';

const SIZE = 300; // 付箋の座標（75mm 角の付箋を 1 = 0.25mm で）
const RULE = {top: 38, gap: 28}; // 罫線の位置（7mm おき）
const PEN_SCALE = 1.6; // ペンの太さ（pt）→ 付箋の座標（1pt ≒ 0.35mm）。見やすいよう少しだけ太く
const MARKER_SCALE = 2.4; // マーカーの太さ（pt）→ 付箋の座標
const HIDER_WIDTH = 24; // 文字隠しペンの太さ（印字の字の高さより少し太い）
const CURL = 26; // めくれた角の大きさ（px）
const PEEL_MS = 450;
/** メモトレーの右上のペン立て：金の台座と玉、斜めに立つ黒いホルダー（口に金の輪） */
const STAND = `<svg class="ts-tray__stand" viewBox="0 0 36 56"><defs>
  <linearGradient id="ts-gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9a7420"/><stop offset="0.45" stop-color="#f6dc86"/><stop offset="1" stop-color="#a27a22"/></linearGradient>
  <linearGradient id="ts-black" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#050505"/><stop offset="0.35" stop-color="#4a4a4a"/><stop offset="1" stop-color="#0a0a0a"/></linearGradient></defs>
  <ellipse cx="18" cy="49" rx="15" ry="5.5" fill="rgba(0,0,0,.25)"/>
  <ellipse cx="18" cy="47.5" rx="14" ry="5" fill="url(#ts-gold)"/><ellipse cx="18" cy="46.5" rx="9" ry="3" fill="#fbe9a8" opacity=".55"/>
  <circle cx="17" cy="41" r="3.6" fill="url(#ts-gold)"/>
  <g transform="rotate(16 17 40)"><path d="M14.6 40 L12 6 Q18 3 24 6 L21.4 40 Z" fill="url(#ts-black)"/><path d="M12.6 14 L23.4 14 L23.2 16 L12.8 16 Z" fill="url(#ts-gold)"/>
  <ellipse cx="18" cy="6" rx="6" ry="2.2" fill="#000"/></g></svg>`;

// 品ごとの書いた線と選んだ芯（この画面を開いている間だけ。描き直しても消えない）
const notes = new Map();
const noteOf = (id) => {
  if (!notes.has(id)) notes.set(id, {ink: [], refill: null});
  return notes.get(id);
};
let sheetAt = {x: 0, y: 0}; // 赤シートを動かした量（px）

/** 書く線の色・太さ・書き方。多機能ペンは選んだ芯（シャープも） */
function inkOf(item) {
  if (item.type === 'pen') {
    const r = item.refills?.find((x) => x.id === noteOf(item.id).refill) ?? item.refills?.[0] ?? item;
    return {kind: 'pen', color: r.color, width: r.width * PEN_SCALE};
  }
  if (item.type === 'marker') return {kind: 'line', color: item.color, width: item.width * MARKER_SCALE};
  return {kind: 'line', color: item.color, width: HIDER_WIDTH};
}

/** 付箋の紙：地の色・罫線・（マーカー・文字隠しペンは）真ん中の「大学ノート」 */
function paper(item) {
  const lines = [];
  for (let y = RULE.top; y < SIZE - 6; y += RULE.gap) lines.push(`<path d="M0 ${y}H${SIZE}"/>`);
  const word =
    item.type === 'pen'
      ? ''
      : `<text class="ts-word" x="${SIZE / 2}" y="${RULE.top + RULE.gap * 5 - 6}" text-anchor="middle">大学ノート</text>`;
  return `<rect class="ts-ground" width="${SIZE}" height="${SIZE}"/><g class="ts-rules">${lines.join('')}</g>${word}`;
}

/** 線の SVG（ボールペンは塗りつぶした輪郭、マーカー・文字隠しペンは太さの決まった線を乗算で） */
function strokeSvg(ink, points, pressure) {
  if (ink.kind === 'pen') return `<path fill="${ink.color}" d="${strokePath(points, ink.width, {pressure})}"/>`;
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  return `<path class="ts-hl" stroke="${ink.color}" stroke-width="${ink.width}" d="${points.length > 1 ? d : `${d}l0.1 0`}"/>`;
}

/** 試し書きの欄（道具の詳細ページ。ペンケースには出さない） */
export function tryout(item) {
  if (!TOOL_TYPES.includes(item.type)) return '';
  const note = noteOf(item.id);
  const sheet = needsRedSheet(item);
  const refills = item.refills
    ? `<div class="ts-refills" role="group" aria-label="書く芯">${item.refills
        .map((r) => {
          const on = r.id === (note.refill ?? item.refills[0].id);
          return `<button type="button" class="shop-chip${on ? ' is-on' : ''}" data-try="refill" data-id="${esc(r.id)}" aria-pressed="${on}"><span class="ts-refills__dot" style="background:${r.color}"></span>${esc(r.name)}</button>`;
        })
        .join('')}</div>`
    : '';
  const fading = item.refills?.filter((r) => !r.sharp && fadesUnderRedSheet(r.color)).map((r) => esc(r.name));
  const what =
    item.type === 'hider'
      ? '赤シートを付箋に重ねると、塗ったところが黒くなって字が読めなくなります。'
      : fading
        ? `赤シートを付箋に重ねると、${fading.join('・')}の線は見えなくなります（ほかの芯の線は見えたままです）。`
        : '赤シートを付箋に重ねると、このインクの線は見えなくなります。';
  requestAnimationFrame(syncAll); // 描き直したあと、赤シートが付箋に重なっていれば写しを出す
  return `<section class="fb-try" data-try-box="${esc(item.id)}" aria-label="試し書き">
    <h3 class="fb-detail__sub">試し書き</h3>
    ${refills}
    <div class="ts-desk${sheet ? ' ts-desk--sheet' : ''}">
      <div class="ts-tray" aria-hidden="true"><div class="ts-tray__well"></div>${STAND}</div>
      <div class="ts-pad">
        <div class="ts-under" aria-hidden="true"><svg viewBox="0 0 ${SIZE} ${SIZE}">${paper(item)}</svg></div>
        <div class="ts-note">
          <svg class="ts-paper" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="試し書きの付箋（なぞると書けます）">
            <defs><filter id="ts-red" color-interpolation-filters="sRGB">
              <feColorMatrix type="matrix" values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 1 0"/>
              <feComponentTransfer><feFuncR type="table" tableValues="0 0.15 0.3 0.45 0.6 0.95 1 1"/><feFuncG type="table" tableValues="0 0.15 0.3 0.45 0.6 0.95 1 1"/><feFuncB type="table" tableValues="0 0.15 0.3 0.45 0.6 0.95 1 1"/></feComponentTransfer>
            </filter></defs>
            <g id="ts-face">${paper(item)}<g class="ts-ink">${note.ink.join('')}</g></g>
          </svg>
          ${sheet ? `<svg class="ts-seen" viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true"><use href="#ts-face" filter="url(#ts-red)"/></svg>` : ''}
        </div>
        <button type="button" class="ts-curl" data-try="peel" aria-label="付箋をはがして新しい紙にする" title="押すか左上へ引くと、はがして新しい紙になります"><span class="ts-curl__flap"></span></button>
      </div>
      ${sheet ? `<div class="ts-sheet" role="img" aria-label="赤シート（ドラッグで動かせます）" style="transform:translate(${sheetAt.x}px, ${sheetAt.y}px)"><span>赤シート</span></div>` : ''}
    </div>
    <p class="muted fb-try__hint">付箋の上をなぞると書けます。右下のめくれた角を押すか左上へ引くと、はがして新しい紙になります。${sheet ? what : ''}</p>
  </section>`;
}

// ---- 赤シートと付箋の重なり：重なったところだけ「赤シートを通した見え方」の写しを見せる ----
function sync(box) {
  const seen = box.querySelector('.ts-seen');
  const sheet = box.querySelector('.ts-sheet');
  if (!seen || !sheet) return;
  const n = box.querySelector('.ts-note').getBoundingClientRect();
  const s = sheet.getBoundingClientRect();
  const left = Math.max(n.left, s.left) - n.left,
    top = Math.max(n.top, s.top) - n.top,
    right = n.right - Math.min(n.right, s.right),
    bottom = n.bottom - Math.min(n.bottom, s.bottom);
  const on = left + right < n.width && top + bottom < n.height;
  seen.style.display = on ? 'block' : 'none';
  if (on) seen.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}
function syncAll() {
  for (const box of document.querySelectorAll('[data-try-box]')) sync(box);
}
window.addEventListener('resize', syncAll);

// ---- 書く ----
let drawing = null;
const toPaper = (e, rect) => [
  ((e.clientX - rect.left) * SIZE) / rect.width,
  ((e.clientY - rect.top) * SIZE) / rect.height
];

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const svg = e.target.closest('.fb-try .ts-paper');
  if (svg) return startInk(e, svg);
  const curl = e.target.closest('.fb-try .ts-curl');
  if (curl) return startPeel(e, curl);
  const sheet = e.target.closest('.fb-try .ts-sheet');
  if (sheet) return startSheet(e, sheet);
});

function startInk(e, svg) {
  const box = svg.closest('[data-try-box]');
  const item = itemOf(box.dataset.tryBox);
  if (!item || box.querySelector('.ts-pad.is-peeling')) return;
  e.preventDefault();
  const ink = inkOf(item);
  const group = svg.querySelector('.ts-ink');
  group.insertAdjacentHTML('beforeend', '<path/>');
  const d = {
    id: item.id,
    ink,
    el: group.lastElementChild,
    rect: svg.getBoundingClientRect(),
    pressure: e.pointerType === 'pen',
    cap: createCapture({minGap: 0.4, streamline: e.pointerType === 'pen' ? 0.2 : 0.4}),
    frame: 0
  };
  const add = (ev) => {
    const [x, y] = toPaper(ev, d.rect);
    d.cap.add(x, y, d.pressure ? (ev.pressure > 0 ? ev.pressure : 0.5) : 0.5);
  };
  const draw = () => {
    d.frame = 0;
    d.el.outerHTML = strokeSvg(d.ink, d.cap.points, d.pressure);
    d.el = group.lastElementChild;
  };
  add(e);
  draw();
  svg.setPointerCapture(e.pointerId);
  const move = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    for (const c of ev.getCoalescedEvents?.() ?? [ev]) add(c);
    d.frame ||= requestAnimationFrame(draw);
  };
  const end = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    svg.removeEventListener('pointermove', move);
    svg.removeEventListener('pointerup', end);
    svg.removeEventListener('pointercancel', end);
    cancelAnimationFrame(d.frame);
    const [x, y] = toPaper(ev, d.rect);
    const points = d.cap.finish(x, y, d.pressure ? (ev.pressure > 0 ? ev.pressure : 0.5) : 0.5);
    const html = strokeSvg(d.ink, points, d.pressure);
    d.el.outerHTML = html;
    noteOf(d.id).ink.push(html);
    drawing = null;
  };
  drawing = d;
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

// ---- はがす：右下のめくれた角を押す・左上へ引く ----
function peel(box) {
  const pad = box.querySelector('.ts-pad');
  if (!pad || pad.classList.contains('is-peeling') || drawing) return;
  pad.classList.add('is-peeling');
  const fast = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(
    () => {
      noteOf(box.dataset.tryBox).ink = [];
      pad.querySelector('.ts-ink').innerHTML = '';
      pad.classList.add('is-fresh'); // 動きを止めて元の場所へ戻す（下の新しい紙と入れ替わったように見える）
      pad.classList.remove('is-peeling');
      pad.style.removeProperty('--curl');
      void pad.offsetWidth;
      pad.classList.remove('is-fresh');
    },
    fast ? 0 : PEEL_MS
  );
}

function startPeel(e, curl) {
  e.preventDefault();
  const box = curl.closest('[data-try-box]');
  const pad = curl.closest('.ts-pad');
  const w = pad.getBoundingClientRect().width;
  const x0 = e.clientX,
    y0 = e.clientY;
  let size = CURL;
  let moved = false;
  pad.classList.add('is-pulling');
  curl.setPointerCapture(e.pointerId);
  const move = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    const dx = x0 - ev.clientX,
      dy = y0 - ev.clientY;
    if (Math.hypot(dx, dy) > 6) moved = true;
    // 左上（角から紙の中へ）へ引いた分だけ、めくれが大きくなる
    size = Math.min(w * 0.7, CURL + Math.max(0, (dx + dy) / Math.SQRT2));
    pad.style.setProperty('--curl', `${size}px`);
  };
  const end = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    curl.removeEventListener('pointermove', move);
    curl.removeEventListener('pointerup', end);
    curl.removeEventListener('pointercancel', end);
    pad.classList.remove('is-pulling');
    if (ev.type === 'pointerup' && (!moved || size > w * 0.35)) peel(box);
    else pad.style.removeProperty('--curl');
  };
  curl.addEventListener('pointermove', move);
  curl.addEventListener('pointerup', end);
  curl.addEventListener('pointercancel', end);
}

// ---- 赤シートを動かす（付箋の机の中で） ----
function startSheet(e, sheet) {
  e.preventDefault();
  const box = sheet.closest('[data-try-box]');
  const desk = sheet.closest('.ts-desk').getBoundingClientRect();
  const r = sheet.getBoundingClientRect();
  const base = {x: r.left - sheetAt.x, y: r.top - sheetAt.y}; // 動かす前（translate 0）の位置
  const start = {...sheetAt, cx: e.clientX, cy: e.clientY};
  const keep = 60; // 机の外へ出しても、この幅は机の中に残す
  sheet.setPointerCapture(e.pointerId);
  sheet.classList.add('is-dragging');
  const move = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    const x = start.x + ev.clientX - start.cx,
      y = start.y + ev.clientY - start.cy;
    sheetAt = {
      x: Math.min(desk.right - keep - base.x, Math.max(desk.left + keep - r.width - base.x, x)),
      y: Math.min(desk.bottom - keep - base.y, Math.max(desk.top - base.y, y))
    };
    sheet.style.transform = `translate(${sheetAt.x}px, ${sheetAt.y}px)`;
    sync(box);
  };
  const end = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    sheet.classList.remove('is-dragging');
    sheet.removeEventListener('pointermove', move);
    sheet.removeEventListener('pointerup', end);
    sheet.removeEventListener('pointercancel', end);
  };
  sheet.addEventListener('pointermove', move);
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('.fb-try [data-try]');
  if (!b) return;
  const box = b.closest('[data-try-box]');
  if (b.dataset.try === 'peel') {
    if (e.detail === 0) peel(box); // キーボード（Enter・スペース）。ポインタは pointerup で済ませている
  } else if (b.dataset.try === 'refill') {
    noteOf(box.dataset.tryBox).refill = b.dataset.id;
    for (const c of box.querySelectorAll('[data-try="refill"]')) {
      const on = c === b;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-pressed', String(on));
    }
  }
});
