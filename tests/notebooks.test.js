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
  assert.equal(rows.length, 35, 'A4・A 罫 7 mm は 35 行（キャンパスノートと同じ）');
  assert.equal(pageGeometry({format: 'b6', head: 'none'}).lines.length, 40, 'B 罫 6 mm は 40 行');
  assert.deepEqual([FORMATS.eng13.gap, FORMATS.eng15.gap], [3.5, 3], '英習罫 13 段 3.5 mm・15 段 3 mm');
  assert.equal(rows[0].y1, HEAD_H + 7);
  for (const f of Object.keys(FORMATS)) {
    for (const head of ['none', 'line', 'double', 'date']) {
      const p = pageGeometry({format: f, head, margin: true, dots: true});
      for (const l of p.lines) {
        for (const v of [l.x1, l.x2]) assert.ok(v >= 0 && v <= p.w, `${f} x=${v}`);
        for (const v of [l.y1, l.y2]) assert.ok(v >= 0 && v <= p.bottom + 0.01, `${f} y=${v}`);
      }
    }
  }
  assert.equal(
    pageGeometry({format: 'b6', head: 'none'}).lines.some((l) => l.c === '#a7afb9'),
    false
  );
  assert.equal(pageGeometry({format: 'plain', head: 'none'}).lines.length, 0, '無地で上の線もなしなら何も描かない');
  const staff = pageGeometry({format: 'staff'});
  assert.equal(staff.lines.length, 12 * 5, '五線譜：12 段 × 5 本。段の端の縦線と上の線は引かない');
  assert.deepEqual([staff.lines[0].x1, staff.lines[0].x2], [15, 195], '線の長さ 180 mm');
  assert.equal(staff.lines[4].y1 - staff.lines[0].y1, 8, '五線の高さ 8 mm');
});

test('原稿用紙：A4 横・縦書き 20 × 20。ふりがなの行と、真ん中の柱に魚尾', () => {
  const g = pageGeometry({format: 'genkou', gap: 9});
  assert.deepEqual([g.w, g.h], [PAGE_H, PAGE_W], 'A4 横');
  assert.equal(cleanDesign({format: 'genkou'}).head, 'none', '上の線ははじめなし');
  // ますの横の線（1 行に 19 本 × 20 行）
  const cells = g.lines.filter((l) => l.y1 === l.y2 && Math.abs(l.x2 - l.x1 - 9) < 0.01);
  assert.equal(cells.length, 19 * 20);
  // 行の左の端の x：10 行ずつ 2 つに分かれ、行と行のあいだはふりがなの行（3.6 mm）、柱は 11.25 mm
  const xs = [...new Set(cells.map((l) => +l.x1.toFixed(2)))].sort((a, b) => a - b);
  assert.equal(xs.length, 20);
  assert.equal(+(xs[1] - xs[0]).toFixed(2), 12.6);
  assert.equal(+(xs[10] - xs[9]).toFixed(2), 9 + 11.25);
  assert.equal(g.polys.length, 1, '魚尾');
  const total = xs[19] + 9 - xs[0];
  assert.ok(Math.abs(xs[0] - (g.w - total) / 2) < 0.01, '左右の真ん中');
  for (const l of g.lines) assert.ok(l.x1 >= 0 && l.x2 <= g.w && l.y2 <= g.h);
  assert.match(pageSvg({format: 'genkou'}, {width: 297}), /viewBox="0 0 297 210"/);
});

test('ページの見本の SVG と表紙の絵（字は Palette だけ）', () => {
  assert.match(pageSvg({format: 'grid5'}), /^<svg class="nb-page"/);
  assert.match(
    pageSvg({format: 'a7'}, {width: 120, crop: {x: 0, y: 0, w: 60, h: 60}}),
    /viewBox="0 0 60 60" width="120" height="120"/
  );
  assert.match(pageSvg({format: 'a7'}, {mm: true}), /width="210mm" height="297mm"/);
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

test('方眼：太線の間隔の倍数にそろえて外のわくを太線で閉じる。上の線をなしにしても上のわくは残る', () => {
  for (const f of ['grid5', 'grid4']) {
    const g = pageGeometry({format: f, head: 'none'});
    const ys = g.lines.filter((l) => l.y1 === l.y2);
    const xs = g.lines.filter((l) => l.x1 === l.x2);
    assert.equal((ys.length - 1) % 2, 0, `${f}：行の数は 2 の倍数`);
    assert.equal((xs.length - 1) % 2, 0, `${f}：列の数は 2 の倍数`);
    const thickest = Math.max(...g.lines.map((l) => l.w));
    for (const edge of [ys[0], ys.at(-1), xs[0], xs.at(-1)]) assert.equal(edge.w, thickest, `${f}：外のわくは太線`);
    assert.equal(ys[0].y1, g.top, '上のわく');
  }
  const dots = pageGeometry({format: 'dotgrid'}).dots;
  assert.ok(
    dots.every((p) => p.y > pageGeometry({format: 'dotgrid'}).top),
    'ドット方眼：上の線と点が重ならない'
  );
});
