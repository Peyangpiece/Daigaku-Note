// 自分のフォルダ：自分で作るフォルダと、パソコンのフォルダの登録。授業（course）の表に kind = 'folder' で入れ、
// 中身はフォルダ（dir）をそのまま読む（登録したフォルダのファイルはコピーしない）。開くたびに読み直し、増えた・消えた・変わったファイルを記録に合わせる。
// 回は分けない。クイズに使えるよう、見えない回（第 0 回）を 1 つ持ち、資料はすべてそこに入れる。
// scope：'term' はその学期のあいだだけホームに出す。'always'（マイフォルダ）は学期が変わっても出す
import {createHash} from 'node:crypto';
import {createReadStream, promises as fsp} from 'node:fs';
import path from 'node:path';
import {ulid} from '../shared/ids.js';
import {layoutOf} from '../shared/layout.js';
import {courseFolderName, sanitizeSegment, uniqueName} from '../shared/naming.js';
import {inside} from '../shared/paths.js';
import {autoTerm, currentTerm} from '../shared/term.js';

export const MY_FOLDER = 'マイフォルダ'; // ルート/マイフォルダ/<名前>
export const TERM_FOLDERS = '自分のフォルダ'; // ルート/<学期>/自分のフォルダ/<名前>（授業フォルダと名前がぶつからないよう 1 段下げる）
export const MAX_FILES = 2000;

/**
 * フォルダの名前だけを変える（同じ親フォルダの中のまま。中のファイルは動かさない）。同じ名前がもうあれば変えない。
 * 大文字と小文字だけの違いは Mac・Windows では同じ名前と見なされるので、あるかどうかを確かめずに変える。変えたら true
 */
export async function renameFolder(from, to) {
  if (from === to) return false;
  if (from.toLowerCase() !== to.toLowerCase() && (await fsp.stat(to).catch(() => null))) throw err(`「${path.basename(to)}」はもうあります`);
  if (!(await fsp.stat(from).catch(() => null))?.isDirectory()) throw err('パソコンのフォルダが見つかりません');
  await fsp.rename(from, to);
  return true;
}
/** フォルダの名前を変えたあと、その授業の資料の記録のパスを新しいフォルダに合わせる */
export function movePaths(repo, courseId, from, to) {
  const a = from + path.sep;
  repo.db
    .prepare('UPDATE material SET path = ? || substr(path, ?) WHERE course_id = ? AND substr(path, 1, ?) = ?')
    .run(to + path.sep, a.length + 1, courseId, a.length, a);
}
/**
 * LMS を使わない授業の名前を変える。パソコンの授業フォルダの名前も変える（同じ学期のフォルダの中のまま）。
 * courseDir は FileManager.courseDir。戻りは course 行
 */
export async function renameCourse({repo, courseDir}, courseId, name) {
  const row = repo.get('course', courseId);
  const term = repo.get('term', row.term_id);
  const patch = {name};
  const folder = courseFolderName(name);
  if (term && folder !== row.folder_name) {
    if (repo.courseFolderNames(term.id).some((f) => f !== row.folder_name && f.toLowerCase() === folder.toLowerCase()))
      throw err(`「${folder}」はもうあります`);
    const from = courseDir(term, row),
      to = courseDir(term, {...row, folder_name: folder});
    if (await fsp.stat(from).catch(() => null)) {
      await renameFolder(from, to);
      movePaths(repo, row.id, from, to);
    }
    patch.folder_name = folder;
  }
  return repo.updateCourse(row.id, patch);
}
const MAX_DEPTH = 6;
const SKIP = /^(\.|~\$|Thumbs\.db$|desktop\.ini$|Icon\r$)/i; // 隠しファイル・Office の一時ファイル・OS の管理ファイル

const err = (message) => Object.assign(new Error(message), {code: 'folder'});
const hashFile = (file) =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (b) => h.update(b))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });

/** フォルダの中のファイル（下のフォルダも MAX_DEPTH 段まで）。多すぎるときは MAX_FILES で打ち切り、truncated を立てる */
export async function listFiles(dir, {max = MAX_FILES} = {}) {
  const out = [];
  let truncated = false;
  const walk = async (d, depth) => {
    const entries = await fsp.readdir(d, {withFileTypes: true}).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    for (const e of entries) {
      if (SKIP.test(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) await walk(p, depth + 1);
      } else if (e.isFile()) {
        if (out.length >= max) {
          truncated = true;
          return;
        }
        const st = await fsp.stat(p).catch(() => null);
        if (st) out.push({path: p, size: st.size, mtime: String(Math.round(st.mtimeMs))});
      }
    }
  };
  await walk(dir, 0);
  return {files: out, truncated};
}

