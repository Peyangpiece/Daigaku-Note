// スケジューラ（DESIGN-M0 §6）。1 分ごとの tick で、毎日の同期・授業開始の同期・定期の確認・日付の変化を見る。
import {dueClassSyncs, dueDailySync, jstNow} from '../shared/schedule.js';
import {currentTerm} from '../shared/term.js';
import {classWeekday, termCalendar} from '../shared/calendar.js';

export class Scheduler {
  constructor(ctx, {intervalMs = 60e3, now = () => new Date()} = {}) {
    this.ctx = ctx;
    this.intervalMs = intervalMs;
    this.now = now;
    this.timer = null;
    this.lastTick = 0;
  }
  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
  tick() {
    const {repo, jobs} = this.ctx;
    const now = this.now();
    const {date} = jstNow(now);
    const slept = this.lastTick && now.getTime() - this.lastTick > this.intervalMs * 3; // 寝ていた
    this.lastTick = now.getTime();
    if (slept) this.ctx.log?.info('スリープから復帰。予定を確かめ直します');

    // 日付が変わった
    const lastDay = repo.getSetting('scheduler.lastDay');
    if (lastDay !== date) {
      repo.setSetting('scheduler.lastDay', date);
      repo.setSetting('scheduler.classSynced', {});
      jobs.enqueue('backup', {}); // 1 日 1 回のバックアップと古い記録の刈り込み（jobs.js・backup.js）
      // レシピの更新（SPEC §6.15）はまだない。仕組みができるまでジョブは積まない（積んでも処理がなく、失敗の記録だけが残るため）
    }

    // 今日の復習の知らせ（9:00 を過ぎたら 1 日 1 回。SPEC §12.1）。復習がなければ出さない
    const {hm} = jstNow(now);
    if (hm >= '09:00' && repo.getSetting('notify.reviewDay') !== date) {
      repo.setSetting('notify.reviewDay', date);
      const due = this.ctx.quiz?.review?.().questions?.length ?? 0;
      if (due > 0) this.ctx.notifier?.show({title: '今日の復習', body: `今日の復習 ${due} 問`, route: '/review'});
    }

    // LMS をつないでいなければ同期しない（自分のフォルダだけで使っているとき、空の同期の知らせを出さない）
    if (!repo.listConnections().some((c) => c.kind !== 'manual' && c.status !== 'disabled')) return;

    // 毎日の同期
    const time = repo.getSetting('sync.time', '16:30');
    if (dueDailySync({time, lastDay: repo.getSetting('sync.lastFullDay')}, now)) {
      repo.setSetting('sync.lastFullDay', date);
      jobs.enqueue('sync', {kind: 'full'});
    }

    // 授業開始の同期
    if (repo.getSetting('sync.classStart', true)) {
      const term = currentTerm(repo.listTerms(), date);
      const periods = term?.periods_json ? JSON.parse(term.periods_json) : null;
      if (term && periods) {
        const classSynced = repo.getSetting('scheduler.classSynced', {});
        const courses = repo.listCourses({termId: term.id});
        // 授業日の判定は学年暦で：休講日・祝日は同期しない。振替授業日はその曜日の授業を同期する
        const cal = termCalendar(term);
        const isClassDay = (c, d) => classWeekday(cal, d) === c.weekday;
        for (const {course} of dueClassSyncs({courses, periods, classSynced, isClassDay}, now)) {
          classSynced[course.id] = date;
          jobs.enqueue('sync', {courseId: course.id, kind: 'class-start'});
        }
        repo.setSetting('scheduler.classSynced', classSynced);
      }
    }

    // 定期の確認
    const everyHours = Number(repo.getSetting('sync.everyHours', 0));
    if (everyHours > 0) {
      const last = repo.getSetting('sync.lastPeriodicAt', 0);
      if (now.getTime() - last >= everyHours * 3600e3) {
        repo.setSetting('sync.lastPeriodicAt', now.getTime());
        jobs.enqueue('sync', {kind: 'full'});
      }
    }
  }
}
