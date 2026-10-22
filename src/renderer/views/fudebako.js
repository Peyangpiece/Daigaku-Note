// 筆箱のページ（SPEC §15）。上の切り替えタブの「筆箱」。
// 「わたしの筆箱」：筆箱に入れる 6 本（編集画面の PDF の横に出る）とペンケースを選ぶ。持っている文房具の一覧。
// 「ショップ」：新しい文房具を入手する。いまは公式の品だけで、すべて無料（「無料で入手」）。
// 持ち物・筆箱の中身はメインの設定（stationery）に保存する（ipc.js の stationery.acquire・stationery.arrange）
import {esc, navigate, refresh, state, toast} from '../app.js';
import {strokePath} from '../../shared/ink.js';
import {CATALOG, SLOTS, TOOL_TYPES, TYPES, TYPE_LABEL, caseArt, itemOf, listed, priceLabel, stationeryState, toolArt} from '../../shared/stationery.js';

const api = window.daigaku;
const ui = {slot: 0}; // わたしの筆箱：入れ替える場所（何本目か）

const st = () => stationeryState(state.data?.stationery);

/** 書いた線の見本（ボールペン・マーカーの色と太さ） */
function sample(item) {
  if (item.type === 'pen') {
    // ゆるい波を、筆圧が少しずつ変わる線で書く（見本なので太さは 2 倍に見せる）
    const pts = Array.from({length: 40}, (_, i) => [6 + i * 2.8, 12 + Math.sin(i / 5) * 5, 0.35 + 0.3 * Math.sin(i / 9)]);
    return `<svg class="fb-sample" viewBox="0 0 120 24" aria-hidden="true"><path fill="${item.color}" d="${strokePath(pts, item.width * 1.6)}"/></svg>`;
  }
  if (item.type === 'marker')
    return `<svg class="fb-sample" viewBox="0 0 120 24" aria-hidden="true"><text x="8" y="14" font-size="12" fill="#333">大学ノート</text><rect x="6" y="${item.thick ? 10 : 13}" width="72" height="${item.thick ? 7 : 3.5}" rx="2" fill="${item.color}" style="mix-blend-mode:multiply"/></svg>`;
  if (item.type === 'hider')
    return `<svg class="fb-sample" viewBox="0 0 120 24" aria-hidden="true"><text x="8" y="16" font-size="12" fill="#333">大学ノート</text><rect x="6" y="5" width="64" height="14" rx="2" fill="${item.color}" style="mix-blend-mode:multiply"/></svg>`;
  return '';
}

/** 品の説明（色・太さ） */
function spec(item) {
  if (item.experimental) return `${esc(item.maker)}・${item.mm} mm・試作（実験）`;
  if (item.type === 'pen') return `${item.mm} mm`;
  if (item.type === 'marker') return item.thick ? '太め' : 'ふつう';
  if (item.type === 'hider') return '赤シートで隠れる色';
  return '';
}

const art = (item) => (item.type === 'case' ? caseArt(item) : toolArt(item));

function tabs(shop) {
  return `<div class="fb-tabs" role="tablist">
    <button type="button" role="tab" class="fb-tab" aria-selected="${!shop}" data-action="nav" data-route="/fudebako">わたしの筆箱</button>
    <button type="button" role="tab" class="fb-tab" aria-selected="${shop}" data-action="nav" data-route="/fudebako?tab=shop">ショップ</button>
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
          (it) => `<button type="button" class="fb-card fb-card--case${it.id === s.caseId ? ' is-in' : ''}" data-fb="case" data-id="${it.id}" aria-pressed="${it.id === s.caseId}">
            <div class="fb-card__art">${caseArt(it)}</div><div class="fb-card__name">${esc(it.name)}</div>
            <span class="muted fb-card__state">${it.id === s.caseId ? '使っています' : '押して使う'}</span></button>`
        )
        .join('')}
    </div></section>
    ${list}
    <p class="fb-more"><button type="button" class="btn" data-action="nav" data-route="/fudebako?tab=shop">ショップで新しい文房具を入手する →</button></p>`;
}

/** ショップ：公式の文房具。いまはすべて無料 */
function shop(s) {
  const has = new Set(s.owned);
  return `<p class="muted fb-note">公式の文房具をそろえています。いまはすべて無料です。入手したペンは「わたしの筆箱」で筆箱に入れると、PDF の編集画面で使えます。</p>
    ${TYPES.map(
      (type) => `<section class="fb-group"><h3>${TYPE_LABEL[type]}</h3><div class="fb-grid">
        ${CATALOG.filter((it) => it.type === type && listed(it, {experiments: state.data?.settings?.experiments === true}))
          .map(
            (it) => `<div class="fb-card${has.has(it.id) ? ' is-owned' : ''}">
              <div class="fb-card__art">${art(it)}</div>
              <div class="fb-card__name">${esc(it.name)}</div>
              <div class="muted fb-card__spec">${spec(it)}</div>
              ${sample(it)}
              <div class="fb-card__buy"><span class="fb-price">${priceLabel(it)}</span>
                ${
                  has.has(it.id)
                    ? '<button type="button" class="btn btn--small" disabled>入手済み</button>'
                    : `<button type="button" class="btn btn--small btn--primary" data-fb="get" data-id="${it.id}">無料で入手</button>`
                }</div>
            </div>`
          )
          .join('')}</div></section>`
    ).join('')}`;
}

/** 筆箱のページ（#/fudebako、ショップは #/fudebako?tab=shop） */
export function renderFudebako(_state, route) {
  const isShop = new URLSearchParams(route.split('?')[1] ?? '').get('tab') === 'shop';
  const s = st();
  if (ui.slot < 0 || ui.slot >= SLOTS) ui.slot = 0;
  return `<div class="fudebako">
    <div class="fb-head"><h2>筆箱</h2>${tabs(isShop)}</div>
    ${isShop ? shop(s) : mine(s)}
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
    const slots = [...s.slots];
    slots[ui.slot] = id;
    const next = slots.indexOf(null);
    save('stationery.arrange', {slots}, `${itemOf(id).name} を ${ui.slot + 1} 本目に入れました`);
    if (next >= 0) ui.slot = next; // 空きがあれば、次はそこへ
  } else if (what === 'case') save('stationery.arrange', {caseId: id});
  else if (what === 'get') {
    const it = itemOf(id);
    save('stationery.acquire', {itemId: id}).then(() => {
      if (!st().owned.includes(id)) return;
      const action = it.type === 'case' ? null : {label: '筆箱に入れる', run: () => navigate('/fudebako')};
      toast(`${it.name} を入手しました`, {action});
    });
  }
});
