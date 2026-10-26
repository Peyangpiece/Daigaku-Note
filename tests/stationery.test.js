import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG,
  SLOTS,
  STARTER,
  STARTER_CASE,
  STARTER_SLOTS,
  acquire,
  arrange,
  cartPoints,
  cartTotal,
  caseArt,
  fadesUnderRedSheet,
  hiderColorOk,
  itemOf,
  needsRedSheet,
  priceLabel,
  purchase,
  shopSeries,
  siblingsOf,
  stationeryState,
  tierOf,
  toolArt,
  yen
} from '../src/shared/stationery.js';

test('品ぞろえ：id は重ならず、公式の品はポイント（はじめの品は 0）、既製品の見た目の品は定価（税込）。文字隠しペンは赤の成分が 0 の色だけ', () => {
  assert.equal(new Set(CATALOG.map((it) => it.id)).size, CATALOG.length);
  for (const it of CATALOG) {
    assert.ok(Number.isInteger(it.price) && it.price >= 0, it.id);
    assert.ok(Number.isInteger(it.points) && it.points >= 0, it.id);
    if (!it.maker) {
      assert.equal(it.price, 0, `${it.id} は円では売らない`);
      if (STARTER.includes(it.id)) assert.equal(it.points, 0, `${it.id} ははじめから持っている`);
      else assert.ok(it.points > 0, `${it.id} はポイントで買う`);
    } else assert.equal(it.points, 0, `${it.id} は円で買う`);
    assert.equal(
      priceLabel(it),
      it.price ? yen(it.price) : it.points ? `${it.points.toLocaleString('ja-JP')} pt` : '無料'
    );
    if (it.type === 'hider') assert.ok(hiderColorOk(it.color), it.id);
    if (it.type === 'pen' || it.type === 'marker') assert.ok(it.width > 0 && /^#[0-9a-f]{6}$/.test(it.color), it.id);
  }
  assert.ok(hiderColorOk('#00d2ff'));
  assert.ok(!hiderColorOk('#ff9ec7'));
  assert.ok(!hiderColorOk('#000000'), '暗い色は下の字が読めない');
  // 定価：三菱鉛筆の参考価格 ¥165、ゼブラの希望小売価格 ¥110、サクラクレパス ¥8,800（2026 年 10 月）
  assert.equal(itemOf('maker-jetstream-black').price, 165);
  assert.equal(itemOf('maker-sarasa-red').price, 110);
  assert.equal(itemOf('maker-craftlab-004').price, 8800);
  assert.equal(priceLabel(itemOf('maker-craftlab-004')), '¥8,800');
  assert.equal(priceLabel(itemOf('case-leather-brown')), '600 pt');
  assert.equal(priceLabel(itemOf('pen-black-05')), '無料', 'はじめの品');
});

test('値段帯：無料・ふだん使い（¥1〜）・ちょっといいもの（¥1,000〜）・高級（¥5,000〜）で札の紙が変わる', () => {
  assert.equal(tierOf(0).id, 'free');
  assert.equal(tierOf(110).id, 'daily');
  assert.equal(tierOf(999).id, 'daily');
  assert.equal(tierOf(1000).id, 'fine');
  assert.equal(tierOf(8800).id, 'premium');
});

test('ショップの札：同じ品の色ちがいは 1 つのシリーズ。値段はいちばん安い品のもの', () => {
  const series = shopSeries();
  assert.equal(new Set(series.map((s) => s.id)).size, series.length);
  const pen05 = series.find((s) => s.id === 'pen-05');
  assert.equal(pen05.name, 'ボールペン 0.5');
  assert.equal(pen05.maker, '大学ノート');
  assert.ok(pen05.items.length >= 9, '0.5 の公式のボールペンは 9 色以上');
  assert.ok(pen05.items.every((it) => it.mm === '0.5' && !it.maker));
  // 軸の色・柄で選ぶペンは、インクの色ちがいの札と分けて 1 枚に
  const art = series.find((s) => s.id === 'pen-art');
  assert.deepEqual(
    art.items.map((it) => it.id),
    ['pen-sakura-05', 'pen-mint-05', 'pen-wood-07', 'pen-navy-038']
  );
  // 既製品の見た目の品も、α 版のあいだはショップに出す
  const js = series.find((s) => s.id === 'jetstream');
  assert.deepEqual(
    js.items.map((it) => it.id),
    ['maker-jetstream-black', 'maker-jetstream-red']
  );
  assert.equal(js.price, 165);
  assert.equal(js.from, false);
  const craft = series.find((s) => s.id === 'maker-craftlab-004');
  assert.equal(craft.items.length, 1, 'シリーズのない品は 1 品で 1 枚');
  assert.ok(craft.items[0].featured, '新しく入った品は上の帯に出す');
  for (const s of series)
    assert.ok(
      s.items.every((it) => it.type === s.type),
      '札の中の種類はそろう'
    );
  assert.deepEqual(
    siblingsOf(itemOf('maker-sarasa-black')).map((it) => it.id),
    ['maker-sarasa-black', 'maker-sarasa-red']
  );
  assert.deepEqual(
    siblingsOf(itemOf('case-clear')).map((it) => it.id),
    ['case-clear']
  );
  // 品ぞろえの順に並ぶ（公式の品 → 既製品の見た目の品）
  assert.equal(series[0].id, 'pen-05');
});

test('カートとレジ：合計は品の値段の和。無料だけなら支払いなし、有料があればデモ決済が要る。注文の記録が残る', () => {
  assert.equal(cartTotal(['maker-sarasa-red', 'pen-wood-07', 'nope']), 110);
  assert.equal(cartTotal([]), 0);
  assert.equal(cartPoints(['maker-sarasa-red', 'pen-wood-07', 'case-tin-silver', 'nope']), 800);
  // ポイントの品だけ：カードは要らない。引く量は order.points（残高から引くのは呼ぶ側。shared/points.js）
  const free = purchase(null, ['pen-wood-07', 'case-tin-silver'], null, {
    now: new Date('2026-10-23T12:00:00Z'),
    orderId: 'o1'
  });
  assert.ok(free.stationery.owned.includes('pen-wood-07') && free.stationery.owned.includes('case-tin-silver'));
  assert.equal(free.order.total, 0);
  assert.equal(free.order.points, 800);
  assert.deepEqual(free.order.payment, {method: 'points'});
  assert.equal(free.order.id, 'o1');
  assert.equal(free.order.at, '2026-10-23T12:00:00.000Z');
  // 円の品は支払いの方法が要る（α 版はデモだけ。カードの情報は受け取らない・残さない）
  assert.throws(() => purchase(null, ['maker-craftlab-004']), /支払い/);
  assert.throws(() => purchase(null, ['maker-craftlab-004'], {method: 'card'}), /支払い/);
  const paid = purchase(null, ['maker-craftlab-004', 'maker-sarasa-red'], {
    method: 'demo',
    last4: '4242 4242 4242 4242'
  });
  assert.equal(paid.order.total, 8910);
  assert.equal(paid.order.points, 0);
  assert.deepEqual(paid.order.payment, {method: 'demo'}, 'カードの番号は残さない');
  assert.deepEqual(
    paid.order.items.map((x) => [x.id, x.price]),
    [
      ['maker-craftlab-004', 8800],
      ['maker-sarasa-red', 110]
    ]
  );
  assert.ok(paid.stationery.owned.includes('maker-craftlab-004'));
  // 同じ品を 2 回は買えない。空のカート・ない品は断る
  assert.throws(() => purchase(paid.stationery, ['maker-sarasa-red'], {method: 'demo'}), /持っています/);
  assert.throws(() => purchase(free.stationery, ['pen-wood-07']), /持っています/);
  assert.throws(() => purchase(null, []), /空/);
  assert.throws(() => purchase(null, ['gold-pen']), /ありません/);
  // 近道（acquire）は円の品もポイントの品も断る（カートからレジへ）
  assert.throws(() => acquire(null, 'maker-craftlab-004'), /カート/);
  assert.throws(() => acquire(null, 'pen-wood-07'), /カート/);
  // 円とポイントの品をいっしょに買える
  const both = purchase(null, ['maker-sarasa-red', 'pen-green-05'], {method: 'demo'});
  assert.equal(both.order.total, 110);
  assert.equal(both.order.points, itemOf('pen-green-05').points);
  assert.equal(both.order.payment.method, 'demo');
  // ポイントの品をまとめて買える
  const mixed = purchase(null, ['pen-green-05', 'marker-blue'], null);
  assert.equal(mixed.order.total, 0);
  assert.equal(mixed.order.points, itemOf('pen-green-05').points + itemOf('marker-blue').points);
  assert.equal(mixed.order.payment.method, 'points');
});

test('はじめの状態：6 本の筆箱と帆布のペンケース。はじめの品はいつも持っている', () => {
  const st = stationeryState(null);
  assert.deepEqual(st.slots, STARTER_SLOTS);
  assert.equal(st.slots.length, SLOTS);
  assert.equal(st.caseId, STARTER_CASE);
  assert.deepEqual(st.owned, STARTER);
  const odd = stationeryState({
    owned: ['nope'],
    slots: ['nope', 'pen-red-05', 'pen-red-05', 'case-tin-silver'],
    caseId: 'pen-red-05'
  });
  assert.deepEqual(odd.slots, [null, 'pen-red-05', null, null, null, null], '知らない品・同じ品・ペンケースは入れない');
  assert.equal(odd.caseId, STARTER_CASE);
});

test('ショップ：近道（acquire）で入手できるのは円もポイントも要らない品だけ。2 回入手しても 1 つ。ない品は入手できない', () => {
  const a = acquire(null, 'pen-black-05');
  assert.equal(a.owned.filter((id) => id === 'pen-black-05').length, 1);
  assert.equal(acquire(a, 'pen-black-05').owned.filter((id) => id === 'pen-black-05').length, 1);
  assert.throws(() => acquire(a, 'gold-pen'), /ありません/);
});

test('筆箱：持っている道具だけを 6 本まで入れる。ペンケースを変えられる', () => {
  const a = purchase(null, ['pen-wood-07', 'case-tin-silver']).stationery;
  const b = arrange(a, {slots: ['pen-wood-07', null, null, null, null, 'hider-cyan'], caseId: 'case-tin-silver'});
  assert.deepEqual(b.slots, ['pen-wood-07', null, null, null, null, 'hider-cyan']);
  assert.equal(b.caseId, 'case-tin-silver');
  assert.throws(() => arrange(a, {slots: ['pen-sakura-05', null, null, null, null, null]}), /持っていない/);
  assert.throws(() => arrange(a, {slots: ['case-tin-silver', null, null, null, null, null]}), /持っていない/);
  assert.throws(() => arrange(a, {slots: ['pen-red-05', 'pen-red-05', null, null, null, null]}), /1 本だけ/);
  assert.throws(() => arrange(a, {slots: [null]}), /不正/);
  assert.throws(() => arrange(null, {caseId: 'case-sage'}), /持っていない/);
});

test('絵：道具とペンケースの SVG に名前が入る（名前は文字として逃がす）', () => {
  assert.match(toolArt(itemOf('pen-black-05')), /<svg[^>]*>[\s\S]*黒のボールペン 0\.5/);
  assert.match(toolArt(itemOf('hider-cyan')), /隠/);
  assert.doesNotMatch(toolArt(itemOf('pen-black-05'), {label: false}), /<title>/);
  for (const id of ['case-canvas-navy', 'case-tin-silver', 'case-leather-brown', 'case-clear'])
    assert.match(caseArt(itemOf(id)), /<svg/);
});

test('既製品の見た目のペン：α 版のあいだはショップに出て入手できる（正式な公開の前に見直す目印 experimental）。持っている人の筆箱には残る', async () => {
  const {MAKER_ITEMS_LISTED, listed} = await import('../src/shared/stationery.js');
  const js = itemOf('maker-jetstream-black');
  assert.equal(js.experimental, true);
  assert.equal(MAKER_ITEMS_LISTED, true);
  assert.equal(listed(js), true);
  assert.equal(listed(itemOf('pen-black-05')), true);
  assert.ok(purchase(null, ['maker-sarasa-red'], {method: 'demo'}).stationery.owned.includes('maker-sarasa-red'));
  assert.throws(() => acquire(null, 'gold-pen'), /ありません/);
  // 前の版で買った人の持ち物と筆箱の場所はそのまま
  const st = stationeryState({owned: ['maker-sarasa-red'], slots: ['maker-sarasa-red', null, null, null, null, null]});
  assert.ok(st.owned.includes('maker-sarasa-red'));
  assert.equal(st.slots[0], 'maker-sarasa-red');
  assert.match(toolArt(js), /JETSTREAM/);
  assert.match(toolArt(itemOf('maker-sarasa-red')), /SARASA/);
});

test('多機能ペン（サクラクラフトラボ 004）：3 本の芯を回して使い、選んだ芯は設定に残る', async () => {
  const {heldPen, listed, nextRefill, refillOf} = await import('../src/shared/stationery.js');
  const it = itemOf('maker-craftlab-004');
  assert.equal(it.type, 'pen');
  assert.equal(it.experimental, true, '既製品（正式な公開の前に見直す）');
  assert.equal(listed(it), true, 'α 版のあいだはショップに出す');
  assert.equal(it.art, 'model');
  assert.equal(it.model, 'craftlab-004');
  assert.equal(it.refill, '4C');
  assert.deepEqual(
    it.refills.map((r) => r.id),
    ['black', 'red', 'sharp']
  );
  assert.deepEqual([it.color, it.width, it.mm], [it.refills[0].color, it.refills[0].width, '0.5'], '最初は黒');
  // 芯：知らない id は最初の芯。回転式：最後の次は最初
  assert.equal(refillOf(it, 'red').name, '赤ボールペン');
  assert.equal(refillOf(it, 'nope').id, 'black');
  assert.equal(nextRefill(it, 'black'), 'red');
  assert.equal(nextRefill(it, 'sharp'), 'black');
  assert.equal(refillOf(itemOf('pen-black-05')), null);
  const red = heldPen(it, 'red');
  assert.equal(red.color, '#d0202e');
  assert.equal(red.refill.id, 'red');
  assert.equal(red.id, it.id, '持っても品の id は変わらない（筆箱の場所と照らす）');
  assert.equal(heldPen(itemOf('pen-black-05'), 'red'), itemOf('pen-black-05'), 'ふつうのペンはそのまま');
  const sharp = heldPen(it, 'sharp');
  assert.ok(sharp.refill.sharp && sharp.width < it.width * 1.3 && sharp.color !== it.color, 'シャープは灰色');
  // 選んだ芯は設定に残る。持っていない品・ない芯は捨てる
  const owned = stationeryState({owned: ['maker-craftlab-004']}); // 前の版で手に入れた人
  assert.deepEqual(owned.refills, {});
  const picked = arrange(owned, {refills: {'maker-craftlab-004': 'red'}});
  assert.deepEqual(picked.refills, {'maker-craftlab-004': 'red'});
  assert.deepEqual(
    stationeryState({...picked, refills: {'maker-craftlab-004': 'nope', 'pen-black-05': 'red'}}).refills,
    {}
  );
  assert.deepEqual(
    stationeryState({refills: {'maker-craftlab-004': 'red'}}).refills,
    {},
    '持っていない品の芯は残さない'
  );
  assert.throws(() => arrange(owned, {refills: {'maker-craftlab-004': 'blue'}}), /ありません/);
  assert.throws(() => arrange(null, {refills: {'maker-craftlab-004': 'red'}}), /ありません/);
  assert.throws(() => arrange(owned, {refills: 'red'}), /不正/);
  // 絵：3D モデルの札（画像は renderer/model3d.js が入れる）
  const art = toolArt(it);
  assert.match(art, /data-model="craftlab-004"/);
  assert.match(art, /<image data-model-img/);
  assert.match(art, /サクラクラフトラボ 004/);
  assert.doesNotMatch(toolArt({...it, art: null}), /data-model/, '描けないときはふつうのペンの絵');
});

test('試し書きの赤シート：文字隠しペンと、赤シートで消える色（赤・橙・桃）のボールペンに置く', () => {
  for (const hex of ['#d93025', '#e37400', '#d6457a', '#e4002b', '#d0202e']) assert.ok(fadesUnderRedSheet(hex), hex);
  for (const hex of ['#222222', '#1a5fd0', '#7b3fbf', '#6b4423', '#188038', '#ffe14d', 'red', null])
    assert.ok(!fadesUnderRedSheet(hex), String(hex));
  const yes = ['hider-cyan', 'pen-red-05', 'pen-orange-05', 'pen-pink-05', 'pen-navy-038', 'maker-sarasa-red'];
  const no = ['pen-black-05', 'pen-blue-05', 'pen-purple-05', 'pen-sakura-05', 'marker-pink', 'case-sage'];
  for (const id of yes) assert.ok(needsRedSheet(itemOf(id)), id);
  for (const id of no) assert.ok(!needsRedSheet(itemOf(id)), id);
  assert.ok(needsRedSheet(itemOf('maker-craftlab-004')), '多機能ペンは赤の芯があれば置く');
  assert.ok(!needsRedSheet(null));
});
