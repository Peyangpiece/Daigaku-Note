import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAID_ON_SALE,
  isPaid,
  CASE_INFO,
  CATALOG,
  EXTRA_MODELS,
  eraserArt,
  kindOf,
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

test('品ぞろえ：id は重ならず、公式の品はポイント（はじめの品は 0）、有料の棚の品（アトリエ）は円（税込）。文字隠しペンは赤の成分が 0 の色だけ', () => {
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
  assert.equal(itemOf('atelier-line-black').price, 300);
  assert.equal(itemOf('atelier-clear-red').price, 250);
  assert.equal(itemOf('atelier-trio').price, 8800);
  assert.equal(priceLabel(itemOf('atelier-trio')), '¥8,800');
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
  assert.equal(pen05.name, 'ボールペン DN-2');
  assert.equal(pen05.maker, 'パレットノート');
  assert.ok(pen05.items.length >= 9, '書き味「普通」の公式のボールペンは 9 色以上');
  assert.ok(pen05.items.every((it) => it.mm === '0.5' && !it.maker));
  // 公式のボールペンは 3 つの型番（DN-1 硬い・DN-2 普通・DN-3 滑らか）。軸の色・柄で選ぶ DN-3 は 1 枚に
  const art = series.find((s) => s.id === 'pen-art');
  assert.equal(art.name, 'ボールペン DN-3');
  assert.deepEqual(
    art.items.map((it) => it.id),
    ['pen-sakura-05', 'pen-mint-05', 'pen-wood-07', 'pen-navy-038', 'pen-black-038', 'pen-black-07']
  );
  assert.equal(
    series.filter(
      (s) => s.type === 'pen' && s.maker === 'パレットノート' && s.id.startsWith('pen-') && s.id !== 'pen-cute'
    ).length,
    3,
    '公式のボールペン（3D）は 3 つ'
  );
  // 名前に字幅・芯の太さは入れない（太さは 0.3・0.5・0.7 から選ぶ）
  for (const it of CATALOG.filter((x) => x.type === 'pen'))
    assert.doesNotMatch(it.name, /\d\.\d/, `${it.id} の名前に太さ`);
  for (const s of series.filter((x) => x.type === 'pen' || x.type === 'pencil'))
    assert.doesNotMatch(s.name, /\d\.\d/, `${s.id} の名前に太さ`);
  // 有料の棚の品（アトリエ）も、色ちがいは 1 枚の札
  const js = series.find((s) => s.id === 'atelier-line');
  assert.deepEqual(
    js.items.map((it) => it.id),
    ['atelier-line-black', 'atelier-line-red']
  );
  assert.equal(js.price, 300);
  assert.equal(js.from, false);
  const craft = series.find((s) => s.id === 'atelier-trio');
  assert.equal(craft.items.length, 1, 'シリーズのない品は 1 品で 1 枚');
  assert.ok(craft.items[0].featured, '新しく入った品は上の帯に出す');
  for (const s of series)
    assert.ok(
      s.items.every((it) => kindOf(it) === s.type),
      '札の中の種類（シャープペンシルはボールペンと分ける）はそろう'
    );
  assert.deepEqual(
    siblingsOf(itemOf('atelier-clear-black')).map((it) => it.id),
    ['atelier-clear-black', 'atelier-clear-red']
  );
  assert.deepEqual(
    siblingsOf(itemOf('case-clear')).map((it) => it.id),
    ['case-clear', 'case-clear-blue', 'case-clear-pink']
  );
  // 品ぞろえの順に並ぶ（ポイントの品 → 有料の棚の品）
  assert.equal(series[0].id, 'pen-05');
});

