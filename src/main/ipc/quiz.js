// IPC の窓口：クイズ（quiz.*・question.*）。index.js が register を呼ぶ（SPEC §12・DESIGN-M0 §4）
import {checkQuestion} from '../../shared/quiz.js';
import {AI_CONSENT_VERSION} from '../../shared/policy.js';
import {claimQuiz} from '../../shared/points.js';
import {clozeQuizFromMasks} from '../quiz/cloze-local.js';
import {str, id, bad, ids} from './common.js';

export function register({handle, repo, log, quiz}) {
  const parseQ = ({o_json, tags_json, ...q}) => {
    const o = JSON.parse(o_json ?? '[]');
    return {
      ...q,
      o: Array.isArray(o) ? o : [],
      unit: Array.isArray(o) ? '' : (o.unit ?? ''),
      tags: JSON.parse(tags_json ?? '[]')
    };
  };

  // API キーの保存には、AI に送るものへの同意（shared/policy.js の版）が要る。同意は版と日時で記録し、設定で見返せる・取り消せる
  handle('quiz.setKey', async ({apiKey, consent}) => {
    if (consent !== true) bad('AI に送る内容への同意が要ります');
    const r = await quiz.setKey(str(apiKey, 300) ?? bad('API キーを入れてください'));
    repo.setSetting('quiz.consent', {version: AI_CONSENT_VERSION, at: new Date().toISOString()});
    return r;
  });

  handle('quiz.removeKey', async () => {
    await quiz.removeKey();
    repo.setSetting('quiz.consent', null); // 取り消し：キーといっしょに同意も消す
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

  handle('quiz.generate', ({roundIds}) => {
    if (repo.getSetting('quiz.consent', null)?.version !== AI_CONSENT_VERSION)
      bad('AI に送る内容の説明が変わりました。設定 → クイズ で内容を確かめて同意し直してください');
    return {queued: quiz.generate(ids(roundIds))};
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
