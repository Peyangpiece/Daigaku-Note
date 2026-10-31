import {esc} from './html.js';
// 文房具（SPEC §9.8・§15）：ボールペン・シャープペンシル・マーカー（アンダーライン用）・文字隠しペン・ペンケース。副作用なし。
// 品ぞろえはアプリに入っている（公式の品はアプリ内のポイントで買う〔POINTS。はじめから持っている品は 0〕。既製品の見た目の品は定価）。
// 持ち物と筆箱の中身は設定（stationery）に保存する。ポイントの残高は shared/points.js。
// ショップはシリーズ（series：同じ品の色ちがい）ごとに 1 枚の札で出し、色は札の右下の丸で選ぶ（SERIES・shopSeries）。
// 買うときはカートに入れてレジへ。α 版の決済はデモ（purchase：実際の請求はなく、注文の記録だけ残す）
// 筆箱には道具（ペン・マーカー・文字隠しペン）を 6 本まで入れられ、編集画面の PDF の横に出る。
// 道具ごとに、書いた線の色・太さが決まる（軸の色は見た目だけ）。
// 文字隠しペンの色は赤の成分が 0 のものに限る（赤シートを乗算で重ねたとき黒くなって隠れる。viewer.js の冒頭）
// 多機能ペン（refills）：1 本に替え芯がいくつか入り、持っている間にどれで書くか選ぶ（選んだ芯は設定に残す）。
// 見た目が 3D モデル（art: 'model'）の品は、GLB を renderer/assets/stationery に置き、renderer/model3d.js が描く

export const SLOTS = 6;
// 種類（kind）：ショップの絞り込み・一覧の見出しの分け方。シャープペンシルは書く道具としてはペン（type: 'pen'）で、
// 線が黒鉛の灰色になるだけなので、種類だけを分ける（pencil: true の品。kindOf）
export const TYPES = ['pen', 'pencil', 'marker', 'hider', 'case'];
export const TOOL_TYPES = ['pen', 'marker', 'hider'];
export const TOOL_KINDS = ['pen', 'pencil', 'marker', 'hider'];
export const TYPE_LABEL = {
  pen: 'ボールペン',
  pencil: 'シャープペンシル',
  marker: 'マーカー',
  hider: '文字隠しペン',
  case: 'ペンケース'
};
/** 品の種類（シャープペンシルは 'pencil'、ほかは type） */
export const kindOf = (item) => (item?.pencil ? 'pencil' : item?.type);
/** 品の種類の名前 */
export const typeLabel = (item) => TYPE_LABEL[kindOf(item)];
/** 道具の種類 → 編集画面の注釈の種類（shared/annotation.js） */
export const KIND_OF = {pen: 'ink', marker: 'line', hider: 'mask'};

// 公式の品の見た目は 3D モデル（scripts/pens3d/build.py が形の種類ごとに作る GLB）。色は品の body・accent・color で
// 塗り替える（renderer/model3d-three.js の tint）。model は形の種類（ファイル名）。trim: 'gold' は天冠・ノックが金色の金属
const pen = (id, name, color, mm, body, accent = color, series = `pen-${mm.replace('.', '')}`, extra = {}) => ({
  id,
  type: 'pen',
  name,
  color,
  width: PEN_WIDTH[mm],
  mm,
  body,
  accent,
  price: 0,
  series,
  art: 'model',
  model: 'pen-ballpoint',
  ...extra
});
/**
 * 筆圧なしのペン（even）：筆圧・書く速さで太さが変わらず、どこも同じ太さの線（書き始め・書き終わりも細くしない。shared/ink.js）。
 * 図・表の線や、太さをそろえたい字に
 */
const evenPen = (id, name, color, body, accent) => ({
  ...pen(id, name, color, '0.5', body, accent, 'pen-even'),
  even: true
});
const marker = (id, name, color, thick = false) => ({
  id,
  type: 'marker',
  name,
  color,
  width: thick ? 5 : 2.5,
  thick,
  body: '#f4f4f2',
  accent: color,
  price: 0,
  series: thick ? 'marker-wide' : 'marker',
  art: 'model',
  model: thick ? 'marker-wide' : 'marker'
});
/**
 * シャープペンシル（大学ノートのオリジナル。製図用の形）：書く道具としてはペン（type: 'pen'）。線は黒鉛の灰色で、
 * 太さは芯の太さで決まる（PENCIL_WIDTH）。芯の硬さは HB。見た目は 3D モデル pencil-mech
 */
