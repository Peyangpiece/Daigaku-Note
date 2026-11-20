import {esc} from './html.js';
import {NOTEBOOKS, STARTER_NOTEBOOKS, MY_NOTES_MAX, cleanDesign, cleanMyNotes} from './notebooks.js';
// 文房具（SPEC §9.8・§15）：ボールペン・シャープペンシル・マーカー（アンダーライン用）・文字隠しペン・ペンケース。副作用なし。
// 品ぞろえはアプリに入っている（公式の品はアプリ内のポイントで買う〔POINTS。はじめから持っている品は 0〕。有料の棚の品〔アトリエ〕は円。発売前）。
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
export const TYPES = ['pen', 'pencil', 'marker', 'hider', 'case', 'pouch', 'calc', 'timer', 'notebook'];
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
  timer: 'タイマー',
  notebook: 'ノート'
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
  },
  cute: {
    short: 'パステル・ふっくら',
    material: 'やわらかいキルティング',
    build: '丸みのある袋。上のファスナーに飾りのチャーム、正面にワッペン',
    size: '約 160 × 40 × 100 mm'
  }
};
// ポーチの電卓・タイマー（形ごとに 1 つの GLB。色は GLB のまま）。note はショップの札の一言
const gadget = (id, type, name, model, note) => ({id, type, name, model, note, price: 0, art: 'model'});
// パステルの品（v0.27.7）：3D モデルを持たない 2D の絵の品（art: 'cute'）。toolArt・caseArt・cuteTimerArt が SVG で描く。
// motif は飾りの形（heart・star・cat・bunny・bear・cloud・ribbon・chick）。色はすべてパステル（CUTE_PASTEL のテスト）。
// ペンのインクの色は、紙の上で読めるように同じ色みを少し濃くしたもの（くすみパステル）
export const CUTE_MOTIFS = ['heart', 'star', 'cat', 'bunny', 'bear', 'cloud', 'ribbon', 'chick'];
const cutePen = (id, name, color, body, accent, motif) => ({
  id,
  type: 'pen',
  name,
  color,
  width: PEN_WIDTH['0.5'],
  mm: '0.5',
  body,
  accent,
  motif,
  price: 0,
  series: 'pen-cute',
  art: 'cute'
});
const cuteCase = (id, name, base, trim, motif) => ({
  id,
  type: 'case',
  name,
  style: 'cute',
  base,
  trim,
  motif,
  price: 0,
  series: 'case-cute',
  art: 'cute'
});
const cuteBag = (id, name, base, trim, motif) => ({
  id,
  type: 'pouch',
  name,
  style: 'cute',
  base,
  trim,
  motif,
  price: 0,
  series: 'pouch-cute',
  art: 'cute'
});
const cuteTimer = (id, name, base, trim, motif, note) => ({
  id,
  type: 'timer',
  name,
  base,
  trim,
  motif,
  note,
  price: 0,
  series: 'timer-cute',
  art: 'cute'
});
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
 * シャープペンシル（パレットノートのオリジナル。製図用の形）：書く道具としてはペン（type: 'pen'）。線は黒鉛の灰色で、
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
    build: '角の丸い浅い箱とかぶせぶた。後ろに蝶番、ふたに「パレットノート」の印刷',
    size: '約 197 × 65 × 26 mm'
  },
  leather: {
    short: 'シボ革・真ちゅうのファスナー',
    material: '革（自然なシボ）',
    build: 'ふっくらした箱形。真ちゅうのファスナー・両側の生成りのステッチ・革の引き手・型押しの「パレットノート」',
    size: '約 195 × 60 × 50 mm'
  },
  clear: {
    short: '透明・中が見える',
    material: '透明の樹脂',
    build: '平たいポーチ。色の付いた樹脂のファスナー。中のペンが外から見える',
    size: '約 205 × 34 × 84 mm'
  },
  cute: {
    short: 'パステル・どうぶつの耳',
    material: 'やわらかいフェルト',
    build: '丸みのある袋。上に耳、正面に顔の刺しゅう、パステルのファスナー',
    size: '約 200 × 60 × 80 mm'
  }
};
/**
 * 有料の棚のペン「アトリエ」（パレットノートのオリジナル。v0.27.0 で、既製品の見た目の試作から入れ替えた）。
 * 見た目は 3D モデル（scripts/pens3d/atelier.py。model は GLB の名前）。gel はゲルインク（少し太く濃い線）。
 * price は円（税込。発売前の仮の値段）。mm は字幅（既定 0.5）。note は軸の作りの短い説明
 */
const ATELIER = 'パレットノート アトリエ';
const atelier = (id, name, model, color, body, accent, price, note, {mm = '0.5', line = null, gel = false} = {}) => ({
  id,
  type: 'pen',
  name,
  color,
  width: gel ? 1.25 : (PEN_WIDTH[mm] ?? 1.1),
  mm,
  body,
  accent,
  price,
  maker: ATELIER,
  art: 'model',
  model,
  line, // ショップの説明の書く線（なければ「0.5 mm」のように字幅）
  note,
  series: model,
  atelier: true
});

// ボールペンの字幅（mm）→ 線の太さ（pt。1pt ≒ 0.35mm）。紙に書いた線の太さに近づける
const PEN_WIDTH = {0.38: 0.8, 0.5: 1.1, 0.7: 1.5, '1.0': 2};
// シャープペンシル 0.5 の線：芯の太さ（0.5mm ≒ 1.4pt）より少し細く、黒鉛の灰色
const SHARP = {color: '#4a4a4a', width: 1.3};
// シャープペンシルの芯の太さ（mm）→ 線の太さ（pt）。0.5 は SHARP と同じ
const PENCIL_WIDTH = {0.3: 0.9, 0.5: 1.3, 0.7: 1.7};

/**
 * アトリエの多機能ペン。refills の最初の芯で書き始める。
 * 各芯：{id, name, color, mm, width, sharp?}。item の color・width・mm は最初の芯のもの（筆箱の一覧の色などに使う）
 */
