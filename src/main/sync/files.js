// ファイル管理（DESIGN-M0 §8.2）：ダウンロード・ハッシュ・回フォルダ・同名の扱い・検疫・複製の整理・回の移動。
import {createHash} from 'node:crypto';
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {ulid} from '../../shared/ids.js';
import {layoutOf} from '../../shared/layout.js';
import {parseNumbered, sanitizeFileName, uniqueName} from '../../shared/naming.js';
import {inside} from '../../shared/paths.js';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** 自分で入れた資料（回に振り分ける前）を置くフォルダ。授業フォルダの中。回のフォルダ名（第NN回…・その他）とは重ならない */
export const OWN_FOLDER = '自分の資料';

const OPENABLE = /\.(pdf|docx?|pptx?|xlsx?|csv|txt|md|rtf|od[tps]|png|jpe?g|gif|webp|heic|mp4|mov|m4a|mp3|wav)$/i;
export const isOpenable = (p) => OPENABLE.test(String(p));

/** Content-Disposition からファイル名を取る。取れなければ '' */
export function filenameFromDisposition(header) {
  const raw = String(header ?? '');
  const star = raw.match(/filename\*=(?:UTF-8|utf-8)''([^;]+)/);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* 次へ */
    }
  }
  const plain = raw.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : '';
}

/** URL の末尾からファイル名らしいものを取る。拡張子がなければ '' */
export function filenameFromUrl(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    return /\.[A-Za-z0-9]{1,8}$/.test(last) ? last : '';
  } catch {
    return '';
  }
}

export class FileManager {
  /**
   * @param {object} deps
   * @param {import('../db/repo.js').Repo} deps.repo
   * @param {() => string} deps.root            保存先のルート（デスクトップ/大学ノート など）
   * @param {(file: string) => Promise<void>} [deps.quarantine]  OS の「インターネットから来た」印
   * @param {(file: string) => Promise<void>} [deps.trash]        OS のゴミ箱へ
   * @param {(msg: string) => void} [deps.log]
   */
  constructor({repo, root, quarantine = async () => {}, trash, log = () => {}}) {
    this.repo = repo;
    this.rootOf = typeof root === 'function' ? root : () => root;
    this.quarantine = quarantine;
    this.trash = trash ?? (async (f) => fsp.rm(f, {force: true}));
    this.log = log;
  }

  courseDir(term, course) {
    if (course.kind === 'folder') return course.dir; // 自分のフォルダ：パソコンのフォルダそのもの
    return path.join(this.rootOf(), term.folder, course.folder_name);
  }
  roundDir(term, course, round) {
    return path.join(this.courseDir(term, course), round.folder_name);
  }
  /** 回のフォルダ。round が null なら「自分の付箋」（自分の資料フォルダ） */
  placeDir(term, course, round) {
    if (course.kind === 'folder') return course.dir; // 自分のフォルダは回で分けない
    return round ? this.roundDir(term, course, round) : path.join(this.courseDir(term, course), OWN_FOLDER);
  }

  /** 同名があれば中身を比べ、同じならそのパス、違えば (2) (3) を足したパス。{path, existed} */
  async uniquePath(dir, name, hash) {
    const taken = new Set(await fsp.readdir(dir).catch(() => []));
    if (taken.has(name)) {
      const existing = await fsp.readFile(path.join(dir, name)).catch(() => null);
      if (existing && sha256(existing) === hash) return {path: path.join(dir, name), existed: true};
    }
    return {
      path: path.join(
        dir,
        uniqueName(name, (c) => taken.has(c))
      ),
      existed: false
    };
  }

