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
export const TYPES = ['pen', 'pencil', 'marker', 'hider', 'case', 'pouch', 'calc', 'timer'];
export const TOOL_TYPES = ['pen', 'marker', 'hider'];
export const TOOL_KINDS = ['pen', 'pencil', 'marker', 'hider'];
export const TYPE_LABEL = {
  pen: 'ボールペン',
  pencil: 'シャープペンシル',
  marker: 'マーカー',
  hider: '文字隠しペン',
  case: 'ペンケース',
  pouch: 'ポーチ',
  calc: '電卓',
  timer: 'タイマー'
};
/**
 * 1 つだけ選んで使う持ち物（ペンケース・ポーチ・ポーチの電卓とタイマー）。種類 → 選んだ品を覚える設定の名前。
 * 筆箱の 6 本（道具）とちがい、持っている中から 1 つを選ぶ
 */
export const GEAR = {case: 'caseId', pouch: 'pouchId', calc: 'calcId', timer: 'timerId'};
export const isGear = (item) => !!GEAR[item?.type];
/** 品の種類（シャープペンシルは 'pencil'、ほかは type） */
export const kindOf = (item) => (item?.pencil ? 'pencil' : item?.type);
/** 品ぞろえ（CATALOG）の外の 3D モデル：消しゴム（筆箱の横にいつもある道具）とポーチの道具の絵 */
export const EXTRA_MODELS = ['eraser', 'tool-sheet', 'tool-calc', 'tool-memo', 'tool-ruler', 'tool-timer'];
// ポーチ（ポーチの道具を入れる袋）も 3D モデル（形の種類ごとの GLB：pouch-flat・pouch-box・pouch-gama・pouch-drum）。
// ペンケースと同じく CaseBase・CaseTrim を base・trim で塗る
const bag = (id, name, style, base, trim, series = undefined) => ({
  id,
  type: 'pouch',
  name,
  style,
  base,
  trim,
  price: 0,
  art: 'model',
  model: `pouch-${style}`,
  ...(series ? {series} : {})
});
/** ポーチの説明（形の種類ごと。寸法は scripts/pens3d/build.py。長さ × 幅 × 高さ）。short はショップの札の一言 */
export const POUCH_INFO = {
  flat: {
    short: '帆布・平たい',
    material: '帆布（太い綿糸の平織り）',
    build: '平たい長方形の袋。上にコイルのファスナー、端に輪のタブ、正面の織りネーム',
    size: '約 190 × 26 × 125 mm'
  },
  box: {
    short: 'マチ付き・自立する',
    material: 'ナイロン',
    build: '底の広い箱形（立てて置ける）。上のファスナー、両端の持ち手のループ',
    size: '約 175 × 85 × 95 mm'
  },
  gama: {
    short: 'がま口・金の口金',
    material: '帆布（太い綿糸の平織り）',
    build: 'ふっくらした袋に、金色の口金と玉の留め具',
    size: '約 150 × 62 × 105 mm'
  },
  drum: {
    short: '筒形・手首のひも',
    material: 'ナイロン',
    build: '横に寝かせた円筒。上のファスナー、両端の縁取り、手首のひも',
    size: '約 170 × 72 × 72 mm'
  }
};
// ポーチの電卓・タイマー（形ごとに 1 つの GLB。色は GLB のまま）。note はショップの札の一言
const gadget = (id, type, name, model, note) => ({id, type, name, model, note, price: 0, art: 'model'});
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
// ペンケースも 3D モデル（形の種類ごとの GLB：case-pouch・case-tin・case-leather・case-clear。色は base・trim で塗る）。
// 同じ形の色ちがい（帆布の筆箱）は series でまとめ、ショップでは 1 枚の札にする
const pencase = (id, name, style, base, trim, series = undefined) => ({
  id,
  type: 'case',
  name,
  style,
  base,
  trim,
  price: 0,
  art: 'model',
  model: `case-${style}`,
  ...(series ? {series} : {})
});
/**
 * ペンケースの説明（形の種類ごと。寸法は scripts/pens3d/build.py の 3D モデルの寸法。長さ × 幅 × 高さ）。
 * short はショップの札の一言
 */
