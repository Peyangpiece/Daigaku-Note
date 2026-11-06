// IPC の窓口：クイズ（quiz.*・question.*）。index.js が register を呼ぶ（SPEC §12・DESIGN-M0 §4）
import {checkQuestion} from '../../shared/quiz.js';
import {AI_CONSENT_VERSION} from '../../shared/policy.js';
import {claimQuiz} from '../../shared/points.js';
import {clozeQuizFromMasks} from '../quiz/cloze-local.js';
import {str, id, bad, ids} from './common.js';

export function register({handle, repo, log, quiz}) {
  const parseQ = ({o_json, tags_json, why_json, ...q}) => {
    const o = JSON.parse(o_json ?? '[]');
    const why = JSON.parse(why_json ?? '[]');
    return {
      ...q,
      why: Array.isArray(why) ? why : [], // 誤答ごとの「なぜ違うか」（o と同じ順。前の版の問題は空）
      o: Array.isArray(o) ? o : [],
      unit: Array.isArray(o) ? '' : (o.unit ?? ''),
      tags: JSON.parse(tags_json ?? '[]')
    };
  };

  // API キーの保存には、AI に送るものへの同意（shared/policy.js の版）が要る。同意は版と日時で記録し、設定で見返せる・取り消せる
  handle('quiz.setKey', async ({apiKey, consent}) => {
    if (consent !== true) bad('AI に送る内容への同意が要ります');
    const r = await quiz.setKey(str(apiKey, 300) ?? bad('API キーを入れてください'));
    quiz.setEngine('api'); // キーを入れたら、作る AI も API キーにする
    repo.setSetting('quiz.consent', {version: AI_CONSENT_VERSION, at: new Date().toISOString(), engine: 'api'});
    return r;
  });

  handle('quiz.removeKey', async () => {
    await quiz.removeKey();
    // 取り消し：API キーで作っていたなら、キーといっしょに同意も消す（Claude Code・Codex への同意は残す）
    if (quiz.settings().engine === 'api') repo.setSetting('quiz.consent', null);
    return {ok: true};
  });

  // このパソコンの Claude Code・Codex を探す（設定 → クイズ を開いたときと「探す」）
  handle('quiz.detectCli', () => quiz.detectCli());

  // クイズを作る AI を選ぶ。送り先（Claude API・Claude Code は Anthropic、Codex は OpenAI）への同意といっしょに記録する
  handle('quiz.setEngine', ({engine, consent}) => {
    const e = str(engine, 20) ?? bad('AI の種類が不正です');
    if (consent !== true) bad('AI に送る内容への同意が要ります');
    quiz.setEngine(e);
    repo.setSetting('quiz.consent', {version: AI_CONSENT_VERSION, at: new Date().toISOString(), engine: e});
    return {ok: true};
  });

  handle('quiz.settings', ({patch}) => {
    if (patch.model !== undefined) repo.setSetting('quiz.model', str(patch.model, 40) ?? bad('モデルが不正です'));
    if (patch.mix && typeof patch.mix === 'object') {
      const mix = {};
      for (const t of quiz.status().types)
        mix[t] = Math.max(0, Math.min(30, Number.isInteger(patch.mix[t]) ? patch.mix[t] : 0));
      const total = Object.values(mix).reduce((a, b) => a + b, 0);
      if (total < 1 || total > 30) bad('問題数は 1〜30 問にしてください');
      repo.setSetting('quiz.mix', mix);
    }
    if (patch.perDay !== undefined)
      repo.setSetting('quiz.perDay', Math.max(1, Math.min(200, Number(patch.perDay) || 30)));
    if (patch.perMonthUsd !== undefined)
      repo.setSetting('quiz.perMonthUsd', Math.max(0.5, Math.min(500, Number(patch.perMonthUsd) || 5)));
    return {ok: true};
  });

  // AI に送る前に、選んでいる AI への今の版の同意があるか（前の版の記録には engine がない＝API キー）
  const needConsent = () => {
    const consent = repo.getSetting('quiz.consent', null);
    if (consent?.version !== AI_CONSENT_VERSION || (consent.engine ?? 'api') !== quiz.settings().engine)
      bad('AI に送る内容への同意が必要です（設定 → クイズ）');
  };

  handle('quiz.generate', ({roundIds}) => {
    needConsent();
    return {queued: quiz.generate(ids(roundIds))};
  });

  // 答えの画面で、その問題について質問する。history はそれまでのやりとり（新しい 6 つまで）
  handle('quiz.ask', ({questionId, text, mine, history}) => {
    needConsent();
    const qid = id(questionId) ?? bad('問題が不正です');
    const t =
      (str(String(text ?? '').trim(), 500) ?? bad('質問が長すぎます（500 文字まで）')) || bad('質問を入れてください');
    const h = (Array.isArray(history) ? history.slice(-6) : []).map((x) => ({
      q: String(x?.q ?? '').slice(0, 500),
      a: String(x?.a ?? '').slice(0, 2000)
    }));
    return quiz.ask({questionId: qid, text: t, mine: mine == null ? null : String(mine).slice(0, 200), history: h});
  });

  // 文字隠しマーカーからの穴埋め（§11.3）：AI も API キーも使わない。同じ回のクイズがあれば版を上げる
  handle('quiz.fromMasks', ({roundId}) =>
    clozeQuizFromMasks({repo, roundId: id(roundId) ?? bad('この回は見つかりませんでした'), log: log.info})
  );

  handle('quiz.questions', ({quizIds, courseId}) =>
    repo
      .listQuestions(
        quizIds ? {quizIds: ids(quizIds)} : {courseId: id(courseId) ?? bad('この授業は見つかりませんでした')}
      )
      .map(parseQ)
  );

  handle('quiz.answer', ({questionId, answer, mode, seconds}) => {
    const qid = id(questionId) ?? bad('問題が不正です');
    const m = ['quiz', 'review', 'retry', 'exam', 'card'].includes(mode) ? mode : 'quiz';
    const r = quiz.answer({
      questionId: qid,
      answer: typeof answer === 'boolean' ? answer : (str(String(answer ?? ''), 300) ?? ''),
      mode: m,
      seconds: Number.isFinite(seconds) ? Math.round(seconds) : null
    });
    // 正解でポイント（単語カードの「できた」は自分で付けるので数えない。同じ問題は 1 日 1 回まで）
    if (!r.ok || m === 'card') return r;
    const got = claimQuiz(repo.getSetting('points', null), qid);
    if (got.gained) repo.setSetting('points', got.points);
    return {...r, points: got.gained, balance: got.points.balance};
  });

  handle('quiz.review', () => {
    const r = quiz.review();
    return {...r, questions: r.questions.map(parseQ)};
  });

  handle('question.update', ({questionId, patch}) => {
    const qid = id(questionId) ?? bad('問題が不正です');
    const q = repo.get('question', qid) ?? bad('問題がありません');
    const allowed = {};
    for (const k of ['q', 'a', 'n'])
      if (typeof patch[k] === 'string')
        allowed[k] = str(patch[k].trim(), k === 'n' ? 400 : k === 'q' ? 300 : 120) ?? bad(`${k} が長すぎます`);
    if (Array.isArray(patch.o))
      allowed.o_json = JSON.stringify(
        patch.o.slice(0, 3).map((x) => str(String(x).trim(), 120) ?? bad('誤答が長すぎます'))
      );
    // 誤答ごとの「なぜ違うか」（o と同じ順。v0.17.5 で編集できるように）
    if (Array.isArray(patch.why))
      allowed.why_json = JSON.stringify(
        patch.why.slice(0, 3).map((x) => str(String(x ?? '').trim(), 200) ?? bad('違う理由が長すぎます'))
      );
    if (patch.reviewed === true) allowed.review = null;
    if (typeof patch.report === 'string') allowed.report_reason = str(patch.report, 60) || null;
    if (patch.report === null) allowed.report_reason = null;
    if (patch.deleted === true) allowed.deleted = 1;
    const next = {...q, ...allowed, o: allowed.o_json ? JSON.parse(allowed.o_json) : JSON.parse(q.o_json ?? '[]')};
    if (allowed.q || allowed.a || allowed.o_json) {
      const errs = checkQuestion({
        ...next,
        o: Array.isArray(next.o) ? next.o : [],
        src: {quote: 'x'.repeat(20)}
      }).filter((e) => !/引用/.test(e));
      if (errs.length) bad(errs.join('／'));
      allowed.review = null; // 本人が直した問題は「要確認」を外す
    }
    return parseQ(repo.updateQuestion(qid, allowed));
  });
}