  /** 一時ファイルに書いてから rename（途中で落ちても壊れたファイルを残さない） */
  async writeAtomic(file, data) {
    const tmp = path.join(path.dirname(file), `.daigaku-tmp-${ulid()}`);
    const fh = await fsp.open(tmp, 'wx');
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, file);
  }

  /**
   * 1 つの資料を取り込む（SPEC §6.7）。
   * fileRef: {url, name?, size?, modified?}  fetchFile: (ref) => {ok, status, contentType, disposition, body}
   * 戻り: {result: 'skip'|'dup'|'saved'|'updated'|'failed', material?, reason?}
   */
  async ingest({term, course, round, roundFrom = 'lms', fileRef, fetchFile, source = 'lms'}) {
    const root = this.rootOf();
    const here = (m) => inside(m.path, root);

    // 1. 同じ URL の記録（この保存先の中）
    let prev = null;
    if (fileRef.url) {
      prev = this.repo.findMaterialsByUrl(fileRef.url).find((m) => m.course_id === course.id && here(m)) ?? null;
      if (prev) {
        const newer = fileRef.modified && (!prev.lms_modified || String(fileRef.modified) > String(prev.lms_modified));
        if (!newer) return {result: 'skip', material: prev};
      }
    }

    // 2. 取得
    let res;
    try {
      res = await fetchFile(fileRef);
    } catch (e) {
      return {result: 'failed', reason: 'download', error: e};
    }
    if (!res?.ok || /text\/html/i.test(res.contentType ?? ''))
      return {result: 'failed', reason: 'download', status: res?.status};
    const body = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);

    // 3. ハッシュ
    const h = sha256(body);
    const same = this.repo.findMaterialByHash(course.id, h);
    if (same && here(same)) {
      // 更新日時だけ進んで中身は同じだった：その日時を覚える（覚えないと、次の同期のたびに取り直す）
      if (prev && fileRef.modified != null) this.repo.updateMaterial(prev.id, {lms_modified: String(fileRef.modified)});
      return {result: 'dup', material: same};
    }
    // 同じ中身の記録が別の保存先（保存先を変える前の場所）にある：記録を新しい保存先へ付け替える（授業ごとに同じ中身の記録は 1 つ）。
    // 回は LMS が言うとおりにし、本人が動かした回（round_from = 'user'）は保つ
    const relink = same ?? null;

    // 4. 回フォルダ
    const dir = this.roundDir(term, course, round);
    await fsp.mkdir(dir, {recursive: true});

    // 5. ファイル名
    let name = fileRef.name || filenameFromDisposition(res.disposition) || filenameFromUrl(fileRef.url);
    if (!name) return {result: 'failed', reason: 'download', detail: 'ファイル名が分かりません'};
    name = sanitizeFileName(name);
    if (prev) name = name.replace(/(\.[^.]+)?$/, (ext) => ` (v${prev.version + 1})${ext}`);
    const {path: file, existed} = await this.uniquePath(dir, name, h);

    // 6. 書き込み
    if (!existed) {
      try {
        await this.writeAtomic(file, body);
      } catch (e) {
        return {result: 'failed', reason: 'write', error: e};
      }
      await this.quarantine(file).catch(() => {});
    }

    // 7. 記録
    if (relink) {
      const material = this.repo.updateMaterial(relink.id, {
        ...(relink.round_from === 'user' ? {} : {round_id: round.id, round_from: roundFrom}),
        url: fileRef.url ?? relink.url ?? null,
        name: path.basename(file),
        path: file,
        // 記録の中身を新しい場所のファイルにそろえる。上書き保存した資料（base_sha256 で見つかった）は、
        // 新しい場所には元の中身を置いたので、元の中身が今のファイルになる（注釈の鍵は変わらない）
        sha256: h,
        ...(relink.base_sha256 === h ? {base_sha256: null} : {}),
        size: body.length,
        lms_modified: fileRef.modified != null ? String(fileRef.modified) : relink.lms_modified,
        status: 'ok'
      });
      this.log(`[files] 別の保存先にあった記録を付け替えました: ${material.name}`);
      return {result: 'saved', material};
    }
    // 同じ中身を同時に取り込んでいた（別の同期が先に記録した）ときは、先の記録を使う（UNIQUE(course_id, sha256)）
    const raced = () => {
      const m = this.repo.findMaterialByHash(course.id, h);
      return m ? {result: 'dup', material: m} : null;
    };
    let material;
    try {
      material = this.createLmsMaterial({course, round, roundFrom, fileRef, file, h, body, res, name, prev, source});
    } catch (e) {
      const won = /UNIQUE/i.test(e.message) && raced();
      if (!won) throw e;
      // 負けたほうが別の名前で書いたファイルは消す（記録のないファイルを残さない）
      if (!existed && won.material.path !== file) await fsp.rm(file, {force: true}).catch(() => {});
      return won;
    }
    return {result: prev ? 'updated' : 'saved', material};
  }

  createLmsMaterial({course, round, roundFrom, fileRef, file, h, body, res, name, prev, source}) {
    return this.repo.createMaterial({
      course_id: course.id,
      round_id: round.id,
      round_from: roundFrom,
      url: fileRef.url ?? null,
      name: path.basename(file),
      path: file,
      sha256: h,
      size: body.length,
      mime: (res.contentType ?? '').split(';')[0].trim() || null,
      layout: layoutOf(name),
      version: prev ? prev.version + 1 : 1,
      lms_modified: fileRef.modified != null ? String(fileRef.modified) : null,
      source,
      status: 'ok'
    });
  }

  /**
   * 自分のファイルを授業に入れる（授業画面の「ファイルを追加」・ドラッグ）。元のファイルは残してコピーする。
   * round が null なら「自分の付箋」に置く。戻り: {result: 'saved'|'dup', material}
   */
  async addOwn({term, course, round = null, name, data}) {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const h = sha256(body);
    const same = this.repo.findMaterialByHash(course.id, h);
    if (same && same.status !== 'trashed') return {result: 'dup', material: same};
    if (same) this.repo.remove('material', same.id); // 前にゴミ箱へ入れたもの：記録を消して入れ直す
    const dir = this.placeDir(term, course, round);
    await fsp.mkdir(dir, {recursive: true});
    const clean = sanitizeFileName(name);
    const {path: file, existed} = await this.uniquePath(dir, clean, h);
    if (!existed) await this.writeAtomic(file, body);
    const material = this.repo.createMaterial({
      course_id: course.id,
      round_id: round?.id ?? null,
      round_from: 'user',
      url: null,
      name: path.basename(file),
      path: file,
      sha256: h,
      size: body.length,
      mime: null,
      layout: layoutOf(clean),
      version: 1,
      lms_modified: null,
      source: 'upload',
      status: 'ok',
      read_at: new Date().toISOString() // 自分で入れたものは未読の印を付けない
    });
    return {result: 'saved', material};
  }

  /** 資料を別の回へ移す（SPEC §8.3）。ファイルも移動し、記録を更新する。round が null なら「自分の付箋」へ */
  async relocate({term, course, material, round}) {
    const dir = this.placeDir(term, course, round);
    await fsp.mkdir(dir, {recursive: true});
    const {path: target, existed} = await this.uniquePath(dir, path.basename(material.path), material.sha256);
    if (!existed && target !== material.path) await fsp.rename(material.path, target);
    else if (existed && target !== material.path) await fsp.rm(material.path, {force: true}); // 同じ中身が移動先にある
    return this.repo.updateMaterial(material.id, {
      path: target,
      name: path.basename(target),
      round_id: round?.id ?? null,
      round_from: 'user'
    });
  }

  /** 授業フォルダ・回フォルダの改名（名前が変わったとき）。移動先があれば中身を合流させる */
  async renameDir(from, to) {
    if (from === to) return;
    try {
      await fsp.access(from);
    } catch {
      return; // 元がなければ何もしない
    }
    try {
      await fsp.access(to);
    } catch {
      await fsp.rename(from, to);
      return;
    }
    // 合流
    for (const entry of await fsp.readdir(from, {withFileTypes: true})) {
      const src = path.join(from, entry.name);
      if (entry.isDirectory()) {
        await this.renameDir(src, path.join(to, entry.name));
        continue;
      }
      const data = await fsp.readFile(src);
      const {path: dest, existed} = await this.uniquePath(to, entry.name, sha256(data));
      if (existed) await fsp.rm(src, {force: true});
      else await fsp.rename(src, dest);
    }
    await fsp.rmdir(from).catch(() => {});
  }

  /** 記録のパスが指すファイルの有無を確かめ、動かされたものは探し直す（SPEC §7.3）。戻りは変更の一覧 */
  async reconcileFiles({term, course, rounds}) {
    const changes = [];
    const materials = this.repo.listMaterials(course.id).filter((m) => m.status !== 'trashed');
    const courseDir = this.courseDir(term, course);
    let scanned = null; // {hash -> path} を必要になったときだけ作る
    const scan = async () => {
      if (scanned) return scanned;
      scanned = new Map();
      let count = 0;
      const walk = async (dir, depth) => {
        for (const e of await fsp.readdir(dir, {withFileTypes: true}).catch(() => [])) {
          if (count++ > 2000) return;
          const p = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (depth < 2) await walk(p, depth + 1);
          } else if (!e.name.startsWith('.')) {
            const data = await fsp.readFile(p).catch(() => null);
            if (data) scanned.set(sha256(data), p);
          }
        }
      };
      await walk(courseDir, 0);
      return scanned;
    };
    for (const m of materials) {
      const exists = await fsp.access(m.path).then(
        () => true,
        () => false
      );
      if (exists) {
        if (m.status === 'missing') {
          this.repo.updateMaterial(m.id, {status: 'ok'});
          changes.push({material: m, change: 'found'});
        }
        continue;
      }
      const found = (await scan()).get(m.sha256);
      if (!found) {
        if (m.status !== 'missing') {
          this.repo.updateMaterial(m.id, {status: 'missing'});
          changes.push({material: m, change: 'missing'});
        }
        continue;
      }
      const dirName = path.basename(path.dirname(found));
      // 回のフォルダへ動かされていれば、その回へ。自分の資料フォルダなら「自分の付箋」へ
      const own = dirName === OWN_FOLDER && path.dirname(path.dirname(found)) === courseDir;
      const round = rounds.find((r) => r.folder_name === dirName);
      const target = own ? null : round ? round.id : undefined;
      const patch = {path: found, name: path.basename(found), status: 'ok'};
      if (target !== undefined && target !== m.round_id) Object.assign(patch, {round_id: target, round_from: 'user'});
      this.repo.updateMaterial(m.id, patch);
      changes.push({material: m, change: target !== undefined && target !== m.round_id ? 'moved-round' : 'moved'});
    }
    return changes;
  }

  /** 「名前 (2).pdf」の複製で、中身が記録どおり・元の名前が残っているものをゴミ箱へ（SPEC §7.4） */
  async trashDuplicates(course) {
    const trashed = [];
    for (const m of this.repo.listMaterials(course.id)) {
      if (m.status !== 'ok') continue;
      const num = parseNumbered(m.name);
      if (!num) continue;
      const original = path.join(path.dirname(m.path), num.base);
      const [data, origExists] = await Promise.all([
        fsp.readFile(m.path).catch(() => null),
        fsp.access(original).then(
          () => true,
          () => false
        )
      ]);
      if (!data || !origExists || sha256(data) !== m.sha256) continue;
      await this.trash(m.path);
      this.repo.updateMaterial(m.id, {status: 'trashed'});
      trashed.push(m);
    }
    return trashed;
  }
}
