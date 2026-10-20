import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';

// CSS の { } の数が合っているか（マージで閉じ括弧が落ちると、その後ろの規則がまるごと効かなくなるため）
test('画面の CSS は括弧の対応がとれている', () => {
  const dir = new URL('../src/renderer/styles/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.css'))) {
    const css = readFileSync(new URL(f, dir), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/'[^'\n]*'|"[^"\n]*"/g, '');
    let depth = 0;
    for (const [i, line] of css.split('\n').entries()) {
      for (const ch of line) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
      assert.ok(depth >= 0, `${f}:${i + 1} で閉じ括弧が多い`);
    }
    assert.equal(depth, 0, `${f} で閉じ括弧が ${depth} 個足りない`);
  }
});
