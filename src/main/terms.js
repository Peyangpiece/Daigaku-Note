// 学期の保存（SPEC §6.14・§12.2）。設定 → 学期 とセットアップの手順 4 から呼ぶ。
// 学期の id は作ったときに決めたまま変えない（学期名・年度を変えても同じ学期のまま。授業はその学期に付いたまま）。
// 年度か学期名を変えたら、パソコンの学期フォルダ（<保存先>/<西暦>_<学期名>）の名前も変え、
// その中の資料の記録（material.path）と自分のフォルダの場所（course.dir）を新しい名前に合わせる
import path from 'node:path';
import {promises as fsp} from 'node:fs';
import {defaultTermDates, termFolder, termId, termRoundDates} from '../shared/term.js';
import {cleanCalendar} from '../shared/calendar.js';
import {PERIOD_PRESETS} from '../shared/schedule.js';

export const ROUNDS = [15, 14, 8, 7];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const err = (m) => new Error(m);

/** 学期名：前後の空白を取り、制御文字を除く。1〜20 文字 */
export function cleanLabel(v) {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim() : '';
  if (!s) throw err('学期名を入れてください');
  if (s.length > 20) throw err('学期名は 20 文字までにしてください');
  return s;
}

/** 新しい学期の id：年度と学期名からの鍵（2026-fall など）。もう使われていれば -2、-3… を付ける */
export function newTermId(year, label, taken) {
  const base = termId(year, label);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * 学期を保存する。input.id があればその学期を直す（なければ新しく足す）。戻りは term 行。
 * rootDir は資料の保存先（学期フォルダの親）
 */
export async function saveTerm({repo, rootDir}, input) {
  const label = cleanLabel(input?.label);
  const year = Number(input?.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw err('年度が不正です');
  const d = defaultTermDates(label, year);
  const start = DATE.test(input.start ?? '') ? input.start : d.start;
  const end = DATE.test(input.end ?? '') ? input.end : d.end;
  if (start >= end) throw err('終了日は開始日より後にしてください');
  const rounds =
    Number.isInteger(Number(input.rounds)) && Number(input.rounds) >= 1 && Number(input.rounds) <= 30
      ? Number(input.rounds)
      : 15;
  const periods =
    input.preset && PERIOD_PRESETS[input.preset]
      ? PERIOD_PRESETS[input.preset]
      : input.periods && typeof input.periods === 'object'
        ? input.periods
        : null;
  // 学年暦：休講日（日付の配列）と振替授業日（{date, weekday}）。形の悪いものは捨てる
  const {holidays, swaps} = cleanCalendar({holidays: input.holidays, swaps: input.swaps});

  const terms = repo.listTerms();
  const folder = termFolder(year, label);
  let current = input.id ? (terms.find((t) => t.id === input.id) ?? null) : null;
  if (input.id && !current) throw err('学期が見つかりません。画面を開き直してください');
  // 新しく足すとき、同じ年度・学期名の学期がもうあれば、その学期を直す（仮の学期や、セットアップのやり直し）
  if (!current) current = terms.find((t) => t.folder === folder) ?? null;
  // 直すとき、学期フォルダの名前がほかの学期とぶつからないように（同じ年度・同じ学期名の学期は 1 つ）
  const clash = terms.find((t) => t.id !== current?.id && t.folder === folder);
  if (clash) throw err(`${year} ${label} の学期はもうあります。その学期を選んで直してください`);

  const id = current?.id ?? newTermId(year, label, new Set(terms.map((t) => t.id)));
  if (current && current.folder !== folder) await moveTermFolder({repo, rootDir}, current.folder, folder);
  return repo.upsertTerm({
    id,
    label,
    year,
    folder,
    start_date: start,
    end_date: end,
    rounds,
    holidays_json: JSON.stringify(holidays),
    swaps_json: JSON.stringify(swaps),
    periods_json: periods ? JSON.stringify(periods) : null,
    source: 'user'
  });
}

/**
 * 学期を保存したあと、その学期の授業の回の日付を計算し直す（学年暦・期間・回数が変わったとき）。
 * LMS から日付が来た回（前の設定での計算と違う日付を持つ回）はそのまま。戻りは変えた回の数
 */
export function recomputeRoundDates(repo, before, after) {
  let changed = 0;
  for (const course of repo.listCourses({termId: after.id})) {
    if (!course.weekday) continue;
    const old = before ? termRoundDates(before, course.weekday) : [];
    const now = termRoundDates(after, course.weekday);
    for (const r of repo.listRounds(course.id)) {
      if (r.number < 1) continue;
      if (r.date && r.date !== old[r.number - 1]) continue;
      const next = now[r.number - 1] ?? null;
      if (r.date === next) continue;
      repo.updateRound(r.id, {date: next});
      changed++;
    }
  }
  return changed;
}

/**
 * 学期を消す。授業・フォルダが 1 つもない学期だけ（前の版で、学期名を変えたつもりが別の学期として増えてしまったものを片付けるため）。
 * 最後の 1 つは消さない
 */
export function removeTerm(repo, id) {
  const terms = repo.listTerms();
  if (!terms.some((t) => t.id === id)) throw err('学期が見つかりません');
  if (terms.length <= 1) throw err('最後の学期は消せません');
  const n = repo.db.prepare('SELECT COUNT(*) c FROM course WHERE term_id = ?').get(id).c;
  if (n) throw err(`この学期には授業・フォルダが ${n} 件あるので消せません`);
  repo.remove('term', id);
}

/**
 * 学期フォルダの名前を変える（保存先の中のまま）。フォルダがまだなければ記録だけ変える。
 * 資料の記録と自分のフォルダの場所の、古いフォルダの下を指す部分を新しい名前に置きかえる
 */
export async function moveTermFolder({repo, rootDir}, fromName, toName) {
  const root = path.resolve(rootDir);
  const from = path.join(root, fromName);
  const to = path.join(root, toName);
  if (from === to) return;
  await moveDir(from, to);
  const a = from + path.sep;
  const b = to + path.sep;
  repo.transaction(() => {
    repo.db
      .prepare('UPDATE material SET path = ? || substr(path, ?) WHERE substr(path, 1, ?) = ?')
      .run(b, a.length + 1, a.length, a);
    repo.db.prepare('UPDATE course SET dir = ? WHERE dir = ?').run(to, from);
    repo.db
      .prepare('UPDATE course SET dir = ? || substr(dir, ?) WHERE substr(dir, 1, ?) = ?')
      .run(b, a.length + 1, a.length, a);
  });
}

const exists = (p) => fsp.stat(p).catch(() => null);

/**
 * フォルダ from を to へ移す。to がなければ名前を変えるだけ。to がもうあれば中身を 1 つずつ移して合わせる
 * （同じ名前のフォルダはその中で合わせる。同じ名前のファイルがあれば止める）。空になった from は消す。
 * 大文字・小文字だけの違いは Mac・Windows では同じ名前なので、そのまま名前を変える
 */
export async function moveDir(from, to) {
  const src = await exists(from);
  if (!src) return;
  if (!src.isDirectory()) throw err('パソコンのフォルダが見つかりません');
  const dst = await exists(to);
  if (!dst || from.toLowerCase() === to.toLowerCase()) return fsp.rename(from, to);
  if (!dst.isDirectory()) throw err(`「${path.basename(to)}」という名前のファイルがあるので、フォルダを移せません`);
  for (const name of await fsp.readdir(from)) {
    const a = path.join(from, name),
      b = path.join(to, name);
    const there = await exists(b);
    if (!there) await fsp.rename(a, b);
    else if (there.isDirectory() && (await fsp.stat(a)).isDirectory()) await moveDir(a, b);
    else throw err(`「${path.basename(to)}」の中に同じ名前の「${name}」があるので、移せません`);
  }
  await fsp.rmdir(from).catch(() => {});
}

/**
 * 仮の学期（LMS をつなぐ前に自動で作った学期）を、時期の重なる学期 row へまとめる。
 * 授業・フォルダを row に付け替え、パソコンの仮の学期フォルダの中身も row の学期フォルダへ移す
 */
export async function mergeAutoTerms({repo, rootDir}, row) {
  for (const t of repo.listTerms()) {
    if (t.source !== 'auto' || t.id === row.id || !(t.start_date <= row.end_date && row.start_date <= t.end_date))
      continue;
    // 同じ名前の授業フォルダが両方の学期にあれば、まとめずに知らせる（上書きしない）
    const names = new Set(repo.listCourses({termId: row.id}).map((c) => c.folder_name));
    const same = repo.listCourses({termId: t.id}).find((c) => names.has(c.folder_name));
    if (same)
      throw err(
        `「${same.folder_name}」が ${t.label} と ${row.label} の両方にあるので、学期をまとめられません。どちらかの名前を変えてください`
      );
    if (t.folder !== row.folder) await moveTermFolder({repo, rootDir}, t.folder, row.folder);
    repo.transaction(() => {
      for (const c of repo.listCourses({termId: t.id})) repo.updateCourse(c.id, {term_id: row.id});
      repo.remove('term', t.id);
    });
  }
}
