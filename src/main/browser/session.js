// Playwright のブラウザ文脈・Cookie の保存・見えるログイン窓（DESIGN-M0 §8.5）。
// ふだんはヘッドレス。本人の操作が要るときだけ別の Chromium を画面に出す。開ける先は許可したホストだけ。
import {hostAllowed} from '../../shared/recipe.js';
import {credentialUrlAllowed, loginFailedText, markLoginForm, staleSsoPage} from './login-form.js';

const BLOCK_TYPES = new Set(['image', 'font', 'media']);

export function createBrowserSession({secrets, log = () => {}, browsersPath, executablePath, playwright = null} = {}) {
  let pw = playwright;
  let headlessBrowser = null;
  const loadPw = async () => (pw ??= await import('playwright'));
  const launchOptions = (headless) => ({headless, ...(executablePath ? {executablePath} : {})});
  if (browsersPath) process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

  async function browser() {
    if (headlessBrowser && headlessBrowser.isConnected()) return headlessBrowser;
    const {chromium} = await loadPw();
    headlessBrowser = await chromium.launch(launchOptions(true));
    headlessBrowser.on('disconnected', () => (headlessBrowser = null));
    return headlessBrowser;
  }

  /** 接続ごとの文脈。保存した Cookie を復元し、許可外のホストと画像・フォント・動画を止める */
  async function open(connection, {allowedHosts, blockAssets = true} = {}) {
    const b = await browser();
    const storageState = (await secrets?.get(`conn:${connection.id}:cookies`)) ?? undefined;
    const context = await b.newContext({
      storageState,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      acceptDownloads: false
    });
    context.setDefaultTimeout(20000);
    context.setDefaultNavigationTimeout(30000);
    const hosts = allowedHosts ?? [];
    const blockedSeen = new Set(); // 同じホストは文脈ごとに 1 回だけログに出す（フォント配信などで何十行も出ないように）
    await context.route('**/*', (route) => {
      const req = route.request();
      if (hosts.length && !hostAllowed(req.url(), hosts)) {
        const h = safeHost(req.url());
        if (!blockedSeen.has(h)) {
          blockedSeen.add(h);
          log(`許可外のホストへの要求を止めました: ${h}`);
        }
        return route.abort('blockedbyclient');
      }
      if (blockAssets && BLOCK_TYPES.has(req.resourceType())) return route.abort('blockedbyclient');
      return route.continue();
    });
    context.__connectionId = connection.id;
    return context;
  }

  /** Cookie を保存する（同期の終わり・ログインの直後） */
  async function save(connection, context) {
    if (!secrets || !context) return;
    const state = await context.storageState();
    await secrets.set(`conn:${connection.id}:cookies`, state);
  }

  async function close(context) {
    await context?.close().catch(() => {});
  }

  /**
   * 見えるログイン窓。url を開き、isLoggedIn(page) が true になるか capture が値を返すまで待つ。
   * ログイン中はホストを止めない（統合認証へ飛ぶため）。訪れたホストを返すので、接続の allowedHosts に足せる。
   * capture: {urlPattern: RegExp, extract: (body: string) => string|null}  例：Moodle の launch.php からトークンを取る
   * autofill: {user, password, base, hosts}  保存した ID・パスワード。ログインの欄が空なら入れておく（送信はしない。本人が押す）。
   *   入れるのは base（LMS）と同じ組織のドメインか hosts（レシピのホスト）のページだけ。
   *   本人が見ている窓なので統合認証のホストにも入れる。Google・Microsoft には入れない（SPEC §6.4）。https のページだけ
   */
  async function loginVisible(
    connection,
    {url, isLoggedIn, capture = null, autofill = null, sso = null, timeoutMs = 600000, onStatus = () => {}}
  ) {
    const {chromium} = await loadPw();
    const b = await chromium.launch(launchOptions(false));
    const storageState = (await secrets?.get(`conn:${connection.id}:cookies`)) ?? undefined;
    const context = await b.newContext({
      storageState,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      viewport: {width: 1000, height: 760}
    });
    const visited = new Set();
    let captured = null;
    if (capture) {
      // 例：Moodle の launch.php は moodlemobile://token=… へ転送する。転送先（Location）か本文からトークンを取り、
      //     ブラウザには「できました」の画面を見せる（独自スキームへの転送はブラウザが開けないため）
      await context.route(capture.urlPattern, async (route) => {
        try {
          const res = await route.fetch({maxRedirects: 0});
          const headers = res.headers();
          const body = await res.text().catch(() => '');
          const v = capture.extract({body, headers, url: route.request().url(), status: res.status()});
          if (v) {
            captured = v;
            await route.fulfill({
              status: 200,
              contentType: 'text/html; charset=utf-8',
              body: '<!doctype html><meta charset="utf-8"><p style="font: 16px sans-serif; padding: 40px">ログインできました。この窓は自動で閉じます。</p>'
            });
            return;
          }
          await route.fulfill({response: res, body});
        } catch {
          await route.continue();
        }
      });
    }
    const page = await context.newPage();
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) visited.add(safeHost(f.url()));
    });
    // LMS 自身のログイン画面（大学のアカウントでは入れない ID・パスワード欄）に、統合認証へのリンク（レシピの login.sso）があれば押す。
    // 開いた直後だけでなく、ログインの途中やあとでこの画面に戻されたときも押す（同じ画面で押し続けないよう 5 秒あけ、5 回まで）
    const ssoOn = async () =>
      !!sso &&
      safeHost(page.url()) === safeHost(url) &&
      (await page
        .locator(sso)
        .count()
        .catch(() => 0)) > 0;
    let ssoClicks = 0;
    let ssoAt = 0;
    const pressSso = async () => {
      if (ssoClicks >= 5 || Date.now() - ssoAt < 5000 || !(await ssoOn())) return;
      ssoClicks++;
      ssoAt = Date.now();
      await page
        .locator(sso)
        .first()
        .click({timeout: 5000})
        .catch(() => {});
    };
    // 保存した ID・パスワードは、統合認証のページの欄にだけ入れる（LMS 自身のログインの欄には入れない）。
    // パスワードを保存していれば、入れたあと「ログイン」「次へ」も押す（ID → パスワードの 2 段階も）。
    // ページが落ち着いてから押す（読み込んだ直後に押すと、ページの準備が終わらず同じ画面が出し直される。中京大学の統合認証。v0.17.7）。
    // パスワードを送るのは 1 回。ただし失敗と書いていないのに同じパスワードの画面に戻ったときだけ、もう 1 回押す（合わせて 2 回まで。
    // 何度も送ってアカウントをロックさせない）。認証コード・ワンタイムパスワードの欄がある画面では押さない（本人が入れる）
    const sent = {user: false, password: 0};
    if (autofill?.user)
      page.on('load', async () => {
        const at = page.url();
        await page.waitForLoadState('networkidle', {timeout: 4000}).catch(() => {});
        await page.waitForTimeout(600).catch(() => {});
        if (page.isClosed() || page.url() !== at) return; // 待つ間に次のページへ進んだ
        if (await ssoOn()) return;
        const f = await fillSaved(page, autofill).catch(() => null);
        if (!f || !autofill.password || !autofill.autoSubmit || f.code || !f.submit) return;
        if (f.password) {
          if (sent.password >= 2) return;
          if (sent.password === 1) {
            const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
            if (loginFailedText(text)) return; // パスワードの誤りなど：本人に任せる
          }
          sent.password++;
          sent.user = true;
        } else if (f.user) {
          if (sent.user || sent.password) return;
          sent.user = true;
        } else return;
        await page
          .locator('[data-dn-login="submit"]')
          .first()
          .click({timeout: 5000})
          .catch(() => {});
      });
    const started = Date.now();
    let restarts = 0;
    try {
      await page.goto(url, {waitUntil: 'domcontentloaded'}).catch(() => {});
      await pressSso();
      onStatus('ログインできたら自動で閉じます');
      while (Date.now() - started < timeoutMs) {
        if (page.isClosed() || !b.isConnected())
          throw Object.assign(new Error('ログイン窓が閉じられました'), {code: 'login-cancelled'});
        if (captured) break;
        if (await Promise.resolve(isLoggedIn?.(page)).catch(() => false)) break;
        // 統合認証の「過去のリクエスト」の画面（戻る・再読み込みで同じ要求を送り直したとき）：最初のページから開き直す。
        // 保存したパスワードは送り直さない（欄には入れる。押すのは本人）。3 回まで
        if (restarts < 3 && (await isStale(page))) {
          restarts++;
          onStatus('ログインの画面を開き直しました');
          await page.goto(url, {waitUntil: 'domcontentloaded'}).catch(() => {});
          ssoAt = 0;
          await pressSso();
          continue;
        }
        await pressSso();
        await page.waitForTimeout(1000);
      }
      if (!captured && Date.now() - started >= timeoutMs)
        throw Object.assign(new Error('ログインが 10 分以内に完了しませんでした'), {code: 'login-timeout'});
      const state = await context.storageState();
      if (secrets) await secrets.set(`conn:${connection.id}:cookies`, state);
      return {captured, visitedHosts: [...visited].filter(Boolean)};
    } finally {
      await b.close().catch(() => {});
    }
  }

  /** 見えるログイン窓の欄に、保存した ID・パスワードを入れる（空の欄だけ。押すかどうかは呼ぶ側） */
  // 入れるのは LMS と同じ組織のドメインか、レシピに書いたホストのページだけ（credentialUrlAllowed）
  // 戻りは欄の様子（markLoginForm）。入れない画面なら null
  async function fillSaved(page, {user, password, base, hosts = []}) {
    if (!credentialUrlAllowed(page.url(), {base, hosts})) return null;
    const f = await page.evaluate(markLoginForm);
    if (f.user && !f.filledUser) await page.locator('[data-dn-login="user"]').first().fill(user);
    if (f.password && !f.filledPassword && password)
      await page.locator('[data-dn-login="password"]').first().fill(password);
    return f;
  }

  async function shutdown() {
    await headlessBrowser?.close().catch(() => {});
    headlessBrowser = null;
  }

  return {open, save, close, loginVisible, shutdown};
}

/** 統合認証の「過去のリクエスト」の画面か（login-form.js の staleSsoPage） */
export async function isStale(page) {
  const url = page.url();
  if (!/\/idp\//i.test(url)) return false;
  const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  return staleSsoPage(url, text);
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
