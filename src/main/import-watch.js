// 授業資料の自動取り込み（v0.16.32。SPEC §6.10）。
// - ダウンロードの見張り（設定 import.enabled。既定オフ）：OS の「ダウンロード」に新しく来た PDF・PowerPoint・Word を見る。
//   ダウンロード元（import-source.js）が大学のサイトなら、授業と回を推定して「入れますか」と聞く（import.mode が 'auto' なら聞かずに入れる）。
//   大学と関係のないサイトのものは何もしない。ダウンロード元が分からないものは、勝手には入れず聞く
// - 取り込みフォルダ（ルート/取り込み）：本人が置いたものなので、ダウンロード元は見ない。推定できたら入れ、できなければ聞く
// - 聞くものは「振り分け待ち」（設定 import.pending）に残し、ホームで授業と回を選んで入れる。元のファイルは消さない（ダウンロードはコピー。
//   取り込みフォルダのものは、入れたあとに取り込みフォルダから消す）
// - 推定（guessPlace）：① ファイル名に授業名 ② 落とした時刻と時間割（曜日・時限）③ 回はファイル名の番号、なければ授業日の日付
import {watch, promises as fsp} from 'node:fs';
import path from 'node:path';
import {ulid} from '../shared/ids.js';
import {fileRound} from '../shared/rounds.js';
import {jstNow, todayJst} from '../shared/schedule.js';
import {currentTerm} from '../shared/term.js';
import {importDir} from '../shared/paths.js';
import {judgeSource, readSource, sharedHost, teamOf} from './import-source.js';

export const IMPORT_EXT = /\.(pdf|pptx?|docx?)$/i;
const TEMP = /(^\.|^~\$|\.(crdownload|part|partial|download|tmp)$)/i;
const MAX_SIZE = 300 * 1024 * 1024;
const MAX_PENDING = 50;
const MAX_SEEN = 3000; // 扱ったファイルの印（パス・大きさ・時刻）。探し直したとき、外したものをまた聞かない
const MAX_SCAN = 500; // すでにあるファイルを探すときの上限（新しい順）

/**
 * ダウンロードした時刻：作った時刻と更新時刻の早いほう（ダウンロードは作ってから書くので作った時刻。コピーしてきたファイルは
 * 作った時刻が新しくなり更新時刻は元のままなので、更新時刻）。作った時刻が取れない OS では更新時刻
 */
export const fileTime = (st) => (st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs);

const minutes = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const norm = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_\-・･.,、。()（）[\]［］【】「」『』]/g, '');
/** 授業名から、曜日・時限などの添え書き（「（金曜／2限）」など）を外したもの */
const courseKey = (name) => norm(String(name ?? '').replace(/[（(][^）)]*[）)]\s*$/, ''));

/**
 * 授業と回の推定。courses：[{id, name, kind, weekday, period}]、roundsOf(courseId)：[{id, number, date}]、
 * periodsOf(course)：{1: '09:00', …}（時限の開始時刻。なければ null）。at：ファイルが来た時刻。
 * 戻り：{courseId, roundId, by: 'name'|'time'|null}（分からなければ null）
 */
export function guessPlace({name, at = new Date(), courses = [], roundsOf = () => [], periodsOf = () => null}) {
  const file = norm(String(name ?? '').replace(/\.[^.]+$/, ''));
  // ① ファイル名に授業名（2 文字以上）。いちばん長く一致した授業
  let best = null;
  for (const c of courses) {
    const key = courseKey(c.name);
    if (key.length >= 2 && file.includes(key) && (!best || key.length > best.len)) best = {course: c, len: key.length};
  }
  let course = best?.course ?? null;
  let by = course ? 'name' : null;
  // ② 落とした時刻：授業の始まる 20 分前から、終わって 1 時間後まで（授業は 105 分までとみなす）。1 つに決まるときだけ
  const {hm, weekday} = jstNow(at);
  if (!course) {
    const now = minutes(hm);
    const hit = courses.filter((c) => {
      const start = c.weekday === weekday && c.period ? periodsOf(c)?.[c.period] : null;
      return start && now >= minutes(start) - 20 && now <= minutes(start) + 105 + 60;
    });
    if (hit.length === 1) [course, by] = [hit[0], 'time'];
  }
  if (!course) return {courseId: null, roundId: null, by: null};
  if (course.kind === 'folder') return {courseId: course.id, roundId: null, by};
  // ③ 回：ファイル名の番号（「第3回」「lecture03」「03_…」）。なければ、授業日の日付が今日か 6 日前までの回のうち、いちばん新しいもの
  const rounds = roundsOf(course.id) ?? [];
  const n = fileRound(name);
  let round = n ? rounds.find((r) => r.number === n) : null;
  if (!round && !n) {
    const today = todayJst(at);
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
    round =
      rounds
        .filter((r) => r.number > 0 && r.date && r.date <= today && r.date >= from)
        .sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
  }
  return {courseId: course.id, roundId: round?.id ?? null, by};
}

