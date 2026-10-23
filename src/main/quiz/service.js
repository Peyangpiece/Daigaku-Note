// クイズの窓口（SPEC §11）。生成は 1 件ずつ（同期のジョブとは別の列。同期中でも待たずに作る）、答えの記録と復習の段階、API キー。
import {DEFAULT_MIX, TYPES, grade} from '../../shared/quiz.js';
import {schedule, reviewQueue, nextDue} from '../../shared/srs.js';
import {DEFAULT_MODEL, MODELS, friendlyAiError, generateQuiz} from './generate.js';

const KEY = 'ai:anthropic';
const err = (message) => Object.assign(new Error(message), {code: 'quiz-service'});

export function createQuizService({repo, secrets, log = () => {}, notify = () => {}, anthropic = null}) {
  const loadSdk = async () => anthropic ?? (await import('@anthropic-ai/sdk')).default;
  const state = new Map(); // roundId -> {state: 'queued'|'running'|'failed', message}
  let chain = Promise.resolve();

  const settings = () => ({
    model: MODELS[repo.getSetting('quiz.model')] ? repo.getSetting('quiz.model') : DEFAULT_MODEL,
    mix: {...DEFAULT_MIX, ...(repo.getSetting('quiz.mix') ?? {})},
    perDay: repo.getSetting('quiz.perDay', 30),
    perMonthUsd: repo.getSetting('quiz.perMonthUsd', 5)
  });

  async function client() {
    const key = await secrets.get(KEY);
    if (!key?.apiKey) throw err('クイズを作るには Claude API キーが必要です（設定 → クイズ）');
    const Anthropic = await loadSdk();
    return new Anthropic({apiKey: key.apiKey});
  }

  function setState(roundId, s) {
    if (s) state.set(roundId, s);
    else state.delete(roundId);
    notify('quiz.progress', {roundId, ...(s ?? {state: 'done'})});
  }

  /** 回のクイズを作る（列に積む）。戻りは積んだ回の数 */
  function generate(roundIds) {
    let queued = 0;
    for (const roundId of roundIds) {
      if (state.get(roundId)?.state === 'queued' || state.get(roundId)?.state === 'running') continue;
      setState(roundId, {state: 'queued', message: '順番を待っています…'});
      queued++;
      chain = chain.then(() => runOne(roundId));
    }
    return queued;
  }

  async function runOne(roundId) {
    const s = settings();
    setState(roundId, {state: 'running', message: '準備しています…'});
    try {
      const c = await client();
      const r = await generateQuiz(
        {repo, client: c, log},
        {
          roundId,
          model: s.model,
          mix: s.mix,
          limits: {perDay: s.perDay, perMonthUsd: s.perMonthUsd},
          onProgress: (m) => setState(roundId, {state: 'running', message: m})
        }
      );
      log(`[quiz] 作りました：回 ${roundId}・${r.count} 問（捨てた ${r.dropped}・要確認 ${r.flagged}）`);
      setState(roundId, null);
      notify('quiz.finished', {roundId, ok: true, ...r});
      notify('state.changed', {kind: 'quiz'});
    } catch (e) {
      const message = friendlyAiError(e, await loadSdk().catch(() => null));
      log(`[quiz] 作れませんでした：回 ${roundId}：${e.code ?? ''} ${e.message}`);
      setState(roundId, {state: 'failed', message});
      notify('quiz.finished', {roundId, ok: false, message, detail: String(e?.message ?? e).slice(0, 300)});
      notify('state.changed', {kind: 'quiz'});
    }
  }

  /** API キーを確かめて保存する（費用のかからないモデル情報の取得で確かめる） */
  async function setKey(apiKey) {
    const k = String(apiKey ?? '').trim();
    if (!/^sk-ant-[\w-]{20,}$/.test(k)) throw err('API キーの形ではありません（sk-ant- で始まる文字列）');
    if (!(await secrets.available())) throw err('このパソコンでは暗号化して保存できないため、API キーは保存しません');
    const Anthropic = await loadSdk();
    try {
      await new Anthropic({apiKey: k, maxRetries: 1}).models.retrieve(settings().model);
    } catch (e) {
      throw err(friendlyAiError(e, Anthropic));
    }
    await secrets.set(KEY, {apiKey: k});
    return {ok: true, last4: k.slice(-4)};
  }

  async function keyInfo() {
    const key = await secrets.get(KEY);
    return key?.apiKey ? {set: true, last4: key.apiKey.slice(-4)} : {set: false};
  }

  /** 答えを記録し、復習の段階を進める。戻りは {ok, a}（正解を返して画面に出す） */
  function answer({questionId, answer, mode = 'quiz', seconds = null}) {
    const q =
      repo.get('question', questionId) ??
      (() => {
        throw err('問題が見つかりません');
      })();
    const ok = grade(q, answer);
    repo.addAttempt({
      question_id: q.id,
      mode,
      ok,
      answer: typeof answer === 'string' ? answer.slice(0, 200) : String(answer),
      seconds
    });
    if (q.type !== 'card' && !q.report_reason) {
      const row = repo.db.prepare('SELECT * FROM srs WHERE question_id = ?').get(q.id);
      const entry = row
        ? {s: row.s, due: Date.parse(row.due), at: Date.parse(row.at), c: row.c, lapses: row.lapses}
        : null;
      const next = schedule(entry, ok, Date.now(), {two: q.type === 'tf'});
      if (next !== entry) repo.saveSrs(q.id, next);
    }
    return {ok, a: q.a};
  }

  /** 今日の復習（全授業。1 日 30 問まで） */
  function review({max = 30} = {}) {
    const now = Date.now();
    const items = repo.reviewCandidates().map((q) => ({
      ...q,
      entry: {s: q.srs_s, due: Date.parse(q.srs_due), at: Date.parse(q.srs_at), c: q.srs_c, lapses: q.srs_lapses}
    }));
    const {items: today, rest} = reviewQueue(items, now, max);
    return {questions: today.map(({entry: _entry, ...q}) => q), rest, next: today.length ? null : nextDue(items, now)};
  }

  function status() {
    const s = settings();
    return {
      ...repo.aiUsageSummary(),
      ...s,
      models: Object.fromEntries(Object.entries(MODELS).map(([id, m]) => [id, m.label])),
      types: TYPES,
      generating: Object.fromEntries(state)
    };
  }

  return {generate, setKey, keyInfo, removeKey: () => secrets.remove(KEY), answer, review, status, settings};
}