const pencil = (id, name, mm, body, accent, series = `pencil-${mm.replace('.', '')}`) => ({
  id,
  type: 'pen',
  pencil: true,
  name,
  color: SHARP.color,
  width: PENCIL_WIDTH[mm],
  mm,
  lead: 'HB',
  body,
  accent,
  price: 0,
  series,
  art: 'model',
  model: 'pencil-mech'
});
const hider = (id, name, color) => ({
  id,
  type: 'hider',
  name,
  color,
  body: '#ffffff',
  accent: color,
  price: 0,
  series: 'hider',
  art: 'model',
  model: 'hider'
});
// ペンケースも 3D モデル（形の種類ごとの GLB：case-pouch・case-tin・case-leather・case-clear。色は base・trim で塗る）
const pencase = (id, name, style, base, trim) => ({
  id,
  type: 'case',
  name,
  style,
  base,
  trim,
  price: 0,
  art: 'model',
  model: `case-${style}`
});
/** 既製品の見た目のペン（実験）。art で絵を分ける。ゲルインク（サラサ）は少し太く濃い線。price はその品の定価（税込） */
const maker = (id, name, makerName, art, color, body, accent, price, series) => ({
  id,
  type: 'pen',
  name,
  color,
  width: art === 'sarasa' ? 1.25 : 1.1,
  mm: '0.5',
  body,
  accent,
  price,
  maker: makerName,
  art,
  series,
  experimental: true
});

// ボールペンの字幅（mm）→ 線の太さ（pt。1pt ≒ 0.35mm）。紙に書いた線の太さに近づける
const PEN_WIDTH = {0.38: 0.8, 0.5: 1.1, 0.7: 1.5, '1.0': 2};
// シャープペンシル 0.5 の線：芯の太さ（0.5mm ≒ 1.4pt）より少し細く、黒鉛の灰色
const SHARP = {color: '#4a4a4a', width: 1.3};
// シャープペンシルの芯の太さ（mm）→ 線の太さ（pt）。0.5 は SHARP と同じ
const PENCIL_WIDTH = {0.3: 0.9, 0.5: 1.3, 0.7: 1.7};

/**
 * 実験：既製品の多機能ペン（3D モデルの見た目）。refills の最初の芯で書き始める。
 * 各芯：{id, name, color, mm, width, sharp?}。item の color・width・mm は最初の芯のもの（筆箱の一覧の色などに使う）
 */