export const CASE_INFO = {
  pouch: {
    short: '帆布・ファスナー',
    material: '帆布（太い綿糸の平織り）',
    build: '舟形の袋。コイルのファスナー・両端の縁取り・輪のタブ・正面の織りネーム',
    size: '約 200 × 72 × 62 mm'
  },
  tin: {
    short: '金属の缶・かぶせぶた',
    material: '金属（塗装した缶）',
    build: '角の丸い浅い箱とかぶせぶた。後ろに蝶番、ふたに「大学ノート」の印刷',
    size: '約 197 × 65 × 26 mm'
  },
  leather: {
    short: 'シボ革・真ちゅうのファスナー',
    material: '革（自然なシボ）',
    build: 'ふっくらした箱形。真ちゅうのファスナー・両側の生成りのステッチ・革の引き手・型押しの「大学ノート」',
    size: '約 195 × 60 × 50 mm'
  },
  clear: {
    short: '透明・中が見える',
    material: '透明の樹脂',
    build: '平たいポーチ。色の付いた樹脂のファスナー。中のペンが外から見える',
    size: '約 205 × 34 × 84 mm'
  }
};
/**
 * 既製品の見た目のペン（実験）。実物の寸法で作った 3D モデル（scripts/pens3d/makers.py）で描く。art は形の種類
 * （jetstream・sarasa は前の絵の名前。3D モデルの名前に読み替える）。ゲルインク（サラサ）は少し太く濃い線。
 * price はその品の定価（税込）。mm は字幅（既定 0.5）
 */