export function createFolders({
  repo,
  rootDir,
  today = () => new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Tokyo'}),
  log = () => {}
}) {
  // LMS をつながずに使い始めたときは学期がまだないので、今日の日付から仮の学期を作る（設定 → 学期 で直せる）
  const termNow = () => {
    const terms = repo.listTerms();
    if (!terms.length) {
      repo.upsertTerm(autoTerm(today()));
      return repo.listTerms()[0];
    }
    return currentTerm(terms, today()) ?? terms.at(-1);
  };
  /** フォルダの見えない回（クイズと「ファイルを追加」の置き場所）。なければ作る */
  const roundOf = (course) =>
    repo.findRound(course.id, 0) ??
    repo.createRound({course_id: course.id, number: 0, title: course.name, folder_name: '.'});
  const folderCourse = (courseId) => {
    const c = repo.get('course', courseId);
    if (!c || c.kind !== 'folder') throw err('フォルダが見つかりません');
    return c;
  };

  /**
   * フォルダを作る（mode 'new'：保存先の中に新しく作る）か、パソコンのフォルダを登録する（mode 'link'：dir をそのまま使う）。
   * 戻りは course 行。同じフォルダをもう一度登録したら、前の記録を出し直して返す
   */
  async function create({name, scope, mode, dir = null}) {
    if (!['term', 'always'].includes(scope)) throw err('フォルダの種類が不正です');
    const term = termNow();
    if (!term) throw err('先に学期を設定してください（設定 → 学期）');
    const root = path.resolve(rootDir());
    let target;
    if (mode === 'new') {
      const clean = sanitizeSegment(name, {max: 80});
      if (!clean) throw err('フォルダの名前を入れてください');
      const base = scope === 'always' ? path.join(root, MY_FOLDER) : path.join(root, term.folder, TERM_FOLDERS);
      await fsp.mkdir(base, {recursive: true});
      const taken = new Set(await fsp.readdir(base).catch(() => []));
      target = path.join(
        base,
        uniqueName(clean, (c) => taken.has(c))
      );
      await fsp.mkdir(target);
    } else if (mode === 'link') {
      target = path.resolve(String(dir ?? ''));
      const st = await fsp.stat(target).catch(() => null);
      if (!st?.isDirectory()) throw err('フォルダが見つかりません');
      // 保存先そのもの・保存先を含むフォルダは、授業の資料まで丸ごと 2 重に出てしまうので登録しない
      if (target === root || inside(root, target))
        throw err('資料の保存先（またはそれを含むフォルダ）は登録できません。中のフォルダを選んでください');
      if (target === path.parse(target).root) throw err('ディスク全体は登録できません。フォルダを選んでください');
      const same = repo.listCourses().find((c) => c.kind === 'folder' && c.dir === target);
      if (same) {
        if (same.hidden || same.scope !== scope) repo.updateCourse(same.id, {hidden: 0, scope});
        return repo.get('course', same.id);
      }
    } else throw err('フォルダの作り方が不正です');
    const label =
      String(name ?? '')
        .trim()
        .slice(0, 80) || path.basename(target);
    const course = repo.createCourse({
      term_id: term.id,
      connection_id: null,
      name: label,
      folder_name: `@folder-${ulid()}`, // 授業フォルダ名の重なりの判定にかからない印（実際の場所は dir）
      kind: 'folder',
      dir: target,
      scope,
      sync_enabled: 0
    });
    roundOf(course);
    log(`[folder] ${mode === 'new' ? '作りました' : '登録しました'}：${label}（${target}）`);
    return course;
  }

  /**
   * フォルダを読み直して記録を合わせる。大きさと更新日時が同じファイルは読み直さない（中身の SHA-256 を毎回は計算しない）。
   * 消えたファイルは「ゴミ箱」の印（status = 'trashed'）にして画面から外す。同じ中身が別の名前・場所に現れたら記録を移す（未読の印や注釈はそのまま）
   * 戻り：{added, removed, truncated, missing}
   */
  async function scan(courseId) {
    const course = folderCourse(courseId);
    const st = await fsp.stat(course.dir).catch(() => null);
    if (!st?.isDirectory()) return {added: 0, removed: 0, truncated: false, missing: true};
    const round = roundOf(course);
    const {files, truncated} = await listFiles(course.dir);
    const known = repo.listMaterials(course.id);
    const byPath = new Map(known.map((m) => [m.path, m]));
    const present = new Set(files.map((f) => f.path));
    const keep = new Set();
    let added = 0;
    for (const f of files) {
      const m = byPath.get(f.path);
      if (m && m.status === 'ok' && m.size === f.size && m.lms_modified === f.mtime) {
        keep.add(m.id);
        continue;
      }
      let h;
      try {
        h = await hashFile(f.path);
      } catch (e) {
        log(`[folder] 読めません：${f.path}（${e.message}）`);
        continue;
      }
      const fields = {
        path: f.path,
        name: path.basename(f.path),
        sha256: h,
        size: f.size,
        lms_modified: f.mtime,
        status: 'ok',
        round_id: round.id
      };
      const same = repo.findMaterialByHash(course.id, h);
      if (m && (!same || same.id === m.id)) {
        repo.updateMaterial(m.id, fields); // 中身が変わった（または消えたあとで戻った）
        keep.add(m.id);
      } else if (same && !keep.has(same.id) && (same.status !== 'ok' || !present.has(same.path))) {
        repo.updateMaterial(same.id, fields); // 名前を変えた・別の下のフォルダへ移した
        keep.add(same.id);
        if (m && m.id !== same.id) repo.updateMaterial(m.id, {status: 'trashed'});
      } else if (!same) {
        if (m) repo.updateMaterial(m.id, {status: 'trashed'});
        const row = repo.createMaterial({
          course_id: course.id,
          round_from: 'user',
          layout: layoutOf(fields.name),
          source: 'folder',
          read_at: new Date().toISOString(), // 自分のファイルなので未読の印は付けない
          ...fields
        });
        keep.add(row.id);
        added++;
      }
      // 同じ中身のファイルがフォルダの中に 2 つあるときは、先に見つけたほうだけを出す
    }
    let removed = 0;
    for (const m of known) {
      if (keep.has(m.id) || m.status === 'trashed') continue;
      // 数が多くて打ち切ったときは、読まなかっただけのファイルを消したことにしない
      if (truncated && !present.has(m.path) && (await fsp.stat(m.path).catch(() => null))?.isFile()) continue;
      repo.updateMaterial(m.id, {status: 'trashed'});
      removed++;
    }
    return {added, removed, truncated, missing: false};
  }

  /** フォルダの名前を変える。パソコンのフォルダの名前も変える（同じ親フォルダの中のまま）。戻りは course 行 */
  async function rename(courseId, name) {
    const c = folderCourse(courseId);
    const label = String(name ?? '').trim().slice(0, 80);
    if (!label) throw err('名前を入れてください');
    const patch = {name: label};
    const to = path.join(path.dirname(c.dir), sanitizeSegment(label, {max: 80}) || 'フォルダ');
    if (await renameFolder(c.dir, to)) {
      movePaths(repo, c.id, c.dir, to);
      patch.dir = to;
    }
    return repo.updateCourse(c.id, patch);
  }
  /** フォルダの中の小さなフォルダ（sub：フォルダからの相対パス）の名前を変える。同じ親フォルダの中のまま。戻りは scan の結果 */
  async function renameSub(courseId, sub, name) {
    const c = folderCourse(courseId);
    const to = String(name ?? '').trim();
    if (!to || to.length > 80 || /[\\/:*?"<>|]/.test(to) || to === '.' || to === '..') throw err('フォルダの名前に使えない文字があります');
    const from = path.resolve(c.dir, String(sub ?? ''));
    if (!from.startsWith(path.resolve(c.dir) + path.sep)) throw err('フォルダが不正です');
    const dest = path.join(path.dirname(from), to);
    if (!(await renameFolder(from, dest))) return {added: 0, removed: 0, truncated: false, missing: false};
    movePaths(repo, c.id, from, dest);
    return scan(c.id);
  }

  return {create, scan, rename, renameSub, roundOf, folderCourse, termNow};
}
