// 文房具（SPEC §9.8・§15）：ボールペン・マーカー（アンダーライン用）・文字隠しペン・ペンケース。副作用なし。
// 品ぞろえはアプリに入っている（公式のみ。いまはすべて無料）。持ち物と筆箱の中身は設定（stationery）に保存する。
// 筆箱には道具（ペン・マーカー・文字隠しペン）を 6 本まで入れられ、編集画面の PDF の横に出る。
// 道具ごとに、書いた線の色・太さが決まる（軸の色は見た目だけ）。
// 文字隠しペンの色は赤の成分が 0 のものに限る（赤シートを乗算で重ねたとき黒くなって隠れる。viewer.js の冒頭）

export const SLOTS = 6;
export const TYPES = ['pen', 'marker', 'hider', 'case'];
export const TOOL_TYPES = ['pen', 'marker', 'hider'];
export const TYPE_LABEL = {pen: 'ボールペン', marker: 'マーカー', hider: '文字隠しペン', case: 'ペンケース'};
/** 道具の種類 → 編集画面の注釈の種類（shared/annotation.js） */
export const KIND_OF = {pen: 'ink', marker: 'line', hider: 'mask'};

const pen = (id, name, color, mm, body, accent = color) => ({id, type: 'pen', name, color, width: PEN_WIDTH[mm], mm, body, accent, price: 0});
const marker = (id, name, color, thick = false) => ({
  id,
  type: 'marker',
  name,
  color,
  width: thick ? 5 : 2.5,
  thick,
  body: '#f4f4f2',
  accent: color,
  price: 0
});
const hider = (id, name, color) => ({id, type: 'hider', name, color, body: '#ffffff', accent: color, price: 0});
const pencase = (id, name, style, base, trim) => ({id, type: 'case', name, style, base, trim, price: 0});

// ボールペンの字幅（mm）→ 線の太さ（pt。1pt ≒ 0.35mm）。紙に書いた線の太さに近づける
const PEN_WIDTH = {'0.38': 0.8, '0.5': 1.1, '0.7': 1.5, '1.0': 2};

export const CATALOG = [
  pen('pen-black-05', '黒のボールペン 0.5', '#222222', '0.5', '#2c2d30', '#55575c'),
  pen('pen-red-05', '赤のボールペン 0.5', '#d93025', '0.5', '#c9262c', '#7d1a1e'),
  pen('pen-blue-05', '青のボールペン 0.5', '#1a5fd0', '0.5', '#1f4fb3', '#183a7f'),
  pen('pen-black-038', '黒のボールペン 0.38', '#222222', '0.38', '#3b3b3b', '#222222'),
  pen('pen-black-07', '黒のボールペン 0.7', '#222222', '0.7', '#e6e2d8', '#222222'),
  pen('pen-green-05', '緑のボールペン 0.5', '#188038', '0.5', '#f2f2f0'),
  pen('pen-blueblack-05', 'ブルーブラック 0.5', '#1f3a5f', '0.5', '#dfe6ee'),
  pen('pen-sepia-05', 'セピアのボールペン 0.5', '#6b4423', '0.5', '#efe3d3'),
  pen('pen-pink-05', 'ピンクのボールペン 0.5', '#d6457a', '0.5', '#fbe3ec'),
  pen('pen-orange-05', 'オレンジのボールペン 0.5', '#e37400', '0.5', '#fdebd3'),
  pen('pen-purple-05', '紫のボールペン 0.5', '#7b3fbf', '0.5', '#ece2f7'),
  pen('pen-sakura-05', 'さくら軸 黒 0.5', '#222222', '0.5', '#f7c5d5', '#e98aa8'),
  pen('pen-mint-05', 'ミント軸 青 0.5', '#1a5fd0', '0.5', '#bfe8dc', '#5fbfa3'),
  pen('pen-wood-07', '木軸 黒 0.7', '#222222', '0.7', '#c89b6d', '#8a6440'),
  pen('pen-navy-038', 'ネイビー軸 赤 0.38', '#d93025', '0.38', '#24365c', '#c9a227'),
  marker('marker-yellow', '黄色のマーカー', '#ffe14d'),
  marker('marker-pink', 'ピンクのマーカー', '#ff9ec7'),
  marker('marker-orange', 'オレンジのマーカー', '#ffbf6b'),
  marker('marker-green', '緑のマーカー', '#9be38a'),
  marker('marker-blue', '青のマーカー', '#8fd3ff'),
  marker('marker-purple', '紫のマーカー', '#c9a7ff'),
  marker('marker-yellow-wide', '黄色のマーカー（太）', '#ffe14d', true),
  marker('marker-pink-wide', 'ピンクのマーカー（太）', '#ff9ec7', true),
  hider('hider-cyan', '文字隠しペン（水色）', '#00d2ff'),
  hider('hider-green', '文字隠しペン（緑）', '#00c98d'),
  hider('hider-blue', '文字隠しペン（青）', '#0094ff'),
  pencase('case-canvas-navy', '帆布の筆箱（紺）', 'pouch', '#2e3f66', '#d9d2c3'),
  pencase('case-tin-silver', '缶ペンケース（銀）', 'tin', '#c9ced6', '#8a929e'),
  pencase('case-leather-brown', '革のペンケース（茶）', 'leather', '#8a5a3b', '#e8c9a0'),
  pencase('case-pastel-pink', 'パステルの筆箱（桃）', 'pouch', '#f6c9d6', '#ffffff'),
  pencase('case-sage', 'くすみグリーンの筆箱', 'pouch', '#a9bfa8', '#f3efe4'),
  pencase('case-clear', 'クリアケース', 'clear', '#e9f3f8', '#9fb7c4')
];
const ITEMS = new Map(CATALOG.map((it) => [it.id, it]));
export const itemOf = (id) => ITEMS.get(id) ?? null;
export const isTool = (id) => TOOL_TYPES.includes(itemOf(id)?.type);

