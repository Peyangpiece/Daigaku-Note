import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/main/db/db.js';
import {Repo} from '../src/main/db/repo.js';
import {checkQuestion, checkQuiz, choicesOf, findQuote, grade, parseNumber} from '../src/shared/quiz.js';
import {scrub, pptxPages, unzip} from '../src/main/quiz/extract.js';
import {SCHEMA, costOf, generateQuiz} from '../src/main/quiz/generate.js';
import {createQuizService} from '../src/main/quiz/service.js';

const TEXT = `原価企画とは、製品の企画・設計段階において目標原価を設定し、それを達成するための活動である。
目標原価は、予定販売価格から目標利益を差し引いて求める。予定販売価格が 1,000 円、目標利益が 200 円なら目標原価は 800 円である。
原価維持とは、量産段階で標準原価を守る活動であり、原価改善は量産段階で原価を引き下げる活動である。`;

const Q = {
  choice: {
    type: 'choice',
    q: '目標原価を設定する段階として最も適当なものはどれか。',
    a: '企画・設計段階',
    o: ['量産段階', '販売後の段階', '決算の段階'],
    unit: '',
    n: '原価企画は企画・設計段階で目標原価を設定する活動である（p.1）。',
    src: {file: '第3回.txt', page: 1, quote: '製品の企画・設計段階において目標原価を設定し'},
    tags: ['定義'],
    difficulty: 1
  },
  tf: {
    type: 'tf',
    q: '原価維持は量産段階で原価を引き下げる活動である。',
    a: '×',
    o: [],
    unit: '',
    n: '引き下げるのは原価改善。原価維持は標準原価を守る活動（p.1）。',
    src: {file: '第3回.txt', page: 1, quote: '原価維持とは、量産段階で標準原価を守る活動であり'},
    tags: ['比較'],
    difficulty: 2
  },
  num: {
    type: 'num',
    q: '予定販売価格 1,000 円・目標利益 200 円のときの目標原価は何円か。',
    a: '800',
    o: [],
    unit: '円',
    n: '目標原価＝予定販売価格−目標利益＝1,000−200＝800 円（p.1）。',
    src: {file: '第3回.txt', page: 1, quote: '目標原価は、予定販売価格から目標利益を差し引いて求める。'},
    tags: ['計算'],
    difficulty: 2
  },
  card: {
    type: 'card',
    q: '原価企画と原価改善の違いを説明せよ。',
    a: '原価企画は企画・設計段階で目標原価を作り込み、原価改善は量産段階で原価を引き下げる。',
    o: [],
    unit: '',
    n: '段階と目的の違いを押さえる（p.1）。資料の定義を参照。',
    src: {file: '第3回.txt', page: 1, quote: '原価改善は量産段階で原価を引き下げる活動である'},
    tags: ['比較'],
    difficulty: 2
  },
  fake: {
    type: 'choice',
    q: '資料にない問いの例として、ABC 分析の目的はどれか。',
    a: '重点管理',
    o: ['全数管理', '分散管理', '無管理'],
    unit: '',
    n: '資料に書かれていない内容なので捨てられるべき問題。',
    src: {file: '第3回.txt', page: 1, quote: 'ABC分析は在庫を重要度で分類する手法である'},
    tags: [],
    difficulty: 1
  }
};

test('問題の検査：種類ごとの決まり・重複・引用の長さ', () => {
  for (const k of ['choice', 'tf', 'num', 'card']) assert.deepEqual(checkQuestion(Q[k]), [], k);
  assert.match(checkQuestion({...Q.choice, o: ['量産段階', '量産段階', 'x']}).join(), /同じ/);
  assert.match(
    checkQuestion({...Q.choice, o: ['企画・設計段階', 'a', 'b']}).join(),
    /同じ/,
    '正解と誤答が同じ（全角半角・空白の違いも）'
  );
  assert.match(checkQuestion({...Q.tf, a: '正しい'}).join(), /○/);
  assert.match(checkQuestion({...Q.choice, type: 'cloze'}).join(), /\[＿\]/);
  assert.match(checkQuestion({...Q.num, a: '約800'}).join(), /数値/);
  assert.match(checkQuestion({...Q.choice, n: '正解は企画。'}).join(), /短すぎ/);
  assert.match(checkQuestion({...Q.choice, src: {...Q.choice.src, quote: '短い'}}).join(), /引用/);
  assert.match(
    checkQuestion(Q.choice, {pageCount: {'第3回.txt': 1}}).join() +
      checkQuestion({...Q.choice, src: {...Q.choice.src, page: 9}}, {pageCount: {'第3回.txt': 1}}).join(),
    /範囲外/
  );
  assert.deepEqual(
    checkQuiz([Q.choice, {...Q.choice}]).map((p) => p.index),
    [1],
    '同じ問いの重複'
  );
});

