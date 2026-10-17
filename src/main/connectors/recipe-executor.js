// 画面操作型コネクタ：レシピ（JSON）を Playwright で実行する（DESIGN-M0 §8.4、SPEC §6.13）。
// レシピにコードはない。この実行器がセレクタ・属性・正規表現・URL の差し込みだけを解釈する。
import path from 'node:path';
import {readdir, unlink, writeFile} from 'node:fs/promises';
import {applyRegex, applyUniversityOverride, fillTemplate, parseFieldList, resolveHref} from '../../shared/recipe.js';
import {parseRound} from '../../shared/rounds.js';
import {parseSlot} from './slot.js';

const META = new Set(['url', 'items', 'openBeforeRead', 'files', 'container']);
const FILE_LINK = /\.(pdf|pptx?|docx?|xlsx?|csv|txt|zip|png|jpe?g|gif|mp4|mp3|m4a|mov)(\?|#|$)|\/file[s]?\/|\/download|forcedownload|pluginfile|attachment/i;

const err = (code, message) => Object.assign(new Error(message), {code});
const LOGOUT_RE = /ログアウト|log\s*out|sign\s*out|サインアウト/i;
const DEBUG_KEEP = 20; // debug フォルダに残す画面の数

/** ページの中で「ログイン済みらしさ」を見る（Playwright に渡すので、外の変数を使わない） */
function pageLoginHints(re) {
  const r = new RegExp(re, 'i');
  const pw = !!document.querySelector('input[type=password]');
  const logout = [...document.querySelectorAll('a, button, input[type=submit], input[type=button], [role=button], [onclick]')].some((el) =>
    [el.textContent, el.getAttribute('href'), el.getAttribute('value'), el.getAttribute('onclick'), el.getAttribute('title'), el.getAttribute('aria-label')].some((v) => v && r.test(v))
  );
  return {pw, logout};
}

/** ページの要約（レシピを直すための手がかり）。Playwright に渡すので、外の変数を使わない */
function pageSummary() {
  const paths = new Map();
  for (const a of document.querySelectorAll('a[href]')) {
    let p;
    try {
      p = new URL(a.href).pathname.split('/').slice(0, 3).join('/') || '/';
    } catch {
      continue;
    }
    paths.set(p, (paths.get(p) ?? 0) + 1);
  }
  const ids = [...new Set([...document.querySelectorAll('[id]')].map((e) => '#' + e.id))].slice(0, 30);
  const links = [...paths].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([p, n]) => `${p}(${n})`);
  return {title: document.title, links, ids, anchors: document.querySelectorAll('a[href]').length};
}

/**
 * ページの中で項目ごとに値を集める関数（Playwright に渡すので、外の変数を使わない）。
 * spec.fields = [[key, [[selector, attr], ...（' || ' の候補）]]]。候補ごとの生の値を配列で返し、正規表現と候補の選択は外（_collect）で行う。
 * selector の先頭の歩き方：'^tr'（closest）、'<'（前の兄弟）、'>'（次の兄弟）。残りは項目（または歩いた先）からの querySelector
 */
function pageExtract(els, spec) {
  const val = (root, sel, attr) => {
    let t = root;
    let s = (sel || '').trim();
    const up = s.match(/^\^([^\s<>]+)/);
    if (up) {
      t = t.closest(up[1]);
      s = s.slice(up[0].length);
    }
    while (t && (s[0] === '<' || s[0] === '>')) {
      t = s[0] === '<' ? t.previousElementSibling : t.nextElementSibling;
      s = s.slice(1);
    }
    s = s.trim();
    if (t && s) t = t.querySelector(s);
    if (!t) return '';
    if (attr === 'text') return (t.textContent || '').trim();
    if (attr === 'innertext') return (t.innerText ?? t.textContent ?? '').trim();
    if (attr === 'html') return t.innerHTML;
    if (attr === 'href') return t.href || t.getAttribute('href') || '';
    return t.getAttribute(attr) ?? '';
  };
  return els.map((el) => {
    const out = {};
    for (const [key, alts] of spec.fields) out[key] = alts.map(([sel, attr]) => val(el, sel, attr));
    if (spec.filesSelector) out.__files = [...el.querySelectorAll(spec.filesSelector)].map((a) => ({href: a.href || a.getAttribute('href') || '', text: (a.textContent || '').trim()}));
    out.__text = (el.innerText ?? el.textContent ?? '').trim().slice(0, 2000);
    return out;
  });
}

