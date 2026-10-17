// 画面操作型コネクタ：レシピ（JSON）を Playwright で実行する（DESIGN-M0 §8.4、SPEC §6.13）。
// レシピにコードはない。この実行器がセレクタ・属性・正規表現・URL の差し込みだけを解釈する。
import path from 'node:path';
import {readdir, unlink, writeFile} from 'node:fs/promises';
import {applyRegex, applyUniversityOverride, fillTemplate, parseField, resolveHref} from '../../shared/recipe.js';
import {parseRound} from '../../shared/rounds.js';
import {parseSlot} from './slot.js';

const META = new Set(['url', 'items', 'openBeforeRead', 'files']);
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

/** ページの中で項目ごとに値を集める関数（Playwright に渡すので、外の変数を使わない） */
function pageExtract(els, spec) {
  const val = (root, sel, attr) => {
    const t = sel ? root.querySelector(sel) : root;
    if (!t) return '';
    if (attr === 'text') return (t.textContent || '').trim();
    if (attr === 'html') return t.innerHTML;
    if (attr === 'href') return t.href || t.getAttribute('href') || '';
    return t.getAttribute(attr) ?? '';
  };
  return els.map((el) => {
    const out = {};
    for (const [key, sel, attr] of spec.fields) out[key] = val(el, sel, attr);
    if (spec.filesSelector) out.__files = [...el.querySelectorAll(spec.filesSelector)].map((a) => ({href: a.href || a.getAttribute('href') || '', text: (a.textContent || '').trim()}));
    return out;
  });
}

export function createRecipeExecutor(recipeIn, {session, secrets, log = () => {}, debug = null}) {
  const compileSection = (sec) => {
    if (!sec) return null;
    const fields = [];
    const regexes = {};
    for (const [k, v] of Object.entries(sec)) {
      if (META.has(k) || typeof v !== 'string') continue;
      const f = parseField(v);
      fields.push([k, f.selector, f.attr]);
      if (f.regex) regexes[k] = f;
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
      if (section.openBeforeRead) {
        const sel = fillTemplate(section.openBeforeRead, vars);
        const targets = page.locator(sel);
        const n = await targets.count();
        for (let i = 0; i < (openAll ? n : Math.min(n, 1)); i++) {
          await targets.nth(i).click({timeout: 5000}).catch(() => {});
          await page.waitForTimeout(ctx.waits.afterClick);
        }
      }
      await page.locator(section.items).first().waitFor({timeout: 8000}).catch(() => {});
      const raw = await page.$$eval(section.items, pageExtract, section.spec);
      if (!raw.length) {
        if (await this._looksLikeLogin(page)) throw err('login-required', 'ログインページに戻されました');
        await this._dump(page, section.label ?? 'items');
        throw err('selector-missing', `要素が見つかりません（${section.items}）`);
      }
      const base = page.url();
      return raw.map((item) => {
        const out = {};
        for (const [k] of section.spec.fields) {
          const f = section.regexes[k];
          out[k] = f ? applyRegex(item[k], f) : item[k];
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
          out.push({lmsId, name: it.name.replace(/\s*[（(][^（()）]*曜[^（()）]*[)）]\s*$/, '').trim() || it.name, url: it.link, weekday: slot.weekday, period: slot.period});
        }
        return out;
      } finally {
        await this._release(ctx, page);
      }
    },

    async listRounds(ctx, course) {
      const sec = ctx.sections.rounds;
      const page = await this._page(ctx);
      try {
        const vars = {base: ctx.base, course: {url: course.lms_url ?? course.url, lmsId: course.lms_id ?? course.lmsId}};
        await this._goto(page, ctx, fillTemplate(sec.url, vars));
        const items = await this._collect(page, ctx, sec, vars);
        return items
          .filter((it) => it.title)
          .map((it) => ({number: Number(it.round) || parseRound(it.title), title: it.title, lmsRef: it.link || it.lmsRef || it.title, url: /^https?:/.test(it.link ?? '') ? it.link : undefined}));
      } finally {
        await this._release(ctx, page);
      }
    },

    async listFiles(ctx, course, round) {
      const sec = ctx.sections.files;
      const page = await this._page(ctx);
      try {
        const vars = {base: ctx.base, course: {url: course.lms_url ?? course.url, lmsId: course.lms_id ?? course.lmsId}, round: {url: round.url ?? course.lms_url ?? course.url, lmsRef: round.lmsRef}};
        await this._goto(page, ctx, fillTemplate(sec.url, vars));
        let items;
        try {
          items = await this._collect(page, ctx, sec, vars);
        } catch (e) {
          if (e.code === 'selector-missing') return []; // 資料のない回
          throw e;
        }
        return items.filter((it) => it.link && FILE_LINK.test(it.link)).map((it) => ({url: it.link, name: it.name || undefined}));
      } finally {
        await this._release(ctx, page);
      }
    },

    async listNoticeFiles(ctx, course) {
      const sec = ctx.sections.notices;
      if (!sec) return [];
      const page = await this._page(ctx);
      try {
        const vars = {base: ctx.base, course: {url: course.lms_url ?? course.url, lmsId: course.lms_id ?? course.lmsId}};
        await this._goto(page, ctx, fillTemplate(sec.url, vars));
        let items;
        try {
          items = await this._collect(page, ctx, sec, vars, {openAll: true});
        } catch (e) {
          if (e.code === 'selector-missing') return [];
          throw e;
        }
        const out = [];
        for (const it of items) {
          const round = Number(it.round) || 0;
          for (const f of it.files ?? []) if (f.url && FILE_LINK.test(f.url)) out.push({url: f.url, name: f.name || undefined, round: round || undefined, noticeTitle: it.title ?? it.round ?? ''});
        }
        return out;
      } finally {
        await this._release(ctx, page);
      }
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
