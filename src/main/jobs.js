// ジョブの待ち行列（SPEC §13.6、DESIGN-M0 §4）。1 件ずつ順に実行する。同じ種類・同じ対象は 1 つにまとめる。
import {currentTerm} from '../shared/term.js';

const RETRY_DELAYS = [15 * 60e3]; // 失敗した同期は 15 分後に 1 回だけやり直す

export class JobRunner {
  constructor(ctx, {notify = () => {}} = {}) {
    this.ctx = ctx;
    this.notify = notify;
    this.running = false;
    this.timer = null;
  }
  start() {
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
    setTimeout(() => this.tick(), 0);
    return job;
  }
  async tick() {
    if (this.running) return;
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
      this.ctx.log.error(`ジョブ失敗 ${job.kind}: ${e.stack || e.message}`);
      this.ctx.repo.finishJob(job.id, 'failed', {message: e.message});
      this.notify('state.changed', {kind: job.kind, error: e.message});
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
        const totals = {courses: 0, materials: 0, failures: 0, status: 'ok'};
        for (const connection of connections) {
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
            this.notify('login.required', {connectionId: connection.id, label: connection.label});
          }
          if (r.status === 'failed' && r.events.some((e) => e.code === 'network')) totals.retry = true;
        }
        return totals;
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