const multi = (id, name, {model, body, accent, refills, refill, price, note, featured = false}) => ({
  id,
  type: 'pen',
  name,
  color: refills[0].color,
  width: refills[0].width,
  mm: refills[0].mm,
  body,
  accent,
  price,
  featured, // ショップの上の帯に出す
  maker: ATELIER,
  art: 'model',
  model,
  refills,
  refill,
  note,
  atelier: true
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
  // パステルの品（2D の絵。v0.27.7）
  cutePen('pen-cute-heart', 'パステルペン ハート（いちごミルク）', '#cf6a90', '#f9cfe0', '#f4a9c4', 'heart'),
  cutePen('pen-cute-star', 'パステルペン ほし（レモン）', '#b5862e', '#fbefb0', '#f6d77c', 'star'),
  cutePen('pen-cute-cat', 'パステルペン ねこ（ラベンダー）', '#9579c9', '#e0d3f5', '#c3aeea', 'cat'),
  cutePen('pen-cute-bunny', 'パステルペン うさぎ（ミント）', '#3f9a7c', '#cdeee0', '#9ddbc3', 'bunny'),
  cutePen('pen-cute-cloud', 'パステルペン くも（そらいろ）', '#5590c9', '#cfe4f7', '#a6cbee', 'cloud'),
  cuteCase('case-cute-cat', 'ねこの筆箱（さくら）', '#f8cfdc', '#fff5f8', 'cat'),
  cuteCase('case-cute-bunny', 'うさぎの筆箱（ラベンダー）', '#ddd0f3', '#fbf8ff', 'bunny'),
  cuteCase('case-cute-bear', 'くまの筆箱（ピーチ）', '#fcd9c4', '#fff7f1', 'bear'),
  cuteCase('case-cute-chick', 'ひよこの筆箱（レモン）', '#fbeeb0', '#fffdf0', 'chick'),
  cuteBag('pouch-cute-heart', 'まるポーチ ハート（さくら）', '#f9d2df', '#fff4f7', 'heart'),
  cuteBag('pouch-cute-star', 'まるポーチ ほし（そらいろ）', '#cde3f6', '#f5faff', 'star'),
  cuteBag('pouch-cute-ribbon', 'まるポーチ リボン（ミント）', '#cbeedf', '#f3fcf8', 'ribbon'),
  cuteBag('pouch-cute-cloud', 'まるポーチ くも（ラベンダー）', '#e0d5f4', '#faf7ff', 'cloud'),
  // どうぶつタイマー（v0.27.10）：角の丸い四角の本体に耳と顔、液晶と「分」「秒」「▶」のボタン。編集画面のタイマーもこの形（desk-tools.js）
  cuteTimer('timer-cute-bear', 'くまタイマー（ピーチ）', '#fde6c9', '#fff3e4', 'bear', 'デジタル・くまの丸い耳'),
  cuteTimer('timer-cute-cat', 'ねこタイマー（さくら）', '#fcdcf0', '#fff0f9', 'cat', 'デジタル・ねこの耳とウインク'),
  cuteTimer('timer-cute-bunny', 'うさぎタイマー（ミント）', '#d0f6e4', '#ecfdf5', 'bunny', 'デジタル・うさぎの折れ耳'),
  cuteTimer(
    'timer-cute-chick',
    'ひよこタイマー（レモン）',
    '#fcf6c8',
    '#fffce6',
    'chick',
    'デジタル・ひよこのくちばし'
  ),
  // 有料の棚：アトリエ（オリジナルの形の、こだわりの軸。発売前。値段は仮）。書く線は、ふだん使いの 2 つは 0.5、
  // ほかは黒・中字相当の 1.0 にそろえる。クリップにインクの色の小さな粒（シリーズの印）
  atelier(
    'atelier-line-black',
    'アトリエ ライン 黒',
    'atelier-line',
    '#1f1f22',
    '#26282c',
    '#26282c',
    300,
    'アルミの細い軸・ノック式'
  ),
  atelier(
    'atelier-line-red',
    'アトリエ ライン 赤',
    'atelier-line',
    '#d0202e',
    '#a8232b',
    '#a8232b',
    300,
    'アルミの細い軸・ノック式'
  ),
  atelier(
    'atelier-clear-black',
    'アトリエ クリア 黒',
    'atelier-clear',
    '#141414',
    '#e8eef2',
    '#1b1b1b',
    250,
    '中の見える透明の軸・ノック式',
    {gel: true}
  ),
  atelier(
    'atelier-clear-red',
    'アトリエ クリア 赤',
    'atelier-clear',
    '#e4002b',
    '#e8eef2',
    '#b3162a',
    250,
    '中の見える透明の軸・ノック式',
    {gel: true}
  ),
  atelier(
    'atelier-flute',
    'アトリエ フルート（藍）',
    'atelier-flute',
    '#1f1f22',
    '#1e2a44',
    '#c9ccd1',
    1800,
    '縦の溝を彫ったつやのある軸・回転式',
    {mm: '1.0', line: '黒・中字相当'}
  ),
  atelier(
    'atelier-facet-brass',
    'アトリエ ファセット（真ちゅう）',
    'atelier-facet',
    '#1f1f22',
    '#c4a25a',
    '#d0d1d4',
    5800,
    '12 角の金属の軸・綾目の握り',
    {mm: '1.0', line: '黒・中字相当'}
  ),
  atelier(
    'atelier-facet-black',
    'アトリエ ファセット（ブラック）',
    'atelier-facet',
    '#1f1f22',
    '#1e1e20',
    '#2a2a2c',
    5200,
    '12 角の金属の軸・綾目の握り',
    {mm: '1.0', line: '黒・中字相当'}
  ),
  atelier(
    'atelier-wood',
    'アトリエ ウッド（くるみ）',
    'atelier-wood',
    '#1f1f22',
    '#6b4a32',
    '#c9ccd1',
    6800,
    'くるみの木の軸・ステンレスの握り',
    {mm: '1.0', line: '黒・中字相当'}
  ),
  atelier(
    'atelier-drop',
    'アトリエ ドロップ（深紅）',
    'atelier-drop',
    '#1f1f22',
    '#5a1220',
    '#d9b45a',
    9800,
    '葉巻の形のつやのある軸・金の金具・回転式',
    {mm: '1.0', line: '黒・中字相当'}
  ),
  // トリオ：回転式の 2&1（黒・赤のボールペンと 0.5 のシャープ）。替え芯は 4C 規格
  multi('atelier-trio', 'アトリエ トリオ', {
    model: 'atelier-trio',
    body: '#22304a',
    accent: '#c9b68f',
    refill: '4C',
    price: 8800,
    note: '太めの軸・回して芯を選ぶ',
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
  'timer-digital': 250,
  // パステルの品（v0.27.7）
  'pen-cute-heart': 250,
  'pen-cute-star': 250,
  'pen-cute-cat': 250,
  'pen-cute-bunny': 250,
  'pen-cute-cloud': 250,
  'case-cute-cat': 450,
  'case-cute-bunny': 450,
  'case-cute-bear': 450,
  'case-cute-chick': 450,
  'pouch-cute-heart': 350,
  'pouch-cute-star': 350,
  'pouch-cute-ribbon': 350,
  'pouch-cute-cloud': 350,
  'timer-cute-cat': 300,
  'timer-cute-bunny': 300,
  'timer-cute-bear': 300,
  'timer-cute-chick': 300
};
for (const it of CATALOG) it.points = POINTS[it.id] ?? 0;
// ノート（docs/SPEC-NOTEBOOK.md。品と値段は shared/notebooks.js）。ポイントは notebooks.js で決めてあるので、上の POINTS のあとに足す
CATALOG.push(...NOTEBOOKS);
const ITEMS = new Map(CATALOG.map((it) => [it.id, it]));
/**
 * 前の版（〜0.26.2）の、既製品の見た目の品の id → いまの品。持ち物・筆箱の場所・選んだ芯と太さ・注文の記録を引き継ぐ
 */
export const RENAMED = {
  'maker-jetstream-black': 'atelier-line-black',
  'maker-jetstream-red': 'atelier-line-red',
  'maker-sarasa-black': 'atelier-clear-black',
  'maker-sarasa-red': 'atelier-clear-red',
  'maker-caran-849-red': 'atelier-facet-brass',
  'maker-caran-849-black': 'atelier-facet-black',
  'maker-parker-jotter': 'atelier-flute',
  'maker-lamy-2000': 'atelier-drop',
  'maker-kaweco-special': 'atelier-wood',
  'maker-craftlab-004': 'atelier-trio'
};
/** いまの id（前の版の id は読み替える） */
export const currentId = (id) => RENAMED[id] ?? id;
export const itemOf = (id) => ITEMS.get(currentId(id)) ?? null;
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
  'pen-art': {name: '滑らか', note: '筆圧によく応え、なめらかに続く', th: 0.45, ts: 1.2, te: 1.5, st: 0.4, w: 1},
  // パステルペン：やわらかい書き味（筆圧に応えるが DN-3 より少し穏やかで、手ぶれ補正をやや強く）
  'pen-cute': {name: 'やわらか', note: 'ふんわり軽く、線がまるくまとまる', th: 0.38, ts: 1, te: 1.3, st: 0.45, w: 1},
  'pencil-05': {
    name: '鉛筆らしい',
    note: '筆圧で太さがよく変わる',
    th: 0.45,
    ts: 0.6,
    te: 0.9,
    st: 0.15,
    w: 1.18
  },
  // 書き味は筆圧の効き（th）0.45・入り（ts）1.2・抜き（te）1.5 を超えない（shared/ink.js の strokeOptions が抑える。v0.16.29）
  // 有料のペン（アトリエ）：軸と芯の性格から決める。筆記抵抗が小さい（よく滑る）ほど手ぶれ補正（st）を強め、抜き（te）を長く。
  // 抵抗が大きい（紙をとらえる）ほど入り・抜きを短くくっきり。インクの出がよく均一なものは太さの変化（th）を控えめに、線を濃く（w）
  // ライン：低粘度の油性。よく滑り、抜きが長くのびる
  'atelier-line': {name: '低粘度の油性', note: '軽く、抜きがのびる', th: 0.28, ts: 0.9, te: 1.5, st: 0.5, w: 1},
  // クリア：ゲルインク。濃く、入りから太い
  'atelier-clear': {name: 'ゲルインク', note: '濃く、入りから太い', th: 0.3, ts: 0.5, te: 0.8, st: 0.25, w: 1.14},
  // ファセット：重い金属の軸。適度な筆記抵抗で紙をしっかりとらえ、均一でしっかりした線
  // → 太さの変化は控えめ、入り・抜きは短め、手ぶれ補正は中くらい、線は濃いめ
  'atelier-facet': {
    name: 'しっかりした油性',
    note: 'インクの出がよく、適度な抵抗でしっかりした線',
    th: 0.24,
    ts: 0.7,
    te: 1,
    st: 0.3,
    w: 1.08
  },
  // フルート：低粘度でとてもなめらか。よく滑る（手ぶれ補正を強く、抜きを長く）
  'atelier-flute': {
    name: 'なめらかな油性',
    note: '低粘度でとてもなめらか、ダマになりにくい',
    th: 0.3,
    ts: 1.1,
    te: 1.5,
    st: 0.48,
    w: 1
  },
  // ドロップ：太い軸でなめらか。当たりのよい向き（縦の線）から外れると少し細くなるクセ（sw）
  'atelier-drop': {
    name: 'スイートスポット',
    note: 'なめらかでサラサラ。向きで線の太さにクセ',
    th: 0.36,
    ts: 1.1,
    te: 1.5,
    st: 0.42,
    w: 1.02,
    sw: 0.28
  },
  // ウッド：軽い木の軸と金属の握りで重心が低い。滑らかで安定し、筆圧の効きは控えめ
  'atelier-wood': {
    name: '軽く安定',
    note: '軽さと安定感、滑らかで疲れにくい',
    th: 0.28,
    ts: 0.9,
    te: 1.5,
    st: 0.44,
    w: 1
  },
  // トリオ（4C の芯）：顔料のゲルインクの細字。ペン先が紙をとらえる適度な手ごたえ（筆記抵抗）
  // → 入り・抜きは短くくっきり、手ぶれ補正は控えめ、ゲルで線は濃い。細かな手ごたえ（gr）を少し
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
  sharp: {name: '鉛筆らしい', note: '筆圧で太さがよく変わる', th: 0.45, ts: 0.6, te: 0.9, st: 0.15, w: 1.18}
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
/** 公式のボールペンの書き味の名前：硬い・普通・滑らか（パステルペンはやわらか）。ほかの品は null（ショップに出すのは公式のボールペンだけ） */
const OFFICIAL_FEEL = ['pen-even', 'pen-05', 'pen-art', 'pen-cute'];
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
export const STARTER = [...STARTER_SLOTS, ...Object.values(STARTER_GEAR), ...STARTER_NOTEBOOKS];
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
  const r0 = raw && typeof raw === 'object' ? raw : {};
  // 前の版の id（既製品の見た目の品）は、いまの品に読み替える
  const renameKeys = (o) =>
    o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [currentId(k), v])) : o;
  const r = {
    ...r0,
    owned: Array.isArray(r0.owned) ? r0.owned.map(currentId) : r0.owned,
    slots: Array.isArray(r0.slots) ? r0.slots.map(currentId) : r0.slots,
    refills: renameKeys(r0.refills),
    sizes: renameKeys(r0.sizes)
  };
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
  // ノート（v0.19.0）：マイノート（持っているノートをもとに調節して保存したもの）と、回のノートを作るときに最初に選ぶ紙
  const myNotes = cleanMyNotes(r.myNotes, owned);
  const noteDefault = noteKeyOk(r.noteDefault, has, myNotes) ? r.noteDefault : 'nb-b6';
  return {owned, slots, ...gear, refills, sizes, myNotes, noteDefault};
}