/**
 * 取り込みの見張り。deps：{repo, files, folders, rootDir: () => string, downloadsDir: () => string, notify(ch, payload), log}
 * 戻り：{refresh, list, accept, dismiss, close, handle}（handle はテスト用：見張らずに 1 つのファイルを処理する）
 */
export function createImporter({
  repo,
  files,
  folders,
  rootDir,
  downloadsDir,
  notify = () => {},
  log = () => {},
  now = () => new Date(),
  source = readSource,
  settle = 1000
}) {
  let watchers = [];
  let startedAt = now().getTime();
  const timers = new Map();
  const done = new Map(); // パス → 「大きさ:更新時刻」（同じファイルを 2 度扱わない）

  const setting = (k, d) => repo.getSetting(k, d);
  const pending = () => setting('import.pending', []) ?? [];
  const savePending = (list) => repo.setSetting('import.pending', list.slice(-MAX_PENDING));

  const coursesNow = () => {
    const terms = repo.listTerms();
    const cur = currentTerm(terms, todayJst(now()))?.id ?? terms.at(-1)?.id ?? null;
    return repo
      .listCourses()
      .filter(
        (c) => !c.hidden && (c.kind === 'folder' ? c.scope === 'always' || c.term_id === cur : c.term_id === cur)
      );
  };
  const universityHosts = () => {
    const out = new Set();
    for (const c of repo.listConnections()) {
      if (c.kind === 'manual') continue;
      try {
        if (c.base_url) out.add(new URL(c.base_url).hostname.toLowerCase());
      } catch {
        /* 読めない URL は使わない */
      }
      try {
        for (const h of JSON.parse(c.allowed_hosts_json ?? '[]')) out.add(String(h).toLowerCase());
      } catch {
        /* 読めなければ使わない */
      }
    }
    return [...out];
  };
  const periodsOf = (course) => {
    const term = course.term_id ? repo.get('term', course.term_id) : null;
    try {
      return term?.periods_json ? JSON.parse(term.periods_json) : null;
    } catch {
      return null;
    }
  };

  /** 入れる場所（ipc/materials.js の placeFor と同じ） */
  const placeOf = (courseId, roundId, sub = '') => {
    const course = repo.get('course', courseId);
    if (!course) throw new Error('授業が見つかりません');
    const term = repo.get('term', course.term_id);
    if (!term) throw new Error('学期がありません');
    if (course.kind === 'folder') {
      if (!course.dir) throw new Error('このフォルダの場所が分かりません');
      // sub：フォルダの中の回のフォルダ（「第3回」。Teams の授業で回の番号が分かったとき）
      return {
        course: sub ? {...course, dir: path.join(course.dir, sub)} : course,
        term,
        round: folders.roundOf(course)
      };
    }
    const round = roundId ? repo.get('round', roundId) : null;
    if (round && round.course_id !== course.id) throw new Error('別の授業の回には入れられません');
    return {course, term, round};
  };

  const labelOf = (courseId, roundId) => {
    const c = courseId ? repo.get('course', courseId) : null;
    if (!c) return '';
    const r = roundId ? repo.get('round', roundId) : null;
    return r ? `${c.name} ${r.number ? `第${r.number}回` : r.title_user || ''}`.trim() : c.name;
  };

  /** ファイルを入れる。取り込みフォルダのものは、入れたあと取り込みフォルダから消す。戻り：{result, material, label} */
  async function put({file, name, from}, courseId, roundId, sub = '') {
    const place = placeOf(courseId, roundId, sub);
    const data = await fsp.readFile(file);
    const r = await files.addOwn({...place, name, data});
    if (from === 'folder') await fsp.rm(file, {force: true}).catch(() => {});
    // 自分のフォルダ：中のフォルダ（第3回など）を付箋として出すため読み直す
    if (place.course.kind === 'folder') await folders.scan?.(courseId).catch(() => {});
    return {...r, label: labelOf(courseId, roundId)};
  }

  const at = (st) => new Date(fileTime(st) || now().getTime());
  /** Teams のチーム → 授業（設定 import.teams。消した授業は使わない） */
  const teamCourseOf = (team) => {
    const id = (setting('import.teams', {}) ?? {})[team.key];
    const c = id ? repo.get('course', id) : null;
    return c && !c.hidden ? c : null;
  };
  const saveTeam = (key, courseId) =>
    repo.setSetting('import.teams', {...(setting('import.teams', {}) ?? {}), [key]: courseId});
  /** Teams の授業へ入れる：自分のフォルダなら回の番号のフォルダ（第N回）へ、授業（LMS）なら推定した回へ */
  async function putTeam(item, course, when) {
    const n = fileRound(item.name);
    if (course.kind === 'folder') return put(item, course.id, null, n ? `第${n}回` : '');
    const g = guessPlace({
      name: item.name,
      at: when,
      courses: [course],
      roundsOf: (id) => repo.listRounds(id),
      periodsOf
    });
    return put(item, course.id, g.roundId);
  }

  const seenKeys = () => new Set(setting('import.seen', []) ?? []);
  const markSeen = (key) => {
    const list = (setting('import.seen', []) ?? []).filter((k) => k !== key);
    list.push(key);
    repo.setSetting('import.seen', list.slice(-MAX_SEEN));
  };

  /**
   * 1 つのファイルを処理する（見張り・すでにあるファイルの取り込みから。テストからも呼ぶ）。
   * backfill：設定する前からあったファイル（見張りを始めた時刻より前でも見る）。quiet：1 つずつ知らせない（まとめて知らせる）
   */
  async function handle(file, from, {backfill = false, quiet = false} = {}) {
    const name = path.basename(file);
    if (!IMPORT_EXT.test(name) || TEMP.test(name)) return {skipped: 'type'};
    const st = await fsp.stat(file).catch(() => null);
    if (!st?.isFile() || !st.size || st.size > MAX_SIZE) return {skipped: 'size'};
    // ダウンロードの見張りでは、見張りを始める前からあったファイル（名前を変えただけ・移しただけ）は見ない
    if (from === 'downloads' && !backfill && st.mtimeMs < startedAt - 2000) return {skipped: 'old'};
    const key = `${st.size}:${Math.round(st.mtimeMs)}`;
    if (done.get(file) === key) return {skipped: 'seen'};
    // 前に扱ったもの（入れた・聞いた・外した・関係のないサイト）は、探し直してもまた聞かない
    if (seenKeys().has(`${file}|${key}`)) return {skipped: 'seen'};
    done.set(file, key);
    markSeen(`${file}|${key}`);
    let src = {kind: 'folder', host: ''};
    let team = null;
    if (from === 'downloads') {
      const urls = await source(file).catch(() => []);
      team = teamOf(urls); // Teams のチーム（＝授業）の場所（v0.17.4）
      src = judgeSource(urls, {
        hosts: universityHosts(),
        domain: setting('profile.universityDomain', ''),
        sites: setting('import.sites', []) ?? []
      });
      if (src.kind === 'other') {
        log(`取り込み：大学と関係のないサイトのファイルは見送りました（${src.host}）`);
        return {skipped: 'other', host: src.host};
      }
    }
    // 前に授業を決めた Teams のチーム：聞かずにその授業へ入れる（回の番号が分かれば「第N回」のフォルダへ）
    const teamCourse = team ? teamCourseOf(team) : null;
    if (teamCourse) {
      try {
        const r = await putTeam({file, name, from}, teamCourse, at(st));
        if (!quiet) notify('import.done', {name, label: r.label, dup: r.result === 'dup'});
        return {imported: r.result, courseId: teamCourse.id, team: team.key};
      } catch (e) {
        log(`取り込み：${name} を入れられませんでした（${e.message}）`);
      }
    }
    const courses = coursesNow();
    const guess = guessPlace({
      name,
      at: at(st),
      courses,
      roundsOf: (id) => repo.listRounds(id),
      periodsOf
    });
    const course = guess.courseId ? repo.get('course', guess.courseId) : null;
    const sure = course && (course.kind === 'folder' || guess.roundId);
    const auto = from === 'folder' || (src.kind === 'university' && setting('import.mode', 'ask') === 'auto');
    if (sure && auto) {
      try {
        const r = await put({file, name, from}, guess.courseId, guess.roundId);
        if (!quiet) notify('import.done', {name, label: r.label, dup: r.result === 'dup'});
        return {imported: r.result, courseId: guess.courseId, roundId: guess.roundId};
      } catch (e) {
        log(`取り込み：${name} を入れられませんでした（${e.message}）`);
      }
    }
    const item = {
      id: ulid(),
      file,
      name,
      size: st.size,
      from,
      source: src.kind,
      host: src.host,
      courseId: guess.courseId,
      roundId: guess.roundId,
      team: team && !teamCourse ? {key: team.key, site: team.site, name: team.name} : null,
      at: now().toISOString()
    };
    savePending([...pending().filter((p) => p.file !== file), item]);
    if (!quiet)
      notify('import.pending', {id: item.id, name, label: labelOf(guess.courseId, guess.roundId), source: src.kind});
    return {pending: item.id};
  }

  const schedule = (file, from) => {
    clearTimeout(timers.get(file));
    timers.set(
      file,
      setTimeout(async () => {
        timers.delete(file);
        // 書き終わるまで待つ（大きさが 2 回続けて同じになるまで。1 分まで）
        let size = -1;
        for (let i = 0; i < 60; i++) {
          const st = await fsp.stat(file).catch(() => null);
          if (!st) return;
          if (st.size === size) break;
          size = st.size;
          await new Promise((r) => setTimeout(r, settle));
        }
        await handle(file, from).catch((e) => log(`取り込み：${path.basename(file)}（${e.message}）`));
      }, settle)
    );
  };

  function close() {
    for (const w of watchers) w.close();
    watchers = [];
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  }

  /** 設定に合わせて見張りを始め直す（設定を変えたとき・起動したとき） */
  async function refresh() {
    close();
    // 社会人には出さない機能なので、前にオンにしていても見張らない（v0.17.6）
    if (!setting('import.enabled', false) || setting('profile.role', null) === 'worker') return;
    startedAt = now().getTime();
    const dirs = [];
    const dl = downloadsDir?.();
    if (dl) dirs.push([dl, 'downloads']);
    const inbox = importDir(rootDir());
    await fsp.mkdir(inbox, {recursive: true}).catch(() => {});
    dirs.push([inbox, 'folder']);
    for (const [dir, from] of dirs) {
      try {
        const w = watch(dir, (_event, fname) => fname && schedule(path.join(dir, String(fname)), from));
        w.on('error', (e) => log(`取り込み：${dir} を見張れなくなりました（${e.message}）`));
        watchers.push(w);
      } catch (e) {
        log(`取り込み：${dir} を見張れません（${e.message}）`);
      }
    }
    // 取り込みフォルダにもとからあるものも見る（本人が置いたもの）
    for (const f of await fsp.readdir(inbox).catch(() => [])) schedule(path.join(inbox, f), 'folder');
  }

  /** 振り分け待ち（画面に出す形） */
  function list() {
    return pending().map((p) => ({...p, label: labelOf(p.courseId, p.roundId)}));
  }

  /**
   * 振り分け待ちを入れる。courseId・roundId は本人が選んだもの。
   * remember：ダウンロード元のサイト（Teams の SharePoint など）を大学のサイトとして覚える（次からは大学の資料として扱う。v0.17.2）
   */
  async function accept(id, courseId, roundId = null, {remember = false, newCourse = ''} = {}) {
    const item = pending().find((p) => p.id === id);
    if (!item) throw new Error('振り分け待ちに見つかりません');
    if (!(await fsp.stat(item.file).catch(() => null))) {
      savePending(pending().filter((p) => p.id !== id));
      throw new Error('ファイルが見つかりません（動かしたか、消した可能性があります）');
    }
    // Teams のチームから：新しい授業（今学期の自分のフォルダ）を作って入れる（v0.17.4）
    if (newCourse) {
      const c = await folders.create({name: newCourse, scope: 'term', mode: 'new'});
      courseId = c.id;
      roundId = null;
    }
    if (!courseId) throw new Error('授業を選んでください');
    // チームを覚える（次からこの授業へ自動で）：チームのファイルは回の番号のフォルダへ
    const course = repo.get('course', courseId);
    const r =
      item.team && remember && course?.kind === 'folder'
        ? await putTeam(item, course, new Date(item.at))
        : await put(item, courseId, roundId);
    if (item.team && remember) saveTeam(item.team.key, courseId);
    savePending(pending().filter((p) => p.id !== id));
    let remembered = '';
    if (remember && item.host && item.source !== 'university' && !sharedHost(item.host)) {
      const sites = setting('import.sites', []) ?? [];
      if (!sites.includes(item.host)) repo.setSetting('import.sites', [...sites, item.host].slice(-50));
      remembered = item.host;
    }
    return {result: r.result, label: r.label, remembered, team: !!(item.team && remember)};
  }

  /** 振り分け待ちから外す（ファイルはそのまま） */
  function dismiss(id) {
    savePending(pending().filter((p) => p.id !== id));
    return {ok: true};
  }

  /**
   * 設定する前からダウンロードにあったファイルを取り込む（オンにしたとき・設定の「すでにダウンロードしたファイルを探す」）。
   * ダウンロードした時刻（fileTime）が今学期の期間（日本時間の開始日 0 時〜終了日 24 時）のものだけ。新しい順に MAX_SCAN まで。
   * 扱いは見張りと同じ（大学のサイトのものだけ。分からないものは聞く）。知らせは 1 つずつでなく、まとめて 1 回。
   * 戻り：{term, checked, outside, other, pending, imported}（今学期がなければ {noTerm: true}）
   */
  async function scanExisting() {
    if (setting('profile.role', null) === 'worker')
      return {term: '', checked: 0, outside: 0, other: 0, pending: 0, imported: 0};
    const today = todayJst(now());
    const term = currentTerm(repo.listTerms(), today);
    if (!term) return {noTerm: true};
    const from = Date.parse(`${term.start_date}T00:00:00+09:00`);
    const to = Date.parse(`${term.end_date}T00:00:00+09:00`) + 86400000;
    const dir = downloadsDir?.();
    const out = {term: `${term.year} ${term.label}`, checked: 0, outside: 0, other: 0, pending: 0, imported: 0};
    if (!dir) return out;
    const files = [];
    for (const name of await fsp.readdir(dir).catch(() => [])) {
      if (!IMPORT_EXT.test(name) || TEMP.test(name)) continue;
      const file = path.join(dir, name);
      const st = await fsp.stat(file).catch(() => null);
      if (!st?.isFile()) continue;
      const t = fileTime(st);
      if (t < from || t >= to) out.outside++;
      else files.push([file, t]);
    }
    files.sort((a, b) => b[1] - a[1]);
    for (const [file] of files.slice(0, MAX_SCAN)) {
      out.checked++;
      const r = await handle(file, 'downloads', {backfill: true, quiet: true}).catch(() => ({}));
      if (r.pending) out.pending++;
      else if (r.imported) out.imported++;
      else if (r.skipped === 'other') out.other++;
    }
    if (out.pending || out.imported) notify('import.scanned', {pending: out.pending, imported: out.imported});
    return out;
  }

  return {refresh, list, accept, dismiss, close, handle, scanExisting};
}
