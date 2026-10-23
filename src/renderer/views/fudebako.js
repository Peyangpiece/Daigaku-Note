// 筆箱のページ（SPEC §15）。上の切り替えタブの「筆箱」。
// 「わたしの筆箱」：筆箱に入れる 6 本（編集画面の PDF の横に出る）とペンケースを選ぶ。持っている文房具の一覧。
// 「文房具をふやす」：品の絵と名前だけの一覧。押すと詳細ページ（#/fudebako/item/<id>）へ。
// 詳細ページ：説明・線の見本・入手。3D モデルの品は、拡大・回転して細部を見られる（renderer/model3d.js）。
// いまは公式の品だけで、すべて無料（値段は出さない）。
// 持ち物・筆箱の中身はメインの設定（stationery）に保存する（ipc.js の stationery.acquire・stationery.arrange）
import {esc, navigate, refresh, state, toast} from '../app.js';
import {strokePath} from '../../shared/ink.js';
import {
  CATALOG,
  SLOTS,
  TOOL_TYPES,
  TYPES,
  TYPE_LABEL,
  caseArt,
  itemOf,
  listed,
  priceLabel,
  stationeryState,
  toolArt
} from '../../shared/stationery.js';

const api = window.daigaku;
const ui = {slot: 0}; // わたしの筆箱：入れ替える場所（何本目か）

const st = () => stationeryState(state.data?.stationery);

/** ゆるい波（見本の線。筆圧が少しずつ変わる） */
const wave = (x0, n) =>
  Array.from({length: n}, (_, i) => [x0 + i * 2.8, 12 + Math.sin(i / 5) * 5, 0.35 + 0.3 * Math.sin(i / 9)]);

/** 書いた線の見本（ボールペン・マーカーの色と太さ。多機能ペンは芯ごとに短い線） */
function sample(item) {
  if (item.refills) {
    const w = 120 / item.refills.length;
    const paths = item.refills
      .map(
        (r, k) =>
          `<path fill="${r.color}" d="${strokePath(wave(4 + k * w, Math.floor((w - 6) / 2.8)), r.width * 1.6)}"/>`
      )
      .join('');
    return `<svg class="fb-sample" viewBox="0 0 120 24" aria-hidden="true">${paths}</svg>`;
  }
  if (item.type === 'pen') {
    // ゆるい波を、筆圧が少しずつ変わる線で書く（見本なので太さは 2 倍に見せる）
    return `<svg class="fb-sample" viewBox="0 0 120 24" aria-hidden="true"><path fill="${item.color}" d="${strokePath(wave(6, 40), item.width * 1.6)}"/></svg>`;
  }
  if (item.type === 'marker')
    return `<svg class="fb-sample" viewBox="0 0 120 24" aria-hidden="true"><text x="8" y="14" font-size="12" fill="#333">大学ノート</text><rect x="6" y="${item.thick ? 10 : 13}" width="72" height="${item.thick ? 7 : 3.5}" rx="2" fill="${item.color}" style="mix-blend-mode:multiply"/></svg>`;
  if (item.type === 'hider')
    return `<svg class="fb-sample" viewBox="0 0 120 24" aria-hidden="true"><text x="8" y="16" font-size="12" fill="#333">大学ノート</text><rect x="6" y="5" width="64" height="14" rx="2" fill="${item.color}" style="mix-blend-mode:multiply"/></svg>`;
  return '';
}

/** 品の説明（色・太さ） */
function spec(item) {
  if (item.refills)
    return `${esc(item.maker)}・${item.refills.length - (item.refills.some((r) => r.sharp) ? 1 : 0)}&${item.refills.filter((r) => r.sharp).length}（${item.refills.map((r) => `${esc(r.name)} ${r.mm}`).join('・')}）・替え芯は ${esc(item.refill)} 規格${item.experimental ? '・試作（実験）' : ''}`;
  if (item.experimental) return `${esc(item.maker)}・${item.mm} mm・試作（実験）`;
  if (item.type === 'pen') return `${item.mm} mm`;
  if (item.type === 'marker') return item.thick ? '太め' : 'ふつう';
  if (item.type === 'hider') return '赤シートで隠れる色';
  return '';
}

