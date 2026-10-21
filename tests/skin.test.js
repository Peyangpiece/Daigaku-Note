import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_TEMPLATES,
  CLASSIC_ID,
  FORMAT,
  ROTATION,
  roundColorIndex,
  contrast,
  darken,
  inkOn,
  luminance,
  normalizeTemplate,
  resolveSkin,
  rotationFor,
  usage
} from '../src/shared/skin.js';
import {BUILTIN_STICKERS, builtinStickerUrl} from '../src/shared/stickers.js';

const SHA = 'a'.repeat(64);

test('テンプレートの形：知らない項目は捨て、範囲外は既定値。CSS の文字列などは入らない', () => {
  const t = normalizeTemplate(
    {
      name: '  わたしの 1 ',
      license: 'all-rights',
      version: 'x',
      evil: '<script>',
      parts: {
        note: {type: 'zigzag', paper: 'red; background:url(x)', line: '#ABCDEF', gap: 'wide', margin: 'yes'},
        folder: {card: '#ffffff', tab: 'course'},
        tape: {color: 'course', pattern: 'check'}
      },
      stickers: [{place: 'folder', asset: SHA, x: 2, y: -1, scale: 9, rotate: 270, z: 3}, {place: 'wall', asset: SHA}],
      assets: {[SHA]: {w: 9999, h: 100}}
    },
    {id: 'T1', now: '2026-10-21T00:00:00.000Z'}
  );
  assert.equal(t.format, FORMAT);
  assert.equal(t.formatVersion, 1);
  assert.equal(t.id, 'T1');
  assert.equal(t.name, 'わたしの 1');
  assert.equal(t.license, 'personal');
  assert.equal(t.version, '1.0.0');
  assert.equal('evil' in t, false);
  assert.deepEqual(t.parts.note, {type: 'ruled', paper: 'default', line: '#abcdef', gap: 'wide', margin: true});
  assert.deepEqual(t.parts.folder, {card: '#ffffff', tab: 'default'}, 'タブに course は使えない');
  assert.deepEqual(t.parts.tape, {color: 'course', pattern: 'check', image: null});
  assert.deepEqual(t.stickers, [{place: 'folder', asset: SHA, x: 1, y: 0, scale: 2, rotate: 180, z: 3}], '貼れない場所は捨て、値は範囲に収める');
  assert.deepEqual(t.assets, {[SHA]: {mime: 'image/png', w: 512, h: 100}});
});

test('テンプレートの形：新しすぎる版・ほかの形式は断る', () => {
  assert.throws(() => normalizeTemplate({formatVersion: 2}), /新しい版/);
  assert.throws(() => normalizeTemplate({format: 'other'}), /テンプレートではありません/);
});

test('シールは 1 か所 5 枚まで', () => {
  const t = normalizeTemplate({stickers: Array.from({length: 8}, () => ({place: 'folder', asset: SHA}))});
  assert.equal(t.stickers.length, 5);
});

test('どのテンプレートが当たるか：授業のテンプレート > 全体。ノートは全体だけ。シールは sticker_mode で', () => {
  const mine = normalizeTemplate({parts: {folder: {card: '#111111'}, note: {type: 'grid'}}, stickers: [{place: 'folder', asset: SHA, z: 1}]}, {id: 'M'});
  const glob = normalizeTemplate({parts: {folder: {card: '#eeeeee'}, note: {type: 'dot'}}, stickers: [{place: 'folder', asset: 'b'.repeat(64), z: 0}]}, {id: 'G'});
  const all = [...BUILTIN_TEMPLATES, mine, glob];
  const plain = resolveSkin(all, 'G', {skin_template_id: null});
  assert.equal(plain.folder.card, '#eeeeee');
  assert.equal(plain.own, false);
  const own = resolveSkin(all, 'G', {skin_template_id: 'M', sticker_mode: 'global'});
  assert.equal(own.folder.card, '#111111');
  assert.equal(own.note.type, 'dot', 'ノートは全体のテンプレートから');
  assert.deepEqual(own.stickers.map((s) => s.asset[0]), ['b']);
  assert.deepEqual(resolveSkin(all, 'G', {skin_template_id: 'M', sticker_mode: 'course'}).stickers.map((s) => s.asset[0]), ['a']);
  assert.deepEqual(resolveSkin(all, 'G', {skin_template_id: 'M', sticker_mode: 'both'}).stickers.map((s) => s.asset[0]), ['b', 'a']);
  assert.equal(resolveSkin(all, 'gone', {skin_template_id: 'gone'}).template.id, CLASSIC_ID, '消えたテンプレートはクラシックに');
});

