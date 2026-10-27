import test from 'node:test';
import assert from 'node:assert/strict';
import {charEdges, snapRange, textIn, wordAt, words, fitToInk, inkFromImage} from '../src/shared/text-snap.js';

// 全角は 2、半角は 1 の幅とみなす
const measure = (c) => (/[\x20-\x7e]/.test(c) ? 1 : 2);
const item = (str, left, right, top = 100) => ({str, left, right, top, bottom: top + 20});

test('字の切れ目：文字列の幅を字の幅の比で分ける（全角・半角）', () => {
  const it = item('原価ab', 0, 60); // 幅の比 2:2:1:1 → 20・20・10・10
  assert.deepEqual(charEdges(it, measure), [0, 20, 40, 50, 60]);
  assert.deepEqual(it.chars, ['原', '価', 'a', 'b']);
});

test('字の切れ目：PDF の送り幅（ws。1 em = 1000）があればそれを使う（MS P ゴシックの「は，」など、幅の違う字）', () => {
  // 実際の資料（MS P ゴシック）の「には，原」：送り幅 1000・1000・664（，）・1000。measure では 4 字とも同じ幅になる
  const it = {...item('には，原', 0, 366.4), ws: [1000, 1000, 664, 1000]};
  assert.deepEqual(
    charEdges(it, measure).map((x) => Math.round(x)),
    [0, 100, 200, 266, 366]
  );
  // 送り幅のない字（pdf.js が足した空白など）だけ measure で測る（100px の字の幅にそろえる）
  const mixed = {...item('原 価', 0, 250), ws: [1000, null, 1000]};
  assert.deepEqual(
    charEdges(mixed, (c) => (c === ' ' ? 50 : 100)),
    [0, 100, 150, 250]
  );
});

test('なぞった端をいちばん近い字の切れ目に合わせる。1 字に満たなければその字', () => {
  const it = item('原価企画の目的', 0, 140); // 1 字 20px
  assert.deepEqual(snapRange([it], 3, 58, measure), {left: 0, right: 60}, '字の途中から途中 → 近い切れ目');
  assert.deepEqual(snapRange([it], 23, 77, measure), {left: 20, right: 80});
  assert.deepEqual(snapRange([it], 42, 47, measure), {left: 40, right: 60}, '短すぎるときは真ん中の字');
  assert.deepEqual(snapRange([it], -30, 400, measure), {left: 0, right: 140}, '字の外まではみ出したら行の端まで');
  assert.equal(textIn([it], 20, 80, measure), '価企画');
});

test('単語：漢字どうし・カタカナどうしはつなげ、ひらがな・句読点は分ける', () => {
  const ws = words('原価企画の目的は、コストダウンです').map(
    (w) => (w.word ? '' : '*') + '原価企画の目的は、コストダウンです'.slice(w.start, w.end)
  );
  assert.deepEqual(ws.slice(0, 5), ['原価企画', 'の', '目的', 'は', '*、']);
  assert.ok(ws.includes('コストダウン'));
});

test('押した位置の単語を覆う。句読点・字の外なら null', () => {
  const it = item('原価企画の目的は、コストを下げる', 0, 320); // 1 字 20px
  assert.deepEqual(wordAt(it, 30, measure), {left: 0, right: 80, str: '原価企画'});
  assert.deepEqual(wordAt(it, 115, measure), {left: 100, right: 140, str: '目的'});
  assert.equal(wordAt(it, 170, measure), null, '「、」は覆わない');
  assert.equal(wordAt(it, 500, measure), null);
  const en = item('Cost down 2026', 0, 140); // 1 字 10px
  assert.deepEqual(wordAt(en, 62, measure), {left: 50, right: 90, str: 'down'});
});