const multi = (id, name, makerName, {model, body, accent, refills, refill, price, featured = false}) => ({
  id,
  type: 'pen',
  name,
  color: refills[0].color,
  width: refills[0].width,
  mm: refills[0].mm,
  body,
  accent,
  price,
  featured, // ショップの上の「新しく入りました」の帯に出す
  maker: makerName,
  art: 'model',
  model,
  refills,
  refill,
  experimental: true
});

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
  pen('pen-sakura-05', 'さくら軸 黒 0.5', '#222222', '0.5', '#f7c5d5', '#e98aa8', 'pen-art'),
  pen('pen-mint-05', 'ミント軸 青 0.5', '#1a5fd0', '0.5', '#bfe8dc', '#5fbfa3', 'pen-art'),
  pen('pen-wood-07', '木軸 黒 0.7', '#222222', '0.7', '#c89b6d', '#8a6440', 'pen-art', {model: 'pen-ballpoint-wood'}),
  pen('pen-navy-038', 'ネイビー軸 赤 0.38', '#d93025', '0.38', '#24365c', '#c9a227', 'pen-art', {trim: 'gold'}),
  evenPen('pen-even-black-05', '筆圧なし 黒 0.5', '#222222', '#f1f1ee', '#222222'),
  evenPen('pen-even-red-05', '筆圧なし 赤 0.5', '#d93025', '#f1f1ee', '#d93025'),
  evenPen('pen-even-blue-05', '筆圧なし 青 0.5', '#1a5fd0', '#f1f1ee', '#1a5fd0'),
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
  pencil('pencil-black-05', 'シャープペンシル 0.5（黒）', '0.5', '#2c2d30', '#55575c'),
  pencil('pencil-silver-05', 'シャープペンシル 0.5（銀）', '0.5', '#c9ced6', '#55575c'),
  pencil('pencil-navy-05', 'シャープペンシル 0.5（紺）', '0.5', '#24365c', '#55575c'),
  pencil('pencil-black-03', 'シャープペンシル 0.3', '0.3', '#2c2d30', '#7d1a1e'),
  pencil('pencil-black-07', 'シャープペンシル 0.7', '0.7', '#2c2d30', '#183a7f'),
  pencase('case-canvas-navy', '帆布の筆箱（紺）', 'pouch', '#2e3f66', '#d9d2c3'),
  pencase('case-tin-silver', '缶ペンケース（銀）', 'tin', '#c9ced6', '#8a929e'),
  pencase('case-leather-brown', '革のペンケース（茶）', 'leather', '#8a5a3b', '#e8c9a0'),
  pencase('case-pastel-pink', 'パステルの筆箱（桃）', 'pouch', '#f6c9d6', '#ffffff'),
  pencase('case-sage', 'くすみグリーンの筆箱', 'pouch', '#a9bfa8', '#f3efe4'),
  pencase('case-clear', 'クリアケース', 'clear', '#e9f3f8', '#9fb7c4'),
  // 既製品の見た目のペン（試作。メーカーの許しを得ていないので、正式な公開の前に見直す。
  // α 版のあいだはショップに出す：MAKER_ITEMS_LISTED）
  // 値段は各メーカーの参考価格・希望小売価格（税込。2026 年 10 月に確かめた）
  maker(
    'maker-jetstream-black',
    'ジェットストリーム 黒 0.5',
    '三菱鉛筆',
    'jetstream',
    '#1f1f22',
    '#1d1e21',
    '#121214',
    165,
    'jetstream'
  ),
  maker(
    'maker-jetstream-red',
    'ジェットストリーム 赤 0.5',
    '三菱鉛筆',
    'jetstream',
    '#d0202e',
    '#c8102e',
    '#121214',
    165,
    'jetstream'
  ),
  maker(
    'maker-sarasa-black',
    'サラサクリップ 黒 0.5',
    'ゼブラ',
    'sarasa',
    '#141414',
    '#e8eef2',
    '#1b1b1b',
    110,
    'sarasa'
  ),
  maker(
    'maker-sarasa-red',
    'サラサクリップ 赤 0.5',
    'ゼブラ',
    'sarasa',
    '#e4002b',
    '#e8eef2',
    '#e4002b',
    110,
    'sarasa'
  ),
  // サクラクラフトラボ 004：回転式の 2&1（黒・赤のボールペンと 0.5 のシャープ）。替え芯は 4C 規格。定価 ¥8,800（税込）。
  // 見た目は 3D モデル（assets/stationery/craftlab-004.glb。写真の質感をそのまま使う）
  multi('maker-craftlab-004', 'サクラクラフトラボ 004', 'サクラクレパス', {
    model: 'craftlab-004',
    body: '#5c5d55',
    accent: '#a99d80',
    refill: '4C',
    price: 8800,
    featured: true,
    refills: [
      {id: 'black', name: '黒ボールペン', color: '#1f1f22', mm: '0.5', width: PEN_WIDTH[0.5]},
      {id: 'red', name: '赤ボールペン', color: '#d0202e', mm: '0.5', width: PEN_WIDTH[0.5]},
      {id: 'sharp', name: 'シャープ', color: SHARP.color, mm: '0.5', width: SHARP.width, sharp: true}
    ]
  })
];
/**
 * 公式の品のポイントの値段（pt。品ごとに決める）。ふつうの色のボールペン・マーカーは安く、
 * 細字・太字・少し変わった色はやや高く、デザイン軸・ペンケースは高め。はじめから持っている品（STARTER）は載せない（0）
 */
