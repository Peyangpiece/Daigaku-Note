import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// 画面の CSS の決まり（SPEC §8.0・§8.0.2）：文字は 13px 以上、動きの長さは --motion を通す（reduced-motion で 0 になる）、
// 角丸・危険の色・ショップの金色はトークン（tokens.css）から取る
const css = readFileSync(new URL('../src/renderer/styles/notebook.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../src/renderer/styles/tokens.css', import.meta.url), 'utf8');

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

test('CSS：notebook.css が使うトークンは tokens.css か自分の中で定義されている', () => {
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