test('描かれた字に合わせる：見積もりの箱と重なる字を丸ごと覆う。上下ははみ出した字まで広げる', () => {
  // 字は 20px ごと（x = 2〜17, 22〜37, …）、y = 8〜27 に描かれている
  const ink = (x, y) =>
    x >= 0 && x < 100 && y >= 8 && y <= 27 && ((x % 20) + 20) % 20 >= 2 && ((x % 20) + 20) % 20 <= 17;
  const r = fitToInk({left: 1, right: 55, top: 10, bottom: 25}, ink, {fh: 20, pad: 0});
  assert.deepEqual([r.left, r.right], [2, 58], '3 字目（42〜57）は大半が箱の中 → 丸ごと覆う');
  assert.deepEqual([r.top, r.bottom], [8, 27], '上下ははみ出した字まで');
  const r2 = fitToInk({left: 4, right: 43, top: 10, bottom: 25}, ink, {fh: 20, pad: 0});
  assert.deepEqual([r2.left, r2.right], [2, 38], '次の字に 1px 入っただけなら覆わない');
});

test('描かれた字に合わせる：字の中のすき間（「が」の濁点・「は」の左の棒）で切らない', () => {
  // 「が」：か（0〜11）と濁点（14〜16）、「成」（22〜37）。字の高さ 20px
  const ga = (x, y) => y >= 0 && y <= 20 && ((x >= 0 && x < 12) || (x >= 14 && x < 17) || (x >= 22 && x < 38));
  const r = fitToInk({left: 15, right: 38, top: 0, bottom: 20}, ga, {fh: 20, pad: 0});
  assert.equal(r.left, 22, '見積もりの左端が濁点の上でも、「が」には入らず「成」から');
  // 「は」：左の棒（40〜42）と右（46〜56）、次の字（62〜77）。見積もりの箱が「は」の左だけ（40〜44）
  const ha = (x, y) => y >= 0 && y <= 20 && ((x >= 40 && x < 43) || (x >= 46 && x < 57) || (x >= 62 && x < 78));
  const r2 = fitToInk({left: 40, right: 44, top: 0, bottom: 20}, ha, {fh: 20, pad: 0});
  assert.deepEqual([r2.left, r2.right], [40, 57], '「は」を丸ごと（左の棒だけにしない）。次の字は覆わない');
  // 見積もりの字の切れ目（edges）があれば、かたまりはその字ごとにまとめる。「に」（右の部分 20〜34）と「は」の左の棒（36〜38）は
  // 合わせると 1 字の幅に収まるが、見積もりでは別の字なのでまとめない
  const niha = (x, y) =>
    y >= 0 &&
    y <= 20 &&
    ((x >= 13 && x < 16) || (x >= 20 && x < 34) || (x >= 36 && x < 39) || (x >= 42 && x < 54) || (x >= 58 && x < 63));
  const edges = [12, 35, 56, 66]; // に・は・，
  const r4 = fitToInk({left: 35, right: 56, top: 0, bottom: 20}, niha, {fh: 30, pad: 0, edges});
  assert.deepEqual([r4.left, r4.right], [36, 54], '「は」だけを丸ごと（「に」も「，」も覆わない）');
  // 英数字だけ（cjk: false）のときはまとめない：「1」（0〜3）と「2」（6〜12）
  const digits = (x, y) => y >= 0 && y <= 20 && ((x >= 0 && x < 4) || (x >= 6 && x < 13));
  const r3 = fitToInk({left: 0, right: 4, top: 0, bottom: 20}, digits, {fh: 20, pad: 0, cjk: false});
  assert.equal(r3.right, 4, '英数字は隣の字とまとめない');
});

test('ImageData から字（背景より暗い画素）を見分ける。背景が暗ければ直さない', () => {
  const img = (rgb) => ({width: 2, height: 1, data: Uint8ClampedArray.from([...rgb, 255, 255, 255, 0, 255])});
  const ink = inkFromImage(img([0, 0, 0]), {x0: 10, y0: 0, scale: 1});
  assert.equal(ink(10, 0), true, '黒い字');
  assert.equal(ink(11, 0), false, '黄色の背景');
  assert.equal(
    inkFromImage({width: 1, height: 1, data: Uint8ClampedArray.from([20, 20, 20, 255])}, {x0: 0, y0: 0, scale: 1}),
    null
  );
});
