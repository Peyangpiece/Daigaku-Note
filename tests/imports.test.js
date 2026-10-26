import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';

// レンダラの import の決まり（v0.10.4）：画面（views・desk・viewer）は app.js を読まず、ui-kit.js（DOM の部品）と store.js（状態・経路）を読む。
// 静的な import に循環がない。shared は shared の中だけを読む（Node のテストからも読めるように）
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === 'vendor' ? [] : walk(p);
    return f.endsWith('.js') ? [p] : [];
  });
const importsOf = (file) =>
  [...readFileSync(file, 'utf8').matchAll(/^(?:import|export)\s[^;]*?from\s+'([^']+)';/gm)]
    .map((m) => m[1])
    .filter((s) => s.startsWith('.'))
    .map((s) => path.resolve(path.dirname(file), s));

test('レンダラ：app.js を読むのは app.js だけ（画面は ui-kit.js と store.js を読む）', () => {
  const app = path.join(ROOT, 'src/renderer/app.js');
  const offenders = walk(path.join(ROOT, 'src/renderer'))
    .filter((f) => f !== app && importsOf(f).includes(app))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(offenders, []);
});

test('レンダラ：静的な import に循環がない', () => {
  const files = walk(path.join(ROOT, 'src/renderer'));
  const graph = new Map(files.map((f) => [f, importsOf(f).filter((d) => files.includes(d))]));
  const state = new Map();
  const cycles = [];
  const visit = (f, stack) => {
    if (state.get(f) === 'done') return;
    if (state.get(f) === 'on')
      return cycles.push([...stack.slice(stack.indexOf(f)), f].map((x) => path.relative(ROOT, x)));
    state.set(f, 'on');
    for (const d of graph.get(f) ?? []) visit(d, [...stack, f]);
    state.set(f, 'done');
  };
  for (const f of files) visit(f, []);
  assert.deepEqual(cycles, [], `循環: ${cycles.map((c) => c.join(' → ')).join('\n')}`);
});

test('shared：shared の中だけを読む（main・renderer に頼らない）', () => {
  const dir = path.join(ROOT, 'src/shared');
  const bad = walk(dir)
    .flatMap((f) => importsOf(f).map((d) => [f, d]))
    .filter(([, d]) => !d.startsWith(dir))
    .map(([f, d]) => `${path.relative(ROOT, f)} → ${path.relative(ROOT, d)}`);
  assert.deepEqual(bad, []);
});