test('クラシックは今の見た目のまま（テーマの色・授業ごとのテープ）', () => {
  const c = BUILTIN_TEMPLATES.find((t) => t.id === CLASSIC_ID);
  assert.deepEqual(c.parts.folder, {card: 'default', tab: 'default'});
  assert.deepEqual(c.parts.tape, {color: 'course', pattern: 'course', image: null});
  assert.equal(c.parts.note.paper, 'default');
});

test('新しい授業への割り当て：クラシック以外を順に、となり同士は違うもの', () => {
  assert.equal(ROTATION.includes(CLASSIC_ID), false);
  for (let i = 0; i < 20; i++) assert.notEqual(rotationFor(i), rotationFor(i + 1));
  assert.equal(rotationFor(-1), ROTATION.at(-1));
});

test('使っている数', () => {
  const cs = [{skin_template_id: 'M'}, {skin_template_id: 'M'}, {skin_template_id: null}];
  assert.deepEqual(usage('M', cs, 'G'), {courses: 2, global: false});
  assert.deepEqual(usage('G', cs, 'G'), {courses: 0, global: true});
});

test('文字の色：背景に対してコントラストの高いほう', () => {
  assert.equal(inkOn('#ffffff'), '#2b2b2b');
  assert.equal(inkOn('#1f2a44'), '#f4f5f7');
  assert.ok(contrast('#ffffff', '#2b2b2b') > 14);
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01);
});

test('暗い表示の色：色合いを保って暗くする', () => {
  const d = darken('#fff6f8');
  assert.ok(luminance(d) < 0.05, `${d} は暗い`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(d.slice(i, i + 2), 16));
  assert.ok(r > g && r > b, `${d} は赤み（さくら色）を残す`);
  assert.ok(contrast(d, '#eceff4') >= 4.5, '暗い表示の文字が読める');
});

test('はじめからあるテンプレートのフォルダは、黒い文字で読める（4.5:1 以上）', () => {
  for (const t of BUILTIN_TEMPLATES) {
    if (t.parts.folder.card === 'default') continue;
    assert.ok(contrast(t.parts.folder.card, inkOn(t.parts.folder.card)) >= 4.5, t.name);
  }
});

test('シールの場所：フォルダ・ホームの余白・授業ページの見出し・PDF 編集画面の余白。はじめから入っているシールも使える', () => {
  const t = normalizeTemplate({
    stickers: [
      {place: 'home', asset: 'builtin-star'},
      {place: 'heading', asset: SHA},
      {place: 'viewer', asset: 'builtin-exam'},
      {place: 'viewer', asset: 'builtin-nothing'}
    ]
  });
  assert.deepEqual(t.stickers.map((s) => s.place), ['home', 'heading', 'viewer']);
  assert.deepEqual(Object.keys(t.assets), [SHA], 'はじめから入っているシールは assets に入れない');
});

test('テープの柄に画像：画像がなければ無地に戻す', () => {
  assert.deepEqual(normalizeTemplate({parts: {tape: {pattern: 'image', image: SHA}}}).parts.tape, {color: 'course', pattern: 'image', image: SHA});
  assert.deepEqual(normalizeTemplate({parts: {tape: {pattern: 'image', image: 'x'}}}).parts.tape, {color: 'course', pattern: 'plain', image: null});
  assert.deepEqual(normalizeTemplate({parts: {tape: {pattern: 'stripe', image: SHA}}}).parts.tape.image, null, '画像の柄でなければ画像は持たない');
  assert.ok(SHA in normalizeTemplate({parts: {tape: {pattern: 'image', image: SHA}}}).assets, 'テープの画像も assets に');
});

test('はじめから入っているシール：20 枚ほど、意味のあるシール（試験・課題…）を含む', () => {
  assert.ok(BUILTIN_STICKERS.length >= 20);
  for (const n of ['試験', '課題', '小テスト', '重要', '休講']) assert.ok(BUILTIN_STICKERS.some((s) => s.name === n && s.kind === 'mark'), n);
  for (const s of BUILTIN_STICKERS) assert.match(builtinStickerUrl(s.id), /^data:image\/svg\+xml/);
});