/** 札の絵。3D モデルの品は、ドラッグで回せる 3D 表示（renderer/model3d.js が中を作る）。big は詳細ページ（拡大もできる） */
const art = (item, {big = false} = {}) =>
  item.type === 'case'
    ? caseArt(item)
    : item.art === 'model'
      ? `<div class="model-view${big ? ' model-view--big' : ''}" data-model="${esc(item.model)}"${big ? ' data-model-zoom="1"' : ''} role="img" aria-label="${esc(item.name)}の 3D モデル"></div>
        <div class="${big ? 'fb-detail__foot' : 'model-view__foot'}"><span class="muted">${big ? 'ドラッグで回す・ホイールやピンチで近づける' : 'ドラッグで回せます'}</span>${
          big
            ? '<button type="button" class="btn btn--small btn--quiet" data-model-reset>向きを戻す</button>'
            : `<button type="button" class="btn btn--small btn--quiet" data-action="nav" data-route="/fudebako/item/${esc(item.id)}">くわしく</button>`
        }</div>`
      : toolArt(item);
const detailRoute = (item) => `/fudebako/item/${encodeURIComponent(item.id)}`;

function tabs(shop) {
  return `<div class="fb-tabs" role="tablist">
    <button type="button" role="tab" class="fb-tab" aria-selected="${!shop}" data-action="nav" data-route="/fudebako">わたしの筆箱</button>
    <button type="button" role="tab" class="fb-tab" aria-selected="${shop}" data-action="nav" data-route="/fudebako?tab=shop">文房具をふやす</button>
  </div>`;
}

/** わたしの筆箱：ペンケースの中に 6 本。押した場所に、下の一覧から入れる */
function mine(s) {
  const kase = itemOf(s.caseId);
  const slots = s.slots
    .map((id, i) => {
      const it = itemOf(id);
      const on = ui.slot === i;
      return `<div class="fb-slot${on ? ' is-on' : ''}${it ? '' : ' is-empty'}">
        <button type="button" class="fb-slot__pick" data-fb="slot" data-i="${i}" aria-pressed="${on}" title="${i + 1} 本目${it ? `：${esc(it.name)}` : '（空き）'}">
          <span class="fb-slot__num">${i + 1}</span>${it ? toolArt(it, {label: false}) : '<span class="muted">空き</span>'}
        </button>
        ${it ? `<button type="button" class="fb-slot__out" data-fb="out" data-i="${i}" title="筆箱から出す" aria-label="${i + 1} 本目を筆箱から出す">×</button>` : ''}
      </div>`;
    })
    .join('');
  const owned = s.owned.map(itemOf).filter(Boolean);
  const list = TOOL_TYPES.map((type) => {
    const items = owned.filter((it) => it.type === type);
    return `<section class="fb-group"><h3>${TYPE_LABEL[type]}</h3><div class="fb-grid">
      ${items
        .map((it) => {
          const where = s.slots.indexOf(it.id);
          return `<div class="fb-card${where >= 0 ? ' is-in' : ''}">
            <div class="fb-card__art">${art(it)}</div>
            <div class="fb-card__name">${esc(it.name)}</div>
            <div class="muted fb-card__spec">${spec(it)}</div>
            ${sample(it)}
            ${
              where >= 0
                ? `<span class="muted fb-card__state">筆箱の ${where + 1} 本目</span>`
                : `<button type="button" class="btn btn--small" data-fb="put" data-id="${it.id}">${ui.slot + 1} 本目に入れる</button>`
            }
          </div>`;
        })
        .join('')}</div></section>`;
  }).join('');
  const cases = owned.filter((it) => it.type === 'case');
  return `
    <div class="fb-case" style="--case-base: ${kase.base}; --case-trim: ${kase.trim}">
      <div class="fb-case__art">${caseArt(kase)}</div>
      <div class="fb-case__slots">${slots}</div>
      <p class="muted fb-case__hint">筆箱のペンは、PDF の編集画面の横に出ます（キーの 1〜6 でも持てます）。場所を押してから、下の一覧で「入れる」を押すと入れ替わります。</p>
    </div>
    <section class="fb-group"><h3>ペンケース</h3><div class="fb-grid fb-grid--cases">
      ${cases
        .map(
          (
            it
          ) => `<button type="button" class="fb-card fb-card--case${it.id === s.caseId ? ' is-in' : ''}" data-fb="case" data-id="${it.id}" aria-pressed="${it.id === s.caseId}">
            <div class="fb-card__art">${caseArt(it)}</div><div class="fb-card__name">${esc(it.name)}</div>
            <span class="muted fb-card__state">${it.id === s.caseId ? '使っています' : '押して使う'}</span></button>`
        )
        .join('')}
    </div></section>
    ${list}
    <p class="fb-more"><button type="button" class="btn" data-action="nav" data-route="/fudebako?tab=shop">文房具をふやす →</button></p>`;
}

