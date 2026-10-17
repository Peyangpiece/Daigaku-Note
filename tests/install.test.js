import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromiumReady, ensureChromium, playwrightVersion} from '../src/main/browser/install.js';

test('Playwright の CLI を見つけて実行し、終わったら印を書く（CLI は --help で代用）', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dn-pw-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  assert.equal(chromiumReady(dir), false);
  // 本物の取り込みは重いので、`node` を execPath にし、PLAYWRIGHT_BROWSERS_PATH に既存の Chromium があればすぐ終わる。
  // ここでは CLI が見つかること（exports の問題が起きないこと）と、失敗時の文言だけを確かめる
  const statuses = [];
  const r = await ensureChromium(dir, {onStatus: (s) => statuses.push(s), execPath: process.execPath, isElectron: false}).catch((e) => e);
  if (r instanceof Error) {
    assert.doesNotMatch(r.message, /Playwright が見つかりません/, 'CLI は見つかること');
    assert.match(r.message, /ブラウザの準備に失敗しました（終了コード/);
  } else {
    assert.equal(r, 'installed');
    assert.equal((await readFile(path.join(dir, '.ready'), 'utf8')).trim(), playwrightVersion());
    assert.equal(chromiumReady(dir), true);
  }
  assert.ok(statuses[0]?.includes('ブラウザを準備しています'));
});
