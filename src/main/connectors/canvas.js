// Canvas LMS（慶應義塾大学の K-LMS など）のコネクタ（SPEC §6.13）。
// ログインは画面操作型と同じ（recipes/canvas.json と recipe-executor.js の見えるログイン窓・Cookie の保存）。
// 一覧は画面を読まず、Canvas の窓口（REST API /api/v1）を、ログインしたブラウザの Cookie で呼ぶ（Canvas の画面自身と同じ呼び方。
// 読むだけ（GET）なので CSRF の札は要らない）。API の鍵（アクセストークン）は使わない（大学が学生に作らせないことがある）。
// - 授業：受講中の授業（/api/v1/courses）。終わった学期のものは除く
// - 回：モジュール（/courses/:id/modules）。名前の「第 N 回」「Week N」から回を読む
// - 資料：モジュールの中のファイルと、モジュールの中のページに貼ったファイル
// - お知らせ：お知らせの本文と添付のファイル。モジュールが 1 つもない授業は、授業のファイル（/courses/:id/files）も読む
import {parseRound} from '../../shared/rounds.js';
import {parseSlot} from './slot.js';

const err = (code, message) => Object.assign(new Error(message), {code});
/** Cookie で呼んだときの JSON の頭（JSON の盗み読みを防ぐための Canvas の決まり） */
const GUARD = /^\s*while\(1\);/;
const MAX_PAGES = 20; // ページ送りの上限（100 件ずつ）
const MAX_REDIRECTS = 5;
const PAST_DAYS = 30; // 学期が終わってからこの日数を過ぎた授業は出さない
const ANNOUNCE_DAYS = 400; // お知らせを読む期間（Canvas の既定は 14 日だけ）

