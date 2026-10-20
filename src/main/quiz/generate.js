// クイズの生成（SPEC §11.5）。回の資料の本文から、Claude API の構造化出力で問題を作り、検査・根拠照合・検算をして保存する。
// client は @anthropic-ai/sdk の Anthropic（テストでは同じ形の偽物を渡す）。呼ぶのはメインプロセスだけ。
import {ulid} from '../../shared/ids.js';
import {BLANK, DEFAULT_MIX, TAGS, TYPES, checkQuiz, findQuote, mixText, norm} from '../../shared/quiz.js';
import {collectText} from './extract.js';

export const MODELS = {
  'claude-sonnet-5-5': {label: '標準（Claude Sonnet 5.5）', input: 2, output: 10, cacheRead: 0.2},
  'claude-opus-5-5': {label: '高精度（Claude Opus 5.5）', input: 4, output: 20, cacheRead: 0.2}
};
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const BETAS = ['server-side-fallback-2026-07-01'];
const err = (code, message) => Object.assign(new Error(message), {code});

/** system（固定。キャッシュする。SPEC §18.3） */
export const SYSTEM = `あなたは大学生向け電子ノート「大学ノート」で、授業資料から復習クイズを作る係です。作った問題は本人が確かめて使います。

## 作り方
- 渡された資料本文だけを根拠にする。資料にないことは出さない。一般知識で補わない。
- 指定された問題数と種類の比率に従う。資料が短くて作れないときは少なくてよい（無理に水増ししない）。
- 用語の定義・概念の比較・手順・事例の意味を問う。資料の文をそのまま写した問いにしない（言い換える）。
- 誤答（o）は、ありがちな誤解・似た用語・逆の関係など、資料を読んでいれば消せるものにする。正解と同じもの・互いに同じものは入れない。
- 誤答は正解と同じ種類の言葉にする（用語なら用語、数値なら数値）。種類の違いで答えが分かってしまう誤答にしない。
- 正解だけが目立って長い・詳しい選択肢にしない（長さと書き方をそろえる）。
- 全問に解説（n）を付け、根拠のページを書く。解説は正解の理由がわかる 1〜3 文にする（「正解は〜」だけで終わらせない）。
- 各問に根拠（src）を付ける。file は資料の名前、page はページ番号、quote は資料本文からそのまま 20〜200 文字を写す（言い換えない）。
- 答えに自信がない問題は入れない。

## 種類（type）
- choice … 4 択。a に正解、o に誤答 3 つ。
- tf … 正誤。資料の記述を正しく、または 1 点だけ誤って言い換えた文を q にし、a は "○" か "×"。o は空の配列。
- cloze … 穴埋め。q に ${BLANK} を 1 つ入れ、a に入る語、o に誤答 3 つ。
- num … 数値で答える計算問題。資料に計算の式や数値例があるときだけ作る。a は数値だけ（単位や記号を付けない）、unit に単位（なければ空文字）。o は空の配列。
- card … 記述カード。q は「〜を説明せよ」の形、a は 1〜3 文の模範解答。o は空の配列。

## 書き方
- q は 300 文字まで、a と o は 120 文字まで、n は 400 文字まで。
- tags は 定義・比較・計算・事例・手順 から 0〜2 個。difficulty は 1（易）〜3（難）。
- 学籍番号・個人名は書かない。`;

/** 出力の JSON Schema（構造化出力。すべての項目を required にする） */
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'qs'],
  properties: {
    title: {type: 'string'},
    qs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'q', 'a', 'o', 'unit', 'n', 'src', 'tags', 'difficulty'],
        properties: {
          type: {type: 'string', enum: TYPES},
          q: {type: 'string'},
          a: {type: 'string'},
          o: {type: 'array', items: {type: 'string'}},
          unit: {type: 'string'},
          n: {type: 'string'},
          src: {
            type: 'object',
            additionalProperties: false,
            required: ['file', 'page', 'quote'],
            properties: {file: {type: 'string'}, page: {type: 'integer'}, quote: {type: 'string'}}
          },
          tags: {type: 'array', items: {type: 'string', enum: TAGS}},
          difficulty: {type: 'integer'}
        }
      }
    }
  }
};

