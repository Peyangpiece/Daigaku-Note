// 資料をまたいで探す（SPEC §8.1 ホームの検索）。名前（授業・回・資料）、資料の本文、書き込んだ文字、回のメモを探す。
// 本文は material_text（クイズと同じ置き場。中身のハッシュごと）を使う。まだ読んでいない資料は、裏で 1 つずつ読んで足す。
// 探し方は PDF の編集画面の検索（renderer/views/viewer/find.js）と同じ：空白は無視し、全角・半角と大文字・小文字の違いも無視する（NFKC）
import {annoKey} from './pdf-save.js';
import {canExtract, extractPages} from './quiz/extract.js';
import {likeOf, normText, snippetOf, termsOf} from '../shared/search.js';

export const MAX_MATERIALS = 60; // 1 回に返す資料の数
export const MAX_HITS_PER_MATERIAL = 3; // 資料ごとに見せる箇所
const MAX_PAGES = 600; // 1 回に見る本文のページ（多すぎるときは打ち切る）

const roundLabel = (r) =>
  !r
    ? ''
    : r.user_made
      ? r.title_user || ''
      : r.number
        ? `第${r.number}回${r.title ? ` ${r.title}` : ''}`
        : r.title_user || '';

/**
 * @param {{repo, extract?: (file: string) => Promise<{method: string, pages: Array<{page: number, text: string}>}>,
 *   log?: Function, onProgress?: Function}} deps
 */
