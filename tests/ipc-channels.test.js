import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// main の IPC の窓口（ipc.js の handle）と preload の許可一覧（INVOKE）がそろっているか。
// 窓口があるのに許可にないと、レンダラから呼んだとき TypeError になる（v0.9.0 の term.readCalendar）
const ipc = readFileSync(new URL('../src/main/ipc.js', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../src/preload/preload.js', import.meta.url), 'utf8');
const handles = [...ipc.matchAll(/handle\('([a-zA-Z.]+)'/g)].map((m) => m[1]);
const invoke = preload.slice(preload.indexOf('INVOKE'), preload.indexOf('ON ='));
const allowed = [...invoke.matchAll(/'([a-zA-Z.]+)'/g)].map((m) => m[1]);

test('IPC：main の窓口はすべて preload の許可一覧にある', () => {
  assert.ok(handles.length > 50, `窓口が少なすぎる（${handles.length}）`);
  const missing = handles.filter((h) => !allowed.includes(h));
  assert.deepEqual(missing, [], `preload の INVOKE に無い: ${missing.join(', ')}`);
});

test('IPC：preload の許可一覧に、main に無い窓口は残っていない', () => {
  const extra = allowed.filter((a) => !handles.includes(a));
  assert.deepEqual(extra, [], `main に窓口が無い: ${extra.join(', ')}`);
});

test('第三者ライセンスの一覧（THIRD-PARTY-NOTICES.md）に、package.json の本番の依存がすべて載っている', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const notices = readFileSync(new URL('../THIRD-PARTY-NOTICES.md', import.meta.url), 'utf8');
  for (const [name, version] of Object.entries(pkg.dependencies))
    assert.ok(
      notices.includes(`### ${name} ${version}`),
      `${name} ${version} が一覧にない（node scripts/third-party-notices.mjs を実行）`
    );
  assert.match(notices, /Noto Sans JP/);
  assert.match(notices, /three\.js の addons/);
});