const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answers'],
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['i', 'answer'],
        properties: {i: {type: 'integer'}, answer: {type: 'string'}}
      }
    }
  }
};

/** user（毎回）。資料の本文はページごとに [p.n] を付ける */
export function userPrompt({courseName, roundTitle, count, mix, hints, docs}) {
  const body = docs
    .map((d) => `### ${d.file}\n` + d.pages.map((p) => `[p.${p.page}] ${p.text}`).join('\n'))
    .join('\n\n');
  return [
    `授業：${courseName}`,
    `回：${roundTitle}`,
    `問題数と種類：${count} 問（${mixText(mix)}）。資料に計算の式や数値例があれば、choice のうち 1〜2 問を num にしてよい`,
    hints ? `本人のメモ（ヒント）：${hints}` : null,
    '',
    '## 資料本文（ページごと）',
    body
  ]
    .filter((x) => x !== null)
    .join('\n');
}

/** 使った額（ドル）。cache 書き込みは入力の 1.25 倍 */
export function costOf(model, usage) {
  const p = MODELS[model] ?? MODELS[DEFAULT_MODEL];
  const M = 1e6;
  return (
    ((usage.input_tokens ?? 0) * p.input +
      (usage.cache_creation_input_tokens ?? 0) * p.input * 1.25 +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
      (usage.output_tokens ?? 0) * p.output) /
    M
  );
}

/** API の失敗を、画面に出す言葉に（SPEC §11.8） */
export function friendlyAiError(e, Anthropic) {
  if (e?.code && /^(no-|limit|refusal|quiz-)/.test(e.code)) return e.message;
  if (Anthropic && e instanceof Anthropic.AuthenticationError) return 'API キーを確かめてください（設定 → クイズ）';
  if (Anthropic && e instanceof Anthropic.PermissionDeniedError)
    return 'この API キーではクイズを作れません（設定 → クイズ）';
  if (Anthropic && e instanceof Anthropic.RateLimitError) return '混んでいます。しばらくしてからもう一度作ってください';
  if (Anthropic && e instanceof Anthropic.APIConnectionError) return 'インターネットに接続してください';
  if (Anthropic && e instanceof Anthropic.InternalServerError)
    return 'AI の側で問題が起きています。しばらくしてからもう一度作ってください';
  return `クイズを作れませんでした：${String(e?.message ?? e).slice(0, 160)}`;
}

/**
 * 1 回分のクイズを作って保存する。戻りは {quizId, count, dropped, flagged, notes}
 * deps: {repo, client, log}。opts: {roundId, model, count, mix, limits:{perDay, perMonthUsd}, onProgress}
 */
