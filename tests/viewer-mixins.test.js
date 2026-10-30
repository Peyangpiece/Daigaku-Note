// PDF の編集画面は、関心ごとのファイル（views/viewer/*.js）のメソッドを Viewer に足して作る。
// 名前が重なると後のほうが黙って上書きする（v0.12.2 まで、注釈の renderText がページの文字の層の renderText を上書きしていた）。
// 画面を開かずに、ファイルの中のメソッド名を読んで重なりがないことを確かめる（画面では viewer.js が読み込み時に止める）
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer/views');
const names = (src) => [...src.matchAll(/^ {2}(?:async )?([A-Za-z_$][\w$]*)\(/gm)].map((m) => m[1]);

test('Viewer に足すメソッドの名前は、ファイルどうし・Viewer 自身と重ならない', () => {
  const seen = new Map();
  const viewer = readFileSync(path.join(DIR, 'viewer.js'), 'utf8');
  const cls = viewer.slice(viewer.indexOf('class Viewer'), viewer.indexOf('const MIXINS'));
  for (const n of names(cls)) if (n !== 'constructor') seen.set(n, 'viewer.js');
  for (const f of readdirSync(path.join(DIR, 'viewer')).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(path.join(DIR, 'viewer', f), 'utf8');
    const i = src.indexOf('export const methods = {');
    if (i < 0) continue;
    for (const n of names(src.slice(i))) {
      assert.ok(!seen.has(n), `${n} が ${seen.get(n)} と ${f} で重なっている`);
      seen.set(n, f);
    }
  }
  assert.ok(seen.get('renderTextLayer') === 'pages.js' && seen.get('renderText') === 'annotations.js');
});
