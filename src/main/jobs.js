// ジョブの待ち行列（SPEC §13.6、DESIGN-M0 §4）。1 件ずつ順に実行する。同じ種類・同じ対象は 1 つにまとめる。
import {currentTerm} from '../shared/term.js';

const RETRY_DELAYS = [15 * 60e3]; // 失敗した同期は 15 分後に 1 回だけやり直す

/** 画面に出す文言（英語の例外をそのまま見せない。DESIGN-M0 §11） */
export function friendlyError(e) {
  const m = String(e?.message ?? e ?? '');
  if (/Executable doesn't exist|browserType\.launch/.test(m)) return 'LMS を読むためのブラウザの準備ができていません。設定の「ブラウザを準備し直す」を押すか、準備が終わるまで待ってください';
  if (e?.code === 'login-required' || /login-required/.test(m)) return 'LMS へのログインが必要です（設定 → LMS との連携 → ログインし直す）';
  if (e?.code === 'network' || /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET/.test(m)) return 'LMS に接続できませんでした。ネットワークを確かめてください';
  if (e?.code === 'selector-missing') return 'LMS の画面を読み取れませんでした（画面の構成が変わった可能性）';
  if (e?.code === 'blocked-navigation') return '想定外のページに移動したため中断しました';
  if (/ENOSPC|EACCES|EPERM/.test(m)) return '保存先に書き込めません';
  return `処理に失敗しました：${m.split('\n')[0].slice(0, 120)}`;
}

export class JobRunner {
  constructor(ctx, {notify = () => {}} = {}) {
    this.ctx = ctx;
    this.notify = notify;
    this.running = false;
    this.started = false;
    this.timer = null;
  }
  /** 準備（Chromium の取り込みなど）が終わってから呼ぶ。それまで積まれたジョブは待つ */
  start() {
    this.started = true;
    this.tick();
  }
  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }
  /** ジョブを積む。同じ kind と payload の pending があれば積まない。戻りは job */
  enqueue(kind, payload = {}) {
    const same = this.ctx.repo.pendingJobs().find((j) => j.kind === kind && j.payload_json === JSON.stringify(payload) && j.status !== 'running');
    if (same) return same;
    const job = this.ctx.repo.enqueueJob(kind, payload);
    if (this.started) setTimeout(() => this.tick(), 0);
    else this.notify('state.changed', {kind, waiting: true});
    return job;
  }
  async tick() {
    if (this.running || !this.started) return;
    const job = this.ctx.repo.claimJob();
    if (!job) {
      this.timer = setTimeout(() => this.tick(), 5000);
      return;
    }
    this.running = true;
    this.ctx.status = this.describe(job);
    this.ctx.refreshTray?.();
    try {
      const result = await this.run(job);
      this.ctx.repo.finishJob(job.id, result?.retry ? 'waiting' : 'done', result);
      if (result?.retry && job.tries <= RETRY_DELAYS.length) setTimeout(() => this.tick(), RETRY_DELAYS[job.tries - 1]);
      this.notify('state.changed', {kind: job.kind});
      if (job.kind === 'sync') this.notify('sync.finished', {jobId: job.id, ...result});
    } catch (e) {
      this.ctx.log.error(`ジョブ失敗 ${job.kind}: ${(e.stack || e.message || '').split('\n').slice(0, 3).join(' | ')}`);
      const message = friendlyError(e);
      this.ctx.repo.finishJob(job.id, 'failed', {message, raw: String(e.message).slice(0, 300)});
      this.notify('state.changed', {kind: job.kind, error: message});
      if (job.kind === 'sync') this.notify('sync.finished', {jobId: job.id, status: 'failed', message, courses: 0, materials: 0, failures: 1});
    } finally {
      this.running = false;
      this.ctx.status = '';
      this.ctx.refreshTray?.();
      setTimeout(() => this.tick(), 0);
    }
  }
  describe(job) {
    return {sync: '同期中…', login: 'ログイン中…', move: '資料を移動中…', settings: '設定を保存中…', recipes: 'レシピを確認中…'}[job.kind] ?? '処理中…';
  }
  async run(job) {
    const {repo, engine, registry, files} = this.ctx;
    switch (job.kind) {
      case 'sync': {
        const terms = repo.listTerms();
        const today = new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Tokyo'});
        const term = currentTerm(terms, today) ?? terms.at(-1);
        if (!term) return {status: 'no-term', message: '学期の設定がありません'};
        const connections = repo.listConnections().filter((c) => (job.payload.connectionId ? c.id === job.payload.connectionId : true) && c.status !== 'disabled' && c.kind !== 'manual');
        const totals = {courses: 0, materials: 0, failures: 0, status: 'ok', messages: []};
        for (const connection of connections) {
          if (connection.kind === 'recipe' && this.ctx.browser?.state !== 'ready') {
            totals.failures++;
            totals.status = 'browser-not-ready';
            totals.messages.push(`${connection.label}：${this.ctx.browser?.state === 'failed' ? 'ブラウザの準備に失敗しています。設定の「ブラウザを準備し直す」を押してください' : 'ブラウザを準備中です。終わってからもう一度同期してください'}`);
            continue;
          }
          const connector = registry.forConnection(connection);
          const r = await engine.run({
            connection,
            connector,
            term,
            courseIds: job.payload.courseId ? [job.payload.courseId] : null,
            kind: job.payload.kind ?? (job.payload.courseId ? 'course' : 'full'),
            full: job.payload.full === true
          });
          totals.courses += r.courses;
          totals.materials += r.materials;
          totals.failures += r.failures;
          if (r.status === 'login-required') {
            totals.status = 'login-required';
            totals.messages.push(r.events.find((e) => e.code?.startsWith('login'))?.message ?? `${connection.label} へのログインが必要です`);
            this.notify('login.required', {connectionId: connection.id, label: connection.label});
          }
          if (r.status === 'failed') {
            totals.status = totals.status === 'ok' ? 'failed' : totals.status;
            totals.messages.push(`${connection.label}：${r.events.find((e) => e.level === 'error')?.message ?? '同期に失敗しました'}`);
            if (r.events.some((e) => e.code === 'network')) totals.retry = true;
          }
        }
        totals.message = totals.messages.join(' / ');
        return totals;
      }
      case 'login': {
        // 起動したとき（更新のあとを含む）：同期を待たずに、各接続のセッションを確かめて切れていれば自動でログインする
        const connections = repo.listConnections().filter((c) => c.status !== 'disabled' && c.kind !== 'manual');
        const result = {loggedIn: 0, failures: 0, messages: []};
        for (const connection of connections) {
          if (connection.kind === 'recipe' && this.ctx.browser?.state !== 'ready') continue; // ブラウザがなければ次の同期に任せる
          const r = await engine
            .restoreSession({connection, connector: registry.forConnection(connection)})
            .catch((error) => ({status: 'failed', error}));
          if (r.loggedIn) result.loggedIn++;
          if (r.status === 'ok') continue;
          result.failures++;
          const message = this.ctx.secrets?.isLocked?.(`conn:${connection.id}:`)
            ? `${connection.label}：保存したログインを読めません。キーチェーンの確認が出たら「常に許可」を選び、大学ノートを開き直してください（出ないときは 設定 → LMS との連携 → ログインし直す）`
            : r.status === 'login-required'
              ? `${connection.label} へのログインが必要です${r.error?.message ? `（${r.error.message}）` : ''}`
              : `${connection.label}：${friendlyError(r.error)}`;
          result.messages.push(message);
          if (r.status === 'login-required') this.notify('login.required', {connectionId: connection.id, label: connection.label, message});
        }
        result.message = result.messages.join(' / ');
        return result;
      }
      case 'move': {
        const material = repo.get('material', job.payload.materialId);
        const round = repo.get('round', job.payload.roundId);
        const course = repo.get('course', material.course_id);
        const term = repo.get('term', course.term_id);
        return {material: await files.relocate({term, course, material, round})};
      }
      default:
        return {message: `未対応のジョブ: ${job.kind}`};
    }
  }
}
