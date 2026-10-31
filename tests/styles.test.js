import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

// 画面の CSS の決まり（SPEC §8.0・§8.0.2）：文字は 13px 以上、動きの長さは --motion を通す（reduced-motion で 0 になる）、
// 角丸・危険の色・ショップの金色はトークン（tokens.css）から取る
// 画面の CSS は styles/ の中で関心ごとに分かれている（index.html が順に読む）。tokens.css 以外を全部つなげて見る
const dir = new URL('../src/renderer/styles/', import.meta.url);
const sheets = readdirSync(dir).filter((f) => f.endsWith('.css') && f !== 'tokens.css');
const css = sheets.map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
const tokens = readFileSync(new URL('tokens.css', dir), 'utf8');

test('CSS：13px より小さい文字がない（SPEC の最小 13px）', () => {
  // rem は本文 15px が基準（tokens.css の --fs-body）
  const small = [...css.matchAll(/font-size:\s*(\d*\.?\d+)(px|rem)/g)].filter(
    (m) => Number(m[1]) * (m[2] === 'rem' ? 15 : 1) < 13
  );
  assert.deepEqual(
    small.map((m) => m[0]),
    [],
    '13px 未満は var(--fs-small) に'
  );
});

test('CSS：遷移とアニメーションの長さに固定の秒がない（--motion を通す）', () => {
  const fixed = [...css.matchAll(/(?:transition|animation):[^;]*\b\d*\.?\d+m?s\b[^;]*;/g)]
    .map((m) => m[0])
    .filter((t) => !t.includes('var(--motion'));
  assert.deepEqual(fixed, []);
});

test('CSS：画面の CSS が使うトークンは tokens.css か自分の中で定義されている', () => {
  const defined = new Set([...`${tokens}\n${css}`.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
  // 値は JS が style で入れるもの（色・座標など）。CSS の中で定義されない
  const byJs = new Set([
    '--swatch',
    '--ink',
    '--body',
    '--current',
    '--index',
    '--sticky-color',
    '--sticky-angle',
    '--memo',
    '--memo-lh',
    '--case-base',
    '--case-img',
    '--curl',
    '--scale-factor',
    '--total-scale-factor',
    '--min-font-size',
    '--text-scale-factor',
    '--min-font-size-inv',
    '--font-height',
    '--scale-x',
    '--rotate',
    '--tape-image',
    '--note-color',
    '--sw',
    '--r',
    '--big',
    '--s',
    '--fig-w'
  ]);
  const missing = [...used].filter((v) => !defined.has(v) && !byJs.has(v));
  assert.deepEqual(missing, [], `tokens.css に無い: ${missing.join(', ')}`);
});
