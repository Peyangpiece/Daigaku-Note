// iPad のアプリで「パソコンなしで使う」（docs/SYNC.md §7・§8）の通しテスト：パソコンが Google ドライブへ送ったもの（送り出しの
// createPusher で実際に作る）を、iPad のアプリの画面（ipad/www。Chromium で開き、Capacitor と Google は代わりのもの）で読み込み、
// パソコンなしでホームと PDF を開く。iPad で変えたものは、開き直しても残る。Chromium がなければ飛ばす
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createPusher} from '../../src/main/cloud/sync.js';
import {newMasterKey, keyQr} from '../../src/main/cloud/keys.js';
import {openDatabase} from '../../src/main/db/db.js';
import {Repo} from '../../src/main/db/repo.js';
import {exportBackup} from '../../src/main/backup.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let chromium = null;
try {
  ({chromium} = require('playwright'));
} catch {
  /* Playwright がない */
}

/** Capacitor の代わり（Filesystem はページを開き直しても残るように sessionStorage に置く。Google のログインはすぐ戻る） */
function capacitorStub() {
  const listeners = {};
  const mem = JSON.parse(sessionStorage.getItem('__fs') ?? '{}');
  const persist = () => sessionStorage.setItem('__fs', JSON.stringify(mem));
  window.Capacitor = {
    Plugins: {
      App: {
        addListener: (ev, cb) => {
          (listeners[ev] ??= []).push(cb);
          return Promise.resolve({remove() {}});
        }
      },
      Browser: {
        addListener: () => Promise.resolve({remove() {}}),
        close: async () => {},
        open: async ({url}) => {
          const u = new URL(url);
          const back = `${u.searchParams.get('redirect_uri')}?state=${u.searchParams.get('state')}&code=C`;
          setTimeout(() => (listeners.appUrlOpen ?? []).forEach((cb) => cb({url: back})), 50);
        }
      },
      Filesystem: {
        readdir: async ({path: p}) => {
          const names = Object.keys(mem)
            .filter((k) => k.startsWith(`${p}/`))
            .map((k) => k.slice(p.length + 1));
          if (!names.length) throw new Error('なし');
          return {files: names.map((name) => ({name}))};
        },
        readFile: async ({path: p}) => {
          if (!(p in mem)) throw new Error('なし');
          return {data: mem[p]};
        },
        writeFile: async ({path: p, data}) => {
          mem[p] = data;
          persist();
          return {};
        },
        deleteFile: async ({path: p}) => {
          delete mem[p];
          persist();
        },
        rmdir: async ({path: p}) => {
          for (const k of Object.keys(mem)) if (k.startsWith(`${p}/`)) delete mem[k];
          persist();
        }
      }
    }
  };
}

