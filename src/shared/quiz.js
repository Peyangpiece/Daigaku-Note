// クイズの問題の検査と採点（SPEC §11.2・§11.6）。副作用なし。生成（main/quiz）と画面（renderer）の両方から使う。
// 問題：{type, q, a, o, n, src: {file, page, quote}, tags, difficulty}
//   choice … 4 択（a 正解・o 誤答 3）／ tf … ○×（a は "○" か "×"）／ cloze … q の [＿] に入る語を 4 択
//   num … 数値で答える（a は数値の文字列、unit は単位。カテキョの「数字入力」にならう）／ card … 自分で思い出して自己採点

export const TYPES = ['choice', 'tf', 'cloze', 'num', 'card'];
export const TYPE_LABEL = {choice: '選択', tf: '正誤', cloze: '穴埋め', num: '数値', card: '記述カード'};
export const TAGS = ['定義', '比較', '計算', '事例', '手順'];
export const BLANK = '[＿]';
const LIMIT = {q: 300, a: 120, o: 120, n: 400, nMin: 15, quoteMin: 20, quoteMax: 200};

/** 比べるための正規化：NFKC・空白を除く・小文字 */
export const norm = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();

/** 数値の読み取り：全角・カンマ・円や % などの単位を外す。読めなければ null */
export function parseNumber(s) {
  const t = String(s ?? '')
    .normalize('NFKC')
    .replace(/[,，\s]/g, '')
    .replace(/[−ー―–]/g, '-')
    .replace(/^[¥￥$]/, '');
  const m = t.match(/^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?/i);
  return m ? Number(m[0]) : null;
}

/**
 * 1 問の検査。戻りは理由の配列（空なら OK）。pageCount は {file: ページ数}（src.page の範囲の確認に使う。なければ見ない）
 */
export function checkQuestion(x, {pageCount = null} = {}) {
  const errs = [];
  if (!x || typeof x !== 'object') return ['問題の形ではありません'];
  if (!TYPES.includes(x.type)) errs.push(`種類（type）が不正: ${x.type}`);
  for (const k of ['q', 'a', 'n']) if (!String(x[k] ?? '').trim()) errs.push(`${k} が空です`);
  if (String(x.q ?? '').length > LIMIT.q) errs.push(`q が ${LIMIT.q} 文字を超えています`);
  if (String(x.a ?? '').length > LIMIT.a) errs.push(`a が ${LIMIT.a} 文字を超えています`);
  if (String(x.n ?? '').length > LIMIT.n) errs.push(`n が ${LIMIT.n} 文字を超えています`);
  if (String(x.n ?? '').trim() && String(x.n).trim().length < LIMIT.nMin)
    errs.push(`解説（n）が短すぎます（${LIMIT.nMin} 文字以上。正解の理由を書く）`);
  const o = Array.isArray(x.o) ? x.o : [];
  if (x.type === 'choice' || x.type === 'cloze') {
    if (o.length !== 3) errs.push('o（誤答）はちょうど 3 つ');
    const all = [x.a, ...o].map(norm);
    if (new Set(all).size !== all.length) errs.push('正解と誤答、または誤答どうしが同じです');
    if (o.some((v) => !String(v ?? '').trim() || String(v).length > LIMIT.o))
      errs.push(`誤答が空か ${LIMIT.o} 文字を超えています`);
  }
  if (x.type === 'tf' && !['○', '×'].includes(x.a)) errs.push('tf の a は "○" か "×"');
  if (x.type === 'cloze' && String(x.q ?? '').split(BLANK).length !== 2)
    errs.push(`cloze の q には ${BLANK} がちょうど 1 つ`);
  if (x.type === 'num' && parseNumber(x.a) === null) errs.push('num の a が数値ではありません');
  const quote = String(x.src?.quote ?? '');
  if (quote.length < LIMIT.quoteMin || quote.length > LIMIT.quoteMax)
    errs.push(`根拠の引用は ${LIMIT.quoteMin}〜${LIMIT.quoteMax} 文字`);
  if (pageCount && x.src?.file in pageCount && !(x.src.page >= 1 && x.src.page <= pageCount[x.src.file]))
    errs.push('根拠のページが資料の範囲外です');
  return errs;
}

/** クイズ全体の検査。戻りは [{index, errors}]（不備のある問題だけ）。同じ問いの重複も見る */
export function checkQuiz(qs, opts) {
  const seen = new Set();
  const out = [];
  qs.forEach((x, i) => {
    const errors = checkQuestion(x, opts);
    const key = norm(x?.q);
    if (seen.has(key)) errors.push('同じ問いが前にもあります');
    seen.add(key);
    if (errors.length) out.push({index: i, errors});
  });
  return out;
}

/** 根拠の照合：引用が資料本文に（正規化して）部分一致するか。docs は [{file, pages:[{page,text}]}]。戻りは見つかった {file, page} か null */
export function findQuote(quote, docs) {
  const q = norm(quote);
  if (q.length < 10) return null;
  for (const d of docs) for (const p of d.pages) if (norm(p.text).includes(q)) return {file: d.file, page: p.page};
  // ページをまたぐ引用：同じ資料の隣り合うページをつないで探す
  for (const d of docs)
    for (let i = 0; i + 1 < d.pages.length; i++)
      if (norm(d.pages[i].text + d.pages[i + 1].text).includes(q)) return {file: d.file, page: d.pages[i].page};
  return null;
}

/** 選択肢（choice・cloze は 4 択、tf は ○×）。seed で並びを決める（同じ問題はいつも同じ並び。ふたたび解くときに場所で覚えないよう、seed は解くたびに変える） */
export function choicesOf(x, seed = 0) {
  if (x.type === 'tf') return ['○', '×'];
  if (x.type !== 'choice' && x.type !== 'cloze') return [];
  const list = [x.a, ...(x.o ?? [])];
  let h = seed >>> 0 || 1;
  for (let i = list.length - 1; i > 0; i--) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    const j = h % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** 採点。card は自己採点（answer が true/false）。num は相対 0.1% か絶対 1e-9 の差まで正解 */
export function grade(x, answer) {
  if (x.type === 'card') return answer === true;
  if (x.type === 'num') {
    const want = parseNumber(x.a);
    const got = parseNumber(answer);
    if (want === null || got === null) return false;
    return Math.abs(got - want) <= Math.max(1e-9, Math.abs(want) * 1e-3);
  }
  return norm(answer) === norm(x.a);
}

/** 既定の問題数と種類の比率（SPEC §11.1。数値は「計算」が出る授業のために足した） */
export const DEFAULT_MIX = {choice: 5, tf: 2, cloze: 2, num: 0, card: 1};
export const mixText = (mix) =>
  Object.entries(mix)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${t} ${n}`)
    .join('・');
