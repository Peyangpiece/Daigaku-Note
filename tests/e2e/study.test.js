// 画面の通しテスト：資料をまたいで探す（#/search）→ 見つけたページを開く、暗記モード（文字隠しのマーカーを 1 つずつ確かめる）。
// Electron を本当に起動する。画面（DISPLAY か xvfb）が要る。Electron の実行ファイルがなければ飛ばす
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let electronPath = null;
try {
  electronPath = require('electron');
} catch {
  /* Electron が入っていない（npm ci の前） */
}
const canRun = !!electronPath && existsSync(electronPath) && (process.env.DISPLAY || process.platform !== 'linux');

async function pdfOf(pages) {
  const {PDFDocument, StandardFonts} = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const pg = doc.addPage([595, 842]);
    lines.forEach((t, i) => pg.drawText(t, {x: 56, y: 780 - i * 30, size: 18, font}));
  }
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
  '画面の通し：資料をさがす → 見つけたページを開く → 暗記モード',
  {skip: !canRun && '画面か Electron がない', timeout: 240000},
  async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'dn-e2e-study-'));
    const a = await pdfOf([['Cost accounting basics'], ['Break-even point', 'Contribution margin ratio']]);
    const b = await pdfOf([['Target costing overview']]);
    const {app, win, errors} = await launch(home);
    try {
      await win.evaluate(() => window.daigaku['settings.update']({patch: {skipSetup: true}}));
      const ids = await win.evaluate(
        async ([a, b]) => {
          const d = window.daigaku;
          const bin = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
          const r = await d['folder.create']({name: '管理会計', scope: 'term', mode: 'new'});
          await d['material.uploadData']({
            courseId: r.courseId,
            files: [
              {name: '第2回 原価計算.pdf', data: bin(a)},
              {name: '第3回 原価企画.pdf', data: bin(b)}
            ]
          });
          const st = await d['state.get']();
          return {course: r.courseId, first: st.materials[r.courseId].find((m) => /原価計算/.test(m.name)).id};
        },
        [a, b]
      );
      await win.evaluate(() => {
        location.hash = '#/';
        location.reload();
      });

      // ---- さがす：ホームの欄から。本文（PDF の中の文字）を読んで、ページと前後の文字を出す ----
      await win.waitForSelector('.home-search__input', {timeout: 30000});
      await win.fill('.home-search__input', 'margin');
      await win.press('.home-search__input', 'Enter');
      await win.waitForSelector('button.search__hit', {timeout: 30000});
      assert.equal(await win.evaluate(() => location.hash), '#/search');
      const hit = await win.evaluate(() => document.querySelector('button.search__hit').innerText);
      assert.match(hit, /2 ページ/);
      assert.match(hit, /Contribution margin ratio/);
      assert.equal(await win.evaluate(() => document.querySelector('.search mark').textContent), 'margin');
      // 名前でも見つかる。打ち直しても、入力の続きが切れない
      await win.fill('#search-q', '');
      await win.type('#search-q', '原価企画', {delay: 20});
      await win.waitForFunction(
        () => [...document.querySelectorAll('.search__name strong')].some((x) => /原価企画/.test(x.textContent)),
        null,
        {timeout: 15000}
      );
      assert.equal(await win.evaluate(() => document.activeElement?.id), 'search-q');
      // 見つけた所を開く：そのページへ行き、言葉に印が付く。戻ると、さがす画面（言葉もそのまま）
      await win.fill('#search-q', 'margin');
      await win.waitForSelector('button.search__hit', {timeout: 15000});
      await win.click('button.search__hit');
      await win.waitForSelector('.viewer-bar', {timeout: 30000});
      await win.waitForFunction(
        () => /1 \/ 1/.test(document.querySelector('[data-v="find-count"]')?.textContent),
        null,
        {
          timeout: 30000
        }
      );
      assert.equal(await win.evaluate(() => document.querySelector('[data-v="find-q"]').value), 'margin');
      assert.equal(await win.evaluate(() => document.querySelector('[data-v="page"]').value), '2', '見つけたページ');
      await win.click('[data-v="back"]');
      await win.waitForSelector('#search-q', {timeout: 15000});
      assert.equal(await win.evaluate(() => document.getElementById('search-q').value), 'margin');

      // ---- 暗記モード：文字隠しのマーカーを黒く隠し、1 つずつ「答えを見る → 覚えた／まだ」 ----
      await win.evaluate(async (id) => {
        const save = (page, y, w) =>
          window.daigaku['annotation.save']({
            materialId: id,
            annotation: {id: null, page, kind: 'mask', rect: {x: 56, y, w, h: 20}, body: 'x', style: {}}
          });
        await save(2, 746, 120);
        await save(1, 776, 60);
        await save(2, 776, 150);
        location.hash = `#/viewer/${id}`;
      }, ids.first);
      await win.waitForSelector('.anno-mask', {timeout: 30000});
      await win.waitForFunction(() => document.querySelector('[data-v="anki"]')?.hidden === false, null, {
        timeout: 15000
      });
      await win.click('[data-v="anki"]');
      const st = () =>
        win.evaluate(() => ({
          count: document.querySelector('[data-v="anki-count"]').textContent,
          cur: [...document.querySelectorAll('.anno-mask')].filter((e) => e.classList.contains('is-anki-current'))
            .length,
          open: !!document.querySelector('.anno-mask.is-anki-open'),
          hidden: getComputedStyle(document.querySelector('.anno-mask:not(.is-anki-open)')).backgroundColor,
          done: !document.querySelector('[data-v="anki-done"]').hidden,
          result: document.querySelector('[data-v="anki-result"]').textContent
        }));
      let s = await st();
      assert.deepEqual([s.count, s.cur, s.open, s.done], ['1 / 3', 1, false, false]);
      assert.equal(s.hidden, 'rgb(31, 31, 31)', 'マーカーは黒く隠れる');
      await win.keyboard.press('Space'); // 答えを見る
      assert.equal((await st()).open, true);
      await win.keyboard.press('ArrowRight'); // 覚えた
      await win.keyboard.press('ArrowLeft'); // まだ
      s = await st();
      assert.deepEqual([s.count, s.open], ['3 / 3', false]);
      await win.keyboard.press('2'); // まだ
      s = await st();
      assert.equal(s.done, true);
      assert.equal(s.result, '覚えた 1・まだ 2');
      await win.click('[data-v="anki-again"]'); // 「まだ」だけもう一度
      assert.equal((await st()).count, '1 / 2');
      await win.keyboard.press('Escape');
      assert.equal(
        await win.evaluate(() => document.querySelector('.viewer-pages').classList.contains('is-anki')),
        false
      );
      // 覚えたかどうかは残る（ページ → 上からの順：1 ページ目が最初）
      const saved = await win.evaluate(
        async (id) =>
          (await window.daigaku['annotation.list']({materialId: id})).annotations
            .sort((x, y) => x.page - y.page || y.rect.y - x.rect.y)
            .map((x) => x.memorized),
        ids.first
      );
      assert.deepEqual(saved, [true, false, false]);
      assert.deepEqual(errors, [], '画面のエラーがない');
    } finally {
      await app.close().catch(() => {});
      rmSync(home, {recursive: true, force: true});
    }
  }
);
