// パソコンと同じ画面（iPad。docs/MOBILE.md §8）の通しテスト：Electron（パソコン）を起動し、iPad（Chromium の iPad の形）から
// パソコンの画面を開いて、ホーム・知らせ・資料を入れる・PDF の編集画面・iPad では断る操作を確かめる。
// 画面（DISPLAY か xvfb）が要る。Electron の実行ファイルがなければ飛ばす
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {open, readPairHash, seal, toB64} from '../../src/shared/mobile-wire.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let electronPath = null;
try {
  electronPath = require('electron');
} catch {
  /* Electron が入っていない（npm ci の前） */
}
const canRun = !!electronPath && existsSync(electronPath) && (process.env.DISPLAY || process.platform !== 'linux');

async function samplePdf() {
  const {PDFDocument, StandardFonts} = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText('Pad sample', {x: 56, y: 780, size: 20, font});
  return Buffer.from(await doc.save());
}

test(
  'iPad の通し：パソコンと同じ画面で、ホーム・知らせ・資料を入れる・PDF・断る操作',
  {skip: !canRun && '画面か Electron がない', timeout: 300000},
  async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'dn-pad-'));
    const {_electron, chromium, devices} = require('playwright');
    const app = await _electron.launch({
      args: ['.', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--password-store=basic'],
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: `${home}/.config`,
        XDG_DESKTOP_DIR: `${home}/Desktop`,
        LANG: 'ja_JP.UTF-8',
        DAIGAKU_TEST_LAN: '127.0.0.1'
      },
      timeout: 90000
    });
    let browser = null;
    try {
      const win = await app.firstWindow({timeout: 90000});
      await win.waitForFunction(() => document.getElementById('view')?.children.length > 0, null, {timeout: 60000});
      // 鍵の保管（safeStorage）：キーリングのない Linux（CI・コンテナ）では、試験のために平文の保管を許す
      await app.evaluate(({safeStorage}) => {
        if (!safeStorage.isEncryptionAvailable()) safeStorage.setUsePlainTextEncryption?.(true);
      });
      // パソコン：セットアップを飛ばし、フォルダを 1 つ作り、スマホとつなぐをオンにして端末を足す
      const pc = await win.evaluate(async () => {
        const d = window.daigaku;
        await d['settings.update']({patch: {skipSetup: true}});
        const f = await d['folder.create']({name: '管理会計', scope: 'term', mode: 'new'});
        const on = await d['mobile.enable']({on: true});
        const pair = await d['mobile.pair']({host: '127.0.0.1'});
        return {courseId: f.courseId, port: on.port, url: pair.url, error: pair.error ?? on.error};
      });
      assert.equal(pc.error, undefined);
      // iPad：QR の鍵であいさつして新しい鍵を受け取る（ホーム画面のアイコンから QR を読むのと同じ）
      const qr = readPairHash(new URL(pc.url).hash);
      const base = `http://127.0.0.1:${pc.port}`;
      const hello = await fetch(`${base}/m/api`, {
        method: 'POST',
        headers: {'User-Agent': 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'},
        body: Buffer.concat([
          Buffer.from(qr.deviceId),
          Buffer.from(seal(qr.key, {ch: 'hello', arg: {}, t: Date.now()}))
        ])
      });
      const key = open(qr.key, new Uint8Array(await hello.arrayBuffer())).value.key;
      assert.ok(key instanceof Uint8Array);

      // 入っている Chromium を使う（Playwright の版と合わないとき。PW_CHROMIUM に実行ファイル）
      browser = await chromium.launch(process.env.PW_CHROMIUM ? {executablePath: process.env.PW_CHROMIUM} : {});
      const ctx = await browser.newContext({...devices['iPad Pro 11 landscape']});
      const ipad = await ctx.newPage();
      const errors = [];
      ipad.on('pageerror', (e) => errors.push(String(e)));
      await ipad.goto(`${base}/m/`);
      await ipad.evaluate(
        ([deviceId, k]) => localStorage.setItem('daigaku-note.pair', JSON.stringify({deviceId, key: k})),
        [qr.deviceId, toB64(key)]
      );
      // まだパソコンでオンにしていない：案内だけ
      await ipad.goto(`${base}/p/`);
      await ipad.waitForSelector('.pad-gate', {timeout: 30000});
      assert.match(await ipad.textContent('.pad-gate'), /まだ使えません/);
      // パソコンでオンにする → もう一度試すとパソコンと同じ画面
      const list = await win.evaluate(
        async (id) => window.daigaku['mobile.setFull']({deviceId: id, on: true}),
        qr.deviceId
      );
      assert.equal(list.devices.find((d) => d.id === qr.deviceId)?.full, true);
      await ipad.click('.pad-gate .pad-btn--primary');
      await ipad.waitForFunction(() => document.body.textContent.includes('管理会計'), null, {timeout: 60000});
      assert.equal(
        await ipad.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
        true,
        '横スクロールが出ない'
      );

      // 知らせ：パソコンで作ったフォルダが、iPad の画面にも出る
      await win.evaluate(() => window.daigaku['folder.create']({name: '原価計算ゼミ', scope: 'term', mode: 'new'}));
      await ipad.waitForFunction(() => document.body.textContent.includes('原価計算ゼミ'), null, {timeout: 40000});

      // 逆も：iPad で作ったフォルダが、パソコンの画面にも出る（パソコンはホームを開いておく）
      await win.evaluate(() => {
        location.hash = '#/';
        location.reload();
      });
      await win.waitForFunction(() => document.body.textContent.includes('原価計算ゼミ'), null, {timeout: 30000});
      await ipad.evaluate(() => window.daigaku['folder.create']({name: 'iPad のゼミ', scope: 'term', mode: 'new'}));
      await win.waitForFunction(() => document.body.textContent.includes('iPad のゼミ'), null, {timeout: 40000});
      if (process.env.PAD_SHOT) await ipad.screenshot({path: `${process.env.PAD_SHOT}/home.png`});

      // 資料を入れる：iPad でファイルを選ぶ（シートのボタンの中の input）
      const upload = ipad.evaluate(
        (courseId) => window.daigaku['material.upload']({courseId, roundId: null}),
        pc.courseId
      );
      await ipad.waitForSelector('.pad-sheet input[type=file]', {timeout: 10000});
      await ipad.setInputFiles('.pad-sheet input[type=file]', {
        name: '第1回 原価企画.pdf',
        mimeType: 'application/pdf',
        buffer: await samplePdf()
      });
      const up = await upload;
      assert.equal(up.added, 1, JSON.stringify(up));
      const st = await win.evaluate(() => window.daigaku['state.get']());
      const material = st.materials[pc.courseId]?.[0]?.id;
      assert.ok(material, 'パソコンに入った');

      // PDF の編集画面：iPad で pdf.js が描く
      await ipad.evaluate((id) => (location.hash = `#/viewer/${id}`), material);
      await ipad.waitForFunction(() => [...document.querySelectorAll('canvas')].some((c) => c.width > 300), null, {
        timeout: 60000
      });
      await ipad.waitForFunction(
        () => document.querySelector('.pdf-page__text')?.textContent.includes('Pad sample'),
        null,
        {timeout: 30000}
      );

      if (process.env.PAD_SHOT) await ipad.screenshot({path: `${process.env.PAD_SHOT}/viewer.png`});
      // iPad で書いた注釈が、パソコンに残る
      const saved = await ipad.evaluate(
        (materialId) =>
          window.daigaku['annotation.save']({
            materialId,
            annotation: {kind: 'note', page: 1, rect: {x: 60, y: 60, w: 20, h: 20}, body: 'iPad から'}
          }),
        material
      );
      assert.equal(saved?.error, undefined, JSON.stringify(saved));
      const onPc = await win.evaluate((materialId) => window.daigaku['annotation.list']({materialId}), material);
      assert.ok(JSON.stringify(onPc).includes('iPad から'));

      // 注釈付きで書き出す：iPad に保存するシートが出る
      const exp = ipad.evaluate((materialId) => window.daigaku['pdf.export']({materialId, options: {}}), material);
      await ipad.waitForSelector('.pad-sheet a[download]', {timeout: 30000});
      assert.match(await ipad.getAttribute('.pad-sheet a[download]', 'download'), /_注釈\.pdf$/);
      await ipad.click('.pad-sheet button');
      assert.deepEqual(await exp, {canceled: true});

      // 断る操作：パソコンのフォルダを開く・パソコンのフォルダを登録する・スマホの設定
      const denied = await ipad.evaluate(async (courseId) => {
        const d = window.daigaku;
        return [
          (await d['folder.reveal']({courseId})).error,
          (await d['folder.create']({name: 'x', scope: 'term', mode: 'link'})).error,
          (await d['mobile.pair']({host: '127.0.0.1'})).error
        ];
      }, pc.courseId);
      for (const m of denied) assert.match(m, /パソコンの画面/);

      // 設定の画面：iPad だけの案内（スマホの画面に切り替える）
      await ipad.evaluate(() => (location.hash = '#/settings?tab=mobile'));
      await ipad.waitForSelector('[data-pad-phone]', {timeout: 30000});

      assert.deepEqual(errors, [], '画面の例外なし');
    } finally {
      await browser?.close();
      await app.close();
      rmSync(home, {recursive: true, force: true});
    }
  }
);
