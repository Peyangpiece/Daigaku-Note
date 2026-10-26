// 同期エンジン（DESIGN-M0 §8.1）。コネクタの種類を問わず同じ手順で動く。
import {todayJst} from '../../shared/schedule.js';
import {courseFolderName, roundFolderName} from '../../shared/naming.js';
import {preferLayout} from '../../shared/layout.js';
import {parseRound, resolveRound, roundTitle} from '../../shared/rounds.js';
import {termRoundDates} from '../../shared/term.js';
import {addDays} from '../../shared/holidays.js';

/** 全部の回を確かめるとき、ダウンロードに失敗した資料があれば次の同期でも全部を確かめ直す回数の上限 */
export const MAX_CRAWL_RETRIES = 3;

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

/**
 * 1 授業の処理に時間切れを付ける。ms の間なにも進まなかったら切る（進むたびに touch() で延びる）。
 * 全部の回を確かめる初回は授業 1 つに数分かかるので、合計ではなく「止まっている時間」で判断する
 */
const withIdleTimeout = (start, ms, msg) =>
  new Promise((resolve, reject) => {
    let last = Date.now();
    const touch = () => (last = Date.now());
    const t = setInterval(() => {
      if (Date.now() - last > ms) {
        clearInterval(t);
        reject(new SyncError('timeout', msg));
      }
    }, 1000);
    start(touch)
      .then(resolve, reject)
      .finally(() => clearInterval(t));
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
    this.today = today ?? (() => todayJst());
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
    const run = this.repo.startSyncRun({
      connection_id: connection.id,
      kind,
      course_id: courseIds?.length === 1 ? courseIds[0] : null
    });
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
      const {error: failure} = await this.loginIfNeeded({connection, connector, ctx});
      if (failure) {
        // 自動ログインを試したときだけ理由を添える（試していなければ「ログインが必要」だけで足りる）
        const code = failure.code?.startsWith('login') ? failure.code : 'login-required';
        event(
          'error',
          null,
          code,
          `${connection.label} へのログインが必要です${connection.save_password ? `（${failure.message}）` : ''}`
        );
        this.repo.finishSyncRun(run.id, {...summary, timing: {total: Date.now() - started}});
        return {...summary, status: 'login-required'};
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
          const saved = await withIdleTimeout(
            (touch) => this.syncCourse({ctx, connector, connection, term, course, fullCrawl, event, touch}),
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

  /**
   * セッションを確かめ、切れていれば保存した ID・パスワードでログインする（SPEC §6.4）。
   * 戻りは {loggedIn}（ログインし直したか）か、だめなら {error}。パスワードが通らなければ自動ログインを止める（何度も送ってロックさせない）
   */
  async loginIfNeeded({connection, connector, ctx}) {
    if ((await connector.ensureSession(ctx)) !== 'login-required') return {loggedIn: false};
    const error = await connector.login(ctx, 'headless').then(
      () => null,
      (e) => e
    );
    if (!error) return {loggedIn: true};
    const badCredentials = error.code === 'login-bad-credentials';
    this.repo.updateConnection(connection.id, {
      status: 'login-required',
      ...(badCredentials ? {save_password: 0} : {})
    });
    return {error};
  }

  /** 起動したとき・更新のあと：同期を待たずにログインまで済ませる。戻りは {status: 'ok'|'login-required', loggedIn, error} */
  async restoreSession({connection, connector}) {
    const ctx = await connector.createContext(connection);
    try {
      const {loggedIn, error} = await this.loginIfNeeded({connection, connector, ctx});
      if (error) {
        this.log(`[login] ${connection.label}: ${error.code ?? ''} ${error.message}`);
        return {status: 'login-required', loggedIn: false, error};
      }
      if (loggedIn) {
        await connector.saveSession?.(ctx).catch(() => {});
        this.log(`[login] ${connection.label}: 自動でログインしました`);
      }
      this.repo.updateConnection(connection.id, {status: 'ok'});
      return {status: 'ok', loggedIn};
    } finally {
      await connector.releaseContext?.(ctx).catch(() => {});
    }
  }

  /** 授業一覧の突き合わせ（追加・改名・消えた授業）。改名のときは授業フォルダも改名し、記録のパスを書き換える */
  async reconcileCourses(connection, term, courses, {markMissing}) {
    const seen = new Set();
    // セットアップの「授業の確認」で外した授業は、非表示で作る（同期しない。設定 → 授業 で戻せる）
    const excluded = new Set(this.repo.getSetting(`courses.exclude.${connection.id}`, []));
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
          weekday_from: c.weekday ? 'lms' : null,
          hidden: excluded.has(lmsId) ? 1 : 0
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
            this.repo.db
              .prepare('UPDATE material SET path = ? || substr(path, ?) WHERE course_id = ? AND substr(path, 1, ?) = ?')
              .run(to, from.length + 1, row.id, from.length, from);
            patch.folder_name = folder;
          }
        }
        if (c.url && c.url !== row.lms_url) patch.lms_url = c.url;
        if (
          c.weekday &&
          row.weekday_from !== 'user' &&
          (c.weekday !== row.weekday || (c.period ?? null) !== row.period)
        ) {
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

  /**
   * 同じ LMS への接続が 2 つ以上あるとき（セットアップをやり直すと増えていた）、1 つにまとめる。同じ授業が 2 つずつ並ぶのを直す。
   * 残す接続：いちばん新しく作ったもの（自動ログインなど、本人が最後に設定したもの）。
   * 同じ授業（LMS の ID が同じ）が両方にあれば、資料の多いほう（同じならフォルダ名が元のままの古いほう）を残し、
   * もう一方の記録を消してフォルダを OS のゴミ箱へ（戻せる）。消すほうにしかない資料があれば、残すほうを次の同期で全部の回から見直す。
   * 戻りは {merged: まとめた接続の数, removedCourses: 消した授業の数}
   */
  async mergeDuplicateConnections() {
    const groups = new Map();
    for (const c of this.repo.listConnections()) {
      const key = `${c.kind}|${c.connector_id}|${(c.university_host ?? '').toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    let merged = 0;
    let removedCourses = 0;
    for (const conns of groups.values()) {
      if (conns.length < 2) continue;
      const keep = conns.at(-1); // listConnections は作った順
      const hosts = new Set();
      for (const c of conns) for (const h of JSON.parse(c.allowed_hosts_json ?? '[]')) hosts.add(h);
      for (const other of conns.slice(0, -1)) {
        for (const course of this.repo.listCourses({connectionId: other.id})) {
          const twin = this.repo.findCourseByLms(keep.id, course.lms_id);
          if (!twin) {
            this.repo.updateCourse(course.id, {connection_id: keep.id});
            continue;
          }
          const okCount = (c) => this.repo.listMaterials(c.id).filter((m) => m.status === 'ok').length;
          const [survivor, loser] =
            okCount(course) > okCount(twin) ||
            (okCount(course) === okCount(twin) && course.created_at <= twin.created_at)
              ? [course, twin]
              : [twin, course];
          await this.removeDuplicateCourse(loser, survivor);
          removedCourses++;
          if (survivor.connection_id !== keep.id) this.repo.updateCourse(survivor.id, {connection_id: keep.id});
          await this.restoreCourseFolderName(survivor.id);
        }
        this.repo.remove('connection', other.id);
        this.log(`[merge] 同じ LMS の接続をまとめました: ${other.label}（${other.id}）→ ${keep.id}`);
        merged++;
      }
      if (hosts.size) this.repo.updateConnection(keep.id, {allowed_hosts_json: JSON.stringify([...hosts])});
    }
    return {merged, removedCourses};
  }

  /** 重なった授業の片方を消す。記録を消し、フォルダを OS のゴミ箱へ。残すほうにない資料があれば、残すほうを全部の回から見直す印に */
  async removeDuplicateCourse(loser, survivor) {
    const have = new Set(this.repo.listMaterials(survivor.id).map((m) => m.sha256));
    const missing = this.repo.listMaterials(loser.id).filter((m) => m.status === 'ok' && !have.has(m.sha256));
    const term = this.repo.get('term', loser.term_id);
    const dir = term ? this.files.courseDir(term, loser) : null;
    const db = this.repo.db;
    this.repo.transaction(() => {
      // 回に結び付くクイズ（問題・答えの記録・復習の段階・API の使用量）も消す。外部キー（foreign_keys=ON）で round を消せなくなるため
      const rounds = 'SELECT id FROM round WHERE course_id = ?';
      const quizzes = `SELECT id FROM quiz WHERE round_id IN (${rounds})`;
      const questions = `SELECT id FROM question WHERE quiz_id IN (${quizzes})`;
      db.prepare(`DELETE FROM srs WHERE question_id IN (${questions})`).run(loser.id);
      db.prepare(`DELETE FROM attempt WHERE question_id IN (${questions})`).run(loser.id);
      db.prepare(`DELETE FROM question WHERE quiz_id IN (${quizzes})`).run(loser.id);
      db.prepare(`DELETE FROM ai_usage WHERE quiz_id IN (${quizzes})`).run(loser.id);
      db.prepare(`DELETE FROM quiz WHERE round_id IN (${rounds})`).run(loser.id);
      db.prepare(`DELETE FROM round_note WHERE round_id IN (${rounds})`).run(loser.id);
      db.prepare('DELETE FROM material WHERE course_id = ?').run(loser.id);
      db.prepare('DELETE FROM round WHERE course_id = ?').run(loser.id);
      db.prepare('DELETE FROM course WHERE id = ?').run(loser.id);
      if (missing.length) db.prepare('UPDATE course SET full_synced_at = NULL WHERE id = ?').run(survivor.id);
    });
    if (dir && dir !== (term && this.files.courseDir(term, survivor)))
      await this.files
        .trash(dir)
        .catch((e) => this.log(`[merge] フォルダをゴミ箱へ移せませんでした: ${dir}（${e.message}）`));
    this.log(
      `[merge] 重なった授業を 1 つにしました: ${loser.name}（${loser.folder_name} をゴミ箱へ${missing.length ? `。残すほうにない資料 ${missing.length} 件は次の同期で取り直します` : ''}）`
    );
  }

  /** 「名前 (2)」になっていた授業フォルダを、空いていれば元の名前に戻す（記録のパスも書き換える） */
  async restoreCourseFolderName(courseId) {
    const row = this.repo.get('course', courseId);
    const term = this.repo.get('term', row.term_id);
    const base = courseFolderName(row.name);
    if (!term || row.folder_name === base || this.repo.courseFolderNames(term.id).includes(base)) return;
    const from = this.files.courseDir(term, row),
      to = this.files.courseDir(term, {...row, folder_name: base});
    await this.files.renameDir(from, to);
    this.repo.db
      .prepare('UPDATE material SET path = ? || substr(path, ?) WHERE course_id = ? AND substr(path, 1, ?) = ?')
      .run(to, from.length + 1, row.id, from.length, from);
    this.repo.updateCourse(row.id, {folder_name: base});
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
    const dates = course.weekday ? termRoundDates(term, course.weekday) : []; // 休講日・振替授業日（学年暦）を見る
    const ensure = async (number, title, lmsRef, date) => {
      const cleanTitle = title ? roundTitle(title) : ''; // 「第3回 原価企画」→「原価企画」、「Week 2」→「」
      let row = byNumber.get(number);
      if (!row) {
        const folder = roundFolderName(number, cleanTitle, [...taken]);
        taken.add(folder);
        row = this.repo.createRound({
          course_id: course.id,
          number,
          title: cleanTitle || null,
          folder_name: folder,
          date: date ?? dates[number - 1] ?? null,
          lms_ref: lmsRef ?? null
        });
        byNumber.set(number, row);
        return row;
      }
      const patch = {};
      if (cleanTitle && cleanTitle !== row.title) {
        patch.title = cleanTitle;
        const folder = roundFolderName(
          number,
          cleanTitle,
          [...taken].filter((f) => f !== row.folder_name)
        );
        if (folder !== row.folder_name) {
          await this.files.renameDir(
            this.files.roundDir(term, course, row),
            this.files.roundDir(term, course, {folder_name: folder})
          );
          taken.delete(row.folder_name);
          taken.add(folder);
          patch.folder_name = folder;
          const from = this.files.roundDir(term, course, row),
            to = this.files.roundDir(term, course, {folder_name: folder});
          this.repo.db
            .prepare('UPDATE material SET path = ? || substr(path, ?) WHERE round_id = ? AND substr(path, 1, ?) = ?')
            .run(to, from.length + 1, row.id, from.length, from);
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
  async syncCourse({ctx, connector, term, course, fullCrawl, event, touch = () => {}}) {
    const lmsRounds = await connector.listRounds(ctx, course);
    touch();
    const {mapped, byNumber, ensure} = await this.reconcileRounds(term, course, lmsRounds);
    await this.files.reconcileFiles({term, course, rounds: [...byNumber.values()]});

    // 対象の回：その授業で全部の回を確かめ終えるまで（full_synced_at が付くまで）は全部、ふだんは今日の前後 7 日の回と日付の分からない回。
    // 「資料があるか」で判断すると、途中で止まった同期で数件だけ入った授業の過去の回が二度と読まれない
    const today = this.today();
    const from = addDays(today, -7),
      to = addDays(today, 7);
    const crawlAll = fullCrawl || !course.full_synced_at;
    const wanted = crawlAll ? mapped : mapped.filter(({row}) => !row.date || (row.date >= from && row.date <= to));
    if (crawlAll && !fullCrawl) event('info', course, null, 'まだ全部の回を確かめていないので、全部の回を確かめます');

    const refs = [];
    for (const {lms, row} of wanted) {
      const files = await connector.listFiles(ctx, course, {...lms, row});
      touch();
      for (const f of files) refs.push({...f, round: row, roundFrom: 'lms'});
    }
    for (const f of (await connector.listNoticeFiles?.(ctx, course)) ?? []) {
      const {round, from} = resolveRound({connector: f.round, notice: f.noticeTitle, filename: f.name});
      const row = byNumber.get(round) ?? (await ensure(round, '', null, null));
      refs.push({...f, round: row, roundFrom: from === 'none' ? 'notice' : from});
    }

    let saved = 0;
    let failed = 0;
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
      touch();
      if (r.result === 'saved' || r.result === 'updated') saved++;
      else if (r.result === 'failed') {
        failed++;
        event(
          'warn',
          course,
          r.reason,
          `${ref.name ?? ref.url} をダウンロードできませんでした${r.status ? `（${r.status}）` : ''}`
        );
      }
    }
    await this.files.trashDuplicates(course);
    // ここまで来れば全部の回の一覧は読めている（読めなければ上で例外になる）。
    // ダウンロードの失敗があれば「全部の回を確かめ終えた」にはしない（ふだんの同期は前後 7 日の回しか見ないので、古い回の失敗分が二度と拾われないため）。
    // ただし何度試しても取れない資料で毎回全部の回を読み直さないよう、3 回まで
    if (crawlAll) {
      const key = `sync.crawlRetries.${course.id}`;
      const tries = Number(this.repo.getSetting(key, 0)) + 1;
      if (failed && tries < MAX_CRAWL_RETRIES) {
        this.repo.setSetting(key, tries);
        event(
          'info',
          course,
          null,
          `ダウンロードできなかった資料があるので、次の同期でも全部の回を確かめます（${tries} 回目）`
        );
      } else {
        if (failed)
          event(
            'warn',
            course,
            'download',
            `${MAX_CRAWL_RETRIES} 回試しても取れない資料があるため、以後は前後 7 日の回だけ確かめます（全部を確かめ直すには「全部の回を確かめ直す」）`
          );
        this.repo.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
        this.repo.updateCourse(course.id, {full_synced_at: new Date().toISOString()});
      }
    }
    return saved;
  }
}
