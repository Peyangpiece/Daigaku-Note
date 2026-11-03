// クイズの答えの画面で、その問題について AI に質問する（SPEC §11.7）。
// 送るのは、問題・選択肢・正解・解説・誤答の理由・本人の答え、根拠のページとその前後のページの本文（ID などを消したもの）、本人の質問とそれまでのやりとり。
// client は generate.js と同じ形（Anthropic の client か、cli.js の Claude Code・Codex）。答えは構造化出力の {answer}
import {BETAS, costOf} from './generate.js';
import {scrub} from './extract.js';

export const ASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: {answer: {type: 'string'}}
};

export const ASK_SYSTEM = `あなたは大学生の復習を手伝う係です。クイズの 1 問について、本人の質問に日本語で答えます。
- 渡された問題・解説・資料の本文を根拠にする。資料にないことで補うときは「資料の外の一般的な説明では」と断る。
- 結論から短く答える（3〜6 文。必要なら箇条書き）。
- 資料のどこに書いてあるかを示せるときは（p.ページ）と書く。
- 答えに自信がないときは、そう書く。`;

const MAX_SOURCE = 6000; // 資料の本文は、根拠のページと前後のページを 6000 文字まで
const err = (code, message) => Object.assign(new Error(message), {code});

/** 根拠のページと前後のページの本文（[p.n] 付き）。資料の文字がなければ空 */
export function sourceText(repo, q) {
  if (!q.src_sha256) return '';
  const pages = repo.readMaterialText(q.src_sha256);
  if (!pages.length) return '';
  const at = q.src_page ?? pages[0].page;
  const near = pages
    .filter((p) => Math.abs(p.page - at) <= 1)
    .sort((a, b) => Math.abs(a.page - at) - Math.abs(b.page - at));
  const out = [];
  let size = 0;
  for (const p of near) {
    const t = scrub(p.text).trim();
    if (!t || size + t.length > MAX_SOURCE) continue;
    out.push({page: p.page, t});
    size += t.length;
  }
  return out
    .sort((a, b) => a.page - b.page)
    .map((p) => `[p.${p.page}] ${p.t}`)
    .join('\n');
}

/** 質問に添える問題の中身 */
export function questionContext(q, mine) {
  let o = [];
  let unit = '';
  try {
    const v = JSON.parse(q.o_json ?? '[]');
    if (Array.isArray(v)) o = v;
    else unit = v?.unit ?? '';
  } catch {
    /* 形がおかしければ選択肢なし */
  }
  let why = [];
  try {
    why = JSON.parse(q.why_json ?? '[]') ?? [];
  } catch {
    /* 理由なし */
  }
  const lines = [
    `問題（${q.type}）：${q.q}`,
    o.length ? `選択肢：${[q.a, ...o].join(' / ')}` : null,
    `正解：${q.a}${unit ? ` ${unit}` : ''}`,
    mine != null && mine !== '' ? `本人の答え：${mine}` : null,
    `解説：${q.n}`,
    ...o.map((x, i) => (why[i] ? `「${x}」が違う理由：${why[i]}` : null)),
    q.src_quote ? `根拠の引用${q.src_page ? `（p.${q.src_page}）` : ''}：${q.src_quote}` : null
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * 1 問について質問する。戻りは {answer}
 * deps: {repo, client, log}。opts: {questionId, text, mine, history: [{q, a}], model, limits: {perMonthUsd}}
 */
export async function askAboutQuestion(deps, opts) {
  const {repo, client, log = () => {}} = deps;
  const {questionId, text, mine = null, history = [], model, limits = {perMonthUsd: 5}} = opts;
  const q =
    repo.get('question', questionId) ??
    (() => {
      throw err('quiz-no-question', '問題が見つかりません');
    })();
  if (repo.aiUsageSummary().monthUsd >= limits.perMonthUsd)
    throw err('limit-month', `今月の費用の上限（$${limits.perMonthUsd}）に達しました`);
  const src = sourceText(repo, q);
  const content = [
    questionContext(q, mine),
    src ? `\n## 資料の本文（根拠のページと前後）\n${src}` : '',
    history.length ? `\n## これまでのやりとり\n${history.map((h) => `質問：${h.q}\n答え：${h.a}`).join('\n\n')}` : '',
    `\n## 質問\n${text}`
  ].join('\n');
  const stream = client.beta.messages.stream({
    model,
    max_tokens: 4000,
    betas: BETAS,
    fallbacks: 'default',
    system: [{type: 'text', text: ASK_SYSTEM}],
    output_config: {format: {type: 'json_schema', schema: ASK_SCHEMA}, effort: 'low'},
    messages: [{role: 'user', content}]
  });
  const msg = await stream.finalMessage();
  repo.addAiUsage({model, usage: msg.usage ?? {}, cost: costOf(model, msg.usage ?? {}), purpose: 'ask'});
  if (msg.stop_reason === 'refusal') throw err('refusal', 'この質問には答えられませんでした');
  const raw = (msg.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let answer;
  try {
    answer = String(JSON.parse(raw).answer ?? '').trim();
  } catch {
    answer = '';
  }
  if (!answer) throw err('quiz-bad-json', '答えを受け取れませんでした。もう一度送ってください');
  log(`[quiz] 質問に答えました：問題 ${questionId}`);
  return {answer};
}