const POINTS = {
  'pen-black-038': 200,
  'pen-black-07': 200,
  'pen-green-05': 150,
  'pen-blueblack-05': 180,
  'pen-sepia-05': 180,
  'pen-pink-05': 150,
  'pen-orange-05': 150,
  'pen-purple-05': 150,
  'pen-sakura-05': 300,
  'pen-mint-05': 300,
  'pen-wood-07': 400,
  'pen-navy-038': 350,
  'pen-even-black-05': 200,
  'pen-even-red-05': 200,
  'pen-even-blue-05': 200,
  'marker-orange': 120,
  'marker-green': 120,
  'marker-blue': 120,
  'marker-purple': 120,
  'marker-yellow-wide': 180,
  'marker-pink-wide': 180,
  'hider-green': 200,
  'hider-blue': 200,
  'pencil-black-05': 250,
  'pencil-silver-05': 250,
  'pencil-navy-05': 250,
  'pencil-black-03': 250,
  'pencil-black-07': 250,
  'case-tin-silver': 400,
  'case-leather-brown': 600,
  'case-pastel-pink': 400,
  'case-sage': 400,
  'case-clear': 500
};
for (const it of CATALOG) it.points = POINTS[it.id] ?? 0;
const ITEMS = new Map(CATALOG.map((it) => [it.id, it]));
export const itemOf = (id) => ITEMS.get(id) ?? null;
export const isTool = (id) => TOOL_TYPES.includes(itemOf(id)?.type);

/** 多機能ペンの芯（id が合わなければ最初の芯）。多機能ペンでなければ null */
export function refillOf(item, refillId) {
  if (!Array.isArray(item?.refills) || !item.refills.length) return null;
  return item.refills.find((r) => r.id === refillId) ?? item.refills[0];
}
/** 持って書くときのペン：多機能ペンは選んだ芯の色・太さにした品（refill に芯）。ふつうのペンはそのまま */
export function heldPen(item, refillId) {
  const r = refillOf(item, refillId);
  if (!r) return item;
  return {...item, color: r.color, width: r.width, mm: r.mm, refill: r};
}
/** 次の芯（回転式：最後の芯の次は最初へ） */
export function nextRefill(item, refillId) {
  const r = refillOf(item, refillId);
  if (!r) return null;
  const i = item.refills.indexOf(r);
  return item.refills[(i + 1) % item.refills.length].id;
}

/** はじめから持っている文房具と、筆箱のはじめの中身 */
export const STARTER_SLOTS = [
  'pen-black-05',
  'pen-red-05',
  'pen-blue-05',
  'marker-yellow',
  'marker-pink',
  'hider-cyan'
];
export const STARTER_CASE = 'case-canvas-navy';
export const STARTER = [...STARTER_SLOTS, STARTER_CASE];
export const DEFAULT_HIDER = 'hider-cyan';

/** 文字隠しペンに使える色か：赤の成分が 0（赤シートで黒くなる）で、下の字が読める明るさ（緑と青の合計が 300 以上） */
export function hiderColorOk(hex) {
  if (!/^#00[0-9a-f]{4}$/i.test(hex ?? '')) return false;
  return parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16) >= 300;
}

/**
 * 赤シートの下で見えなくなるインクの色か（ショップの試し書きで、赤シートを横に置くかを決める）。
 * 赤シートは赤い光だけを通すので、赤の成分が紙（白）に近い明るい赤・橙・桃は紙と見分けがつかなくなる。
 * 条件：赤 190 以上で、赤と緑・青の差が 80 以上（赤 #d93025・橙 #e37400・桃 #d6457a が当たり、紫 #7b3fbf・黒・青は当たらない）。
 * 編集画面の文字入れの判定（shared/annotation.js の hidesUnderRedSheet）より広い：あちらは赤い字を確実に隠すための狭い判定
 */
export function fadesUnderRedSheet(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? '')) return false;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  return r >= 190 && r - Math.max(g, b) >= 80;
}
/** 試し書きの横に赤シートを置く品か：文字隠しペンと、赤シートで消える色のボールペン（多機能ペンはどれかの芯がそうなら） */
export function needsRedSheet(item) {
  if (item?.type === 'hider') return true;
  if (item?.type !== 'pen') return false;
  return (item.refills ?? [item]).some((r) => !r.sharp && fadesUnderRedSheet(r.color));
}

/**
 * 設定に保存した値を、使える形に直す（知らない品・持っていない品は外す。はじめの品はいつも持っている）。
 * 戻り値：{owned: [id…], slots: [id|null × 6], caseId, refills: {多機能ペンの id: 選んだ芯の id}}
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
  const refills = {};
  if (r.refills && typeof r.refills === 'object')
    for (const [id, rid] of Object.entries(r.refills)) {
      const it = itemOf(id);
      if (has.has(id) && it?.refills?.some((x) => x.id === rid)) refills[id] = rid;
    }
  return {owned, slots, caseId, refills};
}

/** 円もポイントも要らない品を入手する（カートを通らない近道。いまははじめから持っている品だけが当たる）。入手できなければ Error */
export function acquire(raw, id) {
  const st = stationeryState(raw);
  const item = itemOf(id);
  if (!item || !listed(item)) throw new Error('その文房具はありません');
  if (item.price !== 0 || item.points !== 0) throw new Error('この文房具はカートからレジへ進んでください');
  if (st.owned.includes(id)) return st;
  return stationeryState({...st, owned: [...st.owned, id]});
}

