// IPC の窓口：学期・授業・回（term.*・course.update・round.update）。index.js が register を呼ぶ（SPEC §12・DESIGN-M0 §4）
import {dialog} from 'electron';
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {renameCourse} from '../folders.js';
import {mergeAutoTerms, removeTerm, saveTerm, syncRoundDates} from '../terms.js';
import {parseCalendar} from '../../shared/calendar.js';
import {calendarText} from '../calendar-pdf.js';
import {str, id, bad} from './common.js';

export function register({handle, ctx, repo, files, getWindow}) {
  // 学期の保存（main/terms.js）。term.id があればその学期を直す（学期名・年度を変えても同じ学期のまま）
  handle('term.save', async ({term}) => {
    const input = {...(term ?? {}), id: typeof term?.id === 'string' && /^[\w-]{1,40}$/.test(term.id) ? term.id : null};
    const row = await saveTerm({repo, rootDir: ctx.rootDir()}, input);
    // LMS をつなぐ前に作った仮の学期が同じ時期にあれば、授業・フォルダとパソコンのフォルダをこの学期へまとめる
    await mergeAutoTerms({repo, rootDir: ctx.rootDir()}, row);
    // この学期の授業の回の日付を、学年暦・期間・回数にそろえる
    const redated = syncRoundDates(repo, row.id);
    return {ok: true, term: row, redated};
  });

  // 学年暦のファイル（PDF・Word・テキスト）から休講日・振替授業日・授業回を読み取る（shared/calendar.js の決まり。AI には送らない）。
  // 保存はしない：画面で確かめてから term.save で入れる
  handle('term.readCalendar', async ({year}) => {
    const win = getWindow();
    const opts = {
      title: '学年暦のファイルを選ぶ',
      properties: ['openFile'],
      filters: [{name: '学年暦（PDF・Word・テキスト）', extensions: ['pdf', 'docx', 'txt', 'md']}]
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths?.[0]) return {ok: false};
    const file = r.filePaths[0];
    const stat = await fsp.stat(file);
    if (stat.size > 50 * 1024 * 1024) bad('ファイルが大きすぎます（50MB まで）');
    let text;
    try {
      text = await calendarText(file); // PDF は灰色のます目（休講）に印を付ける
    } catch (e) {
      bad(`ファイルから文字を取れませんでした：${String(e?.message ?? e).slice(0, 120)}`);
    }
    if (!text.trim())
      bad('文字のないファイルです（画像だけの PDF は読めません。文字の入った PDF か、テキストにしてください）');
    const y = Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
    return {ok: true, file: path.basename(file), ...parseCalendar(text, {year: y ?? undefined})};
  });

  handle('term.remove', ({termId}) => {
    removeTerm(repo, typeof termId === 'string' ? termId : '');
    return {ok: true};
  });

  handle('course.update', async ({courseId, patch}) => {
    const cid = id(courseId) ?? bad('この授業は見つかりませんでした');
    const allowed = {};
    if (Number.isInteger(patch.color) && patch.color >= 1 && patch.color <= 8) allowed.color = patch.color;
    if (['plain', 'stripe', 'dot'].includes(patch.tape_pattern)) allowed.tape_pattern = patch.tape_pattern;
    if (typeof patch.hidden === 'boolean') allowed.hidden = patch.hidden ? 1 : 0;
    if (typeof patch.sync_enabled === 'boolean') allowed.sync_enabled = patch.sync_enabled ? 1 : 0;
    if (Number.isInteger(patch.sort_order)) allowed.sort_order = patch.sort_order;
    if (patch.weekday !== undefined) {
      if (patch.weekday && !'月火水木金土日'.includes(patch.weekday)) bad('曜日が不正です');
      allowed.weekday = patch.weekday || null;
      allowed.period = Number.isInteger(patch.period) && patch.period >= 1 && patch.period <= 7 ? patch.period : null;
      allowed.weekday_from = 'user';
    }
    if (patch.font && typeof patch.font === 'object') allowed.font_json = JSON.stringify(patch.font);
    if (patch.quiz && typeof patch.quiz === 'object') allowed.quiz_json = JSON.stringify(patch.quiz);
    // 名前を変えられるのは、LMS を使わない授業（手動でつくった授業）だけ。LMS の授業名は同期で LMS に合わせる
    if (patch.name !== undefined) {
      const conn = repo.get('connection', repo.get('course', cid)?.connection_id);
      if (conn?.kind !== 'manual') bad('LMS の授業の名前は変えられません');
      const name = (str(patch.name, 200) ?? '').trim().slice(0, 80) || bad('名前を入れてください');
      await renameCourse({repo, courseDir: (t, c) => files.courseDir(t, c)}, cid, name); // パソコンの授業フォルダの名前も変える
    }
    const course = repo.updateCourse(cid, allowed);
    if (allowed.weekday) syncRoundDates(repo, course.term_id); // 曜日を変えたら回の日付もその曜日の授業回に
    return {course};
  });

  // 回の名前（付箋の題）：自分で変える。空なら LMS の題に戻す
  handle('round.update', ({roundId, title}) => {
    const rid = id(roundId) ?? bad('回が不正です');
    if (!repo.get('round', rid)) bad('回がありません');
    return {round: repo.updateRound(rid, {title_user: (str(title, 200) ?? '').trim().slice(0, 80) || null})};
  });
}