/** はじめから持っている文房具と、筆箱のはじめの中身 */
export const STARTER_SLOTS = ['pen-black-05', 'pen-red-05', 'pen-blue-05', 'marker-yellow', 'marker-pink', 'hider-cyan'];
export const STARTER_CASE = 'case-canvas-navy';
export const STARTER = [...STARTER_SLOTS, STARTER_CASE];
export const DEFAULT_HIDER = 'hider-cyan';

/** 文字隠しペンに使える色か：赤の成分が 0（赤シートで黒くなる）で、下の字が読める明るさ（緑と青の合計が 300 以上） */
export function hiderColorOk(hex) {
  if (!/^#00[0-9a-f]{4}$/i.test(hex ?? '')) return false;
  return parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16) >= 300;
}

/**
 * 設定に保存した値を、使える形に直す（知らない品・持っていない品は外す。はじめの品はいつも持っている）。
 * 戻り値：{owned: [id…], slots: [id|null × 6], caseId}
 */
export function stationeryState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const owned = [...new Set([...STARTER, ...(Array.isArray(r.owned) ? r.owned : []).filter((id) => ITEMS.has(id))])];
  const has = new Set(owned);
  const want = Array.isArray(r.slots) ? r.slots : STARTER_SLOTS;
  const used = new Set();
  const slots = Array.from({length: SLOTS}, (_, i) => {
    const id = want[i];
    if (typeof id !== 'string' || !has.has(id) || !isTool(id) || used.has(id)) return null;
    used.add(id);
    return id;
  });
  const caseId = has.has(r.caseId) && itemOf(r.caseId).type === 'case' ? r.caseId : STARTER_CASE;
  return {owned, slots, caseId};
}

/** ショップで入手する。無料の品だけ（有料の品はまだない）。新しい状態を返す。入手できなければ Error */
export function acquire(raw, id) {
  const st = stationeryState(raw);
  const item = itemOf(id);
  if (!item) throw new Error('その文房具はありません');
  if (item.price !== 0) throw new Error('この文房具はまだ入手できません');
  if (st.owned.includes(id)) return st;
  return stationeryState({...st, owned: [...st.owned, id]});
}

/** 筆箱の中身・ペンケースを変える。持っていない品は入れられない（Error） */
export function arrange(raw, {slots, caseId} = {}) {
  const st = stationeryState(raw);
  const has = new Set(st.owned);
  if (slots !== undefined) {
    if (!Array.isArray(slots) || slots.length !== SLOTS) throw new Error('筆箱の中身が不正です');
    for (const id of slots) if (id !== null && (!has.has(id) || !isTool(id))) throw new Error('持っていない文房具は入れられません');
    if (new Set(slots.filter(Boolean)).size !== slots.filter(Boolean).length) throw new Error('同じ文房具は 1 本だけ入れられます');
  }
  if (caseId !== undefined && (!has.has(caseId) || itemOf(caseId)?.type !== 'case')) throw new Error('持っていないペンケースです');
  return stationeryState({...st, ...(slots !== undefined ? {slots} : {}), ...(caseId !== undefined ? {caseId} : {})});
}

