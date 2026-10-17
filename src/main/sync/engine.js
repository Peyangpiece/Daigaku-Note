// 同期エンジン（DESIGN-M0 §8.1）。コネクタの種類を問わず同じ手順で動く。
import {courseFolderName, roundFolderName} from '../../shared/naming.js';
import {preferLayout} from '../../shared/layout.js';
import {parseRound, resolveRound, roundTitle} from '../../shared/rounds.js';
import {roundDates} from '../../shared/term.js';
import {addDays} from '../../shared/holidays.js';

export class SyncError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}

/** 失敗の分類（DESIGN-M0 §11） */
export function classify(e) {
  if (e?.code && typeof e.code === 'string' && /^[a-z-]+$/.test(e.code)) return e.code;
  const m = String(e?.message ?? '').toLowerCase();
  if (/timeout|timed out/.test(m)) return 'timeout';
  if (/enotfound|econnrefused|econnreset|fetch failed|network/.test(m)) return 'network';
  if (/login|invalidtoken|unauthori/.test(m)) return 'login-required';
  if (/enospc|eacces|eperm|erofs/.test(m)) return 'write';
  return 'unknown';
}

/** n 件ずつ並行して f を実行する */
export async function parallel(items, n, f) {
  const queue = [...items];
  const workers = Array.from({length: Math.max(1, n)}, async () => {
    while (queue.length) await f(queue.shift());
  });
  await Promise.all(workers);
}

/** 1 授業の処理に時間切れを付ける */
const withTimeout = (p, ms, msg) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new SyncError('timeout', msg)), ms);
    p.then(resolve, reject).finally(() => clearTimeout(t));
  });