/** 文房具をふやす：品の絵と名前だけの一覧。押すと詳細ページへ */
function shop(s) {
  const has = new Set(s.owned);
  const exp = state.data?.settings?.experiments === true;
  return `<p class="muted fb-note">公式の文房具をそろえています。押すとくわしい説明が出ます。足したペンは「わたしの筆箱」で筆箱に入れると、PDF の編集画面で使えます。</p>
    ${TYPES.map(
      (type) => `<section class="fb-group"><h3>${TYPE_LABEL[type]}</h3><div class="fb-grid">
        ${CATALOG.filter((it) => it.type === type && listed(it, {experiments: exp}))
          .map(
            (
              it
            ) => `<button type="button" class="fb-card fb-card--link${has.has(it.id) ? ' is-owned' : ''}" data-action="nav" data-route="${detailRoute(it)}">
              <div class="fb-card__art">${it.type === 'case' ? caseArt(it) : toolArt(it)}</div>
              <div class="fb-card__name">${esc(it.name)}</div>
              ${has.has(it.id) ? '<span class="muted fb-card__state">筆箱にあります</span>' : ''}
            </button>`
          )
          .join('')}</div></section>`
    ).join('')}`;
}

/** 入手のボタン：持っていなければ「筆箱に足す」、持っていれば筆箱に入れる・入っている場所 */
function buyButtons(s, it) {
  if (!s.owned.includes(it.id))
    return `<button type="button" class="btn btn--primary" data-fb="get" data-id="${it.id}">筆箱に足す</button>`;
  if (it.type === 'case')
    return it.id === s.caseId
      ? '<span class="muted">このペンケースを使っています</span>'
      : `<button type="button" class="btn" data-fb="case" data-id="${it.id}">このペンケースを使う</button>`;
  const where = s.slots.indexOf(it.id);
  if (where >= 0) return `<span class="muted">筆箱の ${where + 1} 本目に入っています</span>`;
  const at = s.slots.indexOf(null);
  return at >= 0
    ? `<button type="button" class="btn btn--primary" data-fb="put" data-id="${it.id}" data-at="${at}">筆箱の ${at + 1} 本目に入れる</button>
      <button type="button" class="btn" data-action="nav" data-route="/fudebako">わたしの筆箱で選ぶ</button>`
    : `<span class="muted">筆箱はいっぱいです</span><button type="button" class="btn" data-action="nav" data-route="/fudebako">わたしの筆箱で入れ替える</button>`;
}