const MAKER_MODEL = {jetstream: 'jetstream', sarasa: 'sarasa-clip'};
const maker = (id, name, makerName, art, color, body, accent, price, series, {mm = '0.5', line = null} = {}) => ({
  id,
  type: 'pen',
  name,
  color,
  width: art === 'sarasa' ? 1.25 : (PEN_WIDTH[mm] ?? 1.1),
  mm,
  body,
  accent,
  price,
  maker: makerName,
  art: 'model',
  model: MAKER_MODEL[art] ?? art,
  line, // ショップの説明の書く線（なければ「0.5 mm」のように字幅）
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
  // 公式のボールペンは 3 つの型番（v0.16.23）：DN-1 硬い（筆圧なし。pen-even）・DN-2 普通（インクの色ちがい。pen-05）・
  // DN-3 滑らか（軸の色・柄で選ぶ。pen-art）。名前に字幅は入れない（太さは 0.3・0.5・0.7 から選ぶ）。id は前の版のまま
  pen('pen-black-05', '黒のボールペン', '#222222', '0.5', '#2c2d30', '#55575c'),
  pen('pen-red-05', '赤のボールペン', '#d93025', '0.5', '#c9262c', '#7d1a1e'),
  pen('pen-blue-05', '青のボールペン', '#1a5fd0', '0.5', '#1f4fb3', '#183a7f'),
  pen('pen-green-05', '緑のボールペン', '#188038', '0.5', '#f2f2f0'),
  pen('pen-blueblack-05', 'ブルーブラックのボールペン', '#1f3a5f', '0.5', '#dfe6ee'),
  pen('pen-sepia-05', 'セピアのボールペン', '#6b4423', '0.5', '#efe3d3'),
  pen('pen-pink-05', 'ピンクのボールペン', '#d6457a', '0.5', '#fbe3ec'),
  pen('pen-orange-05', 'オレンジのボールペン', '#e37400', '0.5', '#fdebd3'),
  pen('pen-purple-05', '紫のボールペン', '#7b3fbf', '0.5', '#ece2f7'),
  pen('pen-sakura-05', 'さくら軸 黒', '#222222', '0.5', '#f7c5d5', '#e98aa8', 'pen-art'),
  pen('pen-mint-05', 'ミント軸 青', '#1a5fd0', '0.5', '#bfe8dc', '#5fbfa3', 'pen-art'),
  pen('pen-wood-07', '木軸 黒', '#222222', '0.7', '#c89b6d', '#8a6440', 'pen-art', {model: 'pen-ballpoint-wood'}),
  pen('pen-navy-038', 'ネイビー軸 赤', '#d93025', '0.38', '#24365c', '#c9a227', 'pen-art', {trim: 'gold'}),
  pen('pen-black-038', 'グレー軸 黒', '#222222', '0.38', '#3b3b3b', '#222222', 'pen-art'),
  pen('pen-black-07', 'クリーム軸 黒', '#222222', '0.7', '#e6e2d8', '#222222', 'pen-art'),
  evenPen('pen-even-black-05', '筆圧なし 黒', '#222222', '#f1f1ee', '#222222'),
  evenPen('pen-even-red-05', '筆圧なし 赤', '#d93025', '#f1f1ee', '#d93025'),
  evenPen('pen-even-blue-05', '筆圧なし 青', '#1a5fd0', '#f1f1ee', '#1a5fd0'),
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
  // シャープペンシル：名前に芯の太さは入れない（太さは 0.3・0.5・0.7 から選ぶ）。前の 0.3・0.7 は色ちがいとして 1 つのシリーズに
  pencil('pencil-black-05', 'シャープペンシル（黒）', '0.5', '#2c2d30', '#55575c'),
  pencil('pencil-silver-05', 'シャープペンシル（銀）', '0.5', '#c9ced6', '#55575c'),
  pencil('pencil-navy-05', 'シャープペンシル（紺）', '0.5', '#24365c', '#55575c'),
  pencil('pencil-black-03', 'シャープペンシル（黒・赤ライン）', '0.3', '#2c2d30', '#7d1a1e', 'pencil-05'),
  pencil('pencil-black-07', 'シャープペンシル（黒・青ライン）', '0.7', '#2c2d30', '#183a7f', 'pencil-05'),
  pencase('case-canvas-navy', '帆布の筆箱（紺）', 'pouch', '#2e3f66', '#d9d2c3', 'case-pouch'),
  pencase('case-tin-silver', '缶ペンケース（銀）', 'tin', '#c9ced6', '#8a929e', 'case-tin'),
  pencase('case-leather-brown', '革のペンケース（茶）', 'leather', '#8a5a3b', '#e8c9a0', 'case-leather'),
  pencase('case-pastel-pink', '帆布の筆箱（桃）', 'pouch', '#f6c9d6', '#ffffff', 'case-pouch'),
  pencase('case-sage', '帆布の筆箱（くすみグリーン）', 'pouch', '#a9bfa8', '#f3efe4', 'case-pouch'),
  pencase('case-clear', 'クリアケース', 'clear', '#e9f3f8', '#9fb7c4', 'case-clear'),
  pencase('case-canvas-mustard', '帆布の筆箱（からし）', 'pouch', '#c9a23a', '#f4ecd8', 'case-pouch'),
  pencase('case-canvas-gray', '帆布の筆箱（グレー）', 'pouch', '#7d828a', '#e9e6df', 'case-pouch'),
  pencase('case-canvas-black', '帆布の筆箱（黒）', 'pouch', '#2b2b2e', '#c9c3b6', 'case-pouch'),
  pencase('case-tin-red', '缶ペンケース（赤）', 'tin', '#c2352f', '#e7e2da', 'case-tin'),
  pencase('case-tin-mint', '缶ペンケース（ミント）', 'tin', '#9fd8c6', '#ffffff', 'case-tin'),
  pencase('case-tin-black', '缶ペンケース（黒）', 'tin', '#2a2c30', '#c9a35a', 'case-tin'),
  pencase('case-leather-black', '革のペンケース（黒）', 'leather', '#26272a', '#d8d2c6', 'case-leather'),
  pencase('case-leather-camel', '革のペンケース（キャメル）', 'leather', '#b07a45', '#f1dfc0', 'case-leather'),
  pencase('case-leather-navy', '革のペンケース（紺）', 'leather', '#2c3a5c', '#e3d6bf', 'case-leather'),
  pencase('case-clear-blue', 'クリアケース（青）', 'clear', '#b9d8f2', '#3d7bc4', 'case-clear'),
  pencase('case-clear-pink', 'クリアケース（桃）', 'clear', '#f6d3df', '#d9608a', 'case-clear'),
  // ポーチ（4 つの形）と、ポーチの電卓・タイマー（2 つずつ）
  bag('pouch-flat-navy', 'フラットポーチ（紺）', 'flat', '#2e4a7a', '#e9e2d0', 'pouch-flat'),
  bag('pouch-flat-mustard', 'フラットポーチ（からし）', 'flat', '#c9a23a', '#f4ecd8', 'pouch-flat'),
  bag('pouch-flat-gray', 'フラットポーチ（グレー）', 'flat', '#7d828a', '#e9e6df', 'pouch-flat'),
  bag('pouch-flat-pink', 'フラットポーチ（桃）', 'flat', '#efb6c6', '#ffffff', 'pouch-flat'),
  bag('pouch-box-pink', 'マチ付きポーチ（桃）', 'box', '#e7a7b8', '#fff3f6', 'pouch-box'),
  bag('pouch-box-navy', 'マチ付きポーチ（紺）', 'box', '#2c3a5c', '#d9d2c3', 'pouch-box'),
  bag('pouch-box-mint', 'マチ付きポーチ（ミント）', 'box', '#9fd8c6', '#ffffff', 'pouch-box'),
  bag('pouch-box-black', 'マチ付きポーチ（黒）', 'box', '#2a2b2f', '#e05a4f', 'pouch-box'),
  bag('pouch-gama-red', 'がま口ポーチ（赤）', 'gama', '#b33a3a', '#f2e4c9', 'pouch-gama'),
  bag('pouch-gama-navy', 'がま口ポーチ（紺）', 'gama', '#2c3a5c', '#e9e2d0', 'pouch-gama'),
  bag('pouch-gama-mustard', 'がま口ポーチ（からし）', 'gama', '#c9a23a', '#f4ecd8', 'pouch-gama'),
  bag('pouch-gama-green', 'がま口ポーチ（深緑）', 'gama', '#2f5d4a', '#efe6d2', 'pouch-gama'),
  bag('pouch-drum-gray', '筒形ポーチ（グレー）', 'drum', '#6b7480', '#f2c14e', 'pouch-drum'),
  bag('pouch-drum-navy', '筒形ポーチ（紺）', 'drum', '#2c3a5c', '#f2f0ea', 'pouch-drum'),
  bag('pouch-drum-red', '筒形ポーチ（赤）', 'drum', '#c2352f', '#f2f0ea', 'pouch-drum'),
  bag('pouch-drum-white', '筒形ポーチ（白）', 'drum', '#efeee9', '#3d7bc4', 'pouch-drum'),
  gadget('calc-standard', 'calc', '電卓', 'tool-calc', '濃い灰色・ふつうのキー'),
  gadget('calc-card', 'calc', 'カード電卓', 'tool-calc-card', '薄いパステル・丸いキー'),
  gadget('timer-stopwatch', 'timer', 'ストップウォッチ', 'tool-timer', '金属のケース・針'),
  gadget('timer-digital', 'timer', 'デジタルタイマー', 'tool-timer-digital', 'ミントの本体・液晶'),
  // 既製品の見た目のペン（試作。メーカーの許しを得ていないので、正式な公開の前に見直す。
  // α 版のあいだはショップに出す：MAKER_ITEMS_LISTED）
  // 値段は各メーカーの参考価格・希望小売価格（税込。2026 年 10 月に確かめた）
  maker(
    'maker-jetstream-black',
    'ジェットストリーム 黒',
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
    'ジェットストリーム 赤',
    '三菱鉛筆',
    'jetstream',
    '#d0202e',
    '#c8102e',
    '#121214',
    165,
    'jetstream'
  ),
  maker('maker-sarasa-black', 'サラサクリップ 黒', 'ゼブラ', 'sarasa', '#141414', '#e8eef2', '#1b1b1b', 110, 'sarasa'),
  maker('maker-sarasa-red', 'サラサクリップ 赤', 'ゼブラ', 'sarasa', '#e4002b', '#e8eef2', '#e4002b', 110, 'sarasa'),
  // 輸入の筆記具（定価は各社・正規販売店の希望小売価格。2026 年 11 月に確かめた）。書く線は黒・中字（M）相当の 1.0 にそろえる
  // （出荷時の替え芯は時期・店で違うことがあるため、アプリでは決めた 1 つにする）
  // ピンクゴールドは 849 プレミアム（ブリュットロゼ）の形（ヘアラインのアルマイトの軸・つやのある金属のクリップとノックの頭）。
  // id は 0.16.0 のレッドのまま（持っている人の持ち物と筆箱の場所を残すため）。値段は販売店の税込価格（定価の公表は見つからず）
  maker(
    'maker-caran-849-red',
    'カランダッシュ 849 プレミアム ボールペン（ピンクゴールド）',
    'カランダッシュ',
    'caran-849-premium',
    '#1f1f22',
    '#d7b4a0',
    '#d9a88c',
    6490,
    'caran-849',
    {mm: '1.0', line: '黒・中字（M）相当'}
  ),
  maker(
    'maker-caran-849-black',
    'カランダッシュ 849 ボールペン（ブラック）',
    'カランダッシュ',
    'caran-849',
    '#1f1f22',
    '#1c1c1e',
    '#1c1c1e',
    5280,
    'caran-849',
    {mm: '1.0', line: '黒・中字（M）相当'}
  ),
  maker(
    'maker-parker-jotter',
    'パーカー ジョッター コアライン ボンドストリートブラック CT',
    'パーカー',
    'parker-jotter',
    '#1f1f22',
    '#2a2a2c',
    '#e8e8e8',
    2750,
    'parker-jotter',
    {mm: '1.0', line: '黒・中字（M）相当'}
  ),
  maker(
    'maker-lamy-2000',
    'LAMY 2000 ボールペン',
    'LAMY',
    'lamy-2000',
    '#1f1f22',
    '#2a2a2b',
    '#c9ccd1',
    14300,
    'lamy-2000',
    {mm: '1.0', line: '黒・中字（M）相当'}
  ),
  maker(
    'maker-kaweco-special',
    'カヴェコ スペシャル ボールペン（ブラック）',
    'カヴェコ',
    'kaweco-special',
    '#1f1f22',
    '#1e1e20',
    '#1e1e20',
    9900,
    'kaweco-special',
    {mm: '1.0', line: '黒・中字（M）相当'}
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
  'case-clear': 500,
  'case-canvas-mustard': 400,
  'case-canvas-gray': 400,
  'case-canvas-black': 400,
  'case-tin-red': 400,
  'case-tin-mint': 400,
  'case-tin-black': 400,
  'case-leather-black': 600,
  'case-leather-camel': 600,
  'case-leather-navy': 600,
  'case-clear-blue': 500,
  'case-clear-pink': 500,
  'pouch-flat-mustard': 300,
  'pouch-flat-gray': 300,
  'pouch-flat-pink': 300,
  'pouch-box-pink': 400,
  'pouch-box-navy': 400,
  'pouch-box-mint': 400,
  'pouch-box-black': 400,
  'pouch-gama-red': 500,
  'pouch-gama-navy': 500,
  'pouch-gama-mustard': 500,
  'pouch-gama-green': 500,
  'pouch-drum-gray': 400,
  'pouch-drum-navy': 400,
  'pouch-drum-red': 400,
  'pouch-drum-white': 400,
  'calc-card': 250,
  'timer-digital': 250
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
/**
 * ペンの太さ（v0.16.22）：どのペンも 0.3・0.5・0.7 から選ぶ（設定 stationery.sizes に、ペンごとに残す）。
 * 線の太さ（pt）は、選んだ太さの基準（ボールペンの線）に、書き味の濃さ（w：ゲルインク・鉛筆は少し太い）を掛ける
 */
export const PEN_SIZES = ['0.3', '0.5', '0.7'];
const SIZE_WIDTH = {0.3: 0.75, 0.5: 1.1, 0.7: 1.5};
/** 品のはじめの太さ：字幅に近いもの（0.38 → 0.3、1.0 → 0.7） */
export const defaultSize = (item) => {
  const mm = Number(item?.refill?.mm ?? item?.mm ?? 0.5);
  return PEN_SIZES.reduce((a, b) => (Math.abs(Number(b) - mm) < Math.abs(Number(a) - mm) ? b : a), '0.5');
};
/**
 * 書き味（型番ごと。同じ型番の色ちがいは同じ書き味）。th・ts・te・st は shared/ink.js の feel、w は線の濃さ（太さの倍率）。
 * name は書き味の名前（公式のボールペンはショップに「書き味：硬い」のように出す）、note は一言のメモ
 */
export const FEELS = {
  // 公式のボールペン：書き味は 3 段階（硬い＝筆圧なし・普通・滑らか）。普通は前の版の線と同じ
  'pen-even': {name: '硬い', note: '筆圧で太さが変わらない', th: 0, ts: 0, te: 0, st: 0.3, w: 1},
  'pen-05': {name: '普通', note: '筆圧にほどよく応える', th: 0.35, ts: 1.2, te: 1.5, st: 0.2, w: 1},
  'pen-art': {name: '滑らか', note: '筆圧で大きく太り、入りと抜きが長い', th: 0.6, ts: 2, te: 2.6, st: 0.4, w: 1},
  'pencil-05': {
    name: '鉛筆らしい',
    note: '筆圧で濃さと太さが大きく変わる',
    th: 0.55,
    ts: 0.6,
    te: 0.9,
    st: 0.15,
    w: 1.18
  },
  // 有料のペン（v0.16.24）：各品の書き味の特徴から決める。筆記抵抗が小さい（よく滑る）ほど手ぶれ補正（st）を強め、抜き（te）を長く。
  // 抵抗が大きい（紙をとらえる）ほど入り・抜きを短くくっきり。インクの出がよく均一なものは太さの変化（th）を控えめに、線を濃く（w）
  // 低粘度油性：ヌルヌルとよく滑り、抜きが長くのびる
  jetstream: {name: '低粘度の油性', note: '軽く、抜きが長くのびる', th: 0.28, ts: 0.9, te: 2.2, st: 0.5, w: 1},
  sarasa: {name: 'ゲルインク', note: '濃く、入りから太い', th: 0.3, ts: 0.5, te: 0.8, st: 0.25, w: 1.14},
  // カランダッシュ 849：伝統的な油性だがインクの出がとてもよく、なめらか。低粘度のような滑りすぎはなく、適度な筆記抵抗で
  // 紙をしっかりとらえ、鉛筆のようなしっかりした線。芯の 5 本の溝でインクが均一に出て、ボタ落ち・カスレが起きにくい
  // → 太さの変化は控えめ（均一）、入り・抜きは短め（紙をとらえる）、手ぶれ補正は中くらい、線は濃いめ。ゆらぎなし
  'caran-849': {
    name: '伝統の油性',
    note: 'インクの出がよく、適度な抵抗でしっかりした線',
    th: 0.24,
    ts: 0.7,
    te: 1,
    st: 0.3,
    w: 1.08
  },
  // パーカー ジョッター：低粘度の油性インク（クインクフロー）。非常に滑らかで、ダマになりにくいサラサラした書き味
  // → よく滑る（手ぶれ補正を強く、抜きを長く）。インクが均一なので太さの変化は中くらい、ゆらぎなし
  'parker-jotter': {
    name: 'クインクフロー',
    note: '低粘度で非常に滑らか、ダマになりにくい',
    th: 0.3,
    ts: 1.1,
    te: 2,
    st: 0.48,
    w: 1
  },
  // LAMY 2000：なめらかでサラサラだが、特有のクセ（スイートスポット）がある
  // → よく滑る（手ぶれ補正を強め、抜きを長め）。当たりのよい向き（縦の線）から外れると少し細くなる（sw）
  'lamy-2000': {
    name: 'スイートスポット',
    note: 'なめらかでサラサラ。向きで線の太さにクセ',
    th: 0.36,
    ts: 1.1,
    te: 1.7,
    st: 0.42,
    w: 1.02,
    sw: 0.28
  },
  'kaweco-special': {name: 'きびきび', note: '入りが短く、止めがはっきり', th: 0.3, ts: 0.6, te: 1, st: 0.22, w: 1},
  // サクラクラフトラボ 004（4C の芯）：水性顔料ゲルインク。サラサラとスムーズで静か。0.4mm の細字で、ペン先が紙をとらえる
  // 適度なカリカリ感（筆記抵抗）。インクの出がよく、にじみにくい
  // → 入り・抜きは短くくっきり（紙をとらえる）、手ぶれ補正は控えめ（抵抗）、ゲルで線は濃い。細かな手ごたえ（gr）を少し
  '4C': {
    name: '顔料ゲル',
    note: 'サラサラ滑らかで、細字のカリカリした手ごたえ',
    th: 0.3,
    ts: 0.55,
    te: 0.85,
    st: 0.25,
    w: 1.12,
    gr: 0.06
  },
  sharp: {name: '鉛筆らしい', note: '筆圧で濃さと太さが大きく変わる', th: 0.55, ts: 0.6, te: 0.9, st: 0.15, w: 1.18}
};
const hashOf = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/** 型番の鍵：多機能ペンは芯の規格（品の refill。シャープの芯は sharp）、ほかはシリーズ（なければ id） */
function feelKey(item, refill) {
  if (refill) return refill.sharp ? 'sharp' : (itemOf(item.id)?.refill ?? item.id);
  return item?.series || item?.id;
}
/** その品（と芯）の書き味。表にない型番は、鍵から決まった値にする（同じ型番ならいつも同じ） */
export function penFeel(item, refill = null) {
  const key = feelKey(item, refill);
  if (FEELS[key]) return FEELS[key];
  const h = hashOf(key);
  const pick = (lo, hi, n) => Math.round((lo + (((h >>> n) % 100) / 100) * (hi - lo)) * 100) / 100;
  return {
    name: 'ふつう',
    note: '',
    th: pick(0.25, 0.45, 0),
    ts: pick(0.8, 1.6, 3),
    te: pick(1, 2, 6),
    st: pick(0.15, 0.4, 9),
    w: 1
  };
}
/** 公式のボールペンの書き味（3 段階）の名前：硬い・普通・滑らか。ほかの品は null（ショップに出すのは公式のボールペンだけ） */
const OFFICIAL_FEEL = ['pen-even', 'pen-05', 'pen-art'];
export const feelLabel = (item) => (OFFICIAL_FEEL.includes(item?.series) ? FEELS[item.series].name : null);
/** 線の太さ（pt）：選んだ太さ × 書き味の濃さ */
export const sizeWidth = (size, feel) =>
  Math.round((SIZE_WIDTH[size] ?? SIZE_WIDTH['0.5']) * (feel?.w ?? 1) * 100) / 100;

/**
 * 持って書くときのペン：多機能ペンは選んだ芯の色にした品（refill に芯）。太さは選んだ太さ（size。なければ品のはじめの太さ）、
 * 書き味（feel）は型番のもの。ペンでない道具（マーカー・文字隠し）はそのまま
 */
export function heldPen(item, refillId, size = null) {
  const r = refillOf(item, refillId);
  const base = r ? {...item, color: r.color, width: r.width, mm: r.mm, refill: r} : item;
  if (item?.type !== 'pen') return base;
  const s = PEN_SIZES.includes(size) ? size : defaultSize(base);
  const f = penFeel(item, r);
  return {
    ...base,
    size: s,
    width: sizeWidth(s, f),
    feel: {th: f.th, ts: f.ts, te: f.te, st: f.st, ...(f.sw ? {sw: f.sw} : {}), ...(f.gr ? {gr: f.gr} : {})}
  };
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
/** はじめから持っているポーチと、ポーチの電卓・タイマー（GEAR の種類ごと） */
export const STARTER_GEAR = {
  case: STARTER_CASE,
  pouch: 'pouch-flat-navy',
  calc: 'calc-standard',
  timer: 'timer-stopwatch'
};
export const STARTER = [...STARTER_SLOTS, ...Object.values(STARTER_GEAR)];
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
  // 1 つだけ選んで使う持ち物（ペンケース・ポーチ・電卓・タイマー）：持っていてその種類の品なら、選んだもの。なければはじめの品
  const gear = Object.fromEntries(
    Object.entries(GEAR).map(([type, key]) => [
      key,
      has.has(r[key]) && itemOf(r[key]).type === type ? r[key] : STARTER_GEAR[type]
    ])
  );
  const refills = {};
  if (r.refills && typeof r.refills === 'object')
    for (const [id, rid] of Object.entries(r.refills)) {
      const it = itemOf(id);
      if (has.has(id) && it?.refills?.some((x) => x.id === rid)) refills[id] = rid;
    }
  // ペンの太さ（v0.16.22）：{ペンの id: '0.3' | '0.5' | '0.7'}。持っているペンだけ
  const sizes = {};
  if (r.sizes && typeof r.sizes === 'object')
    for (const [id, s] of Object.entries(r.sizes))
      if (has.has(id) && itemOf(id)?.type === 'pen' && PEN_SIZES.includes(s)) sizes[id] = s;
  return {owned, slots, ...gear, refills, sizes};
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
export function arrange(raw, {slots, refills, sizes, ...picked} = {}) {
  const st = stationeryState(raw);
  const has = new Set(st.owned);
  if (slots !== undefined) {
    if (!Array.isArray(slots) || slots.length !== SLOTS) throw new Error('筆箱の中身が不正です');
    for (const id of slots)
      if (id !== null && (!has.has(id) || !isTool(id))) throw new Error('持っていない文房具は入れられません');
    if (new Set(slots.filter(Boolean)).size !== slots.filter(Boolean).length)
      throw new Error('同じ文房具は 1 本だけ入れられます');
  }
  // ペンケース・ポーチ・電卓・タイマー（caseId・pouchId・calcId・timerId）
  const gear = {};
  for (const [type, key] of Object.entries(GEAR)) {
    const id = picked[key];
    if (id === undefined) continue;
    if (!has.has(id) || itemOf(id)?.type !== type) throw new Error(`持っていない${TYPE_LABEL[type]}です`);
    gear[key] = id;
  }
  if (refills !== undefined) {
    if (!refills || typeof refills !== 'object') throw new Error('芯の指定が不正です');
    for (const [id, rid] of Object.entries(refills))
      if (!has.has(id) || !itemOf(id)?.refills?.some((x) => x.id === rid)) throw new Error('その芯はありません');
  }
  if (sizes !== undefined) {
    if (!sizes || typeof sizes !== 'object') throw new Error('太さの指定が不正です');
    for (const [id, s] of Object.entries(sizes))
      if (!has.has(id) || itemOf(id)?.type !== 'pen' || !PEN_SIZES.includes(s)) throw new Error('その太さは選べません');
  }
  return stationeryState({
    ...st,
    ...(slots !== undefined ? {slots} : {}),
    ...gear,
    ...(refills !== undefined ? {refills: {...st.refills, ...refills}} : {}),
    ...(sizes !== undefined ? {sizes: {...st.sizes, ...sizes}} : {})
  });
}

// 既製品の見た目の品（experimental）：メーカー（三菱鉛筆・ゼブラ・サクラクレパス・カランダッシュ・パーカー・LAMY・カヴェコ）の
// 許しを得ていない個人の試作。
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
  'pen-even': {name: 'ボールペン DN-1'}, // 書き味：硬い（筆圧なし。太さが変わらない）
  'pen-05': {name: 'ボールペン DN-2'}, // 書き味：普通（インクの色ちがい）
  'pen-art': {name: 'ボールペン DN-3'}, // 書き味：滑らか（軸の色・柄で選ぶ）
  jetstream: {name: 'ジェットストリーム'},
  sarasa: {name: 'サラサクリップ'},
  'caran-849': {name: 'カランダッシュ 849 ボールペン'},
  'parker-jotter': {name: 'パーカー ジョッター'},
  'lamy-2000': {name: 'LAMY 2000 ボールペン'},
  'kaweco-special': {name: 'カヴェコ スペシャル ボールペン'},
  marker: {name: 'マーカー'},
  'marker-wide': {name: 'マーカー（太）'},
  hider: {name: '文字隠しペン'},
  'pencil-05': {name: 'シャープペンシル'},
  'case-pouch': {name: '帆布の筆箱'},
  'case-tin': {name: '缶ペンケース'},
  'case-leather': {name: '革のペンケース'},
  'case-clear': {name: 'クリアケース'},
  'pouch-flat': {name: 'フラットポーチ'},
  'pouch-box': {name: 'マチ付きポーチ'},
  'pouch-gama': {name: 'がま口ポーチ'},
  'pouch-drum': {name: '筒形ポーチ'}
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
export function toolArt(item, {label = true, shot = false} = {}) {
  const title = label ? `<title>${esc(item.name)}</title>` : '';
  const g = `st-${item.id}`; // グラデーションの id（品ごと）
  const open = `<svg class="st-art st-art--${item.type === 'pen' ? 'pen' : 'marker'}" viewBox="0 0 200 28" aria-hidden="${label ? 'false' : 'true'}" role="img">${title}`;
  if (item.art === 'model')
    return `${open.replace('<svg ', `<svg data-model="${esc(item.model)}" data-item="${esc(item.id)}"${shot ? ' data-model-shot="1"' : ''} `)}${shot ? SHOT_IMG : modelArt()}</svg>`;
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
/** ショップの一覧の札（shot）：3D 表示から切り取った画像だけ（影の楕円は描かない。縦横比は画像が入ったときに合わせる） */
const SHOT_IMG = '<image data-model-img x="0" y="0" width="200" height="28" preserveAspectRatio="xMidYMid meet"/>';
const modelArt = () =>
  `<ellipse cx="104" cy="23.5" rx="92" ry="2.2" fill="#000" opacity="0.12"/><image data-model-img x="0" y="0" width="200" height="28" preserveAspectRatio="xMidYMid meet"/>`;

/**
 * 消しゴムの絵（筆箱の横）。viewBox 0 0 64 28。3D モデル（eraser）を斜め上から描いた画像を入れる（renderer/model3d.js）。
 * 入るまで・描けないときは、平らな絵（data-model-flat）を見せる
 */
export function eraserArt() {
  return `<svg viewBox="0 0 64 28" aria-hidden="true" data-model="eraser"><g data-model-flat><rect x="2" y="5" width="40" height="18" rx="3" fill="#fbfbf8" stroke="#c9c6bd"/><rect x="26" y="4" width="36" height="20" rx="2" fill="#2f6fb5"/><rect x="30" y="9" width="28" height="10" rx="1" fill="#fff" opacity="0.9"/></g><image data-model-img x="0" y="0" width="64" height="28" preserveAspectRatio="xMidYMid meet"/></svg>`;
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
