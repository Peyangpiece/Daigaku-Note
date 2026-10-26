// 画面の通しテスト（SPEC §14.7）：Electron を本当に起動し、ホーム → フォルダ → PDF の編集画面 → 設定 → 開き直しても残る、を確かめる。
// 画面（DISPLAY か xvfb）が要る。CI は xvfb-run で動かす。Electron の実行ファイルがなければ飛ばす
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
let electronPath = null;
try {
  electronPath = require('electron');
} catch {
  /* Electron が入っていない（npm ci の前） */
}
const canRun = !!electronPath && existsSync(electronPath) && (process.env.DISPLAY || process.platform !== 'linux');

/** 小さな PDF（pdf-lib） */
async function samplePdf() {
  const {PDFDocument, StandardFonts} = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 1; p <= 2; p++) doc.addPage([595, 842]).drawText(`Sample p.${p}`, {x: 56, y: 780, size: 20, font});
  return Buffer.from(await doc.save()).toString('base64');
}

async function launch(home) {
  const {_electron} = require('playwright');
  const app = await _electron.launch({
    args: ['.', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: `${home}/.config`,
      XDG_DESKTOP_DIR: `${home}/Desktop`,
      LANG: 'ja_JP.UTF-8'
    },
    timeout: 90000
  });
  const win = await app.firstWindow({timeout: 90000});
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  await win.waitForFunction(() => document.getElementById('view')?.children.length > 0, null, {timeout: 60000});
  return {app, win, errors};
}

test(
  '画面の通し：起動 → フォルダ → PDF → 設定 → 開き直しても残る',
  {skip: !canRun && '画面か Electron がない', timeout: 240000},
  async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'dn-e2e-'));
    const pdf = await samplePdf();
    let {app, win, errors} = await launch(home);
    try {
      // 初回はセットアップ。飛ばしてホームへ
      assert.match(
        await win.evaluate(() => document.querySelector('#view h2')?.textContent ?? ''),
        /あなた|セットアップ|1\./
      );
      await win.evaluate(() => window.daigaku['settings.update']({patch: {skipSetup: true}}));
      // 自分のフォルダを作り、PDF を入れる（IPC で用意し、画面で確かめる）
      const ids = await win.evaluate(async (pdf) => {
        const d = window.daigaku;
        const r = await d['folder.create']({name: '管理会計', scope: 'term', mode: 'new'});
        const bin = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
        const up = await d['material.uploadData']({
          courseId: r.courseId,
          files: [{name: '第3回 原価企画.pdf', data: bin}]
        });
        const st = await d['state.get']();
        return {
          course: r.courseId ?? r.error,
          up: up?.error ?? 'ok',
          material: st.materials[r.courseId]?.[0]?.id,
          today: st.today
        };
      }, pdf);
      assert.equal(ids.up, 'ok');
      assert.match(ids.today, /^\d{4}-\d{2}-\d{2}$/, 'main が今日（JST）を渡す');
      await win.evaluate(() => {
        location.hash = '#/';
        location.reload();
      });
      await win.waitForFunction(() => document.querySelector('.folder, [data-action="open-course"]'), null, {
        timeout: 30000
      });
      assert.ok((await win.evaluate(() => document.body.textContent)).includes('管理会計'), 'ホームにフォルダが出る');
      assert.equal(
        await win.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        true,
        '横スクロールが出ない'
      );
      // PDF の編集画面：pdf.js が描く
      await win.evaluate((id) => (location.hash = `#/viewer/${id}`), ids.material);
      await win.waitForSelector('canvas', {timeout: 60000});
      await win.waitForFunction(() => [...document.querySelectorAll('canvas')].some((c) => c.width > 300), null, {
        timeout: 60000
      });
      // 設定：情報の節と版
      await win.evaluate(() => (location.hash = '#/settings'));
      await win.waitForSelector('#st-about', {timeout: 30000});
      const about = await win.evaluate(() => document.querySelector('#st-about').textContent);
      assert.match(about, /α 版/);
      assert.ok(await win.evaluate(() => !!document.querySelector('[data-backup="export"]')), 'データの節がある');
      assert.deepEqual(errors, [], '画面の例外なし');
    } finally {
      await app.close();
    }
    // 開き直しても残る
    ({app, win, errors} = await launch(home));
    try {
      await win.waitForFunction(() => document.body.textContent.includes('管理会計'), null, {timeout: 30000});
      assert.deepEqual(errors, []);
    } finally {
      await app.close();
      rmSync(home, {recursive: true, force: true});
    }
  }
);