/** カートの合計（円。ない品は数えない） */
export function cartTotal(ids) {
  return (Array.isArray(ids) ? ids : []).reduce((sum, id) => sum + (itemOf(id)?.price ?? 0), 0);
}
/** カートの合計（ポイント。ない品は数えない） */
export function cartPoints(ids) {
  return (Array.isArray(ids) ? ids : []).reduce((sum, id) => sum + (itemOf(id)?.points ?? 0), 0);
}

/** α 版の決済：デモ（実際の請求はない）。カード番号は下 4 桁だけ記録する */
export const PAYMENT_METHODS = {demo: 'デモ決済（実際の請求はありません）'};

/**
 * レジ：カートの品をまとめて買う。円の品があれば payment が必要（α 版は {method: 'demo'} だけ受け付ける。カードの情報は扱わない）。
 * ポイントの品の分（order.points）は、呼ぶ側が shared/points.js の spend で残高から引く（足りなければそこで止める）。
 * 持っている品・ない品・出していない品があれば Error。
 * 戻り値：{stationery: 新しい状態, order: {id, at, items: [{id, name, price, points}], total（円）, points, payment: {method}}}
 */
export function purchase(raw, ids, payment = null, {now = new Date(), orderId = null} = {}) {
  const st = stationeryState(raw);
  const list = [...new Set(Array.isArray(ids) ? ids.map(String) : [])];
  if (!list.length) throw new Error('カートが空です');
  for (const id of list) {
    const it = itemOf(id);
    if (!it || !listed(it)) throw new Error('その文房具はありません');
    if (st.owned.includes(id)) throw new Error(`${it.name} はもう持っています`);
  }
  const items = list.map((id) => ({id, name: itemOf(id).name, price: itemOf(id).price, points: itemOf(id).points}));
  const total = items.reduce((sum, it) => sum + it.price, 0);
  const points = items.reduce((sum, it) => sum + it.points, 0);
  let pay = {method: points > 0 ? 'points' : 'free'}; // 円の支払いがない注文：ポイントだけ・無料だけ
  if (total > 0) {
    if (!payment || !PAYMENT_METHODS[payment.method]) throw new Error('支払いの方法を選んでください');
    pay = {method: payment.method}; // デモ決済：カードの情報は受け取らない・残さない
  }
  const order = {
    id: orderId ?? `order-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: now.toISOString(),
    items,
    total,
    points,
    payment: pay
  };
  return {stationery: stationeryState({...st, owned: [...st.owned, ...list]}), order};
}

/** 筆箱の中身・ペンケース・多機能ペンの芯を変える。持っていない品は入れられない（Error） */
export function arrange(raw, {slots, caseId, refills} = {}) {
  const st = stationeryState(raw);
  const has = new Set(st.owned);
  if (slots !== undefined) {
    if (!Array.isArray(slots) || slots.length !== SLOTS) throw new Error('筆箱の中身が不正です');
    for (const id of slots)
      if (id !== null && (!has.has(id) || !isTool(id))) throw new Error('持っていない文房具は入れられません');
    if (new Set(slots.filter(Boolean)).size !== slots.filter(Boolean).length)
      throw new Error('同じ文房具は 1 本だけ入れられます');
  }
  if (caseId !== undefined && (!has.has(caseId) || itemOf(caseId)?.type !== 'case'))
    throw new Error('持っていないペンケースです');
  if (refills !== undefined) {
    if (!refills || typeof refills !== 'object') throw new Error('芯の指定が不正です');
    for (const [id, rid] of Object.entries(refills))
      if (!has.has(id) || !itemOf(id)?.refills?.some((x) => x.id === rid)) throw new Error('その芯はありません');
  }
  return stationeryState({
    ...st,
    ...(slots !== undefined ? {slots} : {}),
    ...(caseId !== undefined ? {caseId} : {}),
    ...(refills !== undefined ? {refills: {...st.refills, ...refills}} : {})
  });
}

// 既製品の見た目の品（experimental）：メーカー（三菱鉛筆・ゼブラ・サクラクレパス）の許しを得ていない個人の試作。
// α 版（正式な公開の前）のあいだは、ふつうの品と同じようにショップに出し、3D モデルも配布物に入れる（SPEC §9.8）。
// 正式に公開する前に見直す：許しを得られなければ false にし、electron-builder.yml で GLB を除く。
// false にしても、すでに持っている人の筆箱には残る（stationeryState は品ぞろえにある品を外さない）
export const MAKER_ITEMS_LISTED = true;
/** ショップに出す品か */
export const listed = (item) => !item.experimental || MAKER_ITEMS_LISTED;

/** 円の表示（¥8,800） */
export const yen = (n) => `¥${Number(n).toLocaleString('ja-JP')}`;
/** 値段の表示。円の品は ¥、ポイントの品は pt、どちらも 0 なら「無料」 */
export const priceLabel = (item) =>
  item.price > 0 ? yen(item.price) : item.points > 0 ? `${item.points.toLocaleString('ja-JP')} pt` : '無料';

/**
 * 値段帯：札の見た目（背景）を変える。無料は白い札にグレーの枠、有料は値段が上がるほど上質な紙に
 * （daily：ふだん使い＝クリーム色、fine：ちょっといいもの＝シャンパンゴールド、premium：高級＝濃紺に金の文字）
 */
export const TIERS = [
  {id: 'free', label: 'ポイント', min: 0}, // 円で売らない品（ポイントの品・はじめから持っている品）
  {id: 'daily', label: 'ふだん使い', min: 1},
  {id: 'fine', label: 'ちょっといいもの', min: 1000},
  {id: 'premium', label: '高級', min: 5000}
];
export const tierOf = (price) => [...TIERS].reverse().find((t) => price >= t.min) ?? TIERS[0];

// ---- ショップの札：シリーズ（同じ品の色ちがい）----
// items の series が同じ品を 1 枚の札にまとめ、色は札の右下の丸で選ぶ。series のない品は 1 品で 1 枚
const SERIES_INFO = {
  'pen-05': {name: 'ボールペン 0.5'},
  'pen-038': {name: 'ボールペン 0.38'},
  'pen-07': {name: 'ボールペン 0.7'},
  'pen-art': {name: 'デザイン軸のボールペン'}, // 軸の色・柄で選ぶペン（インクの色ちがいの札と分ける）
  'pen-even': {name: '筆圧なしペン 0.5'}, // 筆圧で太さが変わらないペン
  jetstream: {name: 'ジェットストリーム 0.5'},
  sarasa: {name: 'サラサクリップ 0.5'},
  marker: {name: 'マーカー'},
  'marker-wide': {name: 'マーカー（太）'},
  hider: {name: '文字隠しペン'},
  'pencil-05': {name: 'シャープペンシル 0.5'},
  'pencil-03': {name: 'シャープペンシル 0.3'},
  'pencil-07': {name: 'シャープペンシル 0.7'}
};
/** 品のシリーズの id（series がなければ品の id） */
export const seriesIdOf = (item) => item.series ?? item.id;
/**
 * ショップに出すシリーズの一覧（品ぞろえの順）。各 {id, name, maker, type, items, price（いちばん安い品）, from（値段に幅があるか）}
 */
export function shopSeries(items = CATALOG) {
  const map = new Map();
  for (const it of items) {
    if (!listed(it)) continue;
    const sid = seriesIdOf(it);
    if (!map.has(sid))
      map.set(sid, {
        id: sid,
        name: SERIES_INFO[sid]?.name ?? it.name,
        maker: it.maker ?? '大学ノート',
        type: kindOf(it),
        items: []
      });
    map.get(sid).items.push(it);
  }
  for (const s of map.values()) {
    const prices = s.items.map((it) => it.price);
    s.price = Math.min(...prices);
    s.from = Math.max(...prices) !== s.price;
  }
  return [...map.values()];
}
/** 同じシリーズの品（色ちがい）。自分も含む */
export const siblingsOf = (item) => CATALOG.filter((it) => listed(it) && seriesIdOf(it) === seriesIdOf(item));

// ---- 見た目（SVG。画像ファイルを持たない）----

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
  if (item.art === 'model')
    return `${open.replace('<svg ', `<svg data-model="${esc(item.model)}" data-item="${esc(item.id)}" `)}${modelArt()}</svg>`;
  if (item.art === 'jetstream') return `${open}${jetstreamArt(item, g)}</svg>`;
  if (item.art === 'sarasa') return `${open}${sarasaArt(item, g)}</svg>`;
  if (item.type === 'pen') {
    const ridges = Array.from(
      {length: 12},
      (_, i) => `<rect x="${33 + i * 3.4}" y="8.2" width="1.2" height="11.6" fill="#000" opacity="0.13"/>`
    ).join('');
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
    const tag =
      item.type === 'hider'
        ? `<text x="120" y="${y + h / 2 + 3}" font-size="8.5" text-anchor="middle" fill="#1d3557" font-family="sans-serif" font-weight="700">隠</text>`
        : '';
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

/**
 * 3D モデルの品の絵：影の上に、モデルを横から描いた画像を置く（画像は renderer/model3d.js が GLB から描いて href に入れる。
 * 入るまでは影だけ）。横向き・左がペン先・上がクリップで、ほかの絵と同じ向き
 */
const modelArt = () =>
  `<ellipse cx="104" cy="23.5" rx="92" ry="2.2" fill="#000" opacity="0.12"/><image data-model-img x="0" y="0" width="200" height="28" preserveAspectRatio="xMidYMid meet"/>`;

// ---- 実験：既製品の見た目（個人の試作。写真を見ながら直す前提のおおよその形）----
const SHADOW = '<ellipse cx="104" cy="24.6" rx="94" ry="2" fill="#000" opacity="0.14"/>';
const TIP = (g, ink) =>
  `<path d="M1.2 14 L9.5 12.2 L9.5 15.8 Z" fill="url(#${g}-m)"/><circle cx="1.5" cy="14" r="0.85" fill="${ink}"/>`;

/** 油性のノック式（不透明の軸・黒いゴムのグリップに細かい粒・軸と同じ色のクリップ・白い文字） */
function jetstreamArt(item, g) {
  const dots = Array.from({length: 13}, (_, i) =>
    [9.6, 12.4, 15.2, 18]
      .map((y, j) => `<circle cx="${32 + i * 3.1 + (j % 2) * 1.5}" cy="${y}" r="0.55" fill="#000" opacity="0.55"/>`)
      .join('')
  ).join('');
  return `<defs>${tube(`${g}-b`, item.body)}${METAL(`${g}-m`)}${tube(`${g}-r`, '#26272a')}
      <linearGradient id="${g}-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9aa0a6" stop-opacity="0.8"/><stop offset="0.45" stop-color="#4a4d52" stop-opacity="0.55"/><stop offset="1" stop-color="#1c1d20" stop-opacity="0.85"/></linearGradient></defs>
    ${SHADOW}${TIP(g, item.color)}
    <path d="M9.5 11.5 L30 8.3 L30 19.7 L9.5 16.5 Z" fill="url(#${g}-f)"/>
    <rect x="12" y="13.5" width="18" height="1" fill="${item.color}" opacity="0.8"/>
    <rect x="30" y="7.9" width="42" height="12.2" rx="4" fill="url(#${g}-r)"/>${dots}
    <rect x="72" y="7.4" width="2.4" height="13.2" fill="url(#${g}-m)"/>
    <rect x="74.4" y="6.9" width="99" height="14.2" rx="3" fill="url(#${g}-b)"/>
    <rect x="78" y="9" width="92" height="1.4" rx="0.7" fill="#fff" opacity="0.35"/>
    <text x="84" y="17" font-size="6.2" font-style="italic" font-weight="700" letter-spacing="0.6" fill="#fff" opacity="0.92" font-family="Arial, Helvetica, sans-serif">JETSTREAM</text>
    <text x="134" y="17" font-size="4.4" fill="#fff" opacity="0.8" font-family="Arial, Helvetica, sans-serif">0.5</text>
    <path d="M173.4 7.6 L184 8.6 L184 19.4 L173.4 20.4 Z" fill="url(#${g}-b)"/>
    <rect x="184" y="9.2" width="13" height="9.6" rx="3.2" fill="url(#${g}-b)"/>
    <rect x="186" y="10.4" width="9" height="1.2" rx="0.6" fill="#fff" opacity="0.3"/>
    <path d="M132 6.9 H181 Q186 6.9 186 4.2 V3.4 Q186 1.6 184 1.6 H140 Q135 1.6 133.4 3.6 Z" fill="url(#${g}-b)" stroke="${shade(item.body, -0.4)}" stroke-width="0.4"/>
    <rect x="150" y="2.6" width="22" height="1.2" rx="0.6" fill="#fff" opacity="0.5"/>`;
}

/** ゲルのノック式（透明の軸の中に替え芯が見える・すけたグリップ・インクと同じ色の大きなクリップとノック） */
function sarasaArt(item, g) {
  const ridges = Array.from(
    {length: 14},
    (_, i) => `<rect x="${31 + i * 2.9}" y="8.4" width="0.9" height="11.2" fill="#6b7680" opacity="0.28"/>`
  ).join('');
  return `<defs>${METAL(`${g}-m`)}${tube(`${g}-c`, item.accent)}${tube(`${g}-i`, item.color)}
      <linearGradient id="${g}-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="0.2" stop-color="#eef3f6" stop-opacity="0.55"/><stop offset="0.6" stop-color="#d7e0e6" stop-opacity="0.35"/><stop offset="1" stop-color="#9aa8b2" stop-opacity="0.75"/></linearGradient>
      <linearGradient id="${g}-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f7f9" stop-opacity="0.9"/><stop offset="0.5" stop-color="#c9d3da" stop-opacity="0.55"/><stop offset="1" stop-color="#8d9aa4" stop-opacity="0.85"/></linearGradient></defs>
    ${SHADOW}${TIP(g, item.color)}
    <rect x="12" y="12.9" width="160" height="2.2" rx="1.1" fill="#e9edf0" stroke="#b7c1c8" stroke-width="0.3"/>
    <rect x="12" y="12.9" width="95" height="2.2" rx="1.1" fill="url(#${g}-i)"/>
    <rect x="166" y="12.4" width="10" height="3.2" rx="1" fill="#f7f7f7" stroke="#b7c1c8" stroke-width="0.3"/>
    <path d="M9.5 11.6 L30 8.5 L30 19.5 L9.5 16.4 Z" fill="url(#${g}-g)" stroke="#a5b0b8" stroke-width="0.35"/>
    <rect x="30" y="8" width="42" height="12" rx="4" fill="url(#${g}-g)" stroke="#a5b0b8" stroke-width="0.35"/>${ridges}
    <rect x="72" y="7" width="104" height="14" rx="3" fill="url(#${g}-b)" stroke="#a9b4bc" stroke-width="0.4"/>
    <rect x="76" y="8.6" width="96" height="1.4" rx="0.7" fill="#fff" opacity="0.9"/>
    <text x="88" y="19.4" font-size="5" font-weight="700" letter-spacing="0.8" fill="#4b5560" opacity="0.85" font-family="Arial, Helvetica, sans-serif">SARASA</text>
    <rect x="176" y="7.6" width="9" height="12.8" rx="1.5" fill="url(#${g}-c)"/>
    <rect x="185" y="9" width="12.5" height="10" rx="2.6" fill="url(#${g}-c)"/>
    <path d="M118 7 H178 Q186 7 186 3.6 V2.8 Q186 0.9 183.8 0.9 H126 Q120 0.9 118.6 3.4 Z" fill="url(#${g}-c)" stroke="${shade(item.accent, -0.35)}" stroke-width="0.4"/>
    <path d="M118 7 Q115.4 7 115.4 9.2" fill="none" stroke="${shade(item.accent, -0.2)}" stroke-width="1"/>
    <rect x="132" y="2" width="40" height="1.1" rx="0.55" fill="#fff" opacity="0.55"/>`;
}

/** ペンケースの絵。viewBox 0 0 200 80。3D モデルの品は、モデルを斜め上から描いた画像（renderer/model3d.js が入れる） */
export function caseArt(item) {
  const {style, base, trim} = item;
  const title = `<title>${esc(item.name)}</title>`;
  if (item.art === 'model')
    return `<svg class="st-art st-art--case" viewBox="0 0 200 80" role="img" data-model="${esc(item.model)}" data-item="${esc(item.id)}">${title}
      <ellipse cx="100" cy="74" rx="90" ry="4" fill="#000" opacity="0.10"/><image data-model-img x="0" y="0" width="200" height="80" preserveAspectRatio="xMidYMid meet"/></svg>`;
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