test('カートとレジ：合計は品の値段の和。ポイントの品は支払いなしで交換できる。有料の品は発売前で買えない。注文の記録が残る', () => {
  assert.equal(cartTotal(['atelier-clear-red', 'pen-wood-07', 'nope']), 250);
  assert.equal(cartTotal([]), 0);
  assert.equal(cartPoints(['atelier-clear-red', 'pen-wood-07', 'case-tin-silver', 'nope']), 800);
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
  // 有料の品（円の値段の品）は発売前：デモ決済でも買えない（v0.26.2。前は請求のないまま手に入った）。何も手に入らない
  assert.equal(PAID_ON_SALE, false);
  assert.equal(isPaid(itemOf('atelier-trio')), true);
  assert.equal(isPaid(itemOf('pen-wood-07')), false);
  assert.throws(() => purchase(null, ['atelier-trio']), /発売前/);
  assert.throws(() => purchase(null, ['atelier-trio', 'atelier-clear-red'], {method: 'demo'}), /発売前/);
  // 前の版で手に入れた有料の品は、そのまま持っている
  const kept = stationeryState({owned: ['atelier-trio']});
  assert.ok(kept.owned.includes('atelier-trio'));
  // 同じ品を 2 回は買えない。空のカート・ない品は断る
  assert.throws(() => purchase(kept, ['atelier-trio'], {method: 'demo'}), /持っています/);
  assert.throws(() => purchase(free.stationery, ['pen-wood-07']), /持っています/);
  assert.throws(() => purchase(null, []), /空/);
  assert.throws(() => purchase(null, ['gold-pen']), /ありません/);
  // 近道（acquire）は円の品もポイントの品も断る（カートからレジへ）
  assert.throws(() => acquire(null, 'atelier-trio'), /カート/);
  assert.throws(() => acquire(null, 'pen-wood-07'), /カート/);
  // 有料の品がカートに混ざっていれば、ポイントの品も含めて何も買えない（ポイントも引かない）
  assert.throws(() => purchase(null, ['atelier-clear-red', 'pen-green-05'], {method: 'demo'}), /発売前/);
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
  assert.match(toolArt(itemOf('pen-black-05')), /<svg[^>]*>[\s\S]*黒のボールペン/);
  assert.match(toolArt(itemOf('hider-cyan')), /隠/);
  assert.doesNotMatch(toolArt(itemOf('pen-black-05'), {label: false}), /<title>/);
  for (const id of ['case-canvas-navy', 'case-tin-silver', 'case-leather-brown', 'case-clear'])
    assert.match(caseArt(itemOf(id)), /<svg/);
});

test('シャープペンシル：書く道具としてはペン（type pen）で、種類は pencil。線は黒鉛の灰色、太さは芯の太さで決まる。3D モデル', () => {
  const ps = CATALOG.filter((it) => it.pencil);
  assert.ok(ps.length >= 3);
  for (const it of ps) {
    assert.equal(it.type, 'pen');
    assert.equal(kindOf(it), 'pencil');
    assert.equal(it.color, '#4a4a4a');
    assert.equal(it.model, 'pencil-mech');
    assert.equal(needsRedSheet(it), false, '黒鉛の線は赤シートで消えない');
  }
  const w = (mm) => ps.find((it) => it.mm === mm).width;
  assert.ok(w('0.3') < w('0.5') && w('0.5') < w('0.7'));
  const se = shopSeries().find((x) => x.id === 'pencil-05');
  assert.equal(se.type, 'pencil');
  assert.equal(se.items.length, 5, '前の 0.3・0.7 も色ちがいとして 1 つのシリーズに');
  assert.equal(se.name, 'シャープペンシル');
});

test('消しゴム・ポーチの道具の絵：3D モデルの画像を入れる所と、入るまでの平らな絵がある。GLB がある', async () => {
  const {existsSync} = await import('node:fs');
  for (const id of ['eraser', 'tool-sheet', 'tool-calc', 'tool-memo', 'tool-ruler', 'tool-timer']) {
    assert.ok(EXTRA_MODELS.includes(id), id);
    assert.ok(existsSync(new URL(`../src/renderer/assets/stationery/${id}.glb`, import.meta.url)), id);
  }
  const art = eraserArt();
  assert.match(art, /data-model="eraser"/);
  assert.match(art, /<image data-model-img/);
  assert.match(art, /data-model-flat/);
});