/** 紙の選び方の鍵が使えるか：持っているノート（nb-…）か、あるマイノート（my-…） */
function noteKeyOk(key, has, myNotes) {
  if (typeof key !== 'string') return false;
  if (key.startsWith('my-')) return myNotes.some((n) => n.id === key);
  return has.has(key) && itemOf(key)?.type === 'notebook';
}

/**
 * マイノートを保存する。id があれば上書き（なければ新しく作る）。base は持っているノート。戻り {stationery, id}。
 * 30 冊を超えるときは Error
 */
export function saveMyNote(raw, {id = null, name = '', base, design} = {}, {newId = null} = {}) {
  const st = stationeryState(raw);
  const item = itemOf(base);
  if (!item || item.type !== 'notebook') throw new Error('そのノートはありません');
  if (!st.owned.includes(base)) throw new Error(`${item.name} を持っていません`);
  const nm =
    String(name ?? '')
      .trim()
      .slice(0, 30) || item.name;
  const note = {name: nm, base, design: cleanDesign({...design, format: item.format})};
  let list = [...st.myNotes];
  let at = id ? list.findIndex((n) => n.id === id) : -1;
  if (at >= 0) list[at] = {...list[at], ...note};
  else {
    if (list.length >= MY_NOTES_MAX) throw new Error(`マイノートは ${MY_NOTES_MAX} 冊までです`);
    const nid = newId ?? `my-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    list = [...list, {id: nid, ...note}];
    at = list.length - 1;
  }
  return {stationery: stationeryState({...st, myNotes: list}), id: list[at].id};
}

/** マイノートを消す。既定の紙だったら、はじめの紙（横罫 B）に戻す */
export function removeMyNote(raw, id) {
  const st = stationeryState(raw);
  return stationeryState({...st, myNotes: st.myNotes.filter((n) => n.id !== id)});
}

/** 回のノートを作るときに最初に選ぶ紙（持っているノートかマイノート） */
export function setNoteDefault(raw, key) {
  const st = stationeryState(raw);
  if (!noteKeyOk(key, new Set(st.owned), st.myNotes)) throw new Error('その紙は選べません');
  return stationeryState({...st, noteDefault: key});
}

/**
 * 紙を選ぶメニューの並び：マイノート → 持っているノート。各 {key, label, design}。
 * design は回のノートの PDF にそのまま渡す（v3）
 */
export function notePapers(raw) {
  const st = stationeryState(raw);
  const mine = st.myNotes.map((n) => ({key: n.id, label: n.name, design: n.design, base: n.base}));
  const books = st.owned
    .map(itemOf)
    .filter((it) => it?.type === 'notebook')
    .map((it) => ({
      key: it.id,
      label: it.name.replace(/^Palette /, ''),
      design: cleanDesign({format: it.format}),
      base: it.id
    }));
  return [...mine, ...books];
}

/** 円もポイントも要らない品を入手する（カートを通らない近道。いまははじめから持っている品だけが当たる）。入手できなければ Error */
export function acquire(raw, id) {
  const st = stationeryState(raw);
  const item = itemOf(id);
  if (!item) throw new Error('その文房具はありません');
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

/**
 * 有料の品（円の値段の付いた品。買い切り）を売っているか。売り始めるまでは false：ショップでは「発売前」と出し、買えない
 * （v0.26.2。それまでは「デモ決済」で、請求のないまま手に入った。前に手に入れた品は、そのまま持っている）
 */
export const PAID_ON_SALE = false;
/** 有料の品か（お金で買う品。ポイントでは交換できない） */
export const isPaid = (it) => (it?.price ?? 0) > 0;
/** 前の版のデモ決済（注文の記録の表示に使う。いまは受け付けない） */
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
    if (!it) throw new Error('その文房具はありません');
    if (st.owned.includes(id)) throw new Error(`${it.name} はもう持っています`);
  }
  const items = list.map((id) => ({id, name: itemOf(id).name, price: itemOf(id).price, points: itemOf(id).points}));
  const total = items.reduce((sum, it) => sum + it.price, 0);
  const points = items.reduce((sum, it) => sum + it.points, 0);
  let pay = {method: points > 0 ? 'points' : 'free'}; // 円の支払いがない注文：ポイントだけ・無料だけ
  if (total > 0) {
    if (!PAID_ON_SALE) throw new Error('有料の品は発売前です。まだ購入できません');
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
  'atelier-line': {name: 'アトリエ ライン'},
  'atelier-clear': {name: 'アトリエ クリア'},
  'atelier-facet': {name: 'アトリエ ファセット'},
  'atelier-flute': {name: 'アトリエ フルート'},
  'atelier-drop': {name: 'アトリエ ドロップ'},
  'atelier-wood': {name: 'アトリエ ウッド'},
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
  'pouch-drum': {name: '筒形ポーチ'},
  'pen-cute': {name: 'パステルペン'},
  'case-cute': {name: 'どうぶつの筆箱'},
  'pouch-cute': {name: 'まるポーチ'},
  'timer-cute': {name: 'どうぶつタイマー'}
};
/** 品のシリーズの id（series がなければ品の id） */
export const seriesIdOf = (item) => item.series ?? item.id;
/**
 * ショップに出すシリーズの一覧（品ぞろえの順）。各 {id, name, maker, type, items, price（いちばん安い品）, from（値段に幅があるか）}
 */
export function shopSeries(items = CATALOG) {
  const map = new Map();
  for (const it of items) {
    const sid = seriesIdOf(it);
    if (!map.has(sid))
      map.set(sid, {
        id: sid,
        name: SERIES_INFO[sid]?.name ?? it.name,
        maker: it.maker ?? 'パレットノート',
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
export const siblingsOf = (item) => CATALOG.filter((it) => seriesIdOf(it) === seriesIdOf(item));

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
/**
 * 道具の絵。flat（v0.16.25。持ち物・ショップの一覧）：3D モデルを真横から、光・陰影・影なしの平らな塗りで描いた 2D の絵
 * （形・部品・色・印字はモデルのまま。renderer/model3d.js の flatFor）。下の影（楕円）も描かない
 */
export function toolArt(item, {label = true, shot = false, flat = false} = {}) {
  const title = label ? `<title>${esc(item.name)}</title>` : '';
  const g = `st-${item.id}`; // グラデーションの id（品ごと）
  const open = `<svg class="st-art st-art--${item.type === 'pen' ? 'pen' : 'marker'}" viewBox="0 0 200 28" aria-hidden="${label ? 'false' : 'true'}" role="img">${title}`;
  if (item.art === 'model' && flat)
    return `${open.replace('<svg ', `<svg data-model="${esc(item.model)}" data-item="${esc(item.id)}" data-flat-art="all" `)}${SHOT_IMG}</svg>`;
  if (item.art === 'model')
    return `${open.replace('<svg ', `<svg data-model="${esc(item.model)}" data-item="${esc(item.id)}"${shot ? ' data-model-shot="1"' : ''} `)}${shot ? SHOT_IMG : modelArt()}</svg>`;
  if (item.art === 'cute') return `${open}${cutePenArt(item, {flat: flat || shot})}</svg>`;
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
export function caseArt(item, {flat = false} = {}) {
  const {style, base, trim} = item;
  const title = `<title>${esc(item.name)}</title>`;
  // flat（v0.16.26。持ち物・ショップ）：3D モデルを光・陰影・影なしの平らな塗りで描いた 2D の絵（部品の輪郭線つき）。下の影も描かない
  if (item.art === 'model' && flat)
    return `<svg class="st-art st-art--case" viewBox="0 0 200 80" role="img" data-model="${esc(item.model)}" data-item="${esc(item.id)}" data-flat-art="all">${title}
      <image data-model-img x="0" y="0" width="200" height="80" preserveAspectRatio="xMidYMid meet"/></svg>`;
  if (item.art === 'model')
    return `<svg class="st-art st-art--case" viewBox="0 0 200 80" role="img" data-model="${esc(item.model)}" data-item="${esc(item.id)}">${title}
      <ellipse cx="100" cy="74" rx="90" ry="4" fill="#000" opacity="0.10"/><image data-model-img x="0" y="0" width="200" height="80" preserveAspectRatio="xMidYMid meet"/></svg>`;
  if (item.art === 'cute') {
    const body =
      item.type === 'timer'
        ? `<svg x="46" y="0" width="108" height="80" viewBox="${TIMER_BOX}">${cuteTimerDevice(item)}</svg>`
        : item.type === 'pouch'
          ? cuteBagBody(item)
          : cuteCaseBody(item);
    return `<svg class="st-art st-art--case st-art--cute" viewBox="0 0 200 80" role="img">${title}${flat ? '' : '<ellipse cx="100" cy="76" rx="84" ry="3.5" fill="#000" opacity="0.08"/>'}${body}</svg>`;
  }
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

// ---- パステルの品の絵（art: 'cute'。v0.27.7）----
// 3D モデルを持たず、ここで SVG に描く。顔の目・ほおだけは読めるように濃い色・ピンクにする
const EYE = '#5b4b57';
const CHEEK = '#f5a3b8';
const n1 = (v) => Math.round(v * 100) / 100;

/** 飾りの形（中心 cx・cy、半径 r）。fill で塗り、line で縁どる */
export function motifSvg(motif, cx, cy, r, fill, line = shade(fill, -0.25)) {
  const sw = n1(Math.max(0.5, r * 0.09));
  const g = (body) =>
    `<g transform="translate(${n1(cx)} ${n1(cy)}) scale(${n1(r)})" stroke="${line}" stroke-width="${n1(sw / r)}" stroke-linejoin="round">${body}</g>`;
  const eyes = (y = 0.05, dx = 0.32, er = 0.1) =>
    `<circle cx="${-dx}" cy="${y}" r="${er}" fill="${EYE}" stroke="none"/><circle cx="${dx}" cy="${y}" r="${er}" fill="${EYE}" stroke="none"/>` +
    `<ellipse cx="${-dx - 0.18}" cy="${y + 0.28}" rx="0.16" ry="0.1" fill="${CHEEK}" stroke="none" opacity="0.8"/><ellipse cx="${dx + 0.18}" cy="${y + 0.28}" rx="0.16" ry="0.1" fill="${CHEEK}" stroke="none" opacity="0.8"/>`;
  switch (motif) {
    case 'heart':
      return g(
        `<path d="M0 0.82 C-0.95 0.18 -1.02 -0.55 -0.52 -0.78 C-0.22 -0.9 0 -0.68 0 -0.45 C0 -0.68 0.22 -0.9 0.52 -0.78 C1.02 -0.55 0.95 0.18 0 0.82Z" fill="${fill}"/>`
      );
    case 'star': {
      const pts = Array.from({length: 10}, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = i % 2 ? 0.45 : 1;
        return `${n1(Math.cos(a) * k)},${n1(Math.sin(a) * k + 0.08)}`;
      }).join(' ');
      return g(`<polygon points="${pts}" fill="${fill}"/>`);
    }
    case 'cloud':
      return g(
        `<path d="M-0.62 0.5 C-1.05 0.5 -1.05 -0.08 -0.62 -0.1 C-0.6 -0.58 0.02 -0.72 0.22 -0.32 C0.6 -0.5 1.02 -0.2 0.86 0.14 C1.08 0.3 0.98 0.5 0.7 0.5 Z" fill="${fill}"/>`
      );
    case 'ribbon':
      return g(
        `<path d="M0 0 L-0.95 -0.55 Q-1.05 0 -0.95 0.55 Z" fill="${fill}"/><path d="M0 0 L0.95 -0.55 Q1.05 0 0.95 0.55 Z" fill="${fill}"/>` +
          `<path d="M-0.12 0.1 L-0.4 0.9 L-0.15 0.8 Z M0.12 0.1 L0.4 0.9 L0.15 0.8 Z" fill="${fill}"/><circle r="0.24" fill="${shade(fill, -0.08)}"/>`
      );
    case 'cat':
      return g(
        `<path d="M-0.82 -0.2 L-0.7 -1 L-0.18 -0.66 Z M0.82 -0.2 L0.7 -1 L0.18 -0.66 Z" fill="${fill}"/><circle cy="0.08" r="0.82" fill="${fill}"/>` +
          eyes() +
          `<path d="M-0.14 0.36 Q-0.07 0.46 0 0.36 Q0.07 0.46 0.14 0.36" fill="none" stroke="${EYE}"/>`
      );
    case 'bunny':
      return g(
        `<ellipse cx="-0.32" cy="-0.9" rx="0.2" ry="0.55" fill="${fill}"/><ellipse cx="0.32" cy="-0.9" rx="0.2" ry="0.55" fill="${fill}"/>` +
          `<ellipse cx="-0.32" cy="-0.9" rx="0.08" ry="0.36" fill="${CHEEK}" stroke="none" opacity="0.6"/><ellipse cx="0.32" cy="-0.9" rx="0.08" ry="0.36" fill="${CHEEK}" stroke="none" opacity="0.6"/>` +
          `<circle cy="0.12" r="0.78" fill="${fill}"/>` +
          eyes(0.12) +
          `<path d="M-0.08 0.42 L0 0.48 L0.08 0.42" fill="none" stroke="${EYE}"/>`
      );
    case 'bear':
      return g(
        `<circle cx="-0.62" cy="-0.6" r="0.32" fill="${fill}"/><circle cx="0.62" cy="-0.6" r="0.32" fill="${fill}"/><circle cy="0.08" r="0.82" fill="${fill}"/>` +
          `<ellipse cy="0.36" rx="0.3" ry="0.22" fill="#fffaf4"/>` +
          eyes(0) +
          `<ellipse cy="0.3" rx="0.09" ry="0.06" fill="${EYE}" stroke="none"/>`
      );
    case 'chick':
      return g(
        `<path d="M-0.08 -0.78 Q0 -1.1 0.12 -0.85 Q0.2 -1.08 0.24 -0.76" fill="none"/><circle cy="0.05" r="0.84" fill="${fill}"/>` +
          eyes(0) +
          `<path d="M-0.14 0.22 L0.14 0.22 L0 0.42 Z" fill="#f7b98c"/>`
      );
    default:
      return g(`<circle r="0.8" fill="${fill}"/>`);
  }
}

/**
 * パステルペン（viewBox 0 0 200 28。左がペン先）。ほかのボールペンの 2D の絵（3D モデル pen-ballpoint を真横から平らに塗り、
 * 部品ごとに暗い輪郭線を引いたもの。renderer/model3d-three.js の withFlat）と同じ形・比率・部品・印字で描く。
 * 部品：金属のペン先・円すいの先（accent）・溝のあるグリップ・白い輪・軸（body。「PALETTE NOTE」と字幅の印字）・
 * 白いクリップ・クリップの付け根（accent）・金属の輪・ノック（accent）。飾り（motif）は軸の印字の左に小さく刷る。
 * グリップは、ほかのペン（accent を暗くした色）とちがい、パステルのまま少しだけ濃くする
 */
function cutePenArt(item, {flat = false} = {}) {
  const {body, accent} = item;
  const line = (c) => shade(c, -0.45); // 部品の輪郭（部品の色を暗くした色。3D の平らな絵の輪郭と同じ考え）
  const sw = 'stroke-width="0.32" stroke-linejoin="round"';
  const grip = shade(accent, -0.14);
  const metal = '#e9eaec';
  const ribs = Array.from(
    {length: 22},
    (_, i) => `<path d="M${n1(24.2 + i * 1.56)} 6.95 V21.05" stroke="${shade(grip, -0.22)}" stroke-width="0.22"/>`
  ).join('');
  const font = `font-family="'Gill Sans','Gill Sans MT',Calibri,'Trebuchet MS',sans-serif" font-size="3" fill="#3a3438"`;
  return `${flat ? '' : '<ellipse cx="104" cy="24.5" rx="92" ry="2" fill="#000" opacity="0.1"/>'}
    <path d="M3.9 12.5 Q3.1 12.6 3.1 14 Q3.1 15.4 3.9 15.5 L8.5 16.1 V11.9 Z" fill="${metal}" stroke="${line(metal)}" ${sw}/>
    <path d="M8.5 11.9 L22.9 6.75 V21.25 L8.5 16.1 Z" fill="${accent}" stroke="${line(accent)}" ${sw}/>
    <rect x="22.9" y="6.75" width="35.85" height="14.5" fill="${grip}" stroke="${line(grip)}" ${sw}/>${ribs}
    <rect x="58.75" y="6.3" width="2.3" height="15.4" rx="0.3" fill="#f6f6f6" stroke="${line('#f6f6f6')}" ${sw}/>
    <rect x="61.05" y="6.5" width="112" height="14.8" fill="${body}" stroke="${line(body)}" ${sw}/>
    ${motifSvg(item.motif, 98.5, 13.9, 1.7, accent, line(accent))}
    <text x="115.4" y="15.05" text-anchor="middle" ${font}>PALETTE NOTE</text>
    <text x="147.2" y="15.05" text-anchor="middle" ${font}>${esc(item.mm ?? '0.5')}</text>
    <rect x="173.05" y="6.9" width="10" height="14.1" rx="0.6" fill="${accent}" stroke="${line(accent)}" ${sw}/>
    <rect x="183.05" y="8.8" width="1.35" height="10.6" fill="#f2f2f2" stroke="${line('#f2f2f2')}" ${sw}/>
    <rect x="184.4" y="9.4" width="12.1" height="9.4" rx="1.5" fill="${accent}" stroke="${line(accent)}" ${sw}/>
    <path d="M122 6.6 V4.6 Q122 4.1 122.6 4.1 H124.9 Q125.6 4.1 125.6 4.8 V5.6 L178.8 5.7 Q181.2 5.9 181.9 7.7 L180.3 7.9 Q179.6 6.9 178.4 6.9 L125.6 6.9 Z" fill="#f7f7f7" stroke="${line('#f7f7f7')}" ${sw}/>`;
}

/** どうぶつの筆箱（viewBox 0 0 200 80。上に耳、正面に顔） */
function cuteCaseBody(item) {
  const {base, trim, motif} = item;
  const line = shade(base, -0.2);
  const sw = `stroke="${line}" stroke-width="1.4" stroke-linejoin="round"`;
  const ears = {
    cat: `<path d="M36 28 L44 4 L68 22 Z M164 28 L156 4 L132 22 Z" fill="${base}" ${sw}/><path d="M44 22 L46 11 L58 20 Z M156 22 L154 11 L142 20 Z" fill="${CHEEK}" opacity="0.6"/>`,
    bunny: `<ellipse cx="74" cy="16" rx="9" ry="16" fill="${base}" ${sw} transform="rotate(-10 74 16)"/><ellipse cx="126" cy="16" rx="9" ry="16" fill="${base}" ${sw} transform="rotate(10 126 16)"/><ellipse cx="74" cy="16" rx="3.5" ry="10" fill="${CHEEK}" opacity="0.55" transform="rotate(-10 74 16)"/><ellipse cx="126" cy="16" rx="3.5" ry="10" fill="${CHEEK}" opacity="0.55" transform="rotate(10 126 16)"/>`,
    bear: `<circle cx="50" cy="20" r="12" fill="${base}" ${sw}/><circle cx="150" cy="20" r="12" fill="${base}" ${sw}/><circle cx="50" cy="20" r="6" fill="${trim}"/><circle cx="150" cy="20" r="6" fill="${trim}"/>`,
    chick: `<path d="M94 20 Q96 6 102 14 Q106 4 108 18" fill="none" ${sw}/>`
  };
  const mouth =
    motif === 'chick'
      ? `<path d="M95 54 L105 54 L100 61 Z" fill="#f7b98c" stroke="${shade('#f7b98c', -0.2)}" stroke-width="0.8"/>`
      : motif === 'bear'
        ? `<ellipse cx="100" cy="57" rx="11" ry="7.5" fill="${trim}" stroke="${line}" stroke-width="1"/><ellipse cx="100" cy="54.5" rx="3" ry="2" fill="${EYE}"/>`
        : `<path d="M95 55 Q97.5 58.5 100 55 Q102.5 58.5 105 55" fill="none" stroke="${EYE}" stroke-width="1.4" stroke-linecap="round"/>`;
  return `${ears[motif] ?? ''}
    <rect x="8" y="18" width="184" height="58" rx="28" fill="${base}" ${sw}/>
    <path d="M30 28 H170" stroke="${trim}" stroke-width="4" stroke-linecap="round"/><path d="M30 28 H170" stroke="${line}" stroke-width="1.2" stroke-dasharray="2 2.4"/>
    ${motifSvg('heart', 174, 34, 5, trim, line)}
    <circle cx="86" cy="48" r="3.4" fill="${EYE}"/><circle cx="114" cy="48" r="3.4" fill="${EYE}"/>
    <circle cx="87.2" cy="46.8" r="1" fill="#fff"/><circle cx="115.2" cy="46.8" r="1" fill="#fff"/>
    <ellipse cx="74" cy="56" rx="7" ry="4" fill="${CHEEK}" opacity="0.75"/><ellipse cx="126" cy="56" rx="7" ry="4" fill="${CHEEK}" opacity="0.75"/>
    ${mouth}`;
}

/** まるポーチ（viewBox 0 0 200 80。キルティングの袋・ファスナーのチャーム・正面のワッペン） */
function cuteBagBody(item) {
  const {base, trim, motif} = item;
  const line = shade(base, -0.2);
  const quilt = [40, 70, 100, 130, 160]
    .map((x) => `<path d="M${x - 22} 74 L${x + 22} 20 M${x + 22} 74 L${x - 22} 20" />`)
    .join('');
  return `<clipPath id="cb-${esc(item.id)}"><path d="M14 32 Q14 16 32 16 H168 Q186 16 186 32 V58 Q186 76 166 76 H34 Q14 76 14 58 Z"/></clipPath>
    <path d="M14 32 Q14 16 32 16 H168 Q186 16 186 32 V58 Q186 76 166 76 H34 Q14 76 14 58 Z" fill="${base}" stroke="${line}" stroke-width="1.4"/>
    <g clip-path="url(#cb-${esc(item.id)})" stroke="${trim}" stroke-width="1.1" opacity="0.8" stroke-dasharray="3 2.5" fill="none">${quilt}</g>
    <path d="M24 24 H176" stroke="${trim}" stroke-width="4.5" stroke-linecap="round"/><path d="M24 24 H176" stroke="${line}" stroke-width="1.2" stroke-dasharray="2 2.4"/>
    <rect x="160" y="20" width="7" height="10" rx="2.5" fill="${trim}" stroke="${line}" stroke-width="1"/>
    <path d="M163.5 30 V38" stroke="${line}" stroke-width="1"/>
    ${motifSvg(motif, 163.5, 44, 7, trim, line)}
    <circle cx="100" cy="50" r="17" fill="${trim}" stroke="${line}" stroke-width="1.2" stroke-dasharray="2.5 2"/>
    ${motifSvg(motif, 100, 50, 11, shade(base, -0.06), line)}`;
}

// ---- どうぶつタイマー（v0.27.10）----
// 正面から見た 2D の絵（viewBox 0 0 140 104）。横長の角の丸い四角の本体（一段高い面つき）に、上の角の小さな耳・目と口、
// 白っぽい大きな液晶、下に「分」「秒」「▶」の小さな丸いボタン。ショップ・ポーチの絵と、編集画面で動くタイマー（desk-tools.js）は同じ絵
export const TIMER_BOX = '0 0 140 104';
/** 液晶とボタンの場所（編集画面のタイマーが、絵の上に押せるボタンを重ねるのに使う） */
export const TIMER_PARTS = {
  lcd: {x: 29, y: 38, w: 82, h: 36},
  buttons: {min: {cx: 42, cy: 88, r: 7.5}, sec: {cx: 70, cy: 88, r: 7.5}, go: {cx: 102, cy: 88, r: 7.5}}
};
const TIMER_EARS = {
  bear: (f, l) =>
    `<circle cx="26" cy="16" r="7.5" fill="${f}" stroke="${l}" stroke-width="1"/><circle cx="114" cy="16" r="7.5" fill="${f}" stroke="${l}" stroke-width="1"/>`,
  cat: (f, l) =>
    `<path d="M16 22 L22 4 L38 15 Z M124 22 L118 4 L102 15 Z" fill="${f}" stroke="${l}" stroke-width="1" stroke-linejoin="round"/>` +
    `<path d="M22 15 L23.5 9 L30 13.5 Z M118 15 L116.5 9 L110 13.5 Z" fill="${shade(CHEEK, 0.2)}" opacity="0.8"/>`,
  // うさぎ：左の耳は立ち、右の耳は折れて頭にかかる
  bunny: (f, l) =>
    `<ellipse cx="48" cy="13.5" rx="6" ry="12.5" fill="${f}" stroke="${l}" stroke-width="1" transform="rotate(-8 48 13.5)"/>` +
    `<ellipse cx="48" cy="13" rx="2.4" ry="7.5" fill="${CHEEK}" opacity="0.4" transform="rotate(-8 48 13)"/>`,
  chick: () => ''
};
/** 頭の上にかかる部品（本体の上に描く）：うさぎの折れた耳 */
const TIMER_OVER = {
  bunny: (f, l) =>
    `<path d="M62 18 C64 7 76 3 84 6 C89 8 86 13 80 14 C74 15 68 17 66 22 Z" fill="${f}" stroke="${l}" stroke-width="1" stroke-linejoin="round"/>` +
    `<path d="M67 15 C70 9 77 7 81 8.5" fill="none" stroke="${CHEEK}" stroke-width="2" stroke-linecap="round" opacity="0.45"/>`
};
/**
 * どうぶつタイマーの絵（<svg> の中身。viewBox は TIMER_BOX）。clock は液晶の字、running なら ▶ の代わりに一時停止の印。
 * 液晶の字（data-timer-lcd）と ▶ の印（data-timer-go-icon）は、編集画面のタイマーが書き換える
 */
export function cuteTimerDevice(item, {clock = '25:00', running = false} = {}) {
  const {base, trim, motif} = item;
  const line = shade(base, -0.45);
  const plate = trim ?? shade(base, 0.35);
  const btn = '#ffffff';
  const btnLine = '#6d6a70';
  const ink = '#3c3b40';
  const {lcd, buttons: b} = TIMER_PARTS;
  const button = ({cx, cy, r}, label) =>
    `<circle cx="${cx}" cy="${cy + 0.9}" r="${r}" fill="${shade(base, -0.18)}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${btn}" stroke="${btnLine}" stroke-width="0.8"/>${label}`;
  const text = (x, y, t) =>
    `<text x="${x}" y="${y}" text-anchor="middle" font-size="6.5" fill="${ink}" font-family="'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif">${t}</text>`;
  const goIcon = running
    ? `<g data-timer-go-icon fill="${ink}"><rect x="${b.go.cx - 2.6}" y="${b.go.cy - 2.8}" width="1.9" height="5.6" rx="0.5"/><rect x="${b.go.cx + 0.7}" y="${b.go.cy - 2.8}" width="1.9" height="5.6" rx="0.5"/></g>`
    : `<g data-timer-go-icon fill="${ink}"><path d="M${b.go.cx - 1.9} ${b.go.cy - 3} L${b.go.cx + 3} ${b.go.cy} L${b.go.cx - 1.9} ${b.go.cy + 3} Z"/></g>`;
  const dot = (x) => `<circle cx="${x}" cy="27" r="1.9" fill="${ink}"/>`;
  const omega = `<path d="M66.6 27.4 Q68.3 30.4 70 27.8 Q71.7 30.4 73.4 27.4" fill="none" stroke="${ink}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>`;
  const face = {
    // ねこ：左目をつぶってウインク
    cat: `<path d="M48 27.2 H54 M51.5 25 L54 27.2" fill="none" stroke="${ink}" stroke-width="1.1" stroke-linecap="round"/>${dot(89)}${omega}`,
    chick: `${dot(55)}${dot(85)}<path d="M70 24.6 L74 27.6 L70 30.6 L66 27.6 Z M66 27.6 H74" fill="#ffc9a3" stroke="${ink}" stroke-width="0.8" stroke-linejoin="round"/>`
  };
  return `${(TIMER_EARS[motif] ?? TIMER_EARS.bear)(base, line)}
    <rect x="4" y="14" width="132" height="86" rx="22" fill="${shade(base, -0.07)}" stroke="${line}" stroke-width="1"/>
    <rect x="4.5" y="14.5" width="131" height="82" rx="21.5" fill="${base}"/>
    <rect x="9" y="18.5" width="122" height="74" rx="18" fill="${plate}" opacity="0.55"/>
    ${(TIMER_OVER[motif] ?? (() => ''))(base, line)}
    ${face[motif] ?? `${dot(52)}${dot(88)}${omega}`}
    <rect x="${lcd.x}" y="${lcd.y}" width="${lcd.w}" height="${lcd.h}" rx="9" fill="#fbfbf8" stroke="#a5a3a8" stroke-width="1"/>
    <text data-timer-lcd x="70" y="${lcd.y + 25}" text-anchor="middle" font-size="22" font-weight="700" fill="#2c2d30" font-family="'SF Pro Rounded','Hiragino Maru Gothic ProN','Arial Rounded MT Bold','Helvetica Neue',Arial,sans-serif">${esc(clock)}</text>
    ${button(b.min, text(b.min.cx, b.min.cy + 2.3, '分'))}
    ${button(b.sec, text(b.sec.cx, b.sec.cy + 2.3, '秒'))}
    ${button(b.go, goIcon)}`;
}

/** どうぶつタイマーの絵（ポーチの隅。viewBox 0 0 56 40） */
export const cuteTimerArt = (item) =>
  `<svg viewBox="0 0 56 40" aria-hidden="true"><svg x="1" y="0" width="54" height="40" viewBox="${TIMER_BOX}">${cuteTimerDevice(item)}</svg></svg>`;