/** 値段の表示。無料は「無料」 */
export const priceLabel = (item) => (item.price === 0 ? '無料' : `¥${item.price}`);

// ---- 見た目（SVG。画像ファイルを持たない）----
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);

/** 色を白（amt > 0）か黒（amt < 0）へ寄せる。立体の陰影に使う */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const to = amt > 0 ? 255 : 0;
  const k = Math.abs(amt);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** 円筒の陰影（上が明るく、下が暗い）のグラデーション */
const tube = (id, color) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${shade(color, -0.25)}"/><stop offset="0.18" stop-color="${shade(color, 0.55)}"/>
  <stop offset="0.42" stop-color="${color}"/><stop offset="0.85" stop-color="${shade(color, -0.22)}"/>
  <stop offset="1" stop-color="${shade(color, -0.45)}"/></linearGradient>`;
const METAL = (id) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#8e949b"/><stop offset="0.25" stop-color="#f7f8f9"/><stop offset="0.55" stop-color="#c3c8ce"/>
  <stop offset="1" stop-color="#7d838a"/></linearGradient>`;

/**
 * 道具の絵（横向き。左がペン先）。viewBox 0 0 200 28。
 * ボールペンはノック式：金属のペン先・透けた先の部品・すべり止めのグリップ・軸・金属のクリップ・ノック。
 * 軸の色・グリップ（accent）・インクの色（ペン先とグリップの下の輪）が品ごとに変わる
 */
export function toolArt(item, {label = true} = {}) {
  const title = label ? `<title>${esc(item.name)}</title>` : '';
  const g = `st-${item.id}`; // グラデーションの id（品ごと）
  const open = `<svg class="st-art st-art--${item.type === 'pen' ? 'pen' : 'marker'}" viewBox="0 0 200 28" aria-hidden="${label ? 'false' : 'true'}" role="img">${title}`;
  if (item.type === 'pen') {
    const ridges = Array.from({length: 12}, (_, i) => `<rect x="${33 + i * 3.4}" y="8.2" width="1.2" height="11.6" fill="#000" opacity="0.13"/>`).join('');
    return `${open}<defs>${tube(`${g}-b`, item.body)}${tube(`${g}-a`, item.accent)}${METAL(`${g}-m`)}
      <linearGradient id="${g}-t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.75"/><stop offset="0.5" stop-color="${shade(item.body, 0.2)}" stop-opacity="0.45"/><stop offset="1" stop-color="${shade(item.body, -0.3)}" stop-opacity="0.7"/></linearGradient></defs>
      <ellipse cx="104" cy="23.5" rx="92" ry="2.2" fill="#000" opacity="0.12"/>
      <path d="M1.5 14 L9 12.3 L9 15.7 Z" fill="url(#${g}-m)"/><circle cx="1.8" cy="14" r="0.9" fill="${item.color}"/>
      <path d="M9 11.6 L28 8.6 L28 19.4 L9 16.4 Z" fill="url(#${g}-t)" stroke="${shade(item.body, -0.35)}" stroke-width="0.4"/>
      <rect x="12" y="13.4" width="16" height="1.2" fill="${item.color}" opacity="0.7"/>
      <rect x="28" y="7.6" width="44" height="12.8" rx="3" fill="url(#${g}-a)"/>${ridges}
      <rect x="72" y="7" width="3" height="14" fill="${item.color}"/>
      <rect x="75" y="6.6" width="101" height="14.8" rx="2.5" fill="url(#${g}-b)"/>
      <rect x="80" y="9" width="90" height="1.6" rx="0.8" fill="#fff" opacity="0.45"/>
      <rect x="176" y="7.2" width="9" height="13.6" rx="1.5" fill="url(#${g}-a)"/>
      <rect x="185" y="8.6" width="12" height="10.8" rx="2.5" fill="url(#${g}-b)"/>
      <path d="M128 6.8 H178 Q183 6.8 183 4.4 V3.2 Q183 1.8 181.4 1.8 H136 Q131 1.8 129 4 Z" fill="url(#${g}-m)" stroke="#6f757c" stroke-width="0.4"/>
      <path d="M130 7 Q127 7 127 8.6" fill="none" stroke="#6f757c" stroke-width="0.6"/></svg>`;
  }
  if (item.type === 'marker' || item.type === 'hider') {
    const h = item.thick ? 17 : 15;
    const y = (28 - h) / 2;
    const tag = item.type === 'hider' ? `<text x="120" y="${y + h / 2 + 3}" font-size="8.5" text-anchor="middle" fill="#1d3557" font-family="sans-serif" font-weight="700">隠</text>` : '';
    return `${open}<defs>${tube(`${g}-b`, item.body)}${tube(`${g}-c`, item.color)}</defs>
      <ellipse cx="104" cy="${y + h + 2}" rx="92" ry="2.2" fill="#000" opacity="0.12"/>
      <path d="M2 ${14 - h * 0.18} L14 ${y + 2} L14 ${y + h - 2} L4 ${14 + h * 0.22} Z" fill="${shade(item.color, -0.12)}"/>
      <rect x="14" y="${y}" width="44" height="${h}" rx="4" fill="url(#${g}-c)"/>
      <rect x="58" y="${y - 0.6}" width="4" height="${h + 1.2}" rx="1" fill="${shade(item.color, -0.3)}"/>
      <rect x="62" y="${y}" width="134" height="${h}" rx="6" fill="url(#${g}-b)" stroke="rgba(0,0,0,.12)" stroke-width="0.5"/>
      <rect x="86" y="${y + 3.5}" width="70" height="${h - 7}" rx="2" fill="${item.color}" opacity="0.75"/>
      <rect x="66" y="${y + 2}" width="124" height="1.6" rx="0.8" fill="#fff" opacity="0.6"/>${tag}</svg>`;
  }
  return '';
}