/** 文房具の詳細ページ：大きな絵（3D モデルは拡大・回転）・説明・線の見本・入手 */
function detail(s, id) {
  const it = itemOf(id);
  const exp = state.data?.settings?.experiments === true;
  if (!it || !listed(it, {experiments: exp}))
    return `<p class="muted">その文房具はありません。</p><p><button type="button" class="btn" data-action="nav" data-route="/fudebako?tab=shop">← 文房具をふやす</button></p>`;
  const rows = [];
  rows.push(['種類', TYPE_LABEL[it.type]]);
  if (it.maker) rows.push(['メーカー', esc(it.maker)]);
  if (it.refills) {
    rows.push([
      'しくみ',
      `${it.refills.length - it.refills.filter((r) => r.sharp).length}&${it.refills.filter((r) => r.sharp).length}（回転式の多機能ペン。持つと芯を選べ、同じ場所をもう一度押すと次の芯に回ります）`
    ]);
    rows.push(['替え芯', `${esc(it.refill)} 規格`]);
  } else if (it.type === 'pen') rows.push(['字幅', `${it.mm} mm`]);
  else if (it.type === 'marker') rows.push(['太さ', it.thick ? '太め' : 'ふつう']);
  else if (it.type === 'hider') rows.push(['色', '赤シートで隠れる色']);
  if (it.art === 'model') rows.push(['見た目', '3D モデル（実物の形と材質）']);
  if (it.experimental) rows.push(['注意', '既製品の見た目の試作（実験）。一般に配る版では出しません']);
  rows.push(['値段', priceLabel(it)]);
  const samples = it.refills
    ? `<ul class="fb-refills">${it.refills
        .map(
          (r) =>
            `<li><span>${esc(r.name)} ${r.mm} mm</span><svg class="fb-sample" viewBox="0 0 120 24" aria-hidden="true"><path fill="${r.color}" d="${strokePath(wave(6, 40), r.width * 1.6)}"/></svg></li>`
        )
        .join('')}</ul>`
    : sample(it);
  return `<p><button type="button" class="btn btn--small" data-action="nav" data-route="/fudebako?tab=shop">← 文房具をふやす</button></p>
    <div class="fb-detail" data-model-box>
      <div class="fb-detail__stage">${art(it, {big: true})}</div>
      <div class="fb-detail__info">
        <h2>${esc(it.name)}</h2>
        ${it.maker ? `<p class="muted fb-detail__maker">${esc(it.maker)}</p>` : ''}
        <dl class="fb-spec">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
        ${samples ? `<h3 class="fb-detail__sub">書いた線</h3>${samples}` : ''}
        <div class="fb-detail__buy">${buyButtons(s, it)}</div>
      </div>
    </div>`;
}

/** 筆箱のページ（#/fudebako、文房具をふやすのは #/fudebako?tab=shop） */
export function renderFudebako(_state, route) {
  const isShop = new URLSearchParams(route.split('?')[1] ?? '').get('tab') === 'shop';
  const item = route.match(/^\/fudebako\/item\/([^?]+)/);
  const s = st();
  if (ui.slot < 0 || ui.slot >= SLOTS) ui.slot = 0;
  return `<div class="fudebako">
    <div class="fb-head"><h2>筆箱</h2>${tabs(isShop || !!item)}</div>
    ${item ? detail(s, decodeURIComponent(item[1])) : isShop ? shop(s) : mine(s)}
  </div>`;
}

async function save(channel, arg, done) {
  const r = await api[channel](arg);
  if (r?.error) return toast(r.error, {error: true});
  state.data.stationery = r.stationery;
  refresh();
  if (done) toast(done);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('.fudebako [data-fb]');
  if (!b) return;
  const s = st();
  const i = Number(b.dataset.i);
  const id = b.dataset.id;
  const what = b.dataset.fb;
  if (what === 'slot') {
    ui.slot = i;
    refresh();
  } else if (what === 'out') {
    const slots = [...s.slots];
    slots[i] = null;
    ui.slot = i;
    save('stationery.arrange', {slots});
  } else if (what === 'put') {
    const at = b.dataset.at !== undefined ? Number(b.dataset.at) : ui.slot; // 詳細ページからは空きの場所へ
    const slots = [...s.slots];
    slots[at] = id;
    const next = slots.indexOf(null);
    save('stationery.arrange', {slots}, `${itemOf(id).name} を ${at + 1} 本目に入れました`);
    if (next >= 0) ui.slot = next; // 空きがあれば、次はそこへ
  } else if (what === 'case') save('stationery.arrange', {caseId: id});
  else if (what === 'get') {
    const it = itemOf(id);
    save('stationery.acquire', {itemId: id}).then(() => {
      if (!st().owned.includes(id)) return;
      const inDetail = !!b.closest('.fb-detail'); // 詳細ページでは、そのまま「筆箱に入れる」ボタンに変わる
      const action = it.type === 'case' || inDetail ? null : {label: '筆箱に入れる', run: () => navigate('/fudebako')};
      toast(`${it.name} を筆箱に足しました`, {action});
    });
  }
});
