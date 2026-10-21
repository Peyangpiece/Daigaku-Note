// 配布物の動作確認（Microsoft Store 向けの MSIX など、パッケージの中で動くかを確かめる。.github/workflows/msix-check.yml）。
// `大学ノート.exe --self-test=<結果の JSON のパス>` で起動すると、窓を開かずに次を順に確かめ、結果を書いて終わる。
// ふだんのデータには触らない（userData の self-test フォルダと、保存先の下の一時ファイルだけを使う）
import {app, safeStorage} from 'electron';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {openDatabase} from './db/db.js';
import {ensureChromium} from './browser/install.js';
import {defaultRoot} from '../shared/paths.js';

export const selfTestPath = (argv = process.argv) => argv.find((a) => a.startsWith('--self-test='))?.slice('--self-test='.length) || null;

export async function runSelfTest(out) {
  const result = {version: app.getVersion(), windowsStore: !!process.windowsStore, platform: process.platform, checks: {}};
  const check = async (name, fn) => {
    try {
      result.checks[name] = {ok: true, detail: (await fn()) ?? ''};
    } catch (e) {
      result.checks[name] = {ok: false, detail: String(e?.stack ?? e).slice(0, 800)};
    }
  };
  const base = path.join(app.getPath('userData'), 'self-test');
  await check('userData に書ける', () => {
    mkdirSync(base, {recursive: true});
    writeFileSync(path.join(base, 'probe.txt'), '大学ノート');
    return `${base}（読み戻し：${readFileSync(path.join(base, 'probe.txt'), 'utf8')}）`;
  });
  await check('保存先（デスクトップ）に書ける', () => {
    const root = defaultRoot(app.getPath('desktop'));
    const f = path.join(root, '.self-test', 'probe.txt');
    mkdirSync(path.dirname(f), {recursive: true});
    writeFileSync(f, 'ok');
    const back = readFileSync(f, 'utf8');
    rmSync(path.join(root, '.self-test'), {recursive: true, force: true});
    return `${root}（読み戻し：${back}）`;
  });
  await check('SQLite を開ける', async () => {
    const {db} = await openDatabase(path.join(base, 'probe.sqlite'));
    const n = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
    db.close?.();
    return `settings ${n} 件`;
  });
  await check('秘密を暗号化できる', () => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage が使えません');
    return safeStorage.decryptString(safeStorage.encryptString('probe')) === 'probe' ? '暗号化・復号できた' : '復号の結果が違う';
  });
  const browsers = path.join(base, 'pw-browsers');
  await check('LMS 用のブラウザを取り込める', () => ensureChromium(browsers, {log: () => {}}));
  await check('取り込んだブラウザを動かせる', async () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
    const {chromium} = await import('playwright');
    const b = await chromium.launch({headless: true});
    try {
      const page = await b.newPage();
      await page.setContent('<title>大学ノート</title><p>ok</p>');
      return `ページの題：${await page.title()}`;
    } finally {
      await b.close();
    }
  });
  result.ok = Object.values(result.checks).every((c) => c.ok);
  mkdirSync(path.dirname(out), {recursive: true});
  writeFileSync(out, JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
}
