import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_TEMPLATES,
  CLASSIC_ID,
  FORMAT,
  ROTATION,
  contrast,
  darken,
  inkOn,
  luminance,
  normalizeTemplate,
  resolveSkin,
  rotationFor,
  usage
} from '../src/shared/skin.js';

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
      stickers: [{place: 'folder', asset: SHA, x: 2, y: -1, scale: 9, rotate: 90, z: 3}, {place: 'wall', asset: SHA}],
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
  assert.deepEqual(t.parts.tape, {color: 'course', pattern: 'check'});
  assert.deepEqual(t.stickers, [{place: 'folder', asset: SHA, x: 1, y: 0, scale: 2, rotate: 45, z: 3}], '貼れない場所は捨て、値は範囲に収める');
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
  assert.deepEqual(c.parts.tape, {color: 'course', pattern: 'course'});
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