export function createSearch({repo, extract = extractPages, log = () => {}, onProgress = () => {}}) {
  const db = repo.db;
  const failed = new Set(); // 読めなかった中身（開いているあいだは読み直さない。iPad の中では本文を読めない）
  let running = null;

  /** まだ本文を読んでいない資料（中身ごとに 1 つ） */
  function pending() {
    const have = new Set(
      db
        .prepare('SELECT DISTINCT sha256 FROM material_text')
        .all()
        .map((r) => r.sha256)
    );
    const seen = new Set();
    const out = [];
    for (const m of Object.values(repo.listMaterialsAll()).flat()) {
      if (m.status !== 'ok' || !m.path || !m.sha256 || !canExtract(m.name)) continue;
      if (have.has(m.sha256) || failed.has(m.sha256) || seen.has(m.sha256)) continue;
      seen.add(m.sha256);
      out.push(m);
    }
    return out;
  }

  /** 前の版で入れた本文に、比べる形を足す */
  function backfill() {
    const rows = db.prepare('SELECT sha256, page, text FROM material_text WHERE norm IS NULL LIMIT 2000').all();
    if (!rows.length) return 0;
    const st = db.prepare('UPDATE material_text SET norm = ? WHERE sha256 = ? AND page = ?');
    repo.transaction(() => {
      for (const r of rows) st.run(normText(r.text), r.sha256, r.page);
    });
    return rows.length;
  }

  /** 裏で、まだ読んでいない資料の本文を読む（動いていれば、それを待つ）。戻りは読んだ数 */
  function index() {
    running ??= (async () => {
      let done = 0;
      try {
        while (backfill()) await new Promise((r) => setImmediate(r));
        for (const m of pending()) {
          try {
            const r = await extract(m.path);
            // 文字のない資料（写真だけの PDF）も「読んだ」印として 1 行残す（毎回読み直さない）
            repo.saveMaterialText(m.sha256, r.method, r.pages.length ? r.pages : [{page: 1, text: ''}]);
            done++;
          } catch (e) {
            failed.add(m.sha256);
            log(`search: 本文を読めませんでした（${m.name}）：${e.message}`);
          }
          onProgress({pending: pending().length});
          await new Promise((r) => setImmediate(r)); // 画面の操作を待たせない
        }
      } finally {
        running = null;
      }
      return done;
    })();
    return running;
  }

  /** 探す。戻り：{q, terms, materials: [...], notes: [...], courses: [...], pending, more} */
  function query(q) {
    const terms = termsOf(q).map(normText).filter(Boolean);
    const empty = {q: String(q ?? ''), terms, materials: [], notes: [], courses: [], pending: pending().length};
    if (!terms.length) return empty;
    const all = (s) => {
      const n = normText(s);
      return terms.every((t) => n.includes(t));
    };

    const courses = new Map(repo.listCourses().map((c) => [c.id, c]));
    const rounds = new Map(
      Object.values(repo.listRoundsAll())
        .flat()
        .map((r) => [r.id, r])
    );
    const mats = Object.values(repo.listMaterialsAll())
      .flat()
      .filter((m) => m.status === 'ok' && courses.has(m.course_id));
    const bySha = new Map(); // 本文の鍵（いまのファイルの中身）
    const byAnno = new Map(); // 書き込みの鍵（PDF は書き込む前の中身）
    for (const m of mats) {
      (bySha.get(m.sha256) ?? bySha.set(m.sha256, []).get(m.sha256)).push(m);
      const k = annoKey(m);
      (byAnno.get(k) ?? byAnno.set(k, []).get(k)).push(m);
    }

    const found = new Map(); // 資料の id → {m, nameHit, hits: [...]}
    const entry = (m) => found.get(m.id) ?? found.set(m.id, {m, nameHit: false, hits: [], count: 0}).get(m.id);
    const addHit = (m, hit) => {
      const e = entry(m);
      e.count++;
      if (e.hits.length < MAX_HITS_PER_MATERIAL && !e.hits.some((h) => h.page === hit.page && h.where === hit.where))
        e.hits.push(hit);
    };

    // 1. 名前
    for (const m of mats) if (all(m.name)) entry(m).nameHit = true;

    // 2. 本文（すべての言葉が同じページにあるもの）
    let more = false;
    const rows = db
      .prepare(
        `SELECT sha256, page, text FROM material_text WHERE ${terms.map(() => "norm LIKE ? ESCAPE '\\'").join(' AND ')}
         ORDER BY sha256, page LIMIT ${MAX_PAGES + 1}`
      )
      .all(...terms.map(likeOf));
    if (rows.length > MAX_PAGES) more = true;
    for (const r of rows.slice(0, MAX_PAGES))
      for (const m of bySha.get(r.sha256) ?? []) {
        const s = snippetOf(r.text, terms[0]);
        if (s) addHit(m, {page: r.page, where: 'text', ...s});
      }

    // 3. 書き込んだ文字（文字入れ・コメント・付箋の言葉）
    for (const a of db
      .prepare("SELECT sha256, page, body FROM annotation WHERE body IS NOT NULL AND body <> '' ORDER BY sha256, page")
      .all()) {
      if (!all(a.body)) continue;
      for (const m of byAnno.get(a.sha256) ?? []) {
        const s = snippetOf(a.body, terms[0]);
        if (s) addHit(m, {page: a.page, where: 'note', ...s});
      }
    }

    const order = (e) => (e.nameHit ? 1000 : 0) + Math.min(999, e.count);
    const list = [...found.values()].sort((a, b) => order(b) - order(a) || a.m.name.localeCompare(b.m.name, 'ja'));
    if (list.length > MAX_MATERIALS) more = true;
    const materials = list.slice(0, MAX_MATERIALS).map((e) => {
      const c = courses.get(e.m.course_id);
      return {
        id: e.m.id,
        name: e.m.name,
        pdf: /\.pdf$/i.test(e.m.name) && e.m.source !== 'export',
        courseId: c.id,
        courseName: c.name,
        round: roundLabel(rounds.get(e.m.round_id)),
        nameHit: e.nameHit,
        count: e.count,
        hits: e.hits.sort((a, b) => a.page - b.page)
      };
    });

    // 4. 回のメモ
    const notes = [];
    for (const n of db.prepare("SELECT round_id, body FROM round_note WHERE body <> ''").all()) {
      if (!all(n.body)) continue;
      const r = rounds.get(n.round_id);
      const c = r && courses.get(r.course_id);
      const s = c && snippetOf(n.body, terms[0]);
      if (s) notes.push({courseId: c.id, courseName: c.name, round: roundLabel(r), ...s});
    }

    // 5. 授業・フォルダの名前
    const courseHits = [...courses.values()]
      .filter((c) => !c.hidden && all(c.name))
      .map((c) => ({id: c.id, name: c.name, folder: c.kind === 'folder'}));

    return {
      q: String(q),
      terms,
      materials,
      notes: notes.slice(0, 20),
      courses: courseHits,
      pending: pending().length,
      more
    };
  }

  return {query, index, pending: () => pending().length};
}
