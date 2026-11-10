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
    // 別のファイルの通しテスト（app.test.js）と同時に動くので、Electron の実行ファイルを相手がまだ書き込んでいる（展開している）と
    // spawn が ETXTBSY で失敗する。書き終わるのを待って起動し直す
    const launchApp = async (opts) => {
      for (let i = 0; ; i++)
        try {
          return await _electron.launch(opts);
        } catch (e) {
          if (!/ETXTBSY/.test(String(e?.message)) || i >= 10) throw e;
          await new Promise((r) => setTimeout(r, 2000));
        }
    };
    const app = await launchApp({
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
      await ipad.goto(`${base}/m/p/`);
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

      // 手のひら：指・ペンでは PDF の文字を選ばない（画面全体が選ばれない）。ペンを使った画面では長押しでメニューを出さない
      const palm = await ipad.evaluate(async () => {
        const span = document.querySelector('.pdf-page__text span');
        const css = (el) => getComputedStyle(el).webkitUserSelect || getComputedStyle(el).userSelect;
        const ev = new Event('selectstart', {bubbles: true, cancelable: true});
        span.dispatchEvent(ev);
        const page = document.querySelector('.pdf-page') ?? span;
        const pen = (type) =>
          page.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerType: 'pen',
              pointerId: 7,
              isPrimary: true,
              clientX: 300,
              clientY: 300
            })
          );
        pen('pointerdown');
        pen('pointerup');
        let menu = 0;
        document.addEventListener('contextmenu', () => menu++, true);
        page.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            pointerType: 'touch',
            pointerId: 8,
            isPrimary: true,
            clientX: 320,
            clientY: 320
          })
        );
        await new Promise((r) => setTimeout(r, 900));
        page.dispatchEvent(
          new PointerEvent('pointerup', {bubbles: true, pointerType: 'touch', pointerId: 8, isPrimary: true})
        );
        const input = document.createElement('input');
        document.body.append(input);
        const typing = css(input);
        input.remove();
        return {span: css(span), body: css(document.body), selectstart: ev.defaultPrevented, menu, typing};
      });
      assert.deepEqual(palm, {span: 'none', body: 'none', selectstart: true, menu: 0, typing: 'text'});
      // 書く道具のページ：ペン先・手のひらを止めて置いても拡大鏡を出さない（touchstart の既定の動きを止める）。ほかの道具では止めない
      const loupe = await ipad.evaluate(() => {
        const pages = document.querySelector('.viewer-pages');
        const page = document.querySelector('.pdf-page');
        const touch = (target) => {
          const t = new Touch({identifier: 9, target, clientX: 300, clientY: 300});
          const ev = new TouchEvent('touchstart', {
            bubbles: true,
            cancelable: true,
            touches: [t],
            targetTouches: [t],
            changedTouches: [t]
          });
          target.dispatchEvent(ev);
          target.dispatchEvent(new TouchEvent('touchend', {bubbles: true, cancelable: true, changedTouches: [t]}));
          return ev.defaultPrevented;
        };
        const was = pages.dataset.tool;
        pages.dataset.tool = 'ink';
        const ink = touch(page);
        pages.dataset.tool = 'select';
        const select = touch(page);
        pages.dataset.tool = was;
        return {ink, select};
      });
      assert.deepEqual(loupe, {ink: true, select: false});
      // 指でページを動かす（ペンを使ったあと）：描き直し 1 回に 1 度だけスクロールし、速く払って離すと慣性で流れる。止めてから離すと流れない
      // iPad の手のひらの見分け：ペンを離して 0.7 秒・浮かせたペンを動かして 0.3 秒の間に触れたものは手のひら。
      // ペンを下ろしたら、いま触れている指は手のひらにし、指で動かしているのをやめる
      const palmPad = await ipad.evaluate(async () => {
        const {methods} = await import('/m/p/src/renderer/views/viewer/pointer.js');
        const now = performance.now();
        const v = {...methods, penSeen: true, drawing: null, hoverAt: -Infinity};
        const at = (ms) => ((v.penAt = now - ms), v.palmLikely());
        const recent = at(100);
        const later = at(900);
        v.hoverAt = now - 100;
        const hover = v.palmLikely();
        v.hoverAt = now - 600;
        const hoverOld = v.palmLikely();
        const drawing = ((v.drawing = {byPen: true}), at(5000));
        const w = {
          ...methods,
          touchIds: new Set([3]),
          palmIds: new Set(),
          palmSoft: new Map(),
          pan: {pointer: 3},
          glide: 0,
          pinch: null
        };
        w.palmOff();
        // 触れた面の大きさ：大きい触れは手のひら。動かし始めたあとで大きくなったら、そこで動かすのをやめる
        const big = methods.bigTouch({width: 120, height: 60});
        const small = methods.bigTouch({width: 30, height: 30});
        const none = methods.bigTouch({});
        const g = {...methods, palmIds: new Set(), palmSoft: new Map(), pan: {pointer: 5}, pinch: null};
        g.palmLate(5);
        // 書いた直後に触れた指（時間だけで手のひら）：少し動いただけなら手のひらのまま、はっきり払ったら指に戻して動かし始める
        const r = {
          ...methods,
          tool: 'ink',
          touchIds: new Set([7]),
          palmIds: new Set([7]),
          palmSoft: new Map([[7, {x: 100, y: 100}]]),
          pan: null,
          drawing: null,
          hoverAt: -Infinity
        };
        r.palmRelease({pointerId: 7, clientX: 110, clientY: 105});
        const stay = r.palmIds.has(7);
        r.palmRelease({pointerId: 7, clientX: 100, clientY: 160});
        return {
          recent,
          later,
          hover,
          hoverOld,
          drawing,
          palmOff: [...w.palmIds],
          pan: w.pan,
          size: [big, small, none],
          late: [[...g.palmIds], g.pan],
          release: [stay, r.palmIds.has(7), r.pan?.pointer]
        };
      });
      assert.deepEqual(palmPad, {
        recent: true,
        later: false,
        hover: true,
        hoverOld: false,
        drawing: true,
        palmOff: [3],
        pan: null,
        size: [true, false, false],
        late: [[5], null],
        release: [true, false, 7]
      });
      // 指・タッチペンで書いている間のもう 1 か所：書いている最中なら関節・手のひら（無視して書き続ける）。書き始めてすぐなら
      // 2 本指の操作（書きかけをやめる）。書き始めの所で止まっていたなら、先のほうが関節（それをやめて、あとの触れで書く）
      const second = await ipad.evaluate(async () => {
        const {methods} = await import('/m/p/src/renderer/views/viewer/pointer.js');
        const make = (age, moved) => {
          let cancelled = 0;
          const v = {
            ...methods,
            touchIds: new Set([1, 2]),
            palmIds: new Set(),
            drawing: {pointer: 1, byPen: false},
            firstTouch: {id: 1, t: performance.now() - age, x: 0, y: 0, moved},
            cancelPointer() {
              cancelled++;
              this.drawing = null;
            }
          };
          const skip = v.secondTouch({pointerId: 2, clientX: 50, clientY: 50});
          return [skip, cancelled, [...v.palmIds], v.firstTouch?.id];
        };
        return {writing: make(800, 40), gesture: make(50, 0), resting: make(800, 2)};
      });
      assert.deepEqual(second, {
        writing: [true, 0, [2], 1],
        gesture: [true, 1, [], 1],
        resting: [false, 1, [1], 2]
      });
      // タッチペンの手の見分け：手のひらの近く・上側は関節。書いている合間は、最後に書いた所＋覚えた手の位置の近くが関節。
      // 次の画を書き始めたら、直前の関節の点（大きな触れで書いた点）を消し、取り消しの手にも残さない
      const hand = await ipad.evaluate(async () => {
        const {methods} = await import('/m/p/src/renderer/views/viewer/pointer.js');
        try {
          localStorage.removeItem('palette.hand');
        } catch {
          // なくてもよい
        }
        const now = performance.now();
        const v = {...methods, bigSpots: new Map([[9, {x: 500, y: 600}]]), bigRecent: [], lastStroke: null};
        const nearPalm = v.knuckleAt(450, 500); // 手のひらの上側
        const belowPalm = v.knuckleAt(500, 760); // 手のひらのずっと下
        const farPen = v.knuckleAt(200, 200); // ペン先（手のひらから遠い）
        v.bigSpots.clear();
        for (let i = 0; i < 3; i++) v.handLearn(380, 330, {x: 300, y: 300}); // 関節はペン先の右下 (80, 30)
        v.lastStroke = {x: 300, y: 300, t: now};
        const byHand = v.knuckleAt(385, 335);
        const next = v.knuckleAt(320, 310); // 最後に書いた所のすぐ近く（続けて書く）
        let removed = null;
        const dot = {key: 'k1', removed: false};
        const w = {
          ...methods,
          bigSpots: new Map(),
          bigRecent: [],
          hand: null,
          undoStack: [{key: 'k1', before: null, after: {}}],
          lastStroke: {x: 600, y: 500, t: now, dot, size: 104},
          removeAnno(a) {
            removed = a.key;
          }
        };
        w.dropKnuckleDot({clientX: 300, clientY: 300});
        // ペンで書いた小さな点（「、」）は、離れた所で書き始めても残す
        const keep = {key: 'k2', removed: false};
        const z = {
          ...methods,
          bigSpots: new Map(),
          bigRecent: [],
          hand: {dx: 0, dy: 0, n: 0},
          undoStack: [],
          lastStroke: {x: 600, y: 500, t: now, dot: keep, size: 42},
          removeAnno() {
            throw new Error('消してはいけない');
          }
        };
        z.dropKnuckleDot({clientX: 300, clientY: 300});
        // 書いていた触れが大きくなった：書きかけを消す
        let cancelled = 0;
        const c = {
          ...methods,
          palmIds: new Set(),
          palmSoft: new Map(),
          bigSpots: new Map(),
          drawing: {pointer: 4},
          pan: null,
          pinch: null,
          cancelPointer() {
            cancelled++;
          }
        };
        c.palmLate(4, {clientX: 1, clientY: 2});
        return {nearPalm, belowPalm, farPen, byHand, next, removed, undo: w.undoStack.length, cancelled};
      });
      assert.deepEqual(hand, {
        nearPalm: true,
        belowPalm: false,
        farPen: false,
        byHand: true,
        next: false,
        removed: 'k1',
        undo: 0,
        cancelled: 1
      });
      const pan = await ipad.evaluate(async () => {
        const {methods} = await import('/m/p/src/renderer/views/viewer/pointer.js');
        const v = {...methods, destroyed: false};
        const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
        const swipe = async (rest) => {
          window.scrollTo(0, 0);
          await frame();
          const p = {pointer: 1, x: 400, y: 700};
          let t = performance.now();
          for (let i = 1; i <= 8; i++) {
            t += 8;
            v.panBy(p, {clientX: 400, clientY: 700 - i * 12, timeStamp: t}); // 8 ミリ秒ごとに 12px 上へ（速い払い）
          }
          await frame();
          const moved = window.scrollY;
          v.endPan(p, {timeStamp: t + rest});
          await new Promise((r) => setTimeout(r, 300));
          const after = window.scrollY;
          v.stopGlide();
          return {moved, after};
        };
        const fast = await swipe(5);
        const rested = await swipe(200);
        return {max: document.documentElement.scrollHeight - innerHeight, fast, rested};
      });
      assert.ok(pan.max > 200, `スクロールできる長さ ${pan.max}`);
      assert.equal(pan.fast.moved, 96, '指が動いた分だけ');
      assert.ok(pan.fast.after > pan.fast.moved + 20, `離したあと流れる ${JSON.stringify(pan.fast)}`);
      assert.equal(pan.rested.after, pan.rested.moved, '止めてから離すと流れない');

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

      // 持ち物の 3D モデル：暗号化した窓口を通さず、ブラウザで直接読む（中身は GLB）
      const glb = await ipad.evaluate(async () => {
        const r = await window.daigaku['stationery.model']({model: 'eraser'});
        return r.error ?? String.fromCharCode(...r.bytes.slice(0, 4));
      });
      assert.equal(glb, 'glTF');

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
