// Chromium の取り込み（DESIGN-M0 §8.5）。初回起動とアプリ更新（Playwright の版が変わったとき）だけ。
// 配布物に Chromium を同梱しないため（約 150 MB）、userData/pw-browsers に Playwright の CLI で入れる。
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

export function playwrightVersion() {
  try {
    return require('playwright-core/package.json').version;
  } catch {
    return '';
  }
}

/** 取り込み済みか（印の版が今の Playwright と同じ） */
export function chromiumReady(browsersPath) {
  try {
    return readFileSync(path.join(browsersPath, '.ready'), 'utf8').trim() === playwrightVersion();
  } catch {
    return false;
  }
}

/**
 * Chromium を取り込む。Electron の中では process.execPath（Electron 自身）を Node として動かす（ELECTRON_RUN_AS_NODE）。
 * onStatus で進み具合の文言を返す。失敗したら Error
 */
export async function ensureChromium(browsersPath, {onStatus = () => {}, log = () => {}, execPath = process.execPath, isElectron = !!process.versions.electron} = {}) {
  if (chromiumReady(browsersPath)) return 'ready';
  mkdirSync(browsersPath, {recursive: true});
  onStatus('LMS を読むためのブラウザを準備しています（初回とアプリの更新後だけ。数分かかります）…');
  let cli;
  try {
    cli = require.resolve('playwright/cli.js');
  } catch (e) {
    throw new Error(`Playwright が見つかりません（npm ci は済んでいますか）: ${e.message}`);
  }
  const env = {...process.env, ...(isElectron ? {ELECTRON_RUN_AS_NODE: '1'} : {}), PLAYWRIGHT_BROWSERS_PATH: browsersPath};
  delete env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD;
  log(`Chromium を取り込みます: ${execPath} ${cli} install chromium → ${browsersPath}`);
  await new Promise((resolve, reject) => {
    const p = spawn(execPath, [cli, 'install', 'chromium'], {env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
    let out = '',
      err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(new Error(`ブラウザの取り込みを始められません: ${e.message}`)));
    p.on('exit', (code) => {
      if (code === 0) return resolve();
      const tail = (err || out).trim().split('\n').slice(-3).join(' | ');
      reject(new Error(`ブラウザの準備に失敗しました（終了コード ${code}）${tail ? '：' + tail.slice(-300) : ''}`));
    });
  });
  writeFileSync(path.join(browsersPath, '.ready'), playwrightVersion() || new Date().toISOString());
  onStatus('');
  return 'installed';
}

export const __test = {existsSync};