test('ペンケース：帆布の筆箱の色ちがいは 1 枚の札（シリーズ）。どの形にも素材・つくり・大きさの説明がある', () => {
  const se = shopSeries().find((x) => x.id === 'case-pouch');
  assert.equal(se.name, '帆布の筆箱');
  assert.deepEqual(
    se.items.map((it) => it.id),
    [
      'case-canvas-navy',
      'case-pastel-pink',
      'case-sage',
      'case-canvas-mustard',
      'case-canvas-gray',
      'case-canvas-black'
    ]
  );
  // どの形のペンケース・ポーチも色ちがいが 3 色以上（1 枚の札にまとめる）。同じシリーズは同じ形・同じ値段
  for (const type of ['case', 'pouch']) {
    const groups = shopSeries().filter((x) => x.type === type && x.items[0].art === 'model');
    assert.equal(groups.length, 4, `${type} は 4 つの形`);
    for (const g of groups) {
      assert.ok(g.items.length >= 3, `${g.id} の色ちがい`);
      assert.equal(new Set(g.items.map((it) => it.model)).size, 1, `${g.id} は同じ形`);
      assert.equal(
        new Set(g.items.filter((it) => it.points > 0).map((it) => it.points)).size,
        1,
        `${g.id} は同じ値段（はじめの品をのぞく）`
      );
      assert.equal(new Set(g.items.map((it) => it.base)).size, g.items.length, `${g.id} の色が重ならない`);
    }
  }
  for (const it of CATALOG.filter((x) => x.type === 'case')) {
    const c = CASE_INFO[it.style];
    assert.ok(c?.short && c.material && c.build && /mm/.test(c.size), it.id);
  }
});

test('ペンケースは 3D モデル（形の種類ごとの GLB。色は base・trim で塗る）。描けないときはペンケースの絵', async () => {
  const {existsSync} = await import('node:fs');
  for (const it of CATALOG.filter((x) => x.type === 'case' && x.art !== 'cute')) {
    assert.equal(it.art, 'model');
    assert.equal(it.model, `case-${it.style}`);
    assert.ok(existsSync(new URL(`../src/renderer/assets/stationery/${it.model}.glb`, import.meta.url)), it.model);
    const art = caseArt(it);
    assert.match(art, new RegExp(`data-model="${it.model}"`));
    assert.match(art, new RegExp(`data-item="${it.id}"`));
    assert.match(art, /viewBox="0 0 200 80"/);
    assert.match(art, /<image data-model-img/);
    assert.doesNotMatch(caseArt({...it, art: null}), /data-model/);
  }
});

test('有料の棚のペン（アトリエ）：オリジナルの品。発売前は買えない。見た目は 3D モデルで、ファイルがそろっている', async () => {
  const {existsSync} = await import('node:fs');
  const paid = CATALOG.filter((x) => x.price > 0);
  assert.equal(paid.length, 10);
  for (const it of paid) {
    assert.equal(it.atelier, true, it.id);
    assert.equal(it.maker, 'パレットノート アトリエ', it.id);
    assert.match(it.name, /^アトリエ /, it.id);
    assert.equal(it.art, 'model', it.id);
    assert.ok(existsSync(new URL(`../src/renderer/assets/stationery/${it.model}.glb`, import.meta.url)), it.model);
    assert.match(toolArt(it), new RegExp(`data-model="${it.model}"`));
  }
  // 実在の製品の名前・メーカーは品ぞろえにない
  assert.doesNotMatch(
    JSON.stringify(CATALOG),
    /ジェットストリーム|サラサ|カランダッシュ|パーカー|LAMY|カヴェコ|クラフトラボ|三菱鉛筆|ゼブラ|サクラクレパス/
  );
  assert.throws(
    () => purchase(null, ['atelier-clear-red'], {method: 'demo'}),
    /発売前/,
    '有料の品は、売り始めるまで買えない'
  );
  assert.throws(() => acquire(null, 'gold-pen'), /ありません/);
  assert.equal(itemOf('atelier-clear-red').model, 'atelier-clear');
  assert.equal(itemOf('atelier-clear-red').width, 1.25, 'ゲルインクの線は少し太い');
});

