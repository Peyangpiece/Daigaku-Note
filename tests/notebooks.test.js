import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMATS,
  NOTEBOOKS,
  STARTER_NOTEBOOKS,
  LEGACY_PAPER_KEYS,
  cleanDesign,
  pageGeometry,
  pageSvg,
  coverArt,
  cleanMyNotes,
  PAGE_W,
  HEAD_H,
  FOOT_H,
  PAGE_H
} from '../src/shared/notebooks.js';

test('ノートの品：形式ごとに 1 冊、表紙の色はどれもちがう。はじめの 4 冊は v0.18 までの紙', () => {
  assert.equal(NOTEBOOKS.length, Object.keys(FORMATS).length);
  assert.equal(new Set(NOTEBOOKS.map((n) => n.cover)).size, NOTEBOOKS.length, '表紙の色はテンプレートごとにちがう');
  assert.deepEqual(STARTER_NOTEBOOKS.sort(), ['nb-a7', 'nb-b6', 'nb-grid6', 'nb-grid7']);
  for (const id of Object.values(LEGACY_PAPER_KEYS)) assert.ok(STARTER_NOTEBOOKS.includes(id));
  for (const n of NOTEBOOKS) {
    assert.equal(n.type, 'notebook');
    assert.ok(n.name.startsWith('Palette '));
    assert.equal(n.points === 0, STARTER_NOTEBOOKS.includes(n.id));
  }
  // 学習ノートの代表的な罫の幅（mm）
  assert.deepEqual(
    ['a7', 'b6', 'c5', 'u8', 'ul10'].map((f) => FORMATS[f].gap),
    [7, 6, 5, 8, 10]
  );
});

test('紙の設定を整える：知らない値は直し、幅は種類ごとの範囲と 0.5 mm 刻みにする', () => {
  const d = cleanDesign({format: 'nope', gap: 99, line: 'red', weight: 'x', head: '?', paper: '#FFF'});
  assert.equal(d.v, 3);
  assert.equal(d.format, 'b6');
  assert.equal(d.gap, 12, '横罫は 12 mm まで');
  assert.equal(d.line, '#c9cfd6');
  assert.equal(d.weight, 'normal');
  assert.equal(d.head, 'line');
  assert.equal(d.paper, '#ffffff');
  assert.equal(cleanDesign({format: 'a7', gap: 6.3}).gap, 6.5);
  assert.equal(cleanDesign({format: 'staff', gap: 9}).gap, 3);
  assert.equal(cleanDesign({format: 'grid5'}).bold, 2, '5 mm 方眼は 10 mm ごとに太線');
  assert.equal(cleanDesign({format: 'b6', bold: 3}).bold, 0, '太線は方眼だけ');
  assert.equal(cleanDesign({format: 'grid5', margin: true}).margin, false, '余白の線は横罫だけ');
  assert.equal(cleanDesign({format: 'dot-b6'}).dots, true, 'ドット入り罫線ははじめから点');
  assert.equal(cleanDesign({format: 'b6'}).dots, false);
});

test('ページの計算：横罫は上の欄の下から下の余白まで行の間ごと。線はページの中に収まる', () => {
  const g = pageGeometry({format: 'a7'});
  const rows = g.lines.filter((l) => l.c === '#c9cfd6');
  assert.equal(rows.length, Math.floor((PAGE_H - FOOT_H - HEAD_H) / 7));
  assert.equal(rows[0].y1, HEAD_H + 7);
  for (const f of Object.keys(FORMATS)) {
    for (const head of ['none', 'line', 'double', 'date']) {
      const p = pageGeometry({format: f, head, margin: true, dots: true});
      for (const l of p.lines) {
        for (const v of [l.x1, l.x2]) assert.ok(v >= 0 && v <= PAGE_W, `${f} x=${v}`);
        for (const v of [l.y1, l.y2]) assert.ok(v >= 0 && v <= PAGE_H - FOOT_H + 0.01, `${f} y=${v}`);
      }
    }
  }
  assert.equal(
    pageGeometry({format: 'b6', head: 'none'}).lines.some((l) => l.c === '#a7afb9'),
    false
  );
  assert.equal(pageGeometry({format: 'plain', head: 'none'}).lines.length, 0, '無地で上の線もなしなら何も描かない');
  const staff = pageGeometry({format: 'staff', head: 'none'});
  assert.equal(staff.lines.length, 12 * 7, '五線譜：12 段 × （5 本＋左右の縦線）');
});

test('ページの見本の SVG と表紙の絵（字は Palette だけ）', () => {
  assert.match(pageSvg({format: 'grid5'}), /^<svg class="nb-page"/);
  const art = coverArt(NOTEBOOKS.find((n) => n.id === 'nb-a7'));
  assert.match(art, />Palette</);
  assert.deepEqual(
    [...art.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]),
    ['Palette'],
    '表紙の字は Palette だけ'
  );
});

test('マイノート：持っているノートのものだけ・形式はもとのノートのもの・最大 30 冊', () => {
  const list = cleanMyNotes(
    [
      {id: 'my-1', name: '  授業用  ', base: 'nb-a7', design: {format: 'staff', gap: 9, line: '#123456'}},
      {id: 'my-2', name: 'x', base: 'nb-staff', design: {}},
      {id: 'bad id', base: 'nb-a7'},
      {id: 'my-1', base: 'nb-b6'}
    ],
    ['nb-a7', 'nb-b6']
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].name, '授業用');
  assert.equal(list[0].design.format, 'a7', '形式はもとのノートのもの');
  assert.equal(list[0].design.gap, 9);
  assert.equal(list[0].design.line, '#123456');
  const many = Array.from({length: 40}, (_, i) => ({id: `my-${i}`, base: 'nb-a7'}));
  assert.equal(cleanMyNotes(many, ['nb-a7']).length, 30);
});