test('根拠の照合：空白・全角半角・改行を無視して部分一致。本文にない引用は null', () => {
  const docs = [{file: '第3回.txt', pages: [{page: 1, text: TEXT}]}];
  assert.deepEqual(findQuote('目標原価は、予定販売価格から目標利益を 差し引いて求める。', docs), {
    file: '第3回.txt',
    page: 1
  });
  assert.equal(findQuote(Q.fake.src.quote, docs), null);
  const split = [
    {
      file: 'a',
      pages: [
        {page: 1, text: 'あいうえおかきくけこ'},
        {page: 2, text: 'さしすせそたちつてと'}
      ]
    }
  ];
  assert.deepEqual(findQuote('かきくけこさしすせそ', split), {file: 'a', page: 1}, 'ページをまたぐ引用');
});

test('採点：数値は全角・カンマ・単位を許す。選択肢の並びは seed で決まる', () => {
  assert.equal(grade(Q.num, '８００'), true);
  assert.equal(grade(Q.num, '800円'), true);
  assert.equal(grade(Q.num, '1,000'), false);
  assert.equal(grade({...Q.num, a: '0.125'}, '0.1250'), true);
  assert.equal(parseNumber('－３．５'), -3.5);
  assert.equal(grade(Q.choice, ' 企画・設計段階 '), true);
  assert.equal(grade(Q.card, true), true);
  assert.equal(grade(Q.card, 'true'), false, 'カードは自己採点（true）だけ');
  assert.deepEqual(choicesOf(Q.choice, 7), choicesOf(Q.choice, 7));
  assert.deepEqual([...choicesOf(Q.choice, 7)].sort(), [Q.choice.a, ...Q.choice.o].sort());
  assert.ok(
    [1, 2, 3, 4, 5, 6].some((s) => choicesOf(Q.choice, s)[0] !== choicesOf(Q.choice, 7)[0]),
    'seed が変われば並びが変わる'
  );
});

test('本文：ID・メール・電話を消す。pptx（zip）を読める', () => {
  assert.equal(
    scrub('学籍 s1234567 連絡 taro@u.ac.jp 052-123-4567 番号 12345678'),
    '学籍 [ID] 連絡 [メール] [電話] 番号 [ID]'
  );
  // 格納（無圧縮）の最小 zip を組み立てる
  const files = {
    'ppt/slides/slide1.xml': '<p:sld><a:p><a:t>原価企画</a:t></a:p><a:p><a:t>目標原価 &amp; 利益</a:t></a:p></p:sld>',
    'ppt/notesSlides/notesSlide1.xml': '<a:p><a:t>試験に出る</a:t></a:p>'
  };
  assert.deepEqual(pptxPages(storedZip(files)), [{page: 1, text: '原価企画\n目標原価 & 利益\n（ノート）試験に出る'}]);
  assert.deepEqual(Object.keys(unzip(storedZip(files), () => true)).sort(), Object.keys(files).sort());
});

function storedZip(files) {
  const parts = [];
  const central = [];
  let off = 0;
  for (const [name, body] of Object.entries(files)) {
    const n = Buffer.from(name);
    const d = Buffer.from(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(d.length, 18);
    local.writeUInt32LE(d.length, 22);
    local.writeUInt16LE(n.length, 26);
    parts.push(local, n, d);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt32LE(d.length, 20);
    c.writeUInt32LE(d.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(off, 42);
    central.push(c, n);
    off += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** 偽の Claude：replies を順に返す（{stop_reason, json}）。受け取った要求を calls に残す */
function fakeClient(replies) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        stream(params) {
          calls.push(params);
          const r = replies.shift() ?? {stop_reason: 'end_turn', json: {answers: []}};
          return {
            finalMessage: async () => ({
              stop_reason: r.stop_reason ?? 'end_turn',
              content: [{type: 'text', text: JSON.stringify(r.json)}],
              usage: {
                input_tokens: 1000,
                output_tokens: 500,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 2000
              }
            })
          };
        }
      }
    }
  };
}