test('前の版（〜0.26.2）の既製品の見た目の品：持ち物・筆箱の場所・選んだ芯と太さを、アトリエの品へ引き継ぐ', async () => {
  const {RENAMED, currentId} = await import('../src/shared/stationery.js');
  for (const [from, to] of Object.entries(RENAMED)) {
    assert.ok(
      CATALOG.some((x) => x.id === to),
      to
    );
    assert.equal(itemOf(from).id, to, '前の id でも品を引ける（注文の記録の名前など）');
  }
  assert.equal(new Set(Object.values(RENAMED)).size, Object.keys(RENAMED).length, '1 対 1');
  assert.equal(currentId('pen-black-05'), 'pen-black-05');
  const st = stationeryState({
    owned: ['maker-sarasa-red', 'maker-craftlab-004', 'maker-lamy-2000'],
    slots: ['maker-sarasa-red', null, 'maker-craftlab-004', null, null, null],
    refills: {'maker-craftlab-004': 'red'},
    sizes: {'maker-lamy-2000': '0.5'}
  });
  assert.ok(st.owned.includes('atelier-clear-red') && st.owned.includes('atelier-trio'));
  assert.ok(!st.owned.some((id) => id.startsWith('maker-')));
  assert.equal(st.slots[0], 'atelier-clear-red');
  assert.equal(st.slots[2], 'atelier-trio');
  assert.deepEqual(st.refills, {'atelier-trio': 'red'});
  assert.deepEqual(st.sizes, {'atelier-drop': '0.5'});
  assert.deepEqual(stationeryState(st), st, '読み替えは 1 回で落ち着く');
});

test('多機能ペン（アトリエ トリオ）：3 本の芯を回して使い、選んだ芯は設定に残る', async () => {
  const {heldPen, nextRefill, refillOf} = await import('../src/shared/stationery.js');
  const it = itemOf('atelier-trio');
  assert.equal(it.type, 'pen');
  assert.equal(it.atelier, true);
  assert.equal(it.art, 'model');
  assert.equal(it.model, 'atelier-trio');
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
  const plain = heldPen(itemOf('pen-black-05'), 'red');
  assert.equal(plain.refill, undefined, 'ふつうのペンに芯はない');
  assert.deepEqual(
    [plain.color, plain.size, plain.width],
    ['#222222', '0.5', 1.1],
    'ふつうのペンは品の色・はじめの太さ'
  );
  const sharp = heldPen(it, 'sharp');
  assert.ok(sharp.refill.sharp && sharp.width < it.width * 1.3 && sharp.color !== it.color, 'シャープは灰色');
  // 選んだ芯は設定に残る。持っていない品・ない芯は捨てる
  const owned = stationeryState({owned: ['atelier-trio']}); // 前の版で手に入れた人
  assert.deepEqual(owned.refills, {});
  const picked = arrange(owned, {refills: {'atelier-trio': 'red'}});
  assert.deepEqual(picked.refills, {'atelier-trio': 'red'});
  assert.deepEqual(stationeryState({...picked, refills: {'atelier-trio': 'nope', 'pen-black-05': 'red'}}).refills, {});
  assert.deepEqual(stationeryState({refills: {'atelier-trio': 'red'}}).refills, {}, '持っていない品の芯は残さない');
  assert.throws(() => arrange(owned, {refills: {'atelier-trio': 'blue'}}), /ありません/);
  assert.throws(() => arrange(null, {refills: {'atelier-trio': 'red'}}), /ありません/);
  assert.throws(() => arrange(owned, {refills: 'red'}), /不正/);
  // 絵：3D モデルの札（画像は renderer/model3d.js が入れる）
  const art = toolArt(it);
  assert.match(art, /data-model="atelier-trio"/);
  assert.match(art, /<image data-model-img/);
  assert.match(art, /アトリエ トリオ/);
  assert.doesNotMatch(toolArt({...it, art: null}), /data-model/, '描けないときはふつうのペンの絵');
});

test('試し書きの赤シート：文字隠しペンと、赤シートで消える色（赤・橙・桃）のボールペンに置く', () => {
  for (const hex of ['#d93025', '#e37400', '#d6457a', '#e4002b', '#d0202e']) assert.ok(fadesUnderRedSheet(hex), hex);
  for (const hex of ['#222222', '#1a5fd0', '#7b3fbf', '#6b4423', '#188038', '#ffe14d', 'red', null])
    assert.ok(!fadesUnderRedSheet(hex), String(hex));
  const yes = ['hider-cyan', 'pen-red-05', 'pen-orange-05', 'pen-pink-05', 'pen-navy-038', 'atelier-clear-red'];
  const no = ['pen-black-05', 'pen-blue-05', 'pen-purple-05', 'pen-sakura-05', 'marker-pink', 'case-sage'];
  for (const id of yes) assert.ok(needsRedSheet(itemOf(id)), id);
  for (const id of no) assert.ok(!needsRedSheet(itemOf(id)), id);
  assert.ok(needsRedSheet(itemOf('atelier-trio')), '多機能ペンは赤の芯があれば置く');
  assert.ok(!needsRedSheet(null));
});

