// API 型コネクタ：Moodle（DESIGN-M0 §8.3）。Web Services（モバイルアプリ用サービス）のトークンで呼ぶ。
import {parseRound} from '../../shared/rounds.js';
import {parseSlot} from './slot.js';

export class MoodleApiError extends Error {
  constructor(errorcode, message) {
    super(message || errorcode);
    this.errorcode = errorcode;
    this.code = ['invalidtoken', 'accessexception', 'invalidlogin'].includes(errorcode)
      ? 'login-required'
      : 'moodle-api';
  }
}

const SERVICE = 'moodle_mobile_app';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createMoodleConnector({
  fetch: fetchImpl = globalThis.fetch,
  secrets,
  retryDelays = [1000, 5000, 15000]
} = {}) {
  const normBase = (u) =>
    String(u)
      .replace(/\/+$/, '')
      .replace(/\/(login\/index\.php|my\/?|course\/.*)$/, '');

  async function call(ctx, wsfunction, params = {}) {
    const body = new URLSearchParams({wstoken: ctx.token ?? '', wsfunction, moodlewsrestformat: 'json'});
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x, i) => body.set(`${k}[${i}]`, String(x)));
      else body.set(k, String(v));
    }
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${ctx.base}/webservice/rest/server.php`, {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body
        });
      } catch (e) {
        if (attempt < retryDelays.length) {
          await sleep(retryDelays[attempt]);
          continue;
        }
        throw Object.assign(new Error(`Moodle に接続できません: ${e.message}`), {code: 'network'});
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retryDelays.length) {
        await sleep(retryDelays[attempt]);
        continue;
      }
      if (!res.ok)
        throw Object.assign(new Error(`Moodle API が ${res.status} を返しました`), {
          code: res.status >= 500 ? 'network' : 'moodle-api'
        });
      const json = await res.json();
      if (json && typeof json === 'object' && json.exception) throw new MoodleApiError(json.errorcode, json.message);
      return json;
    }
  }

  return {
    id: 'moodle',
    kind: 'api',
    name: 'Moodle',
    parallelism: 5,

    /** この URL が Moodle である確からしさ */
    async detect(url, html = '') {
      let score = 0;
      if (/\/moodle\b/i.test(url)) score = 0.5;
      if (/M\.cfg|moodle/i.test(html)) score = Math.max(score, 0.7);
      if (/<meta name="keywords" content="moodle/i.test(html)) score = 0.9;
      try {
        const base = normBase(url);
        const r = await fetchImpl(`${base}/login/token.php?username=&password=&service=${SERVICE}`, {method: 'GET'});
        if (r.ok) {
          const j = await r.json().catch(() => null);
          if (j && (j.error || j.errorcode)) score = Math.max(score, 0.95); // Moodle 特有の応答
        }
      } catch {
        /* 判定できないだけ */
      }
      return score;
    },

    async createContext(connection) {
      return {
        connectionId: connection.id,
        base: normBase(connection.base_url),
        token: (await secrets?.get(`conn:${connection.id}:token`)) ?? null,
        userid: null
      };
    },
    async releaseContext() {},
    async saveSession() {},

    async ensureSession(ctx) {
      if (!ctx.token) return 'login-required';
      try {
        const info = await call(ctx, 'core_webservice_get_site_info');
        ctx.userid = info.userid;
        ctx.siteName = info.sitename;
        return 'ok';
      } catch (e) {
        if (e.code === 'login-required') return 'login-required';
        throw e;
      }
    },

    /**
     * ログイン。headless：保存した ID・パスワードで token.php。visible：launch.php の流れ（browser/session.js が担当。ここでは受け取ったトークンを保存するだけ）
     */
    async login(ctx, mode = 'headless', {credentials, tokenFromBrowser} = {}) {
      const cred = credentials ?? (await secrets?.get(`conn:${ctx.connectionId}:password`));
      if (mode === 'headless') {
        if (!cred?.user)
          throw Object.assign(new Error('保存した ID とパスワードがありません'), {code: 'login-required'});
        const res = await fetchImpl(`${ctx.base}/login/token.php`, {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: new URLSearchParams({username: cred.user, password: cred.password, service: SERVICE})
        });
        const j = await res.json().catch(() => ({}));
        if (!j.token)
          throw Object.assign(new Error(j.error || 'ID かパスワードが違います'), {
            code: 'login-required',
            errorcode: j.errorcode
          });
        ctx.token = j.token;
      } else {
        if (!tokenFromBrowser)
          throw Object.assign(new Error('ブラウザからトークンを受け取れませんでした'), {code: 'login-required'});
        ctx.token = tokenFromBrowser;
      }
      await secrets?.set(`conn:${ctx.connectionId}:token`, ctx.token);
      const info = await call(ctx, 'core_webservice_get_site_info');
      ctx.userid = info.userid;
      return {userid: info.userid, fullname: info.fullname};
    },

    /** launch.php の戻り（daigakunote://token=<base64>）からトークンを取り出す。base64 は "passportHash:::token:::privatetoken" */
    parseLaunchToken(url) {
      const m = String(url).match(/token=([A-Za-z0-9+/=_-]+)/);
      if (!m) return null;
      const decoded = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      const parts = decoded.split(':::');
      return parts.length >= 2 ? parts[1] : null;
    },
    launchUrl(ctx, passport) {
      return `${ctx.base}/admin/tool/mobile/launch.php?service=${SERVICE}&passport=${encodeURIComponent(passport)}&urlscheme=daigakunote`;
    },

    async listCourses(ctx) {
      if (!ctx.userid) await this.ensureSession(ctx);
      const courses = await call(ctx, 'core_enrol_get_users_courses', {userid: ctx.userid});
      return courses
        .filter((c) => c.visible !== 0)
        .map((c) => {
          const slot = parseSlot(c.fullname) ?? parseSlot(c.shortname);
          return {
            lmsId: String(c.id),
            name: String(c.fullname ?? c.shortname).trim(),
            url: `${ctx.base}/course/view.php?id=${c.id}`,
            weekday: slot?.weekday,
            period: slot?.period,
            startDate: c.startdate ? new Date(c.startdate * 1000).toISOString().slice(0, 10) : undefined
          };
        });
    },

    async listRounds(ctx, course) {
      const sections = await this._contents(ctx, course);
      return sections.map((s) => {
        const title = String(s.name ?? '').trim();
        const parsed = parseRound(title);
        return {number: parsed || (s.section >= 1 ? s.section : 0), title, lmsRef: String(s.id), section: s.section};
      });
    },

    async listFiles(ctx, course, round) {
      const sections = await this._contents(ctx, course);
      const s = sections.find((x) => String(x.id) === String(round.lmsRef));
      if (!s) return [];
      const out = [];
      for (const m of s.modules ?? []) {
        if (!['resource', 'folder'].includes(m.modname)) continue;
        for (const c of m.contents ?? []) {
          if (c.type !== 'file' || !c.fileurl) continue;
          out.push({
            url: c.fileurl,
            name: c.filename,
            size: c.filesize,
            modified: c.timemodified ? new Date(c.timemodified * 1000).toISOString() : undefined
          });
        }
      }
      return out;
    },

    async listNoticeFiles() {
      return []; // M0 ではフォーラムの添付は読まない
    },

    async fetchFile(ctx, ref) {
      // トークンは LMS のサイトにだけ付けて送る（API の応答に外のサイトの URL が混ざっていても漏らさない）
      const site = new URL(ctx.base).origin;
      const target = new URL(ref.url);
      if (target.origin !== site) throw new Error(`資料の URL が LMS の外（${target.host}）を指しているので読みません`);
      let url = ref.url + (ref.url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(ctx.token);
      // 転送は自分でたどり、LMS のサイトの中だけにする（外へ転送されたら取らない）
      let res;
      for (let hop = 0; ; hop++) {
        res = await fetchImpl(url, {redirect: 'manual'});
        const location = res.headers.get('location');
        if (!(res.status >= 300 && res.status < 400 && location)) break;
        if (hop >= 5) throw new Error('資料の転送が多すぎます');
        const next = new URL(location, url);
        if (next.origin !== site) throw new Error(`資料の URL が LMS の外（${next.host}）へ転送されたので読みません`);
        url = next.href;
      }
      const body = Buffer.from(await res.arrayBuffer());
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        disposition: res.headers.get('content-disposition') ?? '',
        body
      };
    },

    openUrl(course, round) {
      return course.lms_url + (round?.number ? `#section-${round.number}` : '');
    },

    // core_course_get_contents は 1 授業の同期の間だけキャッシュ
    async _contents(ctx, course) {
      ctx._contents ??= new Map();
      const key = String(course.lms_id ?? course.lmsId);
      if (!ctx._contents.has(key)) ctx._contents.set(key, call(ctx, 'core_course_get_contents', {courseid: key}));
      return ctx._contents.get(key);
    }
  };
}
