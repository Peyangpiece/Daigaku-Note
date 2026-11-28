// 画面の通しテスト（SPEC §14.7）：Electron を本当に起動し、ホーム → フォルダ → PDF の編集画面 → 設定 → 開き直しても残る、を確かめる。
// 画面（DISPLAY か xvfb）が要る。CI は xvfb-run で動かす。Electron の実行ファイルがなければ飛ばす
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
      // フォルダの付箋：長押しで持ち上げて、そのまま動かすと並べ替え（✓ で覚える）。動かさずに離すと付箋のメニュー
      await win.evaluate(async (id) => {
        for (const name of ['あ回', 'い回']) await window.daigaku['folder.addSub']({courseId: id, name});
        location.hash = `#/course/${id}`;
        location.reload(); // IPC で足した付箋を読み直す
      }, ids.course);
      await win.waitForFunction(
        () => document.querySelectorAll('.round-notes--folder > .round-note').length >= 3,
        null,
        {
          timeout: 30000
        }
      );
      const notes = () =>
        win.evaluate(() =>
          [...document.querySelectorAll('.round-notes--folder > .round-note')].map((n) => n.dataset.sortKey)
        );
      const before = await notes();
      // 付箋の何もない所（ボタン・ファイルの外）：付箋の右下の端
      const spot = async (i) =>
        win.evaluate((i) => {
          const r = document.querySelectorAll('.round-notes--folder > .round-note')[i].getBoundingClientRect();
          return {x: r.right - 6, y: r.bottom - 6, cx: r.left + r.width / 2, cy: r.top + r.height / 2};
        }, i);
      // 動かさずに離す → メニュー
      const a = await spot(1);
      await win.mouse.move(a.x, a.y);
      await win.mouse.down();
      await win.waitForTimeout(700);
      await win.mouse.up();
      await win.waitForSelector('.card-menu [data-card-menu="color"]', {timeout: 5000});
      assert.equal(
        await win.evaluate(() => document.body.classList.contains('reordering')),
        false,
        '並べ替えにはならない'
      );
      await win.keyboard.press('Escape');
      // 持ち上げて隣の付箋の上へ動かす → 並べ替え
      const b = await spot(2);
      await win.mouse.move(a.x, a.y);
      await win.mouse.down();
      await win.waitForTimeout(700);
      assert.equal(
        await win.evaluate(() => document.body.classList.contains('reordering')),
        true,
        '長押しで並べ替えになる'
      );
      await win.mouse.move((a.x + b.cx) / 2, (a.y + b.cy) / 2, {steps: 5});
      await win.mouse.move(b.cx, b.cy, {steps: 10});
      await win.waitForTimeout(400);
      await win.mouse.up();
      const moved = await notes();
      assert.deepEqual(moved, [before[0], before[2], before[1], ...before.slice(3)], '持ち上げた付箋が入れ替わる');
      await win.click('.reorder-done');
      await win.waitForFunction(() => !document.body.classList.contains('reordering'));
      const saved = await win.evaluate(
        async (id) => (await window.daigaku['state.get']()).settings.order[`course:${id}`],
        ids.course
      );
      assert.deepEqual(saved, moved, '並びを覚える');
      // PDF の編集画面：pdf.js が描く
      await win.evaluate((id) => (location.hash = `#/viewer/${id}`), ids.material);
      await win.waitForSelector('canvas', {timeout: 60000});
      await win.waitForFunction(() => [...document.querySelectorAll('canvas')].some((c) => c.width > 300), null, {
        timeout: 60000
      });
      // 文字の層（選択・コピー・読み上げ）：PDF の文字が透明な文字として重なる（v0.12.2 まで名前の重なりで描かれなかった）
      await win.waitForFunction(
        () => document.querySelector('.pdf-page__text')?.textContent.includes('Sample p.1'),
        null,
        {timeout: 30000}
      );
      // 複数選択とコピー・貼り付け（v0.27.13）：文字入れを 2 つ作り、囲んで選ぶ → コピー → 貼る（ずらして 2 つ増える）
      // → 取り消し（1 手で 2 つ消える）→ Shift＋クリックで 1 つ外す → 切り取り → 貼る
      const texts = () =>
        win.evaluate(() => [...document.querySelectorAll('.anno-text')].map((el) => el.textContent.trim()).sort());
      const picked = () => win.evaluate(() => document.querySelectorAll('.anno-text.is-selected').length);
      const pg = await win.evaluate(() => {
        const r = document.querySelector('.pdf-page').getBoundingClientRect();
        return {x: r.left, y: r.top};
      });
      for (const [dy, word] of [
        [300, 'Alpha'],
        [400, 'Beta']
      ]) {
        await win.keyboard.press('Control+T');
        await win.mouse.click(pg.x + 120, pg.y + dy);
        await win.keyboard.type(word);
        await win.keyboard.press('Escape');
      }
      await win.keyboard.press('Escape'); // 選択の道具へ
      assert.deepEqual(await texts(), ['Alpha', 'Beta']);
      await win.mouse.move(pg.x + 60, pg.y + 260);
      await win.mouse.down();
      await win.mouse.move(pg.x + 400, pg.y + 460, {steps: 8});
      await win.mouse.up();
      assert.equal(await picked(), 2, '四角で囲むと 2 つとも選ぶ');
      await win.keyboard.press('Control+C');
      await win.keyboard.press('Control+V');
      await win.waitForFunction(() => document.querySelectorAll('.anno-text').length === 4, null, {timeout: 5000});
      assert.deepEqual(await texts(), ['Alpha', 'Alpha', 'Beta', 'Beta'], '貼るとコピーが増える');
      assert.equal(await picked(), 2, '貼ったものが選ばれる');
      const shifted = await win.evaluate(() => {
        const tops = [...document.querySelectorAll('.anno-text')]
          .filter((el) => el.textContent.includes('Alpha'))
          .map((el) => el.getBoundingClientRect().top);
        return Math.abs(tops[0] - tops[1]);
      });
      assert.ok(shifted > 5, '元と重ならないようにずらして貼る');
      await win.keyboard.press('Control+Z');
      await win.waitForFunction(() => document.querySelectorAll('.anno-text').length === 2, null, {timeout: 5000});
      // ⌘A で全部 → Shift＋クリックで Beta を外す → 切り取り → 貼る
      await win.keyboard.press('Control+A');
      assert.equal(await picked(), 2, '⌘A で全部を選ぶ');
      const beta = await win.evaluate(() => {
        const r = [...document.querySelectorAll('.anno-text')]
          .find((el) => el.textContent.includes('Beta'))
          .getBoundingClientRect();
        return {x: r.left + r.width / 2, y: r.top + r.height / 2};
      });
      await win.keyboard.down('Shift');
      await win.mouse.click(beta.x, beta.y);
      await win.keyboard.up('Shift');
      assert.equal(await picked(), 1, 'Shift＋クリックで外す');
      await win.keyboard.press('Control+X');
      await win.waitForFunction(() => document.querySelectorAll('.anno-text').length === 1, null, {timeout: 5000});
      assert.deepEqual(await texts(), ['Beta'], '切り取ると消える');
      await win.keyboard.press('Control+V');
      await win.waitForFunction(() => document.querySelectorAll('.anno-text').length === 2, null, {timeout: 5000});
      assert.deepEqual(await texts(), ['Alpha', 'Beta'], '切り取ったものを貼り戻せる');
      await win.keyboard.press('Escape');
      // 筆箱：画面の右の端から内側へなでると出るのは指だけ。ペンで右の端の近くから書いても出さない（v0.27.4）。
      // ペンを使った直後の指（書いている手）も出さない
      const swipe = (pointerType, {width = 1} = {}) =>
        win.evaluate(
          ({pointerType, width}) => {
            const w = document.documentElement.clientWidth;
            const y = Math.round(window.innerHeight / 4); // 右の上半分（筆箱）
            const fire = (type, x) =>
              (document.elementFromPoint(x, y) ?? document.body).dispatchEvent(
                new PointerEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  pointerId: 7,
                  pointerType,
                  clientX: x,
                  clientY: y,
                  width,
                  height: width,
                  isPrimary: true,
                  buttons: type === 'pointerup' ? 0 : 1
                })
              );
            fire('pointerdown', w - 10);
            for (let x = w - 20; x >= w - 80; x -= 10) fire('pointermove', x);
            fire('pointerup', w - 80);
            const side = document.querySelector('[data-corner="fude"]');
            return !!side && !side.classList.contains('is-tucked');
          },
          {pointerType, width}
        );
      const tuck = () => win.evaluate(() => document.querySelector('[data-corner="fude"]')?.classList.add('is-tucked'));
      assert.equal(await swipe('pen'), false, 'ペンで右の端から書いても筆箱は出ない');
      assert.equal(await swipe('touch'), false, 'ペンを使った直後の指（書いている手）でも出ない');
      await win.waitForTimeout(1600);
      assert.equal(await swipe('touch', {width: 120}), false, '手のひらほど大きい触れ方では出ない');
      assert.equal(await swipe('touch'), true, '指で右の端から内側へなでると出る');
      await tuck();
      // 設定：情報の節と版
      await win.evaluate(() => (location.hash = '#/settings?tab=about')); // 設定の「情報」タブ
      await win.waitForSelector('#st-about', {timeout: 30000});
      const about = await win.evaluate(() => document.querySelector('#st-about').textContent);
      assert.match(about, /α 版/);
      // 設定の「データ」タブ：バックアップ
      await win.evaluate(() => (location.hash = '#/settings?tab=data'));
      await win.waitForSelector('[data-backup="export"]', {timeout: 30000});
      // Google ドライブ（docs/SYNC.md）：クライアント ID がまだないので準備中
      await win.waitForFunction(
        () => /準備中|連携/.test(document.querySelector('[data-v="cloud"]')?.textContent ?? ''),
        null,
        {
          timeout: 30000
        }
      );
      // 裏で状態が変わって描き直しても、打っている欄のカーソルは動かず、日本語の変換中は欄を作り直さない
      await win.evaluate(() => (location.hash = '#/folder-new'));
      await win.waitForSelector('#fn-name');
      await win.fill('#fn-name', '原価計算ゼミ');
      await win.evaluate(() => document.getElementById('fn-name').setSelectionRange(2, 2));
      const changed = async () => {
        await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('state.changed', {}));
        await win.waitForTimeout(600);
      };
      await changed();
      assert.deepEqual(
        await win.evaluate(() => [document.activeElement?.id, document.getElementById('fn-name').selectionStart]),
        ['fn-name', 2],
        'カーソルの位置を保つ'
      );
      await win.evaluate(() => {
        const el = document.getElementById('fn-name');
        el.dataset.mark = '1';
        el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true}));
      });
      await changed();
      assert.equal(
        await win.evaluate(() => document.getElementById('fn-name').dataset.mark),
        '1',
        '変換中は作り直さない'
      );
      await win.evaluate(() =>
        document.getElementById('fn-name').dispatchEvent(new CompositionEvent('compositionend', {bubbles: true}))
      );
      await win.waitForFunction(() => document.getElementById('fn-name')?.dataset.mark !== '1', null, {timeout: 5000});
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