test('ファイル・付箋・しおり：種類ごとの色、色の並び、リボンの形', () => {
  const t = normalizeTemplate({
    parts: {
      file: {pdf: '#FF0000', slide: 'red', nope: '#000000'},
      sticky: {round: Array(8).fill('#123456'), pdf: ['#111111']},
      bookmark: {color: '#00ff00', shape: 'star'}
    }
  });
  assert.equal(t.parts.file.pdf, '#ff0000');
  assert.equal(t.parts.file.slide, 'default');
  assert.equal('nope' in t.parts.file, false);
  assert.equal(t.parts.sticky.round.length, 15, '前の版の 8 色は、9 回目からをはじめの色で埋めて引き継ぐ');
  assert.deepEqual(t.parts.sticky.round.slice(7, 9), ['#123456', '#5ed9d1']);
  assert.equal(t.parts.sticky.pdf, 'default', '数が合わない並びは、はじめの色に');
  assert.deepEqual(t.parts.bookmark, {color: '#00ff00', shape: 'tag'});
});

test('決まった位置のシール：回の付箋・しおりは 1 枚、資料のイラストは種類ごとに 1 枚', () => {
  const t = normalizeTemplate({
    stickers: [
      {place: 'round', asset: 'builtin-star'},
      {place: 'round', asset: 'builtin-heart'},
      {place: 'file', kind: 'pdf', asset: 'builtin-exam'},
      {place: 'file', kind: 'pdf', asset: 'builtin-task'},
      {place: 'file', kind: 'slide', asset: 'builtin-task'},
      {place: 'file', kind: 'movie', asset: 'builtin-task'},
      {place: 'bookmark', asset: 'builtin-crown'}
    ]
  });
  assert.deepEqual(
    t.stickers.map((s) => `${s.place}${s.kind ? `:${s.kind}` : ''}:${s.asset}`),
    ['round:builtin-star', 'file:pdf:builtin-exam', 'file:slide:builtin-task', 'bookmark:builtin-crown']
  );
});

test('資料のイラストの中身：印とラベルのずれは ±40 に収め、出すかどうかは真偽だけ。前の版のテンプレートは元のまま', () => {
  const t = normalizeTemplate({parts: {fileArt: {pdf: {mark: {dx: 99, dy: -3.14, on: false}, label: {on: 'no'}}, nope: {mark: {dx: 1}}}}});
  assert.deepEqual(t.parts.fileArt.pdf, {mark: {dx: 40, dy: -3.1, on: false}, label: {dx: 0, dy: 0, on: true}});
  assert.equal('nope' in t.parts.fileArt, false);
  assert.deepEqual(normalizeTemplate({}).parts.fileArt.video, {mark: {dx: 0, dy: 0, on: true}, label: {dx: 0, dy: 0, on: true}});
  assert.deepEqual(resolveSkin([t], t.id).fileArt.pdf.mark.on, false, 'テンプレートの中身が当たる');
});

test('1 か所に 1 枚のシール：動かしたもの（moved）だけ位置を持つ。ほかの場所には付けない', () => {
  const t = normalizeTemplate({
    stickers: [
      {place: 'round', asset: 'builtin-star', x: 0.3, y: 0.7, moved: true},
      {place: 'file', kind: 'pdf', asset: 'builtin-star', moved: 'yes'},
      {place: 'folder', asset: 'builtin-star', moved: true}
    ]
  });
  assert.deepEqual(t.stickers.map((s) => s.moved ?? false), [true, false, false]);
  assert.equal(t.stickers[0].x, 0.3);
});

test('回の付箋の色：第 1 回から順に 15 色。16 回目からはまた 1 色目、「その他」（第 0 回）は 1 色目', () => {
  assert.equal(roundColorIndex(1), 0);
  assert.equal(roundColorIndex(15), 14);
  assert.equal(roundColorIndex(16), 0);
  assert.equal(roundColorIndex(0), 0);
  assert.equal(normalizeTemplate({parts: {sticky: {round: Array(15).fill('#abcdef')}}}).parts.sticky.round.length, 15);
  assert.equal(normalizeTemplate({parts: {sticky: {round: Array(5).fill('#abcdef')}}}).parts.sticky.round, 'default', '数が合わない並びは、はじめの色に');
});