async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dn-quiz-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  const term = repo.upsertTerm({
    id: '2026-fall',
    label: '秋学期',
    year: 2026,
    folder: '2026_秋学期',
    start_date: '2026-10-01',
    end_date: '2027-03-31',
    rounds: 15,
    holidays_json: '[]'
  });
  const conn = repo.createConnection({kind: 'recipe', connector_id: 'fake', label: 'LMS', base_url: 'https://lms'});
  const course = repo.createCourse({
    term_id: term.id,
    connection_id: conn.id,
    lms_id: '1',
    name: '管理会計Ⅱ',
    folder_name: '管理会計Ⅱ'
  });
  db.prepare(
    "INSERT INTO round (id, course_id, number, title, folder_name) VALUES ('r3', ?, 3, '原価企画', '第03回')"
  ).run(course.id);
  const file = path.join(dir, '第3回.txt');
  await writeFile(file, TEXT);
  db.prepare(
    "INSERT INTO material (id, course_id, round_id, round_from, url, name, path, sha256, size, status, source, downloaded_at) VALUES ('m1', ?, 'r3', 'lms', 'u', '第3回.txt', ?, 'sha-1', 1, 'ok', 'lms', 'x')"
  ).run(course.id, file);
  return {repo, course};
}

test('生成：構造化出力・根拠のない問題は捨てる・検算の不一致に要確認・使用量を記録', async (t) => {
  const {repo, course} = await setup(t);
  const client = fakeClient([
    {json: {title: '原価企画', qs: [Q.choice, Q.tf, Q.num, Q.card, Q.fake]}},
    {
      json: {
        answers: [
          {i: 0, answer: '企画・設計段階'},
          {i: 1, answer: '○'},
          {i: 2, answer: '800'}
        ]
      }
    } // tf を取り違えた
  ]);
  const r = await generateQuiz({repo, client}, {roundId: 'r3'});
  assert.equal(r.count, 4);
  assert.equal(r.dropped, 1, '資料にない引用の問題を捨てる');
  assert.equal(r.flagged, 1);
  // 問題が足りない理由は、クイズの記録にも残る（あとで見返せる）
  const saved = JSON.parse(repo.get('quiz', r.quizId).source_json);
  assert.ok(
    saved.notes.some((n) => /資料に合わない問題 1 問を除いた/.test(n)),
    '除いた理由を記録に残す'
  );
  const first = client.calls[0];
  assert.equal(first.model, 'claude-sonnet-5-5');
  assert.deepEqual(first.output_config.format, {type: 'json_schema', schema: SCHEMA});
  assert.equal(first.output_config.effort, 'medium');
  assert.equal(first.fallbacks, 'default');
  assert.deepEqual(first.system[0].cache_control, {type: 'ephemeral'});
  assert.match(first.messages[0].content, /\[p\.1\] 原価企画とは/);
  assert.match(
    client.calls[1].messages[0].content,
    /選択肢：企画・設計段階 \/ 決算の段階|選択肢：.*企画・設計段階/,
    '検算は選択肢を並べ替えて渡す'
  );
  assert.doesNotMatch(
    client.calls[1].messages[0].content.split('## 解いてください')[1],
    /a:|正解/,
    '検算に答えを見せない'
  );
  const qs = repo.listQuestions({courseId: course.id});
  assert.deepEqual(
    qs.map((q) => q.type),
    ['choice', 'tf', 'num', 'card']
  );
  assert.equal(qs.find((q) => q.type === 'tf').review, 'mismatch');
  assert.equal(JSON.parse(qs.find((q) => q.type === 'num').o_json).unit, '円');
  assert.equal(repo.readMaterialText('sha-1').length, 1, '本文を保存して次から読み直さない');
  const u = repo.aiUsageSummary();
  assert.equal(u.today, 1);
  assert.ok(
    Math.abs(
      u.monthUsd -
        2 * costOf('claude-sonnet-5-5', {input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 2000})
    ) < 1e-9,
    '生成と検算の 2 回分'
  );

  // 作り直すと版が上がり、前の版は一覧から消える
  const again = fakeClient([{json: {title: '原価企画', qs: [Q.choice]}}]);
  await generateQuiz({repo, client: again}, {roundId: 'r3'});
  const list = repo.listQuizzes(course.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].version, 2);
  assert.equal(list[0].count, 1);
});

