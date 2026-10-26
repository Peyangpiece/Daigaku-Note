// 文字隠しマーカーからの機械的な穴埋め（SPEC §11.3）。AI を使わず、隠した語を [＿] にした cloze を作る。副作用なし。
// 資料のページの文字（main/quiz/extract.js が読んだもの）から、隠した語を含む一文を引用にし、誤答は同じ回のほかのマーカーの語から取る
import {BLANK, checkQuestion, norm} from './quiz.js';

/** この数以上の文字隠しマーカーがある回で「隠した箇所から穴埋めを作る」を出す */
export const MIN_MASKS = 5;
const SENTENCE_END = /[。．！？!?\n]/;
const QUOTE = {min: 20, max: 200, around: 80};

/** 空白を除いた文字列と、その各文字が元の文字列のどこにあったか */
function stripped(s) {
  let out = '';
  const map = [];
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) continue;
    out += s[i];
    map.push(i);
  }
  return {out, map};
}
const tidy = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * ページの文字の中から隠した語を探し、その語を含む一文を引用（20〜200 字）、語を [＿] にしたものを問いにする。
 * 空白の違い（PDF の読み取りで入る改行など）は無視して探す。見つからなければ null
 */
export function clozeSentence(pageText, hidden) {
  const raw = String(pageText ?? '');
  const h = String(hidden ?? '').trim();
  if (!h) return null;
  const P = stripped(raw);
  const H = stripped(h);
  if (!H.out) return null;
  let k = P.out.indexOf(H.out);
  if (k < 0) k = P.out.toLowerCase().indexOf(H.out.toLowerCase());
  if (k < 0) return null;
  const start = P.map[k];
  const end = P.map[k + H.out.length - 1] + 1;
  // 語を含む一文
  let s = start;
  while (s > 0 && !SENTENCE_END.test(raw[s - 1])) s--;
  let e = end;
  while (e < raw.length && !SENTENCE_END.test(raw[e])) e++;
  if (e < raw.length && raw[e] !== '\n') e++; // 句点は含める
  // 短すぎれば前後へ広げ、長すぎれば語のまわりに絞る
  if (tidy(raw.slice(s, e)).length < QUOTE.min) {
    s = Math.max(0, Math.min(s, start - QUOTE.around));
    e = Math.min(raw.length, Math.max(e, end + QUOTE.around));
  }
  if (tidy(raw.slice(s, e)).length > QUOTE.max) {
    s = Math.max(s, start - QUOTE.around);
    e = Math.min(e, end + QUOTE.around);
  }
  const quote = tidy(raw.slice(s, e));
  const q = tidy(raw.slice(s, start) + BLANK + raw.slice(end, e));
  if (quote.length < QUOTE.min || quote.length > QUOTE.max) return null;
  return {q, quote};
}

/**
 * マーカーの一覧から穴埋めの問題を作る。
 * masks: [{text, page, file, context}]（text は隠した語、context はそのページの文字）
 * 戻り：検査（checkQuestion）に通った問題の配列 [{type: 'cloze', q, a, o, n, src: {file, page, quote}, tags, difficulty}]
 *   同じ語は 1 問にまとめる。誤答はほかの語から、長さの近いものを 3 つ（4 つ以上の違う語がなければ作れない）
 */
export function clozeFromMasks(masks, {max = 30} = {}) {
  const uniq = [];
  const seen = new Set();
  for (const m of masks ?? []) {
    const text = String(m?.text ?? '').trim();
    const key = norm(text);
    if (!key || text.length > 120 || seen.has(key)) continue;
    seen.add(key);
    uniq.push({...m, text});
  }
  if (uniq.length < 4) return [];
  const out = [];
  for (const m of uniq) {
    const sent = clozeSentence(m.context, m.text);
    if (!sent) continue;
    const o = uniq
      .filter((x) => x !== m)
      .sort(
        (a, b) =>
          Math.abs(a.text.length - m.text.length) - Math.abs(b.text.length - m.text.length) ||
          a.text.localeCompare(b.text, 'ja')
      )
      .slice(0, 3)
      .map((x) => x.text);
    const q = {
      type: 'cloze',
      q: sent.q,
      a: m.text,
      o,
      n: `${m.file ?? '資料'} の ${m.page} ページで、文字隠しマーカーで隠した語です。「${sent.quote.slice(0, 60)}」の箇所を見直してください。`,
      src: {file: m.file ?? '', page: m.page, quote: sent.quote},
      tags: [],
      difficulty: 2
    };
    if (checkQuestion(q).length) continue;
    out.push(q);
    if (out.length >= max) break;
  }
  return out;
}
