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
  caseArt,
  hiderColorOk,
  itemOf,
  priceLabel,
  stationeryState,
  toolArt
} from '../src/shared/stationery.js';

test('品ぞろえ：id は重ならず、いまはすべて無料。文字隠しペンは赤の成分が 0 の色だけ', () => {
  assert.equal(new Set(CATALOG.map((it) => it.id)).size, CATALOG.length);
  for (const it of CATALOG) {
    assert.equal(it.price, 0, it.id);
    assert.equal(priceLabel(it), '無料');
    if (it.type === 'hider') assert.ok(hiderColorOk(it.color), it.id);
    if (it.type === 'pen' || it.type === 'marker') assert.ok(it.width > 0 && /^#[0-9a-f]{6}$/.test(it.color), it.id);
  }
  assert.ok(hiderColorOk('#00d2ff'));
  assert.ok(!hiderColorOk('#ff9ec7'));
  assert.ok(!hiderColorOk('#000000'), '暗い色は下の字が読めない');
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

test('ショップ：無料の品を入手でき、2 回入手しても 1 つ。ない品は入手できない', () => {
  const a = acquire(null, 'pen-wood-07');
  assert.ok(a.owned.includes('pen-wood-07'));
  assert.equal(acquire(a, 'pen-wood-07').owned.filter((id) => id === 'pen-wood-07').length, 1);
  assert.throws(() => acquire(a, 'gold-pen'), /ありません/);
});

test('筆箱：持っている道具だけを 6 本まで入れる。ペンケースを変えられる', () => {
  const a = acquire(acquire(null, 'pen-wood-07'), 'case-tin-silver');
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

test('実験：既製品の見た目のペンは、実験をオンにしたときだけショップに出て入手できる', async () => {
  const {listed} = await import('../src/shared/stationery.js');
  const js = itemOf('maker-jetstream-black');
  assert.equal(js.experimental, true);
  assert.equal(listed(js), false);
  assert.equal(listed(js, {experiments: true}), true);
  assert.equal(listed(itemOf('pen-black-05')), true);
  assert.throws(() => acquire(null, 'maker-sarasa-red'), /ありません/);
  assert.ok(acquire(null, 'maker-sarasa-red', {experiments: true}).owned.includes('maker-sarasa-red'));
  assert.match(toolArt(js), /JETSTREAM/);
  assert.match(toolArt(itemOf('maker-sarasa-red')), /SARASA/);
});

test('多機能ペン（サクラクラフトラボ 004）：3 本の芯を回して使い、選んだ芯は設定に残る', async () => {
  const {heldPen, listed, nextRefill, refillOf} = await import('../src/shared/stationery.js');
  const it = itemOf('maker-craftlab-004');
  assert.equal(it.type, 'pen');
  assert.equal(it.experimental, true, '既製品なので、実験をオンにしたときだけ');
  assert.equal(listed(it), false);
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
  const owned = acquire(null, 'maker-craftlab-004', {experiments: true});
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