test(
  'iPad のアプリ：ドライブから読み込み、パソコンなしでホームと PDF を開く。iPad で変えたものは残る',
  {skip: !chromium && 'Playwright がない', timeout: 240000},
  async () => {
    // 組み立て（ipad/www）
    const built = spawnSync(process.execPath, ['ipad/build-www.mjs'], {cwd: ROOT, encoding: 'utf8'});
    assert.equal(built.status, 0, built.stderr);
    // パソコンのデータ
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-ipad-local-'));
    const {db} = await openDatabase(path.join(tmp, 'db.sqlite'));
    const repo = new Repo(db);
    const conn = repo.createConnection({
      kind: 'api',
      connector_id: 'moodle',
      label: 'Moodle',
      base_url: 'https://lms.example.ac.jp'
    });
    const term = repo.upsertTerm({
      id: '2026-fall',
      label: '秋学期',
      year: 2026,
      folder: '2026_秋学期',
      start_date: '2026-10-01',
      end_date: '2027-03-31',
      rounds: 15
    });
    repo.setSetting('term.current', term.id);
    const c1 = repo.createCourse({
      term_id: term.id,
      connection_id: conn.id,
      lms_id: '1',
      name: '管理会計Ⅱ',
      folder_name: '管理会計Ⅱ'
    });
    const r3 = repo.createRound({course_id: c1.id, number: 3, title: '原価企画', folder_name: '第03回_原価企画'});
    const {PDFDocument, StandardFonts} = require('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([595, 842]).drawText('Local PDF on iPad', {x: 56, y: 780, size: 24, font});
    const pdf = new Uint8Array(await doc.save());
    const mat = repo.createMaterial({
      course_id: c1.id,
      round_id: r3.id,
      url: 'https://x/1',
      name: 'a.pdf',
      path: '/Users/me/Desktop/パレットノート/a.pdf',
      sha256: 'h1',
      size: pdf.length,
      source: 'lms'
    });
    repo.updateMaterial(mat.id, {status: 'ok'});
    // パソコンがドライブへ送る（ドライブはメモリの代わり）
    const files = new Map();
    let n = 0;
    const drive = {
      list: async () => [...files].map(([id, f]) => ({id, name: f.name, size: f.bytes.length})),
      put: async (name, bytes, id) => {
        const k = id ?? `id${++n}`;
        files.set(k, {name: id ? files.get(id).name : name, bytes});
        return {id: k};
      },
      get: async (id) => files.get(id).bytes,
      remove: async (id) => files.delete(id)
    };
    const master = newMasterKey();
    await createPusher({
      drive,
      master,
      exportDb: (f) => exportBackup(db, f),
      materials: () => Object.values(repo.listMaterialsAll()).flat(),
      readMaterial: async () => pdf,
      userData: tmp,
      device: 'pc'
    }).push();
    // iPad のアプリの画面を配る
    const www = path.join(ROOT, 'ipad', 'www');
    const TYPES = {
      '.js': 'text/javascript',
      '.mjs': 'text/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
      '.json': 'application/json',
      '.wasm': 'application/wasm',
      '.svg': 'image/svg+xml',
      '.png': 'image/png'
    };
    const srv = http
      .createServer((q, r) => {
        let u = decodeURIComponent(q.url.split('?')[0]);
        if (u === '/') u = '/index.html';
        const p = path.join(www, u);
        if (!p.startsWith(www)) return r.writeHead(404).end();
        fs.readFile(p, (e, b) => {
          if (e) return r.writeHead(404).end();
          r.setHeader('content-type', TYPES[path.extname(p)] ?? 'application/octet-stream');
          r.end(b);
        });
      })
      .listen(0);
    const browser = await chromium.launch(process.env.PW_CHROMIUM ? {executablePath: process.env.PW_CHROMIUM} : {});
    try {
      const ctx = await browser.newContext({viewport: {width: 1180, height: 820}, hasTouch: true});
      await ctx.addInitScript(capacitorStub);
      const pg = await ctx.newPage();
      const errors = [];
      pg.on('pageerror', (e) => errors.push(e.message));
      if (process.env.DEBUG_LOCAL) pg.on('console', (m) => console.error('console', m.type(), m.text().slice(0, 300)));
      const h = {'access-control-allow-origin': '*'};
      await pg.route('https://oauth2.googleapis.com/token', (r) =>
        r.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: h,
          body: JSON.stringify({refresh_token: 'R', access_token: 'A', expires_in: 3600})
        })
      );
      await pg.route('https://www.googleapis.com/drive/v3/files**', async (r) => {
        const u = new URL(r.request().url());
        if (u.pathname === '/drive/v3/files') {
          const list = (await drive.list()).map((f) => ({...f, size: String(f.size)}));
          return r.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: h,
            body: JSON.stringify({files: list})
          });
        }
        return r.fulfill({status: 200, headers: h, body: Buffer.from(files.get(u.pathname.split('/').pop()).bytes)});
      });
      await pg.goto(`http://127.0.0.1:${srv.address().port}/`);
      await pg.click('[data-v="cloud"]');
      await pg.click('[data-v="login"]');
      await pg.waitForSelector('[data-v="key"]');
      // 鍵の QR を読んだのと同じことをする（QR を読む部分は tests/ipad-cloud.test.js）
      await pg.evaluate(async (k) => {
        const {readKeyQr, fingerprint} = await import('/shared/vault-keys.js');
        const m = readKeyQr(k);
        const s = JSON.parse(localStorage.getItem('palette.cloud'));
        localStorage.setItem(
          'palette.cloud',
          JSON.stringify({...s, key: btoa(String.fromCharCode(...m)), fp: fingerprint(m)})
        );
      }, keyQr(master));
      await pg.reload();
      await pg.click('[data-v="cloud"]');
      await pg.click('[data-v="pull"]');
      await pg.waitForSelector('[data-v="open"]', {timeout: 30000});
      // パソコンなしで開く：ホームに授業が出る
      await pg.click('[data-v="open"]');
      await pg.waitForFunction(() => document.body.textContent.includes('管理会計Ⅱ'), null, {timeout: 60000});
      // PDF を開く
      await pg.evaluate((id) => (location.hash = `#/viewer/${id}`), mat.id);
      await pg.waitForSelector('.pdf-page canvas', {timeout: 60000});
      // iPad で変えたもの（文字入れの書式）は、開き直しても残る
      const saved = await pg.evaluate(
        (id) =>
          window.daigaku['pdf.textStyle']({
            materialId: id,
            style: {size: 20, bold: true, color: '#dd3333', align: 'left'}
          }),
        mat.id
      );
      assert.deepEqual(saved, {ok: true});
      await pg.waitForTimeout(2500); // 保存は少し待ってから
      await pg.reload();
      await pg.waitForFunction(() => !!window.daigaku, null, {timeout: 60000});
      const again = await pg.evaluate(
        async (id) => (await window.daigaku['pdf.open']({materialId: id})).textStyle,
        mat.id
      );
      assert.deepEqual(again, {size: 20, bold: true, color: '#dd3333', align: 'left'});
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      srv.close();
      db.close();
    }
  }
);
