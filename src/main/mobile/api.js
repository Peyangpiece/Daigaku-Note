// スマホ連携（docs/MOBILE.md §4）：スマホから呼べる窓口。パソコンの IPC の窓口（handlers）を、決めたものだけ・決めた形で通す。
// 設定・接続・パスワード・API キー・バックアップなどの窓口は通さない
import {isUlid} from '../../shared/ids.js';
import {MOBILE_KINDS} from '../../shared/mobile-kinds.js';

export const PHOTO_MAX = 30 * 1024 * 1024; // 1 枚
export const PHOTO_COUNT_MAX = 20; // 1 回

/** 写真の種類（中身の頭で見る）：JPEG・PNG・HEIC/HEIF・WebP。違えば null */
export function photoType(b) {
  if (!(b instanceof Uint8Array) || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  const box = String.fromCharCode(...b.subarray(4, 12));
  if (/^ftyp(heic|heix|hevc|mif1|msf1|heim|heis)/.test(box)) return 'heic';
  if (String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP')
    return 'webp';
  return null;
}

/** 写真のファイル名：写真_YYYYMMDD_HHMMSS（日本時間）_n.拡張子 */
export function photoName(type, at, n) {
  const j = new Date(at.getTime() + 9 * 3600 * 1000).toISOString(); // 日本時間
  const stamp = `${j.slice(0, 10).replaceAll('-', '')}_${j.slice(11, 19).replaceAll(':', '')}`;
  return `写真_${stamp}${n ? `_${n + 1}` : ''}.${type}`;
}

const bad = (msg) => {
  throw new Error(msg);
};
const okId = (v) => (isUlid(v) ? v : bad('ID が不正です'));

/**
 * @param {{handlers: Map<string, Function>, repo, getWindow, now?}} deps
 * @returns {Record<string, (arg: object) => Promise<object>>}
 */
export function createMobileApi({handlers, repo, getWindow = () => null, now = () => new Date()}) {
  const call = async (ch, arg) => {
    const fn = handlers.get(ch) ?? bad(`窓口がありません：${ch}`);
    return fn(arg ?? {});
  };
  /** スマホで書き込んだ：パソコンの PDF の画面に知らせ、ファイルの上書きは次にパソコンで開いたときに（pdf.stale） */
  const changed = (materialId) => {
    const stale = new Set(repo.getSetting('pdf.stale', []));
    stale.add(materialId);
    repo.setSetting('pdf.stale', [...stale]);
    getWindow()?.webContents.send('annotations.changed', {materialId});
  };
  /** スマホで直してよい注釈か（メモ・マーカー・文字隠し） */
  const ownAnnotation = (annotationId) => {
    const row = repo.get('annotation', okId(annotationId)) ?? bad('注釈がありません');
    if (!MOBILE_KINDS.includes(row.kind)) bad('この書き込みはパソコンで直してください');
    return row;
  };

  return {
    /** ホーム：今日の復習の数・学期・授業・回・資料（パス・設定・接続は渡さない） */
    async home() {
      const s = await call('state.get');
      const r = await call('quiz.review');
      const courses = s.courses
        .filter((c) => !c.hidden)
        .map(({id, name, weekday, period, color, kind, term_id: termId}) => ({
          id,
          name,
          weekday,
          period,
          color,
          kind,
          termId
        }));
      const ids = new Set(courses.map((c) => c.id));
      const pick = (m) => ({
        id: m.id,
        name: m.name,
        roundId: m.round_id,
        mime: m.mime,
        downloadedAt: m.downloaded_at,
        readAt: m.read_at,
        status: m.status
      });
      return {
        today: s.today,
        terms: s.terms,
        currentTermId: s.currentTermId,
        courses,
        rounds: Object.fromEntries(Object.entries(s.rounds).filter(([cid]) => ids.has(cid))),
        materials: Object.fromEntries(
          Object.entries(s.materials)
            .filter(([cid]) => ids.has(cid))
            .map(([cid, list]) => [cid, list.filter((m) => m.status === 'ok').map(pick)])
        ),
        reviewDue: r.questions?.length ?? 0
      };
    },
    async 'pdf.open'({materialId}) {
      const r = await call('pdf.open', {materialId: okId(materialId)});
      const {material, bytes, annotations, bookmarks} = r;
      return {material, bytes, annotations, bookmarks};
    },
    /** 注釈の一覧（スマホで開いている PDF に、パソコンで書いた分を取り直す） */
    async 'annotation.list'({materialId}) {
      return call('annotation.list', {materialId: okId(materialId)});
    },
    async 'annotation.save'({materialId, annotation}) {
      if (!MOBILE_KINDS.includes(annotation?.kind)) bad('スマホで書けるのはメモ・マーカー・文字隠しです');
      if (annotation.id != null) {
        const row = ownAnnotation(annotation.id);
        if (row.kind !== annotation.kind) bad('注釈が不正です');
      }
      const r = await call('annotation.save', {materialId: okId(materialId), annotation});
      changed(materialId);
      return r;
    },
    async 'annotation.remove'({materialId, annotationId}) {
      ownAnnotation(annotationId);
      const r = await call('annotation.remove', {materialId: okId(materialId), annotationId});
      changed(materialId);
      return r;
    },
    async 'quiz.review'() {
      return call('quiz.review');
    },
    async 'quiz.answer'({questionId, answer, seconds}) {
      return call('quiz.answer', {questionId: okId(questionId), answer, seconds, mode: 'review'});
    },
    /** 取り込んだシールの画像（PDF に貼ったもの） */
    async 'sticker.data'({ids}) {
      return call('sticker.data', {ids: Array.isArray(ids) ? ids.slice(0, 200) : []});
    },
    /** 写真を回のフォルダへ（中身の頭で写真か確かめ、名前は撮った日時から付ける） */
    async 'photo.upload'({courseId, roundId = null, files}) {
      if (!Array.isArray(files) || !files.length || files.length > PHOTO_COUNT_MAX)
        bad(`写真は 1 回 ${PHOTO_COUNT_MAX} 枚までです`);
      const at = now();
      const list = files.map((f, i) => {
        const data = f?.data;
        const type = photoType(data) ?? bad('写真（JPEG・PNG・HEIC・WebP）だけ送れます');
        if (data.length > PHOTO_MAX) bad('写真が大きすぎます（1 枚 30MB まで）');
        return {name: photoName(type, at, files.length > 1 ? i : 0), data};
      });
      return call('material.uploadData', {
        courseId: okId(courseId),
        roundId: roundId == null ? null : okId(roundId),
        files: list
      });
    }
  };
}