test('生成：形の不備は 1 回だけ出し直し・max_tokens は半分で作り直し・拒否と上限', async (t) => {
  const {repo} = await setup(t);
  const fix = fakeClient([
    {json: {title: 'x', qs: [{...Q.choice, o: ['a', 'a', 'b']}]}},
    {json: {title: 'x', qs: [Q.choice]}}
  ]);
  const r = await generateQuiz({repo, client: fix}, {roundId: 'r3'});
  assert.equal(r.count, 1);
  assert.match(fix.calls[1].messages.at(-1).content, /1 問目：.*同じ/);
  assert.equal(fix.calls[1].messages[1].role, 'assistant', '前の返事をそのまま続けて渡す');

  const long = fakeClient([{stop_reason: 'max_tokens', json: {}}, {json: {title: 'x', qs: [Q.choice]}}]);
  await generateQuiz({repo, client: long}, {roundId: 'r3'});
  assert.match(long.calls[1].messages[0].content, /問題数と種類：5 問/);

  await assert.rejects(
    generateQuiz({repo, client: fakeClient([{stop_reason: 'refusal', json: {}}])}, {roundId: 'r3'}),
    (e) => e.code === 'refusal'
  );
  await assert.rejects(
    generateQuiz({repo, client: fakeClient([])}, {roundId: 'r3', limits: {perDay: 3, perMonthUsd: 5}}),
    (e) => e.code === 'limit-day'
  );
});

test('答えの記録と復習：まちがえたら今日の復習に出る・初めての正解は 1 週間後・card は対象外', async (t) => {
  const {repo} = await setup(t);
  await generateQuiz(
    {
      repo,
      client: fakeClient([
        {json: {title: 'x', qs: [Q.choice, Q.tf, Q.card]}},
        {
          json: {
            answers: [
              {i: 0, answer: '企画・設計段階'},
              {i: 1, answer: '×'}
            ]
          }
        }
      ])
    },
    {roundId: 'r3'}
  );
  const svc = createQuizService({
    repo,
    secrets: {get: async () => null, set: async () => {}, available: async () => true, remove: async () => {}}
  });
  const [c, tf, card] = repo.listQuestions({courseId: repo.listCourses()[0].id});
  assert.deepEqual(svc.answer({questionId: c.id, answer: '量産段階'}), {ok: false, a: '企画・設計段階'});
  assert.equal(svc.answer({questionId: tf.id, answer: '×'}).ok, true);
  assert.equal(svc.answer({questionId: card.id, answer: true}).ok, true);
  const rev = svc.review();
  assert.deepEqual(
    rev.questions.map((q) => q.id),
    [c.id],
    'まちがえた問題だけが今日の復習に'
  );
  const tfSrs = repo.db.prepare('SELECT * FROM srs WHERE question_id = ?').get(tf.id);
  assert.equal(tfSrs.s, 3);
  assert.ok(Date.parse(tfSrs.due) - Date.now() > 6 * 864e5);
  assert.equal(repo.db.prepare('SELECT COUNT(*) c FROM srs WHERE question_id = ?').get(card.id).c, 0);
  assert.equal(repo.db.prepare('SELECT COUNT(*) c FROM attempt').get().c, 3);
});

test('API キーがなければ作らずに知らせる', async (t) => {
  const {repo} = await setup(t);
  const events = [];
  const svc = createQuizService({repo, secrets: {get: async () => null}, notify: (ch, p) => events.push([ch, p])});
  svc.generate(['r3']);
  await new Promise((r) => setTimeout(r, 50));
  const fin = events.find(([ch]) => ch === 'quiz.finished');
  assert.equal(fin[1].ok, false);
  assert.equal(fin[1].message, 'クイズを作るには Claude API キーが必要です（設定 → クイズ）');
});