test('筆圧なしのペン：ショップに 1 枚の札（黒・赤・青）、ポイントで買える', async () => {
  const {shopSeries} = await import('../src/shared/stationery.js');
  const even = CATALOG.filter((it) => it.even);
  assert.deepEqual(
    even.map((it) => it.id),
    ['pen-even-black-05', 'pen-even-red-05', 'pen-even-blue-05']
  );
  for (const it of even) {
    assert.equal(it.type, 'pen');
    assert.ok(it.points > 0, 'はじめから持っている品ではない');
  }
  const s = shopSeries().find((x) => x.id === 'pen-even');
  assert.equal(s.name, 'ボールペン DN-1');
  assert.equal(s.items.length, 3);
});

test('ポーチと、ポーチの電卓・タイマー：はじめは 1 つずつ持っていて、ショップで別の形を買い、1 つを選んで使う', async () => {
  const {GEAR, POUCH_INFO, STARTER_GEAR, isGear, stationeryState: state} = await import('../src/shared/stationery.js');
  const {existsSync} = await import('node:fs');
  const bags = CATALOG.filter((it) => it.type === 'pouch' && it.art === 'model');
  assert.equal(new Set(bags.map((it) => it.model)).size, 4, 'ポーチは 4 つの形');
  for (const it of bags) {
    assert.ok(POUCH_INFO[it.style], `${it.id} の説明`);
    assert.match(it.base, /^#[0-9a-f]{6}$/);
  }
  for (const type of ['calc', 'timer'])
    assert.equal(
      new Set(CATALOG.filter((it) => it.type === type && it.art === 'model').map((it) => it.model)).size,
      2,
      `${type} は 2 つの形`
    );
  for (const it of CATALOG.filter((x) => isGear(x) && x.art === 'model'))
    assert.ok(
      existsSync(new URL(`../src/renderer/assets/stationery/${it.model}.glb`, import.meta.url)),
      `${it.model}.glb`
    );
  // はじめの状態：はじめの品を選んでいる。前の版の保存（ポーチの項目がない）でも同じ
  const st = state({owned: ['pen-black-05'], caseId: 'case-canvas-navy'});
  for (const [type, key] of Object.entries(GEAR)) assert.equal(st[key], STARTER_GEAR[type]);
  assert.ok(st.owned.includes('pouch-flat-navy') && st.owned.includes('calc-standard'));
  // 買っていない品は選べない。買えば選べ、種類のちがう品は選べない
  assert.throws(() => arrange(st, {pouchId: 'pouch-gama-red'}), /持っていないポーチ/);
  const mine = state({...st, owned: [...st.owned, 'pouch-gama-red', 'calc-card']});
  const next = arrange(mine, {pouchId: 'pouch-gama-red', calcId: 'calc-card'});
  assert.equal(next.pouchId, 'pouch-gama-red');
  assert.equal(next.calcId, 'calc-card');
  assert.equal(next.timerId, 'timer-stopwatch');
  assert.throws(() => arrange(mine, {calcId: 'pouch-gama-red'}), /持っていない電卓/);
  // ポーチの道具は筆箱の 6 本には入らない・ポイントで買える
  assert.throws(() => arrange(mine, {slots: ['calc-card', null, null, null, null, null]}), /持っていない文房具/);
  assert.ok(CATALOG.filter((it) => isGear(it) && !STARTER.includes(it.id)).every((it) => it.points > 0));
});

test('ペンの太さ：どのペンも 0.3・0.5・0.7 から選べ、選んだ太さはペンごとに残る', async () => {
  const {PEN_SIZES, arrange, defaultSize, heldPen, stationeryState} = await import('../src/shared/stationery.js');
  assert.deepEqual(PEN_SIZES, ['0.3', '0.5', '0.7']);
  assert.equal(defaultSize(itemOf('pen-black-038')), '0.3', '0.38 は 0.3 から');
  assert.equal(defaultSize(itemOf('pen-black-07')), '0.7');
  assert.equal(defaultSize(itemOf('atelier-facet-black')), '0.7', '1.0 は 0.7 から');
  const pen = itemOf('pen-black-05');
  const w = (s) => heldPen(pen, null, s).width;
  assert.ok(w('0.3') < w('0.5') && w('0.5') < w('0.7'), '細い順');
  assert.equal(heldPen(pen, null, '0.9').size, '0.5', '選べない太さははじめの太さ');
  assert.equal(heldPen(itemOf('marker-yellow'), null, '0.3').size, undefined, 'マーカーには太さを選ばない');
  const st = arrange(null, {sizes: {'pen-black-05': '0.7'}});
  assert.deepEqual(st.sizes, {'pen-black-05': '0.7'});
  assert.throws(() => arrange(null, {sizes: {'pen-black-05': '0.4'}}), /太さ/);
  assert.throws(() => arrange(null, {sizes: {'atelier-drop': '0.5'}}), /太さ/, '持っていないペン');
  assert.deepEqual(stationeryState({sizes: {'pen-black-05': '0.3', nope: '0.5', 'pen-red-05': 'x'}}).sizes, {
    'pen-black-05': '0.3'
  });
});

test('書き味：型番ごとに決まり、同じ型番の色ちがいは同じ。型番が違えば違う', async () => {
  const {CATALOG, heldPen, penFeel} = await import('../src/shared/stationery.js');
  const pens = CATALOG.filter((it) => it.type === 'pen' && !it.refills);
  const key = (f) => JSON.stringify([f.th, f.ts, f.te, f.st, f.w]);
  const bySeries = new Map();
  for (const it of pens) {
    const k = key(penFeel(it));
    if (bySeries.has(it.series)) assert.equal(bySeries.get(it.series), k, `${it.id} は ${it.series} と同じ書き味`);
    bySeries.set(it.series, k);
  }
  assert.equal(new Set(bySeries.values()).size, bySeries.size, 'シリーズ（型番）ごとに違う書き味');
  const multi = itemOf('atelier-trio');
  assert.equal(key(penFeel(multi, multi.refills[0])), key(penFeel(multi, multi.refills[1])), '同じ 4C の芯は同じ');
  assert.notEqual(key(penFeel(multi, multi.refills[0])), key(penFeel(multi, multi.refills[2])), 'シャープの芯は別');
  assert.deepEqual(heldPen(itemOf('pen-black-05')).feel, heldPen(itemOf('pen-red-05')).feel);
  assert.equal(heldPen(itemOf('pencil-black-05')).width, 1.3, 'シャープペンシル 0.5 の線は前の版と同じ');
  assert.equal(heldPen(itemOf('atelier-clear-black')).width, 1.25, 'ゲルインクは少し太い（前の版と同じ）');
});

test('公式のボールペンの書き味は 3 段階（硬い＝筆圧なし・普通・滑らか）。型番ごとに同じ', async () => {
  const {feelLabel, penFeel} = await import('../src/shared/stationery.js');
  assert.equal(feelLabel(itemOf('pen-even-red-05')), '硬い');
  assert.equal(feelLabel(itemOf('pen-purple-05')), '普通');
  assert.equal(feelLabel(itemOf('pen-wood-07')), '滑らか');
  assert.equal(feelLabel(itemOf('pen-black-038')), '滑らか', '前の 0.38 は DN-3 の軸の 1 つ');
  assert.equal(feelLabel(itemOf('atelier-clear-black')), null, '有料の棚の品には出さない');
  const th = (id) => penFeel(itemOf(id)).th;
  assert.equal(th('pen-even-black-05'), 0, '硬い：筆圧で太さが変わらない');
  assert.ok(th('pen-black-05') < th('pen-sakura-05'), '普通より滑らかのほうが筆圧で大きく変わる');
  assert.ok(itemOf('pen-even-black-05').even, '硬いは筆圧なしの線（even）');
});

test('有料のペンの書き味：品の特徴に合わせる', async () => {
  const {heldPen, penFeel} = await import('../src/shared/stationery.js');
  const f = (id, r = null) => penFeel(itemOf(id), r);
  const facet = f('atelier-facet-black'),
    flute = f('atelier-flute'),
    drop = f('atelier-drop'),
    line = f('atelier-line-black');
  const trio = itemOf('atelier-trio');
  const gel = f('atelier-trio', trio.refills[0]);
  // ファセット：低粘度ほど滑らず（手ぶれ補正・抜きが短い）、太さは均一（th 小）、線は濃い
  assert.ok(facet.st < line.st && facet.te < line.te, 'ファセットは低粘度より筆記抵抗がある');
  assert.ok(facet.th < f('pen-black-05').th && facet.w > 1, 'インクが均一でしっかりした線');
  assert.ok(!facet.gr && !facet.sw, 'カスレ・クセなし');
  // フルート：低粘度でとても滑らか（ファセットより滑る）
  assert.ok(flute.st > facet.st && flute.te > facet.te);
  // ドロップ：スイートスポット
  assert.ok(drop.sw > 0 && heldPen(itemOf('atelier-drop')).feel.sw === drop.sw, '線に残す');
  // トリオ：顔料ゲル。細字のカリカリ（手ごたえ・短い入り抜き）、濃い
  assert.ok(gel.gr > 0 && gel.ts < facet.ts && gel.w > 1);
  assert.equal(f('atelier-trio', trio.refills[2]).name, '鉛筆らしい', 'シャープの芯は別');
  // ウッド：滑らかで安定（ガタつきなし＝ゆらぎなし、筆圧の効きは控えめ）
  const wood = f('atelier-wood');
  assert.ok(wood.st > facet.st && wood.te > facet.te, '滑らか');
  assert.ok(!wood.gr && !wood.sw && wood.th < f('pen-black-05').th, '安定');
});

test('一覧のペンの絵（flat）：3D モデルを光なしで描く 2D の絵。影の楕円を描かない（v0.16.25）', () => {
  const svg = toolArt(itemOf('atelier-drop'), {flat: true});
  assert.match(svg, /data-flat-art="all"/, '高級の品も平らな絵');
  assert.match(svg, /data-model="atelier-drop"/);
  assert.doesNotMatch(svg, /<ellipse/, '影なし');
  assert.doesNotMatch(svg, /data-model-shot/, '斜めから照らした切り抜きではない');
  assert.match(toolArt(itemOf('pen-black-05')), /<ellipse/, 'ほかの所（PDF の編集画面の筆箱など）は前のまま');
});

test('一覧のペンケース・ポーチの絵（flat）：3D モデルを光なしで描く 2D の絵。影の楕円なし（v0.16.26）', () => {
  const svg = caseArt(itemOf('case-canvas-navy'), {flat: true});
  assert.match(svg, /data-flat-art="all"/);
  assert.doesNotMatch(svg, /<ellipse/, '影なし');
  assert.match(caseArt(itemOf('case-canvas-navy')), /<ellipse/, 'ほかの所は前のまま');
  assert.match(caseArt(itemOf('pouch-flat-navy'), {flat: true}), /data-flat-art="all"/, 'ポーチも');
});

test('ノート（v0.19.0）：はじめから 4 冊。マイノートの保存・上書き・消す・既定の紙。紙を選ぶメニューはマイノート → ノート', async () => {
  const {saveMyNote, removeMyNote, setNoteDefault, notePapers} = await import('../src/shared/stationery.js');
  const st = stationeryState(null);
  for (const id of ['nb-b6', 'nb-a7', 'nb-grid6', 'nb-grid7']) assert.ok(st.owned.includes(id), id);
  assert.equal(st.noteDefault, 'nb-b6');
  assert.deepEqual(st.myNotes, []);
  assert.throws(() => saveMyNote(st, {base: 'nb-staff'}), /持っていません/);
  const r = saveMyNote(st, {name: '授業用', base: 'nb-a7', design: {line: '#9cc0e6', gap: 8}}, {newId: 'my-a'});
  assert.equal(r.id, 'my-a');
  assert.equal(r.stationery.myNotes[0].design.gap, 7, '横罫 A の幅は 7 mm のまま（幅が名前にあるノート）');
  assert.equal(r.stationery.myNotes[0].design.format, 'a7');
  const r2 = saveMyNote(r.stationery, {id: 'my-a', name: '直した', base: 'nb-a7', design: {gap: 9}});
  assert.equal(r2.stationery.myNotes.length, 1, '同じ id は上書き');
  assert.equal(r2.stationery.myNotes[0].name, '直した');
  const d = setNoteDefault(r2.stationery, 'my-a');
  assert.equal(d.noteDefault, 'my-a');
  assert.throws(() => setNoteDefault(d, 'nb-staff'), /選べません/);
  const papers = notePapers(d);
  assert.equal(papers[0].key, 'my-a', 'マイノートが先');
  assert.ok(papers.some((p) => p.key === 'nb-grid7' && p.design.v === 3));
  const gone = removeMyNote(d, 'my-a');
  assert.deepEqual(gone.myNotes, []);
  assert.equal(gone.noteDefault, 'nb-b6', '消したマイノートが既定なら、はじめの紙に戻す');
});

test('パステルの品（2D の絵）：ペン・筆箱・ポーチ・タイマー。色はすべてパステル、ポイントで買え、絵は SVG で描く', async () => {
  const {
    CUTE_MOTIFS,
    POUCH_INFO,
    cuteTimerArt,
    cuteTimerDevice,
    TIMER_BOX,
    isGear,
    stationeryState: state
  } = await import('../src/shared/stationery.js');
  const cute = CATALOG.filter((it) => it.art === 'cute');
  const byType = (type) => cute.filter((it) => it.type === type);
  for (const type of ['pen', 'case', 'pouch', 'timer']) assert.ok(byType(type).length >= 4, `${type} は 4 つ以上`);
  // パステル：明るく（HSV の V ≥ 0.85）、鮮やかすぎない（S ≤ 0.5）。ペンのインクは紙で読めるよう少し濃くする（明るすぎない）
  const hsv = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const v = Math.max(r, g, b);
    return {v, s: v ? (v - Math.min(r, g, b)) / v : 0};
  };
  // WCAG の相対輝度で、白（紙）とのコントラスト比
  const lum = (hex) =>
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (hex) => 1.05 / (lum(hex) + 0.05);
  for (const it of cute) {
    assert.ok(it.points > 0 && it.price === 0, `${it.id} はポイントの品`);
    assert.ok(CUTE_MOTIFS.includes(it.motif), `${it.id} の飾り`);
    assert.equal(it.model, undefined, `${it.id} は 3D モデルを持たない`);
    for (const c of [it.body, it.accent, it.base, it.trim].filter(Boolean)) {
      const {v, s} = hsv(c);
      assert.ok(v >= 0.85 && s <= 0.5, `${it.id} の ${c} はパステル`);
    }
    if (it.type === 'pen') assert.ok(contrast(it.color) >= 3, `${it.id} のインクは白い紙とのコントラスト比 3 以上`);
    const art = isGear(it) ? caseArt(it, {flat: true}) : toolArt(it, {flat: true});
    assert.match(art, /^<svg /);
    assert.doesNotMatch(art, /data-model/, `${it.id} は 3D 表示を使わない`);
    assert.match(isGear(it) ? caseArt(it) : toolArt(it), /^<svg /);
  }
  for (const it of byType('case')) assert.ok(CASE_INFO[it.style]?.short, it.id);
  for (const it of byType('pouch')) assert.ok(POUCH_INFO[it.style]?.short, it.id);
  for (const it of byType('timer')) {
    assert.match(cuteTimerArt(it), /viewBox="0 0 56 40"/);
    // 正面の 2D の絵：液晶（書き換える字）・「分」「秒」・▶。動いている間は一時停止の印
    const dev = cuteTimerDevice(it, {clock: '3:05'});
    assert.match(dev, /data-timer-lcd[^>]*>3:05</);
    assert.match(dev, />分</);
    assert.match(dev, />秒</);
    assert.match(dev, /data-timer-go-icon[^>]*><path/);
    assert.match(cuteTimerDevice(it, {running: true}), /data-timer-go-icon[^>]*><rect/);
    assert.match(caseArt(it, {flat: true}), new RegExp(`viewBox="${TIMER_BOX}"`));
  }
  // 種類ごとに 1 枚の札（シリーズ）
  for (const id of ['pen-cute', 'case-cute', 'pouch-cute', 'timer-cute']) {
    const s = shopSeries().find((x) => x.id === id);
    assert.ok(s && s.items.length >= 4, id);
    assert.equal(new Set(s.items.map((it) => it.points)).size, 1, `${id} は同じ値段`);
  }
  // 買えば筆箱に入れ・選んで使える
  const st = state({owned: ['pen-cute-cat', 'case-cute-bear', 'pouch-cute-star', 'timer-cute-bunny']});
  const next = arrange(st, {caseId: 'case-cute-bear', pouchId: 'pouch-cute-star', timerId: 'timer-cute-bunny'});
  assert.equal(next.caseId, 'case-cute-bear');
  assert.equal(next.timerId, 'timer-cute-bunny');
});