/** 本文（HTML）の中のファイルへのリンクから、ファイルの番号を拾う（/courses/1/files/2・/files/2・data-api-endpoint） */
export function fileIdsIn(html) {
  const out = new Set();
  for (const m of String(html ?? '').matchAll(/\/(?:courses\/\d+\/)?files\/(\d+)(?=[/?"'#\s]|$)/g)) out.add(m[1]);
  return [...out];
}

/** Link ヘッダーの次のページ */
export function nextLink(link) {
  for (const part of String(link ?? '').split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

/** 授業を出すか：学期・授業の終わりから PAST_DAYS を過ぎたものは出さない */
export function currentCourse(c, now = new Date()) {
  if (!c || !c.id || !c.name || c.access_restricted_by_date) return false;
  const end = c.term?.end_at ?? c.end_at;
  if (end && Date.parse(end) + PAST_DAYS * 86400000 < now.getTime()) return false;
  return true;
}

/**
 * recipe-executor.js で作った実行器（ログイン・Cookie・ファイルの取得）に、一覧の読み方だけを Canvas の窓口で差し替える。
 * 実行器のメソッドは this を使うので、実行器を元にした（プロトタイプにした）オブジェクトを返す
 */
export function createCanvasConnector(executor, {log = () => {}, now = () => new Date()} = {}) {
  const c = Object.create(executor);

  /** 窓口を呼ぶ（GET）。ページ送りもたどる。戻りは JSON（配列はページをつないだもの） */
  async function api(ctx, pathOrUrl, {all = true} = {}) {
    const context = await executor._context(ctx);
    const base = new URL(ctx.base);
    let url = new URL(pathOrUrl, ctx.base).href;
    const out = [];
    for (let i = 0; i < MAX_PAGES; i++) {
      if (new URL(url).host !== base.host) throw err('blocked-navigation', '許可していないホストの窓口です');
      const res = await context.request.get(url, {
        headers: {Accept: 'application/json'},
        maxRedirects: 0,
        timeout: 30000
      });
      const status = res.status();
      // ログインの画面への転送：ログインが切れた
      if (status >= 300 && status < 400) {
        await res.dispose().catch(() => {});
        throw err('login-required', 'K-LMS（Canvas）にログインしてください');
      }
      // 401 は 2 通り：ログインしていない（unauthenticated）と、見る権限がない（unauthorized：隠したファイル・タブなど）
      if (status === 401) {
        const why = (await res.text().catch(() => '')).replace(GUARD, '');
        if (/"status"\s*:\s*"unauthorized"/.test(why)) throw err('not-found', 'Canvas で見る権限がありません');
        throw err('login-required', 'K-LMS（Canvas）にログインしてください');
      }
      if (status === 403 || status === 404) {
        await res.dispose().catch(() => {});
        throw err('not-found', `Canvas の窓口が使えません（${status}）`);
      }
      if (!res.ok()) {
        await res.dispose().catch(() => {});
        throw err('network', `Canvas の窓口がエラーを返しました（${status}）`);
      }
      const text = (await res.text()).replace(GUARD, '');
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw err('login-required', 'K-LMS（Canvas）にログインしてください'); // ログインの画面（HTML）が返った
      }
      if (!Array.isArray(body) || !all) return body;
      out.push(...body);
      const next = nextLink(res.headers().link);
      if (!next) return out;
      url = next;
    }
    log(`canvas: ページが多すぎるので ${MAX_PAGES} ページで止めました（${new URL(pathOrUrl, ctx.base).pathname}）`);
    return out;
  }
  /** 使えない窓口（タブを隠した授業など）は空 */
  const optional = (p) => p.catch((e) => (e.code === 'not-found' ? [] : Promise.reject(e)));

  const cache = (ctx) => (ctx.canvas ??= {modules: new Map(), files: new Map()});
  const courseId = (course) => String(course.lms_id ?? course.lmsId ?? '').replace(/\D/g, '');

  /** ファイルの番号 → 資料の参照（読めない・隠したファイルは null） */
  async function fileRef(ctx, cid, fid) {
    const memo = cache(ctx).files;
    const key = `${cid}:${fid}`;
    if (!memo.has(key))
      memo.set(
        key,
        api(ctx, `/api/v1/courses/${cid}/files/${fid}`, {all: false})
          .catch((e) => (e.code === 'not-found' ? api(ctx, `/api/v1/files/${fid}`, {all: false}) : Promise.reject(e)))
          .then((f) =>
            f && f.id && !f.locked_for_user && !f.hidden_for_user
              ? {
                  url: `${ctx.base}/courses/${cid}/files/${f.id}`,
                  name: f.display_name || f.filename || undefined,
                  size: f.size ?? undefined,
                  modified: f.modified_at || f.updated_at || undefined
                }
              : null
          )
          .catch((e) => (e.code === 'not-found' ? null : Promise.reject(e)))
      );
    return memo.get(key);
  }
  const refsOf = async (ctx, cid, ids) => (await Promise.all(ids.map((id) => fileRef(ctx, cid, id)))).filter(Boolean);

  /** モジュール（と中の項目）。項目が多いモジュールは items が付かないので読み足す */
  async function modules(ctx, cid) {
    const memo = cache(ctx).modules;
    if (!memo.has(cid))
      memo.set(
        cid,
        (async () => {
          const list = await optional(api(ctx, `/api/v1/courses/${cid}/modules?include[]=items&per_page=100`));
          for (const m of list)
            if (!Array.isArray(m.items))
              m.items = await optional(api(ctx, `/api/v1/courses/${cid}/modules/${m.id}/items?per_page=100`));
          return list;
        })()
      );
    return memo.get(cid);
  }

  Object.assign(c, {
    id: executor.id,
    api: 'canvas',

    /** ログインしているか：自分の情報（/users/self）が読めるか */
    async ensureSession(ctx) {
      try {
        await api(ctx, '/api/v1/users/self', {all: false});
        return 'ok';
      } catch (e) {
        if (e.code === 'login-required') return 'login-required';
        throw e;
      }
    },

    async listCourses(ctx) {
      const list = await api(ctx, '/api/v1/courses?enrollment_state=active&include[]=term&per_page=100');
      const at = now();
      return list
        .filter((x) => currentCourse(x, at))
        .map((x) => {
          const slot = parseSlot(`${x.name} ${x.course_code ?? ''}`) ?? {};
          return {
            lmsId: String(x.id),
            name: String(x.name).trim(),
            url: `${ctx.base}/courses/${x.id}`,
            weekday: slot.weekday,
            period: slot.period ?? undefined
          };
        });
    },

    /** 回：モジュールの名前から。読めなければ 0（engine が日付・ファイル名から振り直す） */
    async listRounds(ctx, course) {
      const cid = courseId(course);
      return (await modules(ctx, cid))
        .filter((m) => m.name && m.published !== false)
        .map((m) => ({
          number: parseRound(m.name),
          title: String(m.name).trim(),
          lmsRef: `module:${m.id}`,
          url: `${ctx.base}/courses/${cid}/modules/${m.id}`
        }));
    },

    /** 回の資料：モジュールの中のファイルと、中のページに貼ったファイル */
    async listFiles(ctx, course, round) {
      const cid = courseId(course);
      const mid = String(round.lmsRef ?? round.row?.lms_ref ?? '').replace(/^module:/, '');
      const m = (await modules(ctx, cid)).find((x) => String(x.id) === mid);
      if (!m) return [];
      const ids = [];
      for (const it of m.items ?? []) {
        if (it.type === 'File' && it.content_id) ids.push(String(it.content_id));
        else if (it.type === 'Page' && it.page_url) {
          const page = await optional(
            api(ctx, `/api/v1/courses/${cid}/pages/${encodeURIComponent(it.page_url)}`, {all: false})
          );
          ids.push(...fileIdsIn(page?.body));
        }
      }
      return refsOf(ctx, cid, [...new Set(ids)]);
    },

    /** お知らせの添付。モジュールが 1 つもない授業は、授業のファイルもここで渡す（回は名前から読む） */
    async listNoticeFiles(ctx, course) {
      const cid = courseId(course);
      const since = new Date(now().getTime() - ANNOUNCE_DAYS * 86400000).toISOString();
      const notices = await optional(
        api(
          ctx,
          `/api/v1/announcements?context_codes[]=course_${cid}&start_date=${encodeURIComponent(since)}&per_page=50`
        )
      );
      const out = [];
      const seen = new Set();
      for (const n of notices) {
        const ids = [...fileIdsIn(n.message), ...(n.attachments ?? []).map((a) => String(a.id)).filter(Boolean)];
        for (const ref of await refsOf(ctx, cid, [...new Set(ids)])) {
          if (seen.has(ref.url)) continue;
          seen.add(ref.url);
          const title = String(n.title ?? '').trim();
          out.push({...ref, round: parseRound(title) || undefined, noticeTitle: title || 'お知らせ'});
        }
      }
      if (!(await modules(ctx, cid)).length) {
        const files = await optional(api(ctx, `/api/v1/courses/${cid}/files?per_page=100&sort=created_at`));
        for (const f of files) {
          if (!f.id || f.locked_for_user || f.hidden_for_user) continue;
          const url = `${ctx.base}/courses/${cid}/files/${f.id}`;
          if (seen.has(url)) continue;
          seen.add(url);
          out.push({
            url,
            name: f.display_name || f.filename || undefined,
            size: f.size ?? undefined,
            modified: f.modified_at || f.updated_at || undefined
          });
        }
      }
      return out;
    },

    /**
     * ファイルを取る：/courses/:id/files/:fid/download。Canvas はファイルの置き場（別のホストのことがある）へ、
     * 期限つきの URL で転送するので、K-LMS から始めた転送だけは https の別のホストもたどる（その先へ K-LMS の Cookie は送られない）
     */
    async fetchFile(ctx, ref) {
      const context = await executor._context(ctx);
      const base = new URL(ctx.base);
      let url = /\/files\/\d+$/.test(ref.url) ? `${ref.url}/download?download_frd=1` : ref.url;
      if (new URL(url).host !== base.host) throw err('blocked-navigation', '許可していないホストのファイルです');
      for (let hop = 0; ; hop++) {
        const res = await context.request.get(url, {maxRedirects: 0, timeout: 60000});
        const location = res.headers().location;
        if (res.status() >= 300 && res.status() < 400 && location) {
          await res.dispose().catch(() => {});
          if (hop >= MAX_REDIRECTS) throw err('download', '転送が多すぎます');
          const next = new URL(location, url);
          if (next.protocol !== 'https:') throw err('blocked-navigation', 'https でないところへ転送されました');
          if (next.host === base.host && /\/login\b/.test(next.pathname))
            throw err('login-required', 'K-LMS（Canvas）にログインしてください');
          url = next.href;
          continue;
        }
        return {
          ok: res.ok(),
          status: res.status(),
          contentType: res.headers()['content-type'] ?? '',
          disposition: res.headers()['content-disposition'] ?? '',
          body: await res.body()
        };
      }
    },

    openUrl(course) {
      return course.lms_url ?? course.url;
    }
  });
  return c;
}