export async function generateQuiz(deps, opts) {
  const {repo, client, log = () => {}} = deps;
  const {
    roundId,
    model = DEFAULT_MODEL,
    mix = DEFAULT_MIX,
    limits = {perDay: 30, perMonthUsd: 5},
    onProgress = () => {}
  } = opts;
  const count = Object.values(mix).reduce((a, b) => a + b, 0);
  const round =
    repo.get('round', roundId) ??
    (() => {
      throw err('quiz-no-round', '回が見つかりません');
    })();
  const course = repo.get('course', round.course_id);

  // 上限（SPEC §11.8）
  const u = repo.aiUsageSummary();
  if (u.today >= limits.perDay)
    throw err('limit-day', `今日のクイズ作成の上限（${limits.perDay} 回）に達しました。明日また作れます`);
  if (u.monthUsd >= limits.perMonthUsd)
    throw err(
      'limit-month',
      `今月の費用の上限（$${limits.perMonthUsd}）に達しました。上限は設定 → クイズ で変えられます`
    );

  onProgress('資料の文字を読んでいます…');
  const materials = repo.listMaterials(course.id).filter((m) => m.round_id === round.id);
  const text = await collectText(materials, {
    readCached: (sha) => repo.readMaterialText(sha),
    saveCache: (sha, method, pages) => repo.saveMaterialText(sha, method, pages)
  });
  if (!text.docs.length) {
    const why = text.skipped.length ? `（${text.skipped.map((s) => `${s.name}：${s.reason}`).join('、')}）` : '';
    throw err('no-text', `この回には、文字を読める資料がありません${why}`);
  }
  const notes = [];
  if (text.truncatedAt)
    notes.push(`資料が長いため、${text.truncatedAt.file} の p.${text.truncatedAt.page} 以降は使っていません`);
  const roundTitle =
    `${round.number === 0 ? 'その他' : `第${round.number}回`} ${round.title_user || round.title || ''}`.trim();
  const hints = repo.roundNote(round.id)?.body?.trim() || '';

  const call = async (messages, schema, purpose, maxTokens = 32000) => {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: maxTokens,
      betas: BETAS,
      fallbacks: 'default',
      system: [{type: 'text', text: SYSTEM, cache_control: {type: 'ephemeral'}}],
      output_config: {format: {type: 'json_schema', schema}},
      messages
    });
    const msg = await stream.finalMessage();
    repo.addAiUsage({model, usage: msg.usage ?? {}, cost: costOf(model, msg.usage ?? {}), purpose});
    return msg;
  };
  const jsonOf = (msg) => {
    const t = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    try {
      return JSON.parse(t);
    } catch {
      throw err('quiz-bad-json', 'AI の返事を読み取れませんでした。もう一度作ってください');
    }
  };

  onProgress('問題を作っています…（1〜2 分）');
  let want = count;
  let currentMix = mix;
  let messages = [
    {
      role: 'user',
      content: userPrompt({courseName: course.name, roundTitle, count: want, mix: currentMix, hints, docs: text.docs})
    }
  ];
  let msg = await call(messages, SCHEMA, 'generate');
  if (msg.stop_reason === 'refusal') throw err('refusal', 'この資料からはクイズを作れませんでした');
  if (msg.stop_reason === 'max_tokens') {
    // 長すぎた：問題数を半分にして 1 回だけやり直す
    want = Math.max(1, Math.floor(count / 2));
    currentMix = halveMix(mix);
    messages = [
      {
        role: 'user',
        content: userPrompt({courseName: course.name, roundTitle, count: want, mix: currentMix, hints, docs: text.docs})
      }
    ];
    msg = await call(messages, SCHEMA, 'generate');
    if (msg.stop_reason !== 'end_turn')
      throw err('quiz-too-long', '資料が長すぎて作れませんでした。資料を分けてください');
  }
  let out = jsonOf(msg);
  const pageCount = Object.fromEntries(text.docs.map((d) => [d.file, Math.max(...d.pages.map((p) => p.page))]));
  let problems = checkQuiz(out.qs ?? [], {pageCount});
  if (problems.length) {
    // 形の不備：番号と理由を伝えて、全体を 1 回だけ出し直してもらう
    onProgress('問題の形を直してもらっています…');
    const list = problems.map((p) => `- ${p.index + 1} 問目：${p.errors.join('／')}`).join('\n');
    messages = [
      ...messages,
      {role: 'assistant', content: msg.content},
      {role: 'user', content: `次の問題に不備がありました。直した全体をもう一度出してください。\n${list}`}
    ];
    const fixed = await call(messages, SCHEMA, 'fix');
    if (fixed.stop_reason === 'end_turn') {
      out = jsonOf(fixed);
      problems = checkQuiz(out.qs ?? [], {pageCount});
    }
  }
  const bad = new Set(problems.map((p) => p.index));
  // 根拠照合：引用が本文にない問題は捨てる
  const kept = [];
  let dropped = bad.size;
  (out.qs ?? []).forEach((x, i) => {
    if (bad.has(i)) return;
    const at = findQuote(x.src.quote, text.docs);
    if (!at) {
      dropped++;
      log(`[quiz] 根拠が本文にないので捨てました：${x.q.slice(0, 40)}`);
      return;
    }
    kept.push({...x, src: {...x.src, ...at}});
  });
  if (!kept.length) throw err('quiz-empty', '資料に合う問題を作れませんでした。もう一度作るか、資料を確かめてください');

  // 検算：答えを見せず、選択肢を五十音順に並べて解かせる。不一致に「要確認」
  onProgress('答えを確かめています…');
  const checkable = kept.map((x, i) => ({x, i})).filter(({x}) => x.type !== 'card');
  const mismatched = new Set();
  if (checkable.length) {
    const lines = checkable.map(({x, i}) => {
      const opts =
        x.type === 'tf'
          ? '○ / ×'
          : x.type === 'num'
            ? `数値で答える${x.unit ? `（単位：${x.unit}）` : ''}`
            : [x.a, ...x.o].sort((a, b) => a.localeCompare(b, 'ja')).join(' / ');
      return `${i}. ${x.q}\n   選択肢：${opts}`;
    });
    const content = `${userPrompt({courseName: course.name, roundTitle, count: want, mix: currentMix, hints: '', docs: text.docs})}\n\n## 解いてください\n資料だけを根拠に、次の問題の答えを選択肢の文字そのまま（数値の問題は数値だけ）で返してください。i は問題の番号です。\n${lines.join('\n')}`;
    try {
      const check = await call([{role: 'user', content}], CHECK_SCHEMA, 'verify', 8000);
      if (check.stop_reason === 'end_turn') {
        const answers = new Map((jsonOf(check).answers ?? []).map((r) => [r.i, r.answer]));
        const {grade} = await import('../../shared/quiz.js');
        for (const {x, i} of checkable) if (!answers.has(i) || !grade(x, answers.get(i))) mismatched.add(i);
      }
    } catch (e) {
      log(`[quiz] 検算に失敗（問題は保存します）：${e.message}`);
    }
  }

  // 保存：同じ回にクイズがあれば版を上げる
  const prev = repo.latestQuiz(round.id);
  const quizId = ulid();
  repo.transaction(() => {
    repo.insertQuiz({
      id: quizId,
      round_id: round.id,
      version: (prev?.version ?? 0) + 1,
      title: String(out.title || roundTitle).slice(0, 80),
      status: 'ready',
      source_json: JSON.stringify({
        files: text.docs.map((d) => ({file: d.file, sha256: d.sha256, pages: d.pages.length})),
        skipped: text.skipped,
        notes,
        model
      }),
      generated_by: model
    });
    kept.forEach((x, i) =>
      repo.insertQuestion({
        quiz_id: quizId,
        seq: i + 1,
        type: x.type,
        q: x.q,
        a: x.a,
        o_json: JSON.stringify(x.type === 'num' ? {unit: x.unit ?? ''} : (x.o ?? [])),
        n: x.n,
        src_sha256: text.docs.find((d) => d.file === x.src.file)?.sha256 ?? null,
        src_page: x.src.page,
        src_quote: x.src.quote,
        tags_json: JSON.stringify((x.tags ?? []).filter((t) => TAGS.includes(t)).slice(0, 2)),
        difficulty: Math.min(3, Math.max(1, x.difficulty || 2)),
        review: mismatched.has(i) ? 'mismatch' : null
      })
    );
  });
  if (kept.length < count)
    notes.push(
      dropped
        ? `資料に合わない問題 ${dropped} 問を除いたため ${kept.length} 問です`
        : `資料が短いため ${kept.length} 問です`
    );
  return {quizId, count: kept.length, dropped, flagged: mismatched.size, notes};
}

function halveMix(mix) {
  const out = {};
  for (const [k, n] of Object.entries(mix)) out[k] = n > 0 ? Math.max(k === 'choice' ? 1 : 0, Math.floor(n / 2)) : 0;
  return out;
}

/** 本文が同じかを比べる（重複問題の確認などに使う） */
export const sameText = (a, b) => norm(a) === norm(b);