/** ペンケースの絵。viewBox 0 0 200 80 */
export function caseArt(item) {
  const {style, base, trim} = item;
  const title = `<title>${esc(item.name)}</title>`;
  if (style === 'tin')
    return `<svg class="st-art st-art--case" viewBox="0 0 200 80" role="img">${title}
      <rect x="4" y="8" width="192" height="66" rx="10" fill="${base}" stroke="${trim}" stroke-width="3"/>
      <rect x="4" y="8" width="192" height="16" rx="8" fill="${trim}" opacity="0.5"/>
      <rect x="18" y="34" width="164" height="4" rx="2" fill="#fff" opacity="0.6"/></svg>`;
  if (style === 'leather')
    return `<svg class="st-art st-art--case" viewBox="0 0 200 80" role="img">${title}
      <rect x="4" y="10" width="192" height="62" rx="16" fill="${base}"/>
      <rect x="11" y="17" width="178" height="48" rx="11" fill="none" stroke="${trim}" stroke-width="1.6" stroke-dasharray="5 4"/>
      <rect x="150" y="30" width="34" height="20" rx="6" fill="${trim}" opacity="0.85"/></svg>`;
  if (style === 'clear')
    return `<svg class="st-art st-art--case" viewBox="0 0 200 80" role="img">${title}
      <rect x="4" y="10" width="192" height="62" rx="14" fill="${base}" fill-opacity="0.7" stroke="${trim}" stroke-width="2"/>
      <path d="M8 22 H192" stroke="${trim}" stroke-width="3" stroke-dasharray="2 2"/>
      <rect x="30" y="32" width="70" height="6" rx="3" fill="#fff" opacity="0.8"/></svg>`;
  return `<svg class="st-art st-art--case" viewBox="0 0 200 80" role="img">${title}
    <path d="M8 22 Q8 10 22 10 H178 Q192 10 192 22 V60 Q192 74 176 74 H24 Q8 74 8 60 Z" fill="${base}"/>
    <path d="M14 22 H186" stroke="${trim}" stroke-width="4" stroke-dasharray="3 2"/>
    <rect x="160" y="16" width="8" height="18" rx="3" fill="${trim}"/>
    <path d="M16 66 H184" stroke="#000" stroke-opacity="0.12" stroke-width="2"/></svg>`;
}

/** 品の絵（種類で分ける） */
export const itemArt = (item, opts) => (item.type === 'case' ? caseArt(item) : toolArt(item, opts));
