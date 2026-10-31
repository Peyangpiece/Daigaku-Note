// 筆箱のページ（SPEC §15）。上の切り替えタブの「筆箱」。
// 「わたしの筆箱」：筆箱に入れる 6 本（編集画面の PDF の横に出る）とペンケースを選ぶ。持っている文房具の一覧。
// 「ショップ」：上に「新しく入りました」の帯、検索と絞り込み、シリーズ（同じ品の色ちがい）ごとの札。色は札の右下の丸で選ぶ。
//   ポイントの品（公式の品）は白い札にグレーの枠、円の品は値段帯（shared/stationery.js の TIERS）で札の紙を変える。
//   押すと詳細ページ（#/fudebako/item/<id>）へ。3D モデルの品は、拡大・回転して細部を見られる（renderer/model3d.js）。
//   道具の詳細ページには、試し書きの付箋（views/tryout.js。文字隠しペン・赤シートで消える色のペンは赤シートも）を置く。
// 買う：ポイントの品も円の品も「カートへ入れる」→ カート（#/fudebako/cart）→ レジ（#/fudebako/checkout）→ 注文完了（#/fudebako/order/<id>）。
//   ポイントの品の分はレジで残高から引く（足りなければ買えない）。右上のポイントの札から、残高・もらい方・履歴（#/fudebako/points）。
// 筆箱がいっぱいのときは、詳細ページ・注文完了で「何本目と入れ替えるか」を選んで入れる（swapButtons）。
//   α 版の円の決済はデモ（実際の請求はない。カードの番号は下 4 桁だけ注文の記録に残す）。ポイントの品だけならカードの入力はない。
// 持ち物・筆箱の中身はメインの設定（stationery）に保存する（ipc.js の stationery.purchase・stationery.arrange）
import {esc, toast} from '../ui-kit.js';
import {navigate, refresh, state} from '../store.js';
import {cart} from '../cart.js';
import {strokePath} from '../../shared/ink.js';
import {tryout} from './tryout.js';
import {EARN, dayOf, pt} from '../../shared/points.js';
import {
  PAYMENT_METHODS,
  SLOTS,
  TOOL_TYPES,
  TYPES,
  TYPE_LABEL,
  cartPoints,
  cartTotal,
  caseArt,
  itemOf,
  listed,
  priceLabel,
  shopSeries,
  siblingsOf,
  stationeryState,
  tierOf,
  toolArt,
  yen
} from '../../shared/stationery.js';

const api = window.daigaku;
const ui = {
  slot: 0, // わたしの筆箱：入れ替える場所（何本目か）
  shop: {q: '', type: 'all', pay: 'all', unowned: false, sort: 'rec', pick: {}} // ショップ：検索・絞り込み・並び替え・シリーズごとに選んだ色
};
const SORTS = {rec: 'おすすめ順', cheap: '安い順', dear: '高い順', name: '名前順'};

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
    // ゆるい波を、筆圧が少しずつ変わる線で書く（見本なので太さは 2 倍に見せる）。筆圧なしのペンは同じ太さのまま
    return `<svg class="fb-sample" viewBox="0 0 120 24" aria-hidden="true"><path fill="${item.color}" d="${strokePath(wave(6, 40), item.width * 1.6, {pressure: item.even ? 'even' : true})}"/></svg>`;
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
    return `${esc(item.maker)}・${item.refills.length - (item.refills.some((r) => r.sharp) ? 1 : 0)}&${item.refills.filter((r) => r.sharp).length}（${item.refills.map((r) => `${esc(r.name)} ${r.mm}`).join('・')}）・替え芯は ${esc(item.refill)} 規格`;
  if (item.experimental) return `${esc(item.maker)}・${item.mm} mm`;
  if (item.type === 'pen') return item.even ? `${item.mm} mm・筆圧なし（太さが一定）` : `${item.mm} mm`;
  if (item.type === 'marker') return item.thick ? '太め' : 'ふつう';
  if (item.type === 'hider') return '赤シートで隠れる色';
  return '';
}

/** 札の絵。3D モデルの品は、ドラッグで回せる 3D 表示（renderer/model3d.js が中を作る）。big は詳細ページ（拡大もできる）。foot: false で下の説明を省く */
const art = (item, {big = false, foot = true} = {}) =>
  item.type === 'case' && !big
    ? caseArt(item)
    : item.art === 'model'
      ? `<div class="model-view${big ? ' model-view--big' : ''}" data-model="${esc(item.model)}" data-item="${esc(item.id)}"${big ? ' data-model-zoom="1"' : ''} role="img" aria-label="${esc(item.name)}の 3D モデル"></div>
        ${
          foot
            ? `<div class="${big ? 'fb-detail__foot' : 'model-view__foot'}"><span class="muted">${big ? 'ドラッグで回す・ホイールやピンチで近づける' : 'ドラッグで回せます'}</span>${
                big
                  ? '<button type="button" class="btn btn--small btn--quiet" data-model-reset>向きを戻す</button>'
                  : `<button type="button" class="btn btn--small btn--quiet" data-action="nav" data-route="/fudebako/item/${esc(item.id)}">くわしく</button>`
              }</div>`
            : ''
        }`
      : item.type === 'case'
        ? caseArt(item)
        : toolArt(item);