/**
 * ページの中で、欄（container）の折りたたみを開く（openBeforeRead: 'auto'）。Playwright に渡すので、外の変数を使わない。
 * 見出しの作りを決め打ちせず、「押すと何かが起きそうな」要素を 1 回ずつ押す：onclick・# や javascript: のリンク・href のないリンク・
 * [+] らしい画像・toggle/collapse/expand/accordion/open の class・jQuery のクリック処理（直接・委譲）。本物のリンク（ファイル・ページ）は押さない。
 * 入れ子は内側だけ押す。押した要素に data-daigaku-toggle を付け、押した数を返す
 */
function pageExpand(containerSel) {
  const box = containerSel ? document.querySelector(containerSel) : null;
  if (!box) return 0;
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const realLink = (e) => {
    const a = e.closest('a[href]');
    return !!a && !/^(#|javascript:)/i.test(a.getAttribute('href') || '');
  };
  const found = new Set(
    box.querySelectorAll(
      '[onclick],a[href^="#"],a[href^="javascript:"],a:not([href]),summary,[role=button],img[src*="plus" i],img[src*="open" i],img[src*="expand" i],[class*="plus" i],[class*="toggle" i],[class*="collapse" i],[class*="expand" i],[class*="accordion" i],[class*="open" i]'
    )
  );
  const jq = window.jQuery;
  if (jq && typeof jq._data === 'function') {
    const events = (n) => {
      try {
        return jq._data(n, 'events')?.click || [];
      } catch {
        return [];
      }
    };
    const owners = [document, document.documentElement, document.body];
    for (let n = box; n; n = n.parentElement) owners.push(n);
    for (const n of owners)
      for (const h of events(n))
        if (h.selector)
          try {
            for (const e of box.querySelectorAll(h.selector)) found.add(e);
          } catch {
            /* 読めないセレクタは飛ばす */
          }
    for (const e of box.querySelectorAll('*')) if (events(e).length) found.add(e);
  }
  const all = [...found].filter((e) => e !== box && !realLink(e) && vis(e) && !e.closest('input,select,textarea,form[action]'));
  const leaves = all.filter((e) => !all.some((o) => o !== e && e.contains(o)));
  let n = 0;
  for (const e of leaves) {
    if (n >= 100) break;
    if (e.dataset.daigakuToggle !== undefined) continue;
    e.dataset.daigakuToggle = String(n++);
    e.click();
  }
  return n;
}

/**
 * ページの中で、欄（container）の項目に data-daigaku-item を付ける（items: 'auto'）。Playwright に渡すので、外の変数を使わない。
 * 押した見出し（data-daigaku-toggle）ごとに、その見出しだけを含む最大の祖先を項目とする。見出しがなければ欄全体を 1 項目にする
 */
function pageMarkItems(containerSel) {
  const box = containerSel ? document.querySelector(containerSel) : null;
  if (!box) return 0;
  for (const e of box.querySelectorAll('[data-daigaku-item]')) delete e.dataset.daigakuItem;
  delete box.dataset.daigakuItem;
  let n = 0;
  for (const t of box.querySelectorAll('[data-daigaku-toggle]')) {
    let item = t;
    while (item.parentElement && item.parentElement !== box && item.parentElement.querySelectorAll('[data-daigaku-toggle]').length === 1) item = item.parentElement;
    if (item.dataset.daigakuItem === undefined) item.dataset.daigakuItem = String(n++);
  }
  if (!n) {
    box.dataset.daigakuItem = '0';
    n = 1;
  }
  return n;
}

export function createRecipeExecutor(recipeIn, {session, secrets, log = () => {}, debug = null}) {
  const compileSection = (sec) => {
    if (!sec) return null;
    const fields = [];
    const regexes = {};
    for (const [k, v] of Object.entries(sec)) {
      if (META.has(k) || typeof v !== 'string') continue;
      const alts = parseFieldList(v);
      fields.push([k, alts.map((f) => [f.selector, f.attr])]);
      regexes[k] = alts;
    }
    return {...sec, spec: {fields, filesSelector: sec.files ?? null}, regexes};
  };
  const compile = (label, sec) => {
    const c = compileSection(sec);
    return c && {...c, label};
  };

  return {
    id: recipeIn.id,
    kind: 'recipe',
    name: recipeIn.name,
    parallelism: 3,
    recipe: recipeIn,

    async createContext(connection) {
      const host = connection.university_host ?? safeHost(connection.base_url);
      const recipe = applyUniversityOverride(recipeIn, host);
      const extra = (() => {
        try {
          return JSON.parse(connection.allowed_hosts_json ?? '[]');
        } catch {
          return [];
        }
      })();
      const allowedHosts = [...new Set([host, ...(recipe.allowedHosts ?? []), ...extra].filter(Boolean))];
      return {
        connection,
        recipe,
        sections: {
          courses: compile('courses', recipe.courses),
          rounds: compile('rounds', recipe.rounds),
          files: compile('files', recipe.files),
          notices: compile('notices', recipe.notices)
        },
        base: String(connection.base_url).replace(/\/+$/, ''),
        allowedHosts,
        waits: {afterClick: 800, pageLoad: 'domcontentloaded', ...(recipe.waits ?? {})},
        context: null,
        pages: []
      };
    },
    async releaseContext(ctx) {
      for (const p of ctx.pages) await p.close().catch(() => {});
      await session.close(ctx.context);
      ctx.context = null;
    },
    async saveSession(ctx) {
      if (ctx.context) await session.save(ctx.connection, ctx.context);
    },

    async _page(ctx) {
      ctx.context ??= await session.open(ctx.connection, {allowedHosts: ctx.allowedHosts});
      const page = await ctx.context.newPage();
      ctx.pages.push(page);
      return page;
    },
    async _release(ctx, page) {
      ctx.pages = ctx.pages.filter((p) => p !== page);
      await page.close().catch(() => {});
    },

    /**
     * 同じ URL のページは開いたまま使い回す（SaBoRo と同じく、授業ページを 1 回開いて回を切り替える）。
     * 授業ごとに回 → ファイル → お知らせの順に同じページを使うので、授業の数だけ（最大 4 枚）持つ
     */
    async _pageAt(ctx, url) {
      ctx.pageByUrl ??= new Map();
      const cached = ctx.pageByUrl.get(url);
      if (cached && !cached.isClosed() && safeHost(cached.url()) === safeHost(url)) return cached;
      if (cached) ctx.pageByUrl.delete(url);
      while (ctx.pageByUrl.size >= 4) {
        const [oldUrl, oldPage] = ctx.pageByUrl.entries().next().value;
        ctx.pageByUrl.delete(oldUrl);
        await this._release(ctx, oldPage);
      }
      const page = await this._page(ctx);
      await this._goto(page, ctx, url);
      ctx.pageByUrl.set(url, page);
      return page;
    },

    async _goto(page, ctx, url) {
      try {
        await page.goto(url, {waitUntil: ctx.waits.pageLoad});
      } catch (e) {
        if (/blockedbyclient|ERR_BLOCKED_BY_CLIENT/.test(e.message)) throw err('blocked-navigation', '許可していないページへ移動したため中断しました');
        if (/Timeout/i.test(e.message)) throw err('timeout', `${safeHost(url)} の応答がありませんでした`);
        throw err('network', `${safeHost(url)} に接続できませんでした`);
      }
    },

    async _isLoggedIn(page, ctx) {
      const sel = ctx.recipe.login?.loggedIn?.selector;
      if (sel && (await page.locator(sel).count().catch(() => 0)) > 0) return true;
      // 予備の判定（未検証のレシピや LMS の改修でセレクタが合わないとき）：
      // パスワード欄がなく、「ログアウト」にあたるリンク・ボタンがあればログイン済みとみなす
      const h = await page.evaluate(pageLoginHints, LOGOUT_RE.source).catch(() => ({pw: true, logout: false}));
      const ok = !h.pw && h.logout;
      if (ok && !ctx.heuristicLogged) {
        ctx.heuristicLogged = true;
        log(`[recipe] ${recipeIn.id}: login.loggedIn のセレクタ（${sel ?? 'なし'}）は一致しませんでしたが、「ログアウト」の表示があるのでログイン済みと判断しました（${page.url()}）。レシピの見直しが要ります`);
      }
      return ok;
    },

    /** レシピが合わなかった画面を debug フォルダに保存し、要約をログに出す（レシピを直すための手がかり） */
    async _dump(page, label) {
      if (!debug?.dir) return null;
      try {
        const summary = await page.evaluate(pageSummary).catch(() => ({title: '', links: [], ids: [], anchors: 0}));
        const file = path.join(debug.dir, `${recipeIn.id}_${label}_${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
        await writeFile(file, `<!-- ${page.url()} -->\n${await page.content()}`);
        log(`[recipe] ${recipeIn.id} ${label}: ${page.url()} 「${summary.title}」 リンク ${summary.anchors} 本（${summary.links.join(' ')}） id: ${summary.ids.join(' ')} → 画面を保存 ${file}`);
        const old = (await readdir(debug.dir)).filter((f) => f.endsWith('.html')).sort();
        for (const f of old.slice(0, Math.max(0, old.length - DEBUG_KEEP))) await unlink(path.join(debug.dir, f)).catch(() => {});
        return file;
      } catch (e) {
        log(`[recipe] 画面の保存に失敗: ${e.message}`);
        return null;
      }
    },
    async _looksLikeLogin(page) {
      return (await page.locator('input[type=password]').count()) > 0;
    },

    async ensureSession(ctx) {
      const page = await this._page(ctx);
      try {
        await this._goto(page, ctx, ctx.base + '/');
        if (await this._isLoggedIn(page, ctx)) return 'ok';
        await this._dump(page, 'login-check');
        return 'login-required';
      } finally {
        await this._release(ctx, page);
      }
    },

    /** headless：保存した ID・パスワードをフォームに入れる（login.form があるときだけ）。visible：見えるログイン窓 */
    async login(ctx, mode = 'headless', {credentials} = {}) {
      const form = ctx.recipe.login?.form;
      if (mode === 'headless') {
        if (!form) throw err('login-required', 'この LMS は統合認証のため、ブラウザ窓でログインしてください');
        const cred = credentials ?? (await secrets?.get(`conn:${ctx.connection.id}:password`));
        if (!cred?.user) throw err('login-required', '保存した ID とパスワードがありません');
        const page = await this._page(ctx);
        try {
          await this._goto(page, ctx, ctx.base + '/');
          if (await this._isLoggedIn(page, ctx)) return {ok: true};
          await page.locator(form.user).first().fill(cred.user);
          await page.locator(form.password).first().fill(cred.password);
          await Promise.all([page.waitForLoadState(ctx.waits.pageLoad).catch(() => {}), page.locator(form.submit).first().click()]);
          await page.locator(ctx.recipe.login.loggedIn.selector).first().waitFor({timeout: 30000}).catch(() => {});
          if (!(await this._isLoggedIn(page, ctx))) throw err('login-required', 'ID かパスワードが違うか、追加の認証が必要です');
          await session.save(ctx.connection, ctx.context);
          return {ok: true};
        } finally {
          await this._release(ctx, page);
        }
      }
      const r = await session.loginVisible(ctx.connection, {
        url: ctx.base + '/',
        isLoggedIn: async (page) => {
          try {
            return new URL(page.url()).hostname === safeHost(ctx.base) && (await this._isLoggedIn(page, ctx));
          } catch {
            return false;
          }
        }
      });
      return {ok: true, visitedHosts: r.visitedHosts};
    },

    async _collect(page, ctx, section, vars, {openAll = false} = {}) {
      // 欄（container）が AJAX で後から入るときは、中身が入るまで待ってから押す・読む
      const container = section.container ? fillTemplate(section.container, vars) : null;
      if (container) {
        await page.locator(container).first().waitFor({timeout: 8000}).catch(() => {});
        await page
          .waitForFunction(
            (sel) => {
              const b = document.querySelector(sel);
              return !b || b.children.length > 0 || b.textContent.trim().length > 0;
            },
            container,
            {timeout: 8000}
          )
          .catch(() => {});
      }
      // 押したあとは「欄の中身が入れ替わり、読み込み中の印が消える」まで待つ（通信が落ち着くのを待つと、常に通信のある LMS で毎回数秒を失う）
      const settled = (before) =>
        container
          ? page
              .waitForFunction(
                ([sel, prev]) => {
                  const b = document.querySelector(sel);
                  return !!b && (prev === null || b.innerHTML !== prev) && !b.querySelector('.loading, [class*="loading" i], [class*="spinner" i]');
                },
                [container, before],
                {timeout: 8000}
              )
              .catch(() => {})
          : Promise.resolve();
      const snapshot = () => (container ? page.evaluate((sel) => document.querySelector(sel)?.innerHTML ?? '', container).catch(() => '') : Promise.resolve(null));
      if (section.openBeforeRead === 'auto') {
        const n = await page.evaluate(pageExpand, container).catch(() => 0);
        if (n) {
          await page.waitForTimeout(ctx.waits.afterClick);
          await settled(null);
        }
      } else if (section.openBeforeRead) {
        const sel = fillTemplate(section.openBeforeRead, vars);
        const targets = page.locator(sel);
        const n = await targets.count();
        if (!n) log(`[recipe] ${recipeIn.id} ${section.label}: 押す要素がありません（${sel}）`);
        for (let i = 0; i < (openAll ? n : Math.min(n, 1)); i++) {
          const before = await snapshot();
          await targets.nth(i).click({timeout: 5000}).catch(() => {});
          await settled(before);
          await page.waitForTimeout(ctx.waits.afterClick);
        }
      }
      let itemsSel = section.items;
      if (itemsSel === 'auto') {
        await page.evaluate(pageMarkItems, container).catch(() => 0);
        itemsSel = '[data-daigaku-item]';
      }
      // 欄が落ち着いたあとなら項目はすぐ出るはず。空の回で毎回 8 秒待たない
      await page.locator(itemsSel).first().waitFor({timeout: container ? 1500 : 8000}).catch(() => {});
      const raw = await page.$$eval(itemsSel, pageExtract, section.spec);
      if (!raw.length) {
        if (await this._looksLikeLogin(page)) throw err('login-required', 'ログインページに戻されました');
        // files は「資料のない回」で空になるのがふつうなので、画面の保存は接続ごとに 1 回だけ
        if (section.label !== 'files' || !ctx.dumpedFiles) {
          ctx.dumpedFiles = ctx.dumpedFiles || section.label === 'files';
          await this._dump(page, section.label ?? 'items');
        }
        throw err('selector-missing', `要素が見つかりません（${section.items}）`);
      }
      const base = page.url();
      return raw.map((item) => {
        const out = {};
        for (const [k] of section.spec.fields) {
          const alts = section.regexes[k];
          out[k] = '';
          for (let i = 0; i < alts.length; i++) {
            const v = applyRegex(item[k][i], alts[i]);
            if (v) {
              out[k] = v;
              break;
            }
          }
        }
        if (out.link && !/^@/.test(section.link ?? '') && /^(https?:)?\/|^[^:]+$/.test(out.link) && /@href/.test(section.link ?? '@href')) out.link = resolveHref(out.link, base) || out.link;
        if (item.__files) out.files = item.__files.map((f) => ({url: resolveHref(f.href, base), name: f.text}));
        out.__text = item.__text;
        return out;
      });
    },

    async listCourses(ctx) {
      const sec = ctx.sections.courses;
      const page = await this._page(ctx);
      try {
        await this._goto(page, ctx, fillTemplate(sec.url, {base: ctx.base}));
        if (!(await this._isLoggedIn(page, ctx)) && (await this._looksLikeLogin(page))) throw err('login-required', 'ログインが必要です');
        const items = await this._collect(page, ctx, sec, {base: ctx.base});
        const seen = new Set();
        const out = [];
        for (const it of items) {
          if (!it.name || !it.link) continue;
          const lmsId = it.lmsId || it.link;
          if (seen.has(lmsId)) continue;
          seen.add(lmsId);
          const slot = it.weekday ? {weekday: it.weekday, period: Number(it.period) || undefined} : parseSlot(it.name) ?? {};
          // リンクの文字は「授業名（金曜／2限）\n教員名」のように複数行のことがある。授業名は最初の行だけ
          const firstLine = it.name.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? it.name;
          out.push({lmsId, name: firstLine.replace(/\s*[（(][^（()）]*曜[^（()）]*[)）]\s*$/, '').trim() || firstLine, url: it.link, weekday: slot.weekday, period: slot.period});
        }
        return out;
      } finally {
        await this._release(ctx, page);
      }
    },

    async listRounds(ctx, course) {
      const sec = ctx.sections.rounds;
      const vars = {base: ctx.base, course: {url: course.lms_url ?? course.url, lmsId: course.lms_id ?? course.lmsId}};
      const page = await this._pageAt(ctx, fillTemplate(sec.url, vars));
      const items = await this._collect(page, ctx, sec, vars);
      return items
        .filter((it) => it.title)
        .map((it) => ({number: Number(it.round) || parseRound(it.title), title: it.title, lmsRef: it.link || it.lmsRef || it.title, url: /^https?:/.test(it.link ?? '') ? it.link : undefined}));
    },

    async listFiles(ctx, course, round) {
      const sec = ctx.sections.files;
      const vars = {base: ctx.base, course: {url: course.lms_url ?? course.url, lmsId: course.lms_id ?? course.lmsId}, round: {url: round.url ?? course.lms_url ?? course.url, lmsRef: round.lmsRef}};
      const page = await this._pageAt(ctx, fillTemplate(sec.url, vars));
      let items;
      try {
        items = await this._collect(page, ctx, sec, vars);
      } catch (e) {
        if (e.code === 'selector-missing') return []; // 資料のない回
        throw e;
      }
      return items.filter((it) => it.link && FILE_LINK.test(it.link)).map((it) => ({url: it.link, name: it.name || undefined}));
    },

    async listNoticeFiles(ctx, course) {
      const sec = ctx.sections.notices;
      if (!sec) return [];
      const vars = {base: ctx.base, course: {url: course.lms_url ?? course.url, lmsId: course.lms_id ?? course.lmsId}};
      const url = fillTemplate(sec.url, vars);
      const page = await this._pageAt(ctx, url);
      let items;
      try {
        items = await this._collect(page, ctx, sec, vars, {openAll: true});
      } catch (e) {
        if (e.code === 'selector-missing') return [];
        throw e;
      } finally {
        // お知らせは授業の最後の読み取り。この授業のページはもう使わないので閉じる
        ctx.pageByUrl?.delete(url);
        await this._release(ctx, page);
      }
      const out = [];
      for (const it of items) {
        const round = Number(it.round) || 0;
        for (const f of it.files ?? []) if (f.url && FILE_LINK.test(f.url)) out.push({url: f.url, name: f.name || undefined, round: round || undefined, noticeTitle: it.title ?? it.round ?? ''});
      }
      return out;
    },

    async fetchFile(ctx, ref) {
      ctx.context ??= await session.open(ctx.connection, {allowedHosts: ctx.allowedHosts});
      if (ctx.allowedHosts.length && !ctx.allowedHosts.some((h) => safeHost(ref.url) === h || safeHost(ref.url).endsWith('.' + h)))
        throw err('blocked-navigation', '許可していないホストのファイルです');
      const res = await ctx.context.request.get(ref.url, {maxRedirects: 5, timeout: 60000});
      return {ok: res.ok(), status: res.status(), contentType: res.headers()['content-type'] ?? '', disposition: res.headers()['content-disposition'] ?? '', body: await res.body()};
    },

    openUrl(course) {
      return course.lms_url ?? course.url;
    }
  };
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
