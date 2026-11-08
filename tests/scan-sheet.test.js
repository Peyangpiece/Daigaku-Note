import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMATS, pageGeometry, scanDesign, SIZES} from '../src/shared/notebooks.js';
import {SCAN_FORMAT_IDS, SCAN_MARK, decodeScanCode, encodeScanCode} from '../src/shared/scan-code.js';

test('スキャン用の紙：全形式に形式の番号があり、コードは読み戻せる。区切り・検査が合わなければ読まない', () => {
  assert.deepEqual([...SCAN_FORMAT_IDS].sort(), Object.keys(FORMATS).sort(), 'ショップの全形式');
  assert.equal(new Set(SCAN_FORMAT_IDS).size, SCAN_FORMAT_IDS.length);
  for (const f of SCAN_FORMAT_IDS) {
    const bits = encodeScanCode(f);
    assert.equal(bits.length, 23);
    assert.deepEqual(decodeScanCode(bits), {format: f, version: 1});
    // 1 ビットでもちがえば読まない（検査で弾く）
    for (let i = 3; i < 19; i++) {
      const bad = [...bits];
      bad[i] ^= 1;
      const r = decodeScanCode(bad);
      assert.ok(r === null || r.format !== f, `${f}：${i} ビット目のちがいを見逃さない`);
    }
  }
  assert.equal(encodeScanCode('nope'), null);
  assert.equal(decodeScanCode([1, 0, 1]), null);
});

test('スキャン用の紙：B5（原稿用紙は横）。罫は目印とコードにかからない。A4 の紙は変わらない', () => {
  const {inset, size, codeFromBottom} = SCAN_MARK;
  for (const f of SCAN_FORMAT_IDS) {
    const d = scanDesign(f);
    assert.equal(d.size, 'b5');
    assert.equal(d.scan, true);
    const g = pageGeometry(d);
    const land = !!FORMATS[f].landscape;
    assert.deepEqual([g.w, g.h], land ? [SIZES.b5.h, SIZES.b5.w] : [SIZES.b5.w, SIZES.b5.h], f);
    const marks = inset + size; // 目印の内側の端
    for (const l of g.lines) {
      const ys = [l.y1, l.y2];
      assert.ok(Math.min(...ys) > marks + 1, `${f}：上の目印より下`);
      assert.ok(Math.max(...ys) < g.h - codeFromBottom - 1, `${f}：下のコードより上`);
    }
    // 目印 3 つ＋右下の枠 4 本＋コードの黒い部分
    const ink = g.polys.filter((p) => p.c === '#1a1a1a');
    assert.equal(ink.length, 7 + encodeScanCode(f).filter(Boolean).length, f);
  }
  // 横罫 A：B5 は 30 行（セミ B5 のキャンパスノートと同じ 210 mm）
  assert.equal(pageGeometry(scanDesign('a7')).lines.filter((l) => l.y1 === l.y2 && l.x1 === 0).length, 31); // 罫 30 本＋上の線
  // スキャンでない A4 の紙には目印を描かない
  assert.equal(pageGeometry({format: 'a7'}).polys.length, 0);
});