const detailRoute = (item) => `/fudebako/item/${encodeURIComponent(item.id)}`;
const SHOP = '/fudebako?tab=shop';

function tabs(shop) {
  // 画面の切り替え（アドレスが変わる）なので tab ではなく、いまいる画面を aria-current で示す
  return `<nav class="fb-tabs" aria-label="筆箱の画面">
    <button type="button" class="fb-tab" aria-current="${shop ? 'false' : 'page'}" data-action="nav" data-route="/fudebako">わたしの筆箱</button>
    <button type="button" class="fb-tab" aria-current="${shop ? 'page' : 'false'}" data-action="nav" data-route="${SHOP}">ショップ</button>
  </nav>`;
}
/** いまのポイントの残高 */
const balance = () => state.data?.points?.balance ?? 0;
/** 右上のポイントの札（押すと、残高・もらい方・履歴のページ） */
function pointsButton() {
  return `<button type="button" class="shop-points" data-action="nav" data-route="/fudebako/points" aria-label="ポイント（${pt(balance())}）">${ICON.coin}<b>${balance().toLocaleString('ja-JP')}</b> pt</button>`;
}
/** 右上のカートのボタン（入っている数つき） */
function cartButton() {
  const n = cart.count();
  return `<button type="button" class="shop-cart" data-action="nav" data-route="/fudebako/cart" aria-label="カート（${n} 点）">${ICON.cart} カート${n ? `<b class="shop-cart__n">${n}</b>` : ''}</button>`;
}
const ICON = {
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/></svg>',
  coin: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#f5c542" stroke="#b8860b" stroke-width="1.6"/><text x="12" y="16.2" text-anchor="middle" font-size="11" font-weight="700" fill="#7a5600" font-family="sans-serif">P</text></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.4 11h11l2-7H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/></svg>'
};

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
    <p class="fb-more"><button type="button" class="btn" data-action="nav" data-route="${SHOP}">ショップへ →</button></p>`;
}

// ---- ショップ ----

/** 値段の札（持っていれば「持っています」） */
function priceTag(item, owned) {
  if (owned) return '<span class="shop-tag shop-tag--own">✓ 持っています</span>';
  const t = tierOf(item.price);
  return `<span class="shop-tag shop-tag--${t.id}">${priceLabel(item)}</span>`;
}
/** 色の丸：外が軸の色、中がインクの色（ペンケースは外が本体、中が飾り） */
const dotStyle = (it) =>
  it.type === 'case' ? `--body:${it.base};--ink:${it.trim}` : `--body:${it.body ?? it.color};--ink:${it.color}`;
/** 札の右下の丸：シリーズの色ちがい（押すと札の品が変わる）。多機能ペンは芯の色（押せない） */
function dots(series, picked) {
  if (series.items.length === 1 && picked.refills)
    return `<span class="shop-dots" title="芯の色">${picked.refills.map((r) => `<span class="shop-dot shop-dot--static" style="--body:${r.color};--ink:${r.color}" title="${esc(r.name)}"></span>`).join('')}</span>`;
  if (series.items.length === 1) return '';
  return `<span class="shop-dots" role="group" aria-label="色">${series.items
    .map(
      (it) =>
        `<button type="button" class="shop-dot${it.id === picked.id ? ' is-on' : ''}" data-shop="pick" data-series="${esc(series.id)}" data-id="${esc(it.id)}" style="${dotStyle(it)}" title="${esc(it.name)}" aria-pressed="${it.id === picked.id}"><span class="sr-only">${esc(it.name)}</span></button>`
    )
    .join('')}</span>`;
}
/** シリーズで選んでいる品（選んでいなければ、シリーズの最初の品＝代表の色） */
function pickedOf(series) {
  const id = ui.shop.pick[series.id];
  return series.items.find((it) => it.id === id) ?? series.items[0];
}
/** 札の下のボタン：持っている・カートに入っている・カートへ入れる */
function cartAction(it, s) {
  if (s.owned.includes(it.id)) return '';
  if (cart.has(it.id))
    return `<span class="muted shop-card__state">カートに入っています</span><button type="button" class="btn btn--small" data-action="nav" data-route="/fudebako/cart">カートを見る</button>`;
  return `<button type="button" class="btn btn--small${it.price ? ' btn--primary' : ''}" data-shop="cart" data-id="${esc(it.id)}">${ICON.cart} カートへ入れる</button>`;
}
function ribbons(it) {
  const r = [];
  if (it.featured) r.push('<span class="shop-ribbon shop-ribbon--new">新着</span>');
  if (it.art === 'model' && it.maker) r.push('<span class="shop-ribbon shop-ribbon--3d">3D で見られる</span>'); // 公式の品はみな 3D なので、既製品の見た目の品だけに付ける
  return r.length ? `<span class="shop-ribbons">${r.join('')}</span>` : '';
}
/** 持っている色を選んでいるときの札の下：ほかに持っていない色があれば、その数 */
function ownedNote(series, has) {
  if (series.items.length === 1) return '';
  const rest = series.items.filter((x) => !has.has(x.id)).length;
  return `<span class="muted shop-card__state">${rest ? `ほかに ${rest} 色（丸で選べます）` : '全色持っています'}</span>`;
}
/** シリーズの札 */
function seriesCard(series, s) {
  const has = new Set(s.owned);
  const it = pickedOf(series);
  const owned = has.has(it.id);
  const tier = tierOf(it.price);
  const sub = [it.maker ?? '大学ノート'];
  if (series.items.length > 1) sub.push(it.name);
  else if (it.refills) sub.push(`2&1・替え芯 ${it.refill} 規格`);
  else if (it.type === 'pen') sub.push(it.even ? `${it.mm} mm・筆圧なし` : `${it.mm} mm`);
  else if (it.type === 'marker') sub.push(it.thick ? '太め' : 'ふつう');
  else if (it.type === 'hider') sub.push('赤シートで隠れる');
  return `<article class="shop-card shop-card--${tier.id}${owned ? ' is-owned' : ''}" data-series="${esc(series.id)}">
    ${ribbons(it)}
    <button type="button" class="shop-card__stage" data-action="nav" data-route="${detailRoute(it)}" aria-label="${esc(it.name)}をくわしく見る">${it.type === 'case' ? caseArt(it) : toolArt(it)}</button>
    <button type="button" class="shop-card__name" data-action="nav" data-route="${detailRoute(it)}">${esc(series.name)}</button>
    <div class="muted shop-card__spec">${sub.map(esc).join('・')}</div>
    <div class="shop-card__foot">${priceTag(it, owned)}${dots(series, it)}</div>
    <div class="shop-card__act">${owned ? ownedNote(series, has) : cartAction(it, s)}</div>
  </article>`;
}

/** 検索の言葉がシリーズに当たるか（名前・メーカー・色ちがいの名前・字幅・種類・3D） */
function matches(series, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [
    series.name,
    series.maker,
    TYPE_LABEL[series.type],
    ...series.items.flatMap((it) => [
      it.name,
      it.mm ? `${it.mm} mm ${it.mm}mm` : '',
      it.art === 'model' ? '3d' : '',
      it.refill ?? ''
    ])
  ]
    .join(' ')
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}
/** 絞り込みと並び替えをかけたシリーズの一覧 */
function filtered(s) {
  const f = ui.shop;
  const has = new Set(s.owned);
  let list = shopSeries().filter((se) => {
    if (f.type !== 'all' && se.type !== f.type) return false;
    if (f.pay === 'points' && !se.items.some((it) => it.points > 0)) return false;
    if (f.pay === 'yen' && !se.items.some((it) => it.price > 0)) return false;
    if (f.unowned && se.items.every((it) => has.has(it.id))) return false;
    return matches(se, f.q);
  });
  // 値段の順：ポイントの品と円の品は比べられないので、安い順はポイントの品（pt の順）→ 円の品（円の順）、高い順はその逆
  const cost = (se) => {
    const yenMin = Math.min(...se.items.map((it) => it.price || Infinity));
    return yenMin < Infinity ? [1, yenMin] : [0, Math.min(...se.items.map((it) => it.points || Infinity))];
  };
  const byCost = (a, b) => cost(a)[0] - cost(b)[0] || cost(a)[1] - cost(b)[1];
  if (f.sort === 'cheap') list = [...list].sort(byCost);
  else if (f.sort === 'dear') list = [...list].sort((a, b) => byCost(b, a));
  else if (f.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return list;
}
/** 検索の結果（札の一覧と件数）。検索欄に字を打つたびにここだけ描き直す */
function results(s) {
  const list = filtered(s);
  if (!list.length)
    return `<p class="muted shop-empty">当てはまる文房具がありません。<button type="button" class="btn btn--small" data-shop="reset">絞り込みを外す</button></p>`;
  const all = shopSeries().reduce((k, se) => k + se.items.length, 0);
  const n = list.reduce((k, se) => k + se.items.length, 0);
  return `<p class="muted shop-count">${n === all ? `全 ${all} 点` : `${n} 点（全 ${all} 点）`}</p>
    <div class="shop-grid">${list.map((se) => seriesCard(se, s)).join('')}</div>`;
}
const chip = (what, v, label, on) =>
  `<button type="button" class="shop-chip${on ? ' is-on' : ''}" data-shop="${what}" data-v="${v}" aria-pressed="${on}">${label}</button>`;
/** 上の「新しく入りました」の帯（featured の品）。検索・絞り込み中は出さない */
function hero(s) {
  const f = ui.shop;
  if (f.q || f.type !== 'all' || f.pay !== 'all' || f.unowned) return '';
  const it = shopSeries()
    .flatMap((se) => se.items)
    .find((x) => x.featured);
  if (!it) return '';
  const owned = s.owned.includes(it.id);
  return `<section class="shop-hero shop-hero--${tierOf(it.price).id}" aria-label="新しく入りました">
    <div class="shop-hero__text">
      <span class="shop-hero__pill">新しく入りました</span>
      <h3>${esc(it.name)}</h3>
      <p>${esc(it.maker)}。${it.refills ? '黒・赤のボールペンと 0.5 のシャープが 1 本に。' : ''}${it.art === 'model' ? '3D モデルで、実物の形と材質を回して確かめられます。' : ''}</p>
      <div class="shop-hero__act">${priceTag(it, owned)}${owned ? '' : cartAction(it, s)}<button type="button" class="btn btn--small" data-action="nav" data-route="${detailRoute(it)}">くわしく見る</button></div>
    </div>
    <div class="shop-hero__art">${art(it, {foot: false})}${it.art === 'model' && it.type !== 'case' ? '<p class="muted shop-hero__hint">ドラッグで回せます</p>' : ''}</div>
  </section>`;
}
/** ショップ：帯・検索・絞り込み・シリーズの札 */
function shop(s) {
  const f = ui.shop;
  return `<div class="shop">
    ${hero(s)}
    <div class="shop-toolbar" role="search">
      <div class="shop-toolbar__row">
        <label class="shop-search">${ICON.search}<input id="shop-q" type="search" value="${esc(f.q)}" placeholder="ペンやメーカーの名前でさがす（例：0.38、サラサ、ジェット）" aria-label="文房具をさがす" autocomplete="off" /></label>
        <label class="shop-sort"><span class="sr-only">並び替え</span><select id="shop-sort" data-shop="sort">${Object.entries(
          SORTS
        )
          .map(([k, v]) => `<option value="${k}"${f.sort === k ? ' selected' : ''}>${v}</option>`)
          .join('')}</select></label>
      </div>
      <div class="shop-chips">
        <span class="muted shop-chips__label">種類</span>${chip('type', 'all', 'すべて', f.type === 'all')}${TYPES.map((t) => chip('type', t, TYPE_LABEL[t], f.type === t)).join('')}
        <span class="shop-chips__sep"></span><span class="muted shop-chips__label">値段</span>${chip('price', 'all', 'すべて', f.pay === 'all')}${chip('price', 'points', 'ポイント', f.pay === 'points')}${chip('price', 'yen', '円', f.pay === 'yen')}
        <span class="shop-chips__sep"></span>${chip('unowned', f.unowned ? '0' : '1', 'まだ持っていないものだけ', f.unowned)}
      </div>
    </div>
    <p class="muted shop-note">公式の文房具はポイントで買えます（ログインボーナスやクイズの正解でたまります）。円の支払いは α 版のあいだはデモです（実際の請求はありません）。</p>
    <div id="shop-results">${results(s)}</div>
  </div>`;
}

/** 入手のボタン（詳細ページ）：持っていなければ「カートへ入れる」、持っていれば筆箱に入れる・入っている場所 */
function buyButtons(s, it) {
  if (!s.owned.includes(it.id))
    return cart.has(it.id)
      ? `<span class="muted">カートに入っています</span><button type="button" class="btn btn--primary" data-action="nav" data-route="/fudebako/cart">カートを見る</button>`
      : `<button type="button" class="btn btn--primary" data-shop="cart" data-id="${esc(it.id)}">${ICON.cart} カートへ入れる</button>`;
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
    : swapButtons(s, it);
}
/** 筆箱がいっぱいのとき：何本目と入れ替えるかのボタン（丸は今そこにある品のインクの色。出した品は持ち物に残る） */
function swapButtons(s, it) {
  return `<span class="fb-swap" role="group" aria-label="筆箱の何本目と入れ替えるか"><span class="muted fb-swap__label">筆箱はいっぱいです。入れ替える場所：</span>${s.slots
    .map((id, i) => {
      const old = itemOf(id);
      return `<button type="button" class="fb-swap__slot" data-fb="put" data-id="${esc(it.id)}" data-at="${i}" title="${i + 1} 本目（${esc(old?.name ?? '空き')}）と入れ替える"><span class="fb-swap__dot" style="background:${old?.color ?? 'transparent'}"></span>${i + 1}</button>`;
    })
    .join('')}</span>`;
}

/** 文房具の詳細ページ：大きな絵（3D モデルは拡大・回転）・説明・線の見本・色ちがい・入手・試し書き */
function detail(s, id) {
  const it = itemOf(id);
  if (!it || !listed(it))
    return `<p class="muted">その文房具はありません。</p><p><button type="button" class="btn" data-action="nav" data-route="${SHOP}">← ショップ</button></p>`;
  const rows = [];
  rows.push(['種類', TYPE_LABEL[it.type]]);
  if (it.refills) {
    rows.push([
      'しくみ',
      `${it.refills.length - it.refills.filter((r) => r.sharp).length}&${it.refills.filter((r) => r.sharp).length}（回転式の多機能ペン。持つと芯を選べ、同じ場所をもう一度押すと次の芯に回ります）`
    ]);
    rows.push(['替え芯', `${esc(it.refill)} 規格`]);
  } else if (it.type === 'pen') {
    rows.push(['字幅', `${it.mm} mm`]);
    if (it.even)
      rows.push([
        '書き味',
        '筆圧なし：ペンタブ・スタイラスの筆圧や書く速さで太さが変わらず、どこも同じ太さの線になります（書き始め・書き終わりも細くなりません）'
      ]);
  } else if (it.type === 'marker') rows.push(['太さ', it.thick ? '太め' : 'ふつう']);
  else if (it.type === 'hider') rows.push(['色', '赤シートで隠れる色']);
  if (it.art === 'model') rows.push(['見た目', '3D モデル（実物の形と材質）']);
  const samples = it.refills
    ? `<ul class="fb-refills">${it.refills
        .map(
          (r) =>
            `<li><span>${esc(r.name)} ${r.mm} mm</span><svg class="fb-sample" viewBox="0 0 120 24" aria-hidden="true"><path fill="${r.color}" d="${strokePath(wave(6, 40), r.width * 1.6)}"/></svg></li>`
        )
        .join('')}</ul>`
    : sample(it);
  const sib = siblingsOf(it);
  const colors =
    sib.length > 1
      ? `<h3 class="fb-detail__sub">色ちがい</h3><div class="shop-dots shop-dots--big" role="list">${sib
          .map(
            (x) =>
              `<button type="button" class="shop-dot${x.id === it.id ? ' is-on' : ''}" data-action="nav" data-route="${detailRoute(x)}" style="${dotStyle(x)}" title="${esc(x.name)}" aria-current="${x.id === it.id}"><span class="sr-only">${esc(x.name)}</span></button>`
          )
          .join('')}</div><p class="muted fb-detail__colorname">${esc(it.name)}</p>`
      : '';
  return `<p><button type="button" class="btn btn--small" data-action="nav" data-route="${SHOP}">← ショップ</button></p>
    <div class="fb-detail" data-model-box>
      <div class="fb-detail__stage">${art(it, {big: true})}</div>
      <div class="fb-detail__info">
        ${ribbons(it)}
        <h2>${esc(it.name)}</h2>
        ${it.maker ? `<p class="muted fb-detail__maker">${esc(it.maker)}</p>` : ''}
        <p class="fb-detail__price">${priceTag(it, s.owned.includes(it.id))}${
          s.owned.includes(it.id)
            ? ''
            : it.price
              ? '<span class="muted">メーカーの参考価格（税込）</span>'
              : it.points
                ? `<span class="muted">いま ${pt(balance())} 持っています</span>`
                : ''
        }</p>
        <dl class="fb-spec">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
        ${colors}
        ${samples ? `<h3 class="fb-detail__sub">書いた線</h3>${samples}` : ''}
        <div class="fb-detail__buy">${buyButtons(s, it)}</div>
      </div>
    </div>
    ${tryout(it)}`;
}

// ---- カート・レジ・注文完了 ----

/** カートの中身（持っている品・ない品は外す） */
function cartItems(s) {
  cart.prune((id) => itemOf(id) && listed(itemOf(id)) && !s.owned.includes(id));
  return cart.ids().map(itemOf);
}
/** カート・注文の行の説明（メーカー・字幅など。既製品の見た目の品は spec にメーカーが入るので重ねない） */
const rowSpec = (it) =>
  [it.experimental ? '' : (it.maker ?? '大学ノート'), spec(it) || TYPE_LABEL[it.type]].filter(Boolean).join('・');
const orderRow = (it, {remove = false} = {}) =>
  `<li class="shop-row">
    <button type="button" class="shop-row__art" data-action="nav" data-route="${detailRoute(it)}" aria-label="${esc(it.name)}をくわしく見る">${it.type === 'case' ? caseArt(it) : toolArt(it)}</button>
    <div class="shop-row__text"><div class="shop-row__name">${esc(it.name)}</div><div class="muted">${rowSpec(it)}</div></div>
    <div class="shop-row__price">${priceLabel(it)}</div>
    ${remove ? `<button type="button" class="btn btn--small btn--quiet" data-shop="remove" data-id="${esc(it.id)}" aria-label="${esc(it.name)}をカートから外す">外す</button>` : ''}
  </li>`;
/** 合計：円とポイントは別々に（両方あれば 2 行） */
const totals = (items) => {
  const ids = items.map((it) => it.id);
  const total = cartTotal(ids);
  const points = cartPoints(ids);
  const sums = [];
  if (points || !total)
    sums.push(`<dt class="shop-total__sum">合計（ポイント）</dt><dd class="shop-total__sum">${pt(points)}</dd>`);
  if (total) sums.push(`<dt class="shop-total__sum">合計（円）</dt><dd class="shop-total__sum">${yen(total)}</dd>`);
  return `<dl class="shop-total"><dt>${items.length} 点</dt><dd></dd>${sums.join('')}</dl>`;
};
/** ポイントの足りる・足りないの説明（カート・レジ） */
function pointsNote(items) {
  const need = cartPoints(items.map((it) => it.id));
  if (!need) return '';
  const have = balance();
  return have >= need
    ? `<p class="muted shop-side__note">ポイント：いま ${pt(have)} → 買ったあと ${pt(have - need)}</p>`
    : `<p class="shop-side__short" role="alert">ポイントが ${pt(need - have)} 足りません（いま ${pt(have)}）。<button type="button" class="btn btn--small btn--quiet" data-action="nav" data-route="/fudebako/points">ためかた</button></p>`;
}
/** カート */
function cartPage(s) {
  const items = cartItems(s);
  if (!items.length)
    return `<h3 class="shop-h">カート</h3><p class="muted">カートは空です。</p><p><button type="button" class="btn" data-action="nav" data-route="${SHOP}">ショップへ</button></p>`;
  return `<h3 class="shop-h">カート</h3>
    <div class="shop-checkout">
      <ul class="shop-rows">${items.map((it) => orderRow(it, {remove: true})).join('')}</ul>
      <aside class="shop-side">
        ${totals(items)}
        ${pointsNote(items)}
        ${cartTotal(items.map((it) => it.id)) ? '<p class="muted shop-side__note">円の支払いは α 版のあいだはデモです。実際の請求はありません。</p>' : ''}
        <button type="button" class="btn btn--primary shop-side__go" data-action="nav" data-route="/fudebako/checkout">レジへ進む</button>
        <button type="button" class="btn" data-action="nav" data-route="${SHOP}">買い物を続ける</button>
      </aside>
    </div>`;
}
/** レジ：注文内容と支払い（円の品があればデモのカードの入力。ポイントの品は残高から引く） */
function checkout(s) {
  const items = cartItems(s);
  if (!items.length) return cartPage(s);
  const total = cartTotal(items.map((it) => it.id));
  const points = cartPoints(items.map((it) => it.id));
  const short = points > balance();
  const pointsPart = points
    ? `<div class="shop-pay__points"><b>${ICON.coin} ポイントで払う</b>${pointsNote(items)}</div>`
    : '';
  const label = [points ? pt(points) : '', total ? yen(total) : ''].filter(Boolean).join(' ＋ ');
  // デモ決済：カードの情報は入れない・受け取らない（実際の請求はない）。押すとそのまま注文になる
  const pay = `<div class="shop-pay"><h4>支払い</h4>
      ${total ? '<div class="shop-pay__demo"><b>デモ決済</b><span>α 版の試しの支払いです。カードの番号などは入れません。実際の請求はなく、注文の記録に「デモ」と残るだけです。</span></div>' : ''}
      ${pointsPart || (total ? '' : '<p class="muted">支払いのない品だけです。</p>')}
      <button type="button" class="btn btn--primary shop-side__go" data-shop="buy"${short ? ' disabled' : ''}>${total ? `${label} をデモで支払う` : points ? `${pt(points)} で買う` : '受け取る'}</button>
    </div>`;
  return `<h3 class="shop-h">レジ</h3>
    <div class="shop-checkout">
      <div>
        <h4>注文内容</h4>
        <ul class="shop-rows">${items.map((it) => orderRow(it)).join('')}</ul>
        ${totals(items)}
        <p><button type="button" class="btn btn--small" data-action="nav" data-route="/fudebako/cart">← カートに戻る</button></p>
      </div>
      <aside class="shop-side">${pay}</aside>
    </div>`;
}
/** 注文完了：注文の記録と、筆箱に入れるボタン */
function orderPage(s, id) {
  const o = (state.data.orders ?? []).find((x) => x.id === id);
  if (!o)
    return `<p class="muted">その注文はありません。</p><p><button type="button" class="btn" data-action="nav" data-route="${SHOP}">ショップへ</button></p>`;
  const at = new Date(o.at).toLocaleString('ja-JP', {dateStyle: 'medium', timeStyle: 'short'});
  const payLabel = [
    o.points ? `ポイント ${pt(o.points)}` : '',
    o.payment.method === 'demo' ? PAYMENT_METHODS.demo : o.payment.method === 'free' ? '支払いなし' : ''
  ]
    .filter(Boolean)
    .join('・');
  const cost = (x) => (x.price ? yen(x.price) : x.points ? pt(x.points) : '無料');
  const empty = s.slots.indexOf(null);
  const rows = o.items
    .map((x) => {
      const it = itemOf(x.id);
      if (!it)
        return `<li class="shop-row"><div class="shop-row__text">${esc(x.name)}</div><div class="shop-row__price">${cost(x)}</div></li>`;
      let act = '';
      if (it.type === 'case')
        act =
          it.id === s.caseId
            ? '<span class="muted">使っています</span>'
            : `<button type="button" class="btn btn--small" data-fb="case" data-id="${it.id}">このペンケースを使う</button>`;
      else {
        const where = s.slots.indexOf(it.id);
        act =
          where >= 0
            ? `<span class="muted">筆箱の ${where + 1} 本目</span>`
            : empty >= 0
              ? `<button type="button" class="btn btn--small" data-fb="put" data-id="${it.id}" data-at="${empty}">筆箱の ${empty + 1} 本目に入れる</button>`
              : swapButtons(s, it);
      }
      return `<li class="shop-row">
        <button type="button" class="shop-row__art" data-action="nav" data-route="${detailRoute(it)}" aria-label="${esc(it.name)}をくわしく見る">${it.type === 'case' ? caseArt(it) : toolArt(it)}</button>
        <div class="shop-row__text"><div class="shop-row__name">${esc(it.name)}</div><div class="muted">${esc(it.maker ?? '大学ノート')}</div></div>
        <div class="shop-row__price">${cost(x)}</div>
        <div class="shop-row__act">${act}</div>
      </li>`;
    })
    .join('');
  return `<div class="shop-done">
      <h3 class="shop-h">ご注文ありがとうございます</h3>
      <p class="muted">注文番号 <code>${esc(o.id)}</code>・${esc(at)}・${esc(payLabel)}</p>
      <ul class="shop-rows">${rows}</ul>
      <dl class="shop-total">${o.points ? `<dt class="shop-total__sum">合計（ポイント）</dt><dd class="shop-total__sum">${pt(o.points)}</dd>` : ''}${o.total || !o.points ? `<dt class="shop-total__sum">合計（円）</dt><dd class="shop-total__sum">${yen(o.total)}</dd>` : ''}</dl>
      <p class="muted">買った文房具は「わたしの筆箱」に入りました。筆箱に入れると PDF の編集画面で使えます。</p>
      <p class="shop-done__act"><button type="button" class="btn btn--primary" data-action="nav" data-route="/fudebako">わたしの筆箱へ</button><button type="button" class="btn" data-action="nav" data-route="${SHOP}">ショップへ戻る</button></p>
    </div>`;
}

/** ポイントのページ：残高・もらい方（準備中のものも並べる）・履歴 */
function pointsPage() {
  const p = state.data?.points ?? {balance: 0, history: []};
  const ways = Object.entries(EARN)
    .map(
      ([k, w]) => `<li class="pts-way${w.available ? '' : ' is-soon'}">
        <span class="pts-way__name">${esc(w.label)}</span>
        <span class="pts-way__amount">+${pt(w.amount)}</span>
        <span class="muted pts-way__note">${esc(w.note)}${k === 'login' && p.lastLogin === dayOf() ? '・今日はもらいました' : ''}</span>
        ${w.available ? '' : '<span class="pts-way__soon">準備中</span>'}
      </li>`
    )
    .join('');
  const label = (h) => (h.kind === 'shop' ? 'ショップで買い物' : (EARN[h.kind]?.label ?? h.kind));
  const history = p.history.length
    ? `<ul class="pts-history">${p.history
        .slice(0, 50)
        .map(
          (
            h
          ) => `<li><span class="muted">${esc(new Date(h.at).toLocaleString('ja-JP', {dateStyle: 'short', timeStyle: 'short'}))}</span>
            <span>${esc(label(h))}${h.note ? `<span class="muted">（${esc(h.note)}）</span>` : ''}</span>
            <b class="${h.amount < 0 ? 'is-minus' : 'is-plus'}">${h.amount < 0 ? '−' : '+'}${pt(Math.abs(h.amount))}</b></li>`
        )
        .join('')}</ul>`
    : '<p class="muted">まだありません。</p>';
  return `<p><button type="button" class="btn btn--small" data-action="nav" data-route="${SHOP}">← ショップ</button></p>
    <div class="pts">
      <section class="pts-balance"><span class="muted">いまのポイント</span><b>${ICON.coin}${p.balance.toLocaleString('ja-JP')}<small> pt</small></b>
        <p class="muted">公式の文房具はポイントで買えます。</p></section>
      <section><h3 class="shop-h">ポイントのもらい方</h3><ul class="pts-ways">${ways}</ul></section>
      <section><h3 class="shop-h">履歴</h3>${history}</section>
    </div>`;
}

/** 筆箱のページ（#/fudebako、ショップは #/fudebako?tab=shop、カート #/fudebako/cart、レジ #/fudebako/checkout、注文 #/fudebako/order/<id>、ポイント #/fudebako/points） */
export function renderFudebako(_state, route) {
  const isShop = new URLSearchParams(route.split('?')[1] ?? '').get('tab') === 'shop';
  const item = route.match(/^\/fudebako\/item\/([^?]+)/);
  const order = route.match(/^\/fudebako\/order\/([^?]+)/);
  const isCart = /^\/fudebako\/cart(\?|$)/.test(route);
  const isCheckout = /^\/fudebako\/checkout(\?|$)/.test(route);
  const isPoints = /^\/fudebako\/points(\?|$)/.test(route);
  const s = st();
  if (ui.slot < 0 || ui.slot >= SLOTS) ui.slot = 0;
  const inShop = isShop || !!item || !!order || isCart || isCheckout || isPoints;
  const body = item
    ? detail(s, decodeURIComponent(item[1]))
    : order
      ? orderPage(s, decodeURIComponent(order[1]))
      : isCart
        ? cartPage(s)
        : isCheckout
          ? checkout(s)
          : isPoints
            ? pointsPage()
            : isShop
              ? shop(s)
              : mine(s);
  return `<div class="fudebako">
    <div class="fb-head"><h2>筆箱</h2>${tabs(inShop)}<div class="fb-head__side">${pointsButton()}${cartButton()}</div></div>
    ${body}
  </div>`;
}

async function save(channel, arg, done) {
  const r = await api[channel](arg);
  if (r?.error) return toast(r.error, {error: true});
  state.data.stationery = r.stationery;
  if (r.orders) state.data.orders = r.orders;
  refresh();
  if (done) toast(done);
  return r;
}

/** レジで買う（デモ決済）。終わったら注文完了のページへ */
async function pay(button) {
  const s = st();
  const items = cartItems(s);
  if (!items.length) return toast('カートが空です', {error: true});
  const payment = cartTotal(items.map((it) => it.id)) > 0 ? {method: 'demo'} : null; // 円の品があればデモ決済
  button.disabled = true;
  const label = button.innerHTML;
  button.innerHTML = payment ? '決済を確かめています…' : '受け取っています…';
  if (payment) await new Promise((r) => setTimeout(r, 900)); // デモ：決済に少し時間がかかる様子
  const r = await api['stationery.purchase']({itemIds: items.map((it) => it.id), payment});
  if (r?.error) {
    button.disabled = false;
    button.innerHTML = label;
    return toast(r.error, {error: true});
  }
  state.data.stationery = r.stationery;
  state.data.orders = r.orders;
  if (r.points) state.data.points = r.points;
  cart.clear();
  navigate(`/fudebako/order/${encodeURIComponent(r.order.id)}`);
  toast(
    [
      r.order.points ? `${pt(r.order.points)} を使いました` : '',
      r.order.total ? `${yen(r.order.total)} を支払いました（デモ）` : ''
    ]
      .filter(Boolean)
      .join('・') || '受け取りました'
  );
}

// 検索欄：字を打つたびに結果だけ描き直す（画面全体を描き直すと入力の途中で手が止まるので）
document.addEventListener('input', (e) => {
  const q = e.target.closest('#shop-q');
  if (!q) return;
  ui.shop.q = q.value;
  const box = document.getElementById('shop-results');
  if (box) box.innerHTML = results(st());
  const h = document.querySelector('.shop-hero');
  if (h) h.hidden = !!ui.shop.q.trim();
});
document.addEventListener('change', (e) => {
  const sel = e.target.closest('#shop-sort');
  if (!sel) return;
  ui.shop.sort = sel.value in SORTS ? sel.value : 'rec';
  refresh();
});

document.addEventListener('click', (e) => {
  const sb = e.target.closest('.fudebako [data-shop]');
  if (sb) {
    const what = sb.dataset.shop;
    if (what === 'type' || what === 'price') {
      ui.shop[what === 'price' ? 'pay' : 'type'] = sb.dataset.v;
      refresh();
    } else if (what === 'unowned') {
      ui.shop.unowned = sb.dataset.v === '1';
      refresh();
    } else if (what === 'reset') {
      ui.shop = {...ui.shop, q: '', type: 'all', pay: 'all', unowned: false};
      refresh();
    } else if (what === 'pick') {
      ui.shop.pick[sb.dataset.series] = sb.dataset.id;
      const card = sb.closest('.shop-card');
      const se = shopSeries().find((x) => x.id === sb.dataset.series);
      if (card && se) card.outerHTML = seriesCard(se, st());
      else refresh();
    } else if (what === 'cart') {
      const it = itemOf(sb.dataset.id);
      if (!it) return;
      if (st().owned.includes(it.id)) return toast(`${it.name} はもう持っています`);
      cart.add(it.id);
      refresh();
      toast(`${it.name} をカートに入れました`, {
        action: {label: 'カートを見る', run: () => navigate('/fudebako/cart')},
        untilNavigate: true
      });
    } else if (what === 'remove') {
      cart.remove(sb.dataset.id);
      refresh();
    } else if (what === 'buy') pay(sb);
    return;
  }
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
    const at = b.dataset.at !== undefined ? Number(b.dataset.at) : ui.slot; // 詳細ページ・注文完了からは空きの場所へ
    const slots = [...s.slots];
    const old = itemOf(slots[at]);
    slots[at] = id;
    const next = slots.indexOf(null);
    save(
      'stationery.arrange',
      {slots},
      `${itemOf(id).name} を ${at + 1} 本目に入れました${old ? `（${old.name} は持ち物に残っています）` : ''}`
    );
    if (next >= 0) ui.slot = next; // 空きがあれば、次はそこへ
  } else if (what === 'case') save('stationery.arrange', {caseId: id});
});