export class SyncEngine {
  /**
   * @param {object} deps
   * @param {import('../db/repo.js').Repo} deps.repo
   * @param {import('./files.js').FileManager} deps.files
   * @param {(msg: string) => void} [deps.log]
   * @param {(p: object) => void} [deps.onProgress]
   * @param {() => string} [deps.today]   'YYYY-MM-DD'（テストで差し替える）
   * @param {number} [deps.courseTimeoutMs]
   */
  constructor({repo, files, log = () => {}, onProgress = () => {}, today, courseTimeoutMs = 120000}) {
    this.repo = repo;
    this.files = files;
    this.log = log;
    this.onProgress = onProgress;
    this.today = today ?? (() => new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Tokyo'}));
    this.courseTimeoutMs = courseTimeoutMs;
  }

  /**
   * 同期を 1 回行う。
   * @param {object} p
   * @param {object} p.connection  connection 行
   * @param {object} p.connector   Connector（DESIGN-M0 §8.3〜8.4）
   * @param {object} p.term        term 行
   * @param {string[]} [p.courseIds]  対象の授業（なければ sync_enabled の全部）
   * @param {'full'|'course'|'class-start'|'initial'|'manual'} [p.kind]
   * @param {boolean} [p.full]     全回を確かめる（初回・保存先の変更）
   */
  async run({connection, connector, term, courseIds = null, kind = 'full', full = false}) {
    const run = this.repo.startSyncRun({connection_id: connection.id, kind, course_id: courseIds?.length === 1 ? courseIds[0] : null});
    const summary = {courses: 0, materials: 0, failures: 0, events: [], timing: {}};
    const started = Date.now();
    const event = (level, course, code, message) => {
      summary.events.push({level, course: course?.name ?? null, code, message});
      this.repo.addSyncEvent(run.id, {level, course_id: course?.id ?? null, code, message});
      if (level === 'error') summary.failures++;
      this.log(`[sync] ${level} ${course?.name ?? ''} ${code ?? ''} ${message}`);
    };
    const ctx = await connector.createContext(connection);
    try {
      // セッション
      let session = await connector.ensureSession(ctx);
      if (session === 'login-required') {
        const ok = await connector.login(ctx, 'headless').then(() => true, () => false);
        if (!ok) {
          this.repo.updateConnection(connection.id, {status: 'login-required'});
          event('error', null, 'login-required', `${connection.label} へのログインが必要です`);
          this.repo.finishSyncRun(run.id, {...summary, timing: {total: Date.now() - started}});
          return {...summary, status: 'login-required'};
        }
        session = 'ok';
      }
      this.repo.updateConnection(connection.id, {status: 'ok'});

      // 授業一覧
      const t0 = Date.now();
      let courses;
      try {
        courses = await connector.listCourses(ctx);
      } catch (e) {
        event('error', null, classify(e), `授業一覧を読めませんでした: ${e.message}`);
        this.repo.finishSyncRun(run.id, {...summary, timing: {total: Date.now() - started}});
        return {...summary, status: 'failed'};
      }
      const rows = await this.reconcileCourses(connection, term, courses, {markMissing: !courseIds});
      summary.timing.courses = Date.now() - t0;
      summary.courses = rows.length;

      // 対象の授業
      let targets = rows.filter((c) => c.sync_enabled !== 0 && !c.hidden);
      if (courseIds) targets = targets.filter((c) => courseIds.includes(c.id));
      const fullCrawl = full || !connection.last_sync_at;

      let done = 0;
      await parallel(targets, connector.parallelism ?? 3, async (course) => {
        this.onProgress({phase: 'course', current: ++done, total: targets.length, courseName: course.name});
        try {
          const saved = await withTimeout(
            this.syncCourse({ctx, connector, connection, term, course, fullCrawl, event}),
            this.courseTimeoutMs,
            `${course.name} の読み取りが時間切れになりました`
          );
          summary.materials += saved;
        } catch (e) {
          event('error', course, classify(e), e.message);
        }
      });

      await connector.saveSession?.(ctx).catch(() => {});
      this.repo.updateConnection(connection.id, {last_sync_at: new Date().toISOString()});
      summary.timing.total = Date.now() - started;
      this.repo.finishSyncRun(run.id, summary);
      return {...summary, status: 'ok'};
    } finally {
      await connector.releaseContext?.(ctx).catch(() => {});
    }
  }

  /** 授業一覧の突き合わせ（追加・改名・消えた授業）。改名のときは授業フォルダも改名し、記録のパスを書き換える */
  async reconcileCourses(connection, term, courses, {markMissing}) {
    const seen = new Set();
    const result = [];
    for (const c of courses) {
      const lmsId = String(c.lmsId ?? c.url ?? c.name);
      seen.add(lmsId);
      let row = this.repo.findCourseByLms(connection.id, lmsId);
      if (!row) {
        const folder = this.uniqueCourseFolder(term.id, c.name);
        row = this.repo.createCourse({
          term_id: term.id,
          connection_id: connection.id,
          lms_id: lmsId,
          lms_url: c.url ?? null,
          name: c.name,
          folder_name: folder,
          weekday: c.weekday ?? null,
          period: c.period ?? null,
          weekday_from: c.weekday ? 'lms' : null
        });
      } else {
        const patch = {};
        if (c.name && c.name !== row.name) {
          const folder = this.uniqueCourseFolder(term.id, c.name, row.folder_name);
          patch.name = c.name;
          if (folder !== row.folder_name) {
            const from = this.files.courseDir(term, row),
              to = this.files.courseDir(term, {...row, folder_name: folder});
            await this.files.renameDir(from, to);
            this.repo.db.prepare('UPDATE material SET path = ? || substr(path, ?) WHERE course_id = ? AND substr(path, 1, ?) = ?').run(to, from.length + 1, row.id, from.length, from);
            patch.folder_name = folder;
          }
        }
        if (c.url && c.url !== row.lms_url) patch.lms_url = c.url;
        if (c.weekday && row.weekday_from !== 'user' && (c.weekday !== row.weekday || (c.period ?? null) !== row.period)) {
          patch.weekday = c.weekday;
          patch.period = c.period ?? null;
          patch.weekday_from = 'lms';
        }
        if (row.sync_enabled === 0 && row.lms_missing) patch.sync_enabled = 1;
        if (Object.keys(patch).length) row = this.repo.updateCourse(row.id, patch);
      }
      result.push(row);
    }
    if (markMissing) {
      for (const row of this.repo.listCourses({connectionId: connection.id})) {
        if (!seen.has(row.lms_id) && row.sync_enabled !== 0) {
          this.repo.updateCourse(row.id, {sync_enabled: 0});
          this.log(`[sync] LMS から消えた授業: ${row.name}`);
        }
      }
    }
    return result;
  }

  uniqueCourseFolder(termId, name, keep = null) {
    const taken = this.repo.courseFolderNames(termId).filter((f) => f !== keep);
    const base = courseFolderName(name);
    if (!taken.includes(base)) return base;
    for (let i = 2; i < 100; i++) if (!taken.includes(`${base} (${i})`)) return `${base} (${i})`;
    throw new Error('授業フォルダ名を決められません');
  }

  /** 回の突き合わせ。LMS の回ごとに round 行をそろえ、フォルダ名を決める。戻りは {number -> round 行} */
  async reconcileRounds(term, course, lmsRounds) {
    const existing = this.repo.listRounds(course.id);
    const byNumber = new Map(existing.map((r) => [r.number, r]));
    const taken = new Set(existing.map((r) => r.folder_name));
    const dates = course.weekday
      ? roundDates({start: term.start_date, end: term.end_date, weekday: course.weekday, rounds: term.rounds, holidays: JSON.parse(term.holidays_json ?? '[]')})
      : [];
    const ensure = async (number, title, lmsRef, date) => {
      const cleanTitle = title ? roundTitle(title) : ''; // 「第3回 原価企画」→「原価企画」、「Week 2」→「」
      let row = byNumber.get(number);
      if (!row) {
        const folder = roundFolderName(number, cleanTitle, [...taken]);
        taken.add(folder);
        row = this.repo.createRound({course_id: course.id, number, title: cleanTitle || null, folder_name: folder, date: date ?? dates[number - 1] ?? null, lms_ref: lmsRef ?? null});
        byNumber.set(number, row);
        return row;
      }
      const patch = {};
      if (cleanTitle && cleanTitle !== row.title) {
        patch.title = cleanTitle;
        const folder = roundFolderName(number, cleanTitle, [...taken].filter((f) => f !== row.folder_name));
        if (folder !== row.folder_name) {
          await this.files.renameDir(this.files.roundDir(term, course, row), this.files.roundDir(term, course, {folder_name: folder}));
          taken.delete(row.folder_name);
          taken.add(folder);
          patch.folder_name = folder;
          const from = this.files.roundDir(term, course, row),
            to = this.files.roundDir(term, course, {folder_name: folder});
          this.repo.db.prepare('UPDATE material SET path = ? || substr(path, ?) WHERE round_id = ? AND substr(path, 1, ?) = ?').run(to, from.length + 1, row.id, from.length, from);
        }
      }
      if (lmsRef && lmsRef !== row.lms_ref) patch.lms_ref = lmsRef;
      if (!row.date && (date ?? dates[number - 1])) patch.date = date ?? dates[number - 1];
      if (Object.keys(patch).length) {
        row = this.repo.updateRound(row.id, patch);
        byNumber.set(number, row);
      }
      return row;
    };
    const mapped = [];
    for (const r of lmsRounds) {
      const number = Number.isInteger(r.number) && r.number >= 1 ? r.number : parseRound(r.title);
      const row = await ensure(number, r.title, r.lmsRef, r.date);
      mapped.push({lms: r, row});
    }
    if (!byNumber.has(0)) await ensure(0, '', null, null);
    return {mapped, byNumber, ensure};
  }

  /** 1 授業分：回 → 対象の回のファイル → お知らせの添付 → 取り込み。戻りは保存した件数 */
  async syncCourse({ctx, connector, connection, term, course, fullCrawl, event}) {
    const lmsRounds = await connector.listRounds(ctx, course);
    const {mapped, byNumber, ensure} = await this.reconcileRounds(term, course, lmsRounds);
    await this.files.reconcileFiles({term, course, rounds: [...byNumber.values()]});

    // 対象の回：初回（接続の初回、またはその授業にまだ資料が 1 つもないとき）は全部、ふだんは今日の前後 7 日の回と日付の分からない回
    const today = this.today();
    const from = addDays(today, -7),
      to = addDays(today, 7);
    const crawlAll = fullCrawl || this.repo.listMaterials(course.id).length === 0;
    const wanted = crawlAll ? mapped : mapped.filter(({row}) => !row.date || (row.date >= from && row.date <= to));
    if (crawlAll && !fullCrawl) event('info', course, null, 'まだ資料がないので、全部の回を確かめます');

    const refs = [];
    for (const {lms, row} of wanted) {
      const files = await connector.listFiles(ctx, course, {...lms, row});
      for (const f of files) refs.push({...f, round: row, roundFrom: 'lms'});
    }
    for (const f of (await connector.listNoticeFiles?.(ctx, course)) ?? []) {
      const {round, from} = resolveRound({connector: f.round, notice: f.noticeTitle, filename: f.name});
      const row = byNumber.get(round) ?? (await ensure(round, '', null, null));
      refs.push({...f, round: row, roundFrom: from === 'none' ? 'notice' : from});
    }

    let saved = 0;
    for (const ref of preferLayout(refs, (r) => r.name ?? '')) {
      const r = await this.files.ingest({
        term,
        course,
        round: ref.round,
        roundFrom: ref.roundFrom,
        fileRef: ref,
        source: ref.noticeTitle ? 'notice' : 'lms',
        fetchFile: (x) => connector.fetchFile(ctx, x)
      });
      if (r.result === 'saved' || r.result === 'updated') saved++;
      else if (r.result === 'failed') event('warn', course, r.reason, `${ref.name ?? ref.url} をダウンロードできませんでした${r.status ? `（${r.status}）` : ''}`);
    }
    await this.files.trashDuplicates(course);
    return saved;
  }
}
