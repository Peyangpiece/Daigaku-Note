// 文字隠しマーカーからの一括生成（SPEC §11.3）：AI も API キーも使わず、回の資料に引いた文字隠しマーカーの語を穴埋めにする。
// 問題の作り方は shared/cloze.js（副作用なし）。ここは資料の文字を読み、クイズとして保存する
import {ulid} from '../../shared/ids.js';
import {MIN_MASKS, clozeFromMasks} from '../../shared/cloze.js';
import {collectText} from './extract.js';
import {annoKey} from '../pdf-save.js';

const err = (code, message) => Object.assign(new Error(message), {code});

/** 回の資料の文字隠しマーカー（隠した語のあるもの）。戻りは [{material, text, page}] */
export function masksOfRound(repo, materials) {
  const out = [];
  for (const m of materials)
    for (const a of repo.listAnnotations(annoKey(m)))
      if (a.kind === 'mask' && String(a.body ?? '').trim()) out.push({material: m, text: a.body, page: a.page});
  return out;
}

/** 回の穴埋めクイズを作って保存する。同じ回のクイズがあれば版を上げる（前の版の記録は残る）。戻りは {quizId, count, masks} */
export async function clozeQuizFromMasks({repo, roundId, log = () => {}}) {
  const round = repo.get('round', roundId) ?? err('quiz-no-round', '回が見つかりません');
  if (round instanceof Error) throw round;
  const course = repo.get('course', round.course_id);
  const materials = repo.listMaterials(course.id).filter((m) => m.round_id === round.id);
  const masks = masksOfRound(repo, materials);
  if (masks.length < MIN_MASKS)
    throw err(
      'cloze-few',
      `文字隠しマーカーが ${MIN_MASKS} つ以上ある回で作れます（この回は ${masks.length} つ）。PDF の編集画面で、覚えたい語をマーカーで隠してください`
    );
  const text = await collectText(materials, {
    readCached: (sha) => repo.readMaterialText(sha),
    saveCache: (sha, method, pages) => repo.saveMaterialText(sha, method, pages)
  });
  const pageText = (m, page) =>
    text.docs.find((d) => d.sha256 === m.sha256)?.pages.find((p) => p.page === page)?.text ?? '';
  const qs = clozeFromMasks(
    masks.map(({material: m, text: t, page}) => ({text: t, page, file: m.name, context: pageText(m, page)}))
  );
  if (!qs.length)
    throw err(
      'cloze-none',
      '穴埋めを作れませんでした（隠した語が資料の文字と合わないか、違う語が 4 つに満たないか、文が短すぎます）'
    );
  const prev = repo.latestQuiz(round.id);
  const quizId = ulid();
  const base = course.kind === 'folder' ? course.name : round.title_user || round.title || `第 ${round.number} 回`;
  repo.transaction(() => {
    repo.insertQuiz({
      id: quizId,
      round_id: round.id,
      version: (prev?.version ?? 0) + 1,
      title: `${base} の穴埋め`.slice(0, 80),
      status: 'ready',
      source_json: JSON.stringify({
        files: text.docs.map((d) => ({file: d.file, sha256: d.sha256, pages: d.pages.length})),
        skipped: text.skipped,
        masks: masks.length
      }),
      generated_by: 'cloze-local'
    });
    qs.forEach((x, i) =>
      repo.insertQuestion({
        quiz_id: quizId,
        seq: i + 1,
        type: x.type,
        q: x.q,
        a: x.a,
        o_json: JSON.stringify(x.o),
        n: x.n,
        src_sha256: materials.find((m) => m.name === x.src.file)?.sha256 ?? null,
        src_page: x.src.page,
        src_quote: x.src.quote,
        tags_json: '[]',
        difficulty: x.difficulty,
        review: null
      })
    );
  });
  log(`[quiz] 隠した箇所から穴埋めを作りました：回 ${round.id}・${qs.length} 問（マーカー ${masks.length}）`);
  return {quizId, count: qs.length, masks: masks.length};
}
