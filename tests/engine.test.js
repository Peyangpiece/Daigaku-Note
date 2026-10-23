import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/main/db/db.js';
import {Repo} from '../src/main/db/repo.js';
import {FileManager} from '../src/main/sync/files.js';
import {SyncEngine, classify, parallel} from '../src/main/sync/engine.js';

/** 偽のコネクタ：data = {courses: [{lmsId, name, weekday, period, rounds: [{number?, title, files: [{url, name, body}]}], notices: [...]}]} */
function fakeConnector(data, opts = {}) {
  const calls = {fetch: 0, listFiles: 0};
  return {
    id: 'fake',
    kind: 'recipe',
    parallelism: 2,
    calls,
    async createContext() {
      return {};
    },
    async ensureSession() {
      return opts.session ?? 'ok';
    },
    async login() {
      if (opts.loginError) throw Object.assign(new Error(opts.loginError.message), {code: opts.loginError.code});
      if (!opts.loginOk) throw Object.assign(new Error('no'), {code: 'login-required'});
    },
    async listCourses() {
      if (opts.failCourses) throw new Error('fetch failed');
      return data.courses.map(({lmsId, name, weekday, period}) => ({
        lmsId,
        name,
        url: `https://lms/c/${lmsId}`,
        weekday,
        period
      }));
    },
    async listRounds(ctx, course) {
      const c = data.courses.find((x) => x.lmsId === course.lms_id);
      if (c.throw) throw new Error(c.throw);
      return c.rounds.map((r, i) => ({number: r.number, title: r.title, lmsRef: 'd' + i}));
    },
    async listFiles(ctx, course, round) {
      calls.listFiles++;
      const c = data.courses.find((x) => x.lmsId === course.lms_id);
      const r = c.rounds.find((x, i) => 'd' + i === round.lmsRef);
      return (r?.files ?? []).map(({url, name}) => ({url, name}));
    },
    async listNoticeFiles(ctx, course) {
      const c = data.courses.find((x) => x.lmsId === course.lms_id);
      return (c.notices ?? []).map(({url, name, noticeTitle}) => ({url, name, noticeTitle}));
    },
    async fetchFile(ctx, ref) {
      calls.fetch++;
      if (opts.failUrls?.has(ref.url)) return {ok: false, status: 500, contentType: '', body: Buffer.alloc(0)};
      for (const c of data.courses)
        for (const r of [...c.rounds, {files: c.notices ?? []}])
          for (const f of r.files)
            if (f.url === ref.url)
              return {ok: true, status: 200, contentType: 'application/pdf', body: Buffer.from(f.body)};
      return {ok: false, status: 404, contentType: '', body: Buffer.alloc(0)};
    }
  };
}

async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dn-engine-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  const term = repo.upsertTerm({
    id: '2026-fall',
    label: '秋学期',
    year: 2026,
    folder: '2026_秋学期',
    start_date: '2026-09-21',
    end_date: '2027-01-31',
    rounds: 15,
    holidays_json: '[]'
  });
  const connection = repo.createConnection({
    kind: 'recipe',
    connector_id: 'fake',
    label: 'LMS',
    base_url: 'https://lms'
  });
  const files = new FileManager({repo, root: () => root, trash: async () => {}});
  const progress = [];
  const engine = new SyncEngine({
    repo,
    files,
    today: () => '2026-10-16',
    onProgress: (p) => progress.push(p),
    courseTimeoutMs: 5000
  });
  return {root, repo, term, connection, files, engine, progress};
}

const data = () => ({
  courses: [
    {
      lmsId: '1',
      name: '管理会計Ⅱ',
      weekday: '金',
      period: 2,
      rounds: [
        {title: '第1回 イントロダクション', files: [{url: 'https://lms/f/1', name: '第1回 資料.pdf', body: 'r1'}]},
        {
          title: '第4回 原価企画',
          files: [
            {url: 'https://lms/f/4', name: '第4回 資料.pdf', body: 'r4'},
            {url: 'https://lms/f/4b', name: '第4回 資料 4up.pdf', body: 'r4-4up'}
          ]
        },
        {title: '第5回 原価維持', files: [{url: 'https://lms/f/5', name: '第5回 資料.pdf', body: 'r5'}]},
        {title: 'その他の資料', files: [{url: 'https://lms/f/x', name: 'シラバス.pdf', body: 'syl'}]}
      ],
      notices: [
        {url: 'https://lms/f/n3', name: 'お知らせ添付.pdf', body: 'n3', noticeTitle: '【第03回，10/09】休講のお知らせ'}
      ]
    },
    {
      lmsId: '2',
      name: '意思決定論',
      weekday: '月',
      period: 3,
      rounds: [{title: 'Week 2', files: [{url: 'https://lms/f/w2', name: 'w2.pdf', body: 'w2'}]}]
    }
  ]
});

test('初回は全回、2 回目は前後 7 日の回だけ。回フォルダ・1up 優先・お知らせの回', async (t) => {
  const {root, repo, term, connection, engine, progress} = await setup(t);
  const d = data();
  const conn = fakeConnector(d);
  const r1 = await engine.run({connection, connector: conn, term, kind: 'initial'});
  assert.equal(r1.status, 'ok');
  assert.equal(r1.courses, 2);
  assert.equal(
    r1.materials,
    6,
    '管理会計Ⅱ 5 件（1up を優先するので 4up は保存しない。お知らせの添付を含む）＋意思決定論 1 件'
  );
  assert.equal(r1.failures, 0);
  assert.equal(progress.length, 2);

  const courseDir = path.join(root, '2026_秋学期', '管理会計Ⅱ');
  const dirs = (await readdir(courseDir)).sort();
  assert.deepEqual(dirs, ['その他', '第01回_イントロダクション', '第03回', '第04回_原価企画', '第05回_原価維持']);
  assert.deepEqual(await readdir(path.join(courseDir, '第04回_原価企画')), ['第4回 資料.pdf']);
  assert.deepEqual(await readdir(path.join(courseDir, '第03回')), ['お知らせ添付.pdf']);
  assert.deepEqual(await readdir(path.join(courseDir, 'その他')), ['シラバス.pdf']);
  assert.deepEqual(
    await readdir(path.join(root, '2026_秋学期', '意思決定論')),
    ['第02回'],
    '「Week 2」は番号だけ。その他フォルダは資料が入るまで作らない'
  );

  const course = repo.findCourseByLms(connection.id, '1');
  const rounds = repo.listRounds(course.id);
  assert.equal(rounds.find((r) => r.number === 4).date, '2026-10-16', '金曜の 4 回目（9/25,10/2,10/9,10/16）');
  assert.equal(rounds.find((r) => r.number === 4).title, '原価企画');
  assert.equal(repo.get('connection', connection.id).last_sync_at !== null, true);

  // 2 回目：今日 10/16 の前後 7 日 → 第 4 回（10/16）だけ。第 1 回（9/25）・第 5 回（10/23 は範囲内）
  conn.calls.listFiles = 0;
  const r2 = await engine.run({connection: repo.get('connection', connection.id), connector: conn, term, kind: 'full'});
  assert.equal(r2.materials, 0);
  assert.equal(
    conn.calls.listFiles,
    3,
    '管理会計Ⅱ：第4回(10/16)・第5回(10/23)・LMS の「その他の資料」（日付なし）。意思決定論：Week 2 は 10/5 で範囲外'
  );

  // 途中から増えた授業（まだ資料がない）は、接続が初回でなくても全部の回を確かめる
  const d3 = data();
  d3.courses.push({
    lmsId: '3',
    name: '新しい授業',
    weekday: '月',
    period: 1,
    rounds: [{title: '第1回 ガイダンス', files: [{url: 'https://lms/f/g1', name: 'ガイダンス.pdf', body: 'g1'}]}]
  });
  const conn3 = fakeConnector(d3);
  const r3 = await engine.run({
    connection: repo.get('connection', connection.id),
    connector: conn3,
    term,
    kind: 'full'
  });
  assert.equal(r3.materials, 1, '第1回（9/21）は範囲外だが、まだ全部の回を確かめていない授業なので取り込む');
  assert.ok(r3.events.some((e) => e.course === '新しい授業' && /全部の回/.test(e.message)));
  const c3 = repo.listCourses().find((c) => c.name === '新しい授業');
  assert.ok(c3.full_synced_at, '確かめ終えた印が付く');
  // 途中で止まった同期（回の一覧が読めなかった）では印が付かず、次も全部の回を見る
  const d4 = d3; // 授業 3 も含めたまま 4 を足す
  d4.courses.push({lmsId: '4', name: '途中で止まる授業', weekday: '月', period: 2, throw: 'network down', rounds: []});
  await engine.run({
    connection: repo.get('connection', connection.id),
    connector: fakeConnector(d4),
    term,
    kind: 'full'
  });
  assert.equal(repo.listCourses().find((c) => c.name === '途中で止まる授業').full_synced_at, null);
  d4.courses.at(-1).throw = null;
  d4.courses.at(-1).rounds = [{title: '第2回', files: [{url: 'https://lms/f/s2', name: '第2回.pdf', body: 's2'}]}];
  const conn4 = fakeConnector(d4);
  const r4 = await engine.run({
    connection: repo.get('connection', connection.id),
    connector: conn4,
    term,
    kind: 'full'
  });
  assert.equal(r4.materials, 1, '第2回（9/28）は範囲外だが、印がないので全部の回を見て取り込む');
  // 印の付いた授業は、full: true で全部の回を見直せる
  conn4.calls.listFiles = 0;
  await engine.run({
    connection: repo.get('connection', connection.id),
    connector: conn4,
    term,
    kind: 'course',
    courseIds: [c3.id],
    full: true
  });
  assert.equal(conn4.calls.listFiles, 1, '新しい授業の第1回を見直す');
});

test('授業の改名でフォルダも改名。消えた授業は sync_enabled=0。授業ごとの同期', async (t) => {
  const {root, repo, term, connection, engine} = await setup(t);
  const d = data();
  await engine.run({connection, connector: fakeConnector(d), term, kind: 'initial'});
  d.courses[0].name = '管理会計Ⅱ（新）';
  d.courses.pop();
  const conn2 = fakeConnector(d);
  await engine.run({
    connection: repo.get('connection', connection.id),
    connector: conn2,
    term,
    kind: 'full',
    full: true
  });
  const names = (await readdir(path.join(root, '2026_秋学期'))).sort();
  assert.deepEqual(names, ['意思決定論', '管理会計Ⅱ（新）']);
  const c1 = repo.findCourseByLms(connection.id, '1');
  assert.equal(c1.folder_name, '管理会計Ⅱ（新）');
  assert.equal(repo.listMaterials(c1.id)[0].path.includes('管理会計Ⅱ（新）'), true, '記録のパスも追従');
  assert.equal(repo.findCourseByLms(connection.id, '2').sync_enabled, 0);

  // 授業ごとの同期では消えた判定をしない
  d.courses.push({lmsId: '3', name: '新しい授業', rounds: []});
  await engine.run({
    connection: repo.get('connection', connection.id),
    connector: fakeConnector(d),
    term,
    kind: 'course',
    courseIds: [c1.id]
  });
  assert.equal(repo.findCourseByLms(connection.id, '3') !== null, true, '一覧の突き合わせは常に行う');
});

test('セットアップで外した授業は非表示で作られ、同期しない', async (t) => {
  const {repo, term, connection, engine} = await setup(t);
  repo.setSetting(`courses.exclude.${connection.id}`, ['2']);
  await engine.run({connection, connector: fakeConnector(data()), term, kind: 'initial'});
  const c2 = repo.findCourseByLms(connection.id, '2');
  assert.equal(c2.hidden, 1);
  assert.equal(repo.listMaterials(c2.id).length, 0);
  assert.equal(repo.findCourseByLms(connection.id, '1').hidden, 0);
});

test('自動ログイン：パスワードが通らなければ自動ログインを止め、理由を残す。認証コードなら止めない', async (t) => {
  const {repo, term, connection, engine} = await setup(t);
  repo.updateConnection(connection.id, {save_password: 1});
  const bad = await engine.run({
    connection: repo.get('connection', connection.id),
    connector: fakeConnector(data(), {
      session: 'login-required',
      loginError: {code: 'login-bad-credentials', message: 'パスワード違い'}
    }),
    term
  });
  assert.equal(bad.status, 'login-required');
  assert.equal(repo.get('connection', connection.id).save_password, 0, '次の同期でまた送らない');
  assert.equal(bad.events[0].code, 'login-bad-credentials');
  assert.match(bad.events[0].message, /パスワード違い/);

  repo.updateConnection(connection.id, {save_password: 1});
  const otp = await engine.run({
    connection: repo.get('connection', connection.id),
    connector: fakeConnector(data(), {
      session: 'login-required',
      loginError: {code: 'login-needs-user', message: '認証コード'}
    }),
    term
  });
  assert.equal(otp.events[0].code, 'login-needs-user');
  assert.equal(
    repo.get('connection', connection.id).save_password,
    1,
    '認証コードのときは自動ログインを残す（次はまた ID・パスワードで入れる）'
  );

  const ok = await engine.run({
    connection: repo.get('connection', connection.id),
    connector: fakeConnector(data(), {session: 'login-required', loginOk: true}),
    term
  });
  assert.equal(ok.status, 'ok', '自動ログインできれば同期を続ける');
});

test('起動時の自動ログイン：同期せずにセッションを確かめ、切れていればログインして保存する', async (t) => {
  const {repo, connection, engine} = await setup(t);
  const saved = [];
  const released = [];
  const connector = (opts) => ({
    ...fakeConnector(data(), opts),
    saveSession: async () => saved.push(opts.session),
    releaseContext: async () => released.push(opts.session),
    listCourses: async () => assert.fail('同期はしない')
  });
  repo.updateConnection(connection.id, {status: 'login-required'});
  const kept = await engine.restoreSession({connection, connector: connector({session: 'ok'})});
  assert.deepEqual(kept, {status: 'ok', loggedIn: false});
  assert.equal(repo.get('connection', connection.id).status, 'ok');
  assert.deepEqual(saved, [], 'ログインしていなければ保存し直さない');

  const relogged = await engine.restoreSession({
    connection,
    connector: connector({session: 'login-required', loginOk: true})
  });
  assert.deepEqual(relogged, {status: 'ok', loggedIn: true});
  assert.deepEqual(saved, ['login-required']);

  repo.updateConnection(connection.id, {save_password: 1});
  const bad = await engine.restoreSession({
    connection,
    connector: connector({
      session: 'login-required',
      loginError: {code: 'login-bad-credentials', message: 'パスワード違い'}
    })
  });
  assert.equal(bad.status, 'login-required');
  assert.equal(bad.error.code, 'login-bad-credentials');
  assert.equal(repo.get('connection', connection.id).status, 'login-required');
  assert.equal(repo.get('connection', connection.id).save_password, 0, '通らないパスワードは送り続けない');
  assert.equal(released.length, 3, '毎回あと片付けをする');
});

test('同じ LMS の接続が 2 つあると授業が 2 つずつできる → 起動時に 1 つにまとめる', async (t) => {
  const {root, repo, term, connection, files, engine} = await setup(t);
  const trashed = [];
  files.trash = async (f) => (trashed.push(f), rm(f, {recursive: true, force: true}));
  repo.updateConnection(connection.id, {allowed_hosts_json: '["idp.example"]'});
  const second = repo.createConnection({kind: 'recipe', connector_id: 'fake', label: 'LMS', base_url: 'https://lms'});
  // 2 つ目の接続を作った順に並べるため、作成時刻をずらす
  repo.db.prepare('UPDATE connection SET created_at = ? WHERE id = ?').run('2099-01-01T00:00:00.000Z', second.id);
  repo.updateConnection(second.id, {save_password: 1});
  await engine.run({connection, connector: fakeConnector(data()), term, kind: 'initial'});
  const d2 = data();
  d2.courses[0].rounds[0].files.push({url: 'https://lms/f/only2', name: '2 つ目だけの資料.pdf', body: 'only2'});
  d2.courses[1].rounds[0].files = [{url: 'https://lms/f/w2b', name: 'w2 改訂.pdf', body: 'w2-new'}]; // 数は同じ・中身が違う
  await engine.run({
    connection: repo.get('connection', second.id),
    connector: fakeConnector(d2),
    term,
    kind: 'initial'
  });
  assert.equal(repo.listCourses().length, 4, '再現：同じ授業が 2 つずつ');
  assert.deepEqual((await readdir(path.join(root, '2026_秋学期'))).sort(), [
    '意思決定論',
    '意思決定論 (2)',
    '管理会計Ⅱ',
    '管理会計Ⅱ (2)'
  ]);

  assert.ok(repo.findCourseByLms(connection.id, '2').full_synced_at, '前提：全部の回を確かめ終えた印がある');
  // 消すほうの授業（1 つ目の管理会計Ⅱ）と残すほうの授業（1 つ目の意思決定論）にクイズがある。
  // 外部キー（foreign_keys=ON）で round を消せず、統合がまるごと失敗していた
  const addQuiz = (courseId, title) => {
    const round = repo.listRounds(courseId).find((r) => r.number > 0);
    const quiz = repo.insertQuiz({
      id: `quiz-${title}`,
      round_id: round.id,
      version: 1,
      title,
      status: 'ready',
      source_json: '{}',
      generated_by: 'test'
    });
    const q = repo.insertQuestion({
      quiz_id: quiz.id,
      seq: 1,
      type: 'tf',
      q: '問い',
      a: '○',
      o_json: '[]',
      n: '解説',
      src_page: 1,
      src_quote: 'x'.repeat(20),
      tags_json: '[]',
      difficulty: 1
    });
    repo.addAttempt({question_id: q.id, mode: 'quiz', ok: 1});
    repo.saveSrs(q.id, {s: 3, due: Date.now() + 864e5, at: Date.now(), c: 0, lapses: 0});
    repo.addAiUsage({
      model: 'm',
      usage: {input_tokens: 1, output_tokens: 1},
      cost: 0.001,
      purpose: 'generate',
      quizId: quiz.id
    });
    return quiz;
  };
  addQuiz(repo.findCourseByLms(connection.id, '1').id, 'loser');
  const kept = addQuiz(repo.findCourseByLms(connection.id, '2').id, 'survivor');
  const r = await engine.mergeDuplicateConnections();
  assert.deepEqual(r, {merged: 1, removedCourses: 2});
  assert.equal(repo.get('quiz', 'quiz-loser'), null, '消した授業のクイズも消える');
  assert.ok(repo.get('quiz', kept.id), '残す授業のクイズは残る');
  assert.equal(repo.db.prepare('SELECT COUNT(*) AS n FROM question').get().n, 1);
  assert.equal(repo.db.prepare('SELECT COUNT(*) AS n FROM srs').get().n, 1);
  const conns = repo.listConnections();
  assert.equal(conns.length, 1);
  assert.equal(conns[0].id, second.id, '新しいほう（本人が最後に設定したほう）を残す');
  assert.equal(conns[0].save_password, 1);
  assert.deepEqual(JSON.parse(conns[0].allowed_hosts_json), ['idp.example'], '覚えたホストを引き継ぐ');
  const courses = repo.listCourses();
  assert.equal(courses.length, 2, '授業は 1 つずつ');
  assert.ok(courses.every((c) => c.connection_id === second.id));
  // 管理会計Ⅱ は資料の多い 2 つ目（フォルダ「(2)」）を残し、元の名前に戻す。意思決定論は同数なので古いほう
  const kanri = courses.find((c) => c.lms_id === '1');
  assert.equal(kanri.folder_name, '管理会計Ⅱ');
  assert.ok(
    repo
      .listMaterials(kanri.id)
      .some((m) => m.name === '2 つ目だけの資料.pdf' && m.path.includes(`${path.sep}管理会計Ⅱ${path.sep}`)),
    '記録のパスも元の名前に'
  );
  assert.deepEqual((await readdir(path.join(root, '2026_秋学期'))).sort(), ['意思決定論', '管理会計Ⅱ']);
  const ishi = courses.find((c) => c.lms_id === '2');
  assert.equal(ishi.full_synced_at, null, '消したほうにしかない資料があるので、次の同期で全部の回を見直す');
  assert.ok(kanri.full_synced_at, '取りこぼしがなければ印はそのまま');
  assert.equal(trashed.length, 2, '消すほうのフォルダはゴミ箱へ');
  assert.equal(await engine.mergeDuplicateConnections().then((x) => x.merged), 0, '2 回目は何もしない');
});

test('全部の回を確かめるときにダウンロードが失敗したら、次の同期でも全部の回を確かめる（3 回まで）', async (t) => {
  const {repo, term, connection, engine} = await setup(t);
  const d = data();
  d.courses = [d.courses[0]];
  d.courses[0].notices = [];
  const failUrls = new Set(['https://lms/f/1']); // 第 1 回（今日 10/16 の前後 7 日の外）の資料が落とせない
  // 1 回目：失敗があるので「全部の回を確かめ終えた」にしない
  let r = await engine.run({connection, connector: fakeConnector(d, {failUrls}), term, kind: 'initial'});
  const course = () => repo.findCourseByLms(connection.id, '1');
  const conn = () => repo.get('connection', connection.id); // 2 回目からは DB の接続行（last_sync_at 付き）を渡す（jobs.js と同じ）
  assert.equal(r.materials, 3, '第4回（4up は 1up があるので除く）・第5回・その他');
  assert.equal(course().full_synced_at, null, '失敗があれば印を付けない');
  assert.ok(r.events.some((e) => e.level === 'info' && /次の同期でも全部の回/.test(e.message)));
  // 2 回目：まだ失敗 → まだ付けない
  r = await engine.run({connection: conn(), connector: fakeConnector(d, {failUrls}), term});
  assert.equal(course().full_synced_at, null);
  // 3 回目：取れた → 保存され、印が付く
  failUrls.clear();
  r = await engine.run({connection: conn(), connector: fakeConnector(d), term});
  assert.equal(r.materials, 1, '前に落とせなかった第 1 回の資料が入る');
  assert.ok(course().full_synced_at);
  assert.equal(repo.getSetting(`sync.crawlRetries.${course().id}`, null), null, '数え直しは消す');
  // 4 回目：ふだんの同期は前後 7 日だけ（全部は読まない）
  const c = fakeConnector(d);
  await engine.run({connection: conn(), connector: c, term});
  assert.equal(c.calls.listFiles, 3, '第4回・第5回・その他（日付なし）だけ');
});

test('何度試しても取れない資料があれば、3 回で「全部の回を確かめ終えた」にする（毎回全部を読み直さない）', async (t) => {
  const {repo, term, connection, engine} = await setup(t);
  const d = data();
  d.courses = [d.courses[0]];
  d.courses[0].notices = [];
  const failUrls = new Set(['https://lms/f/1']);
  const course = () => repo.findCourseByLms(connection.id, '1');
  const conn = () => repo.get('connection', connection.id);
  for (let i = 0; i < 2; i++)
    await engine.run({connection: conn(), connector: fakeConnector(d, {failUrls}), term, kind: i ? 'full' : 'initial'});
  assert.equal(course().full_synced_at, null);
  const r = await engine.run({connection: conn(), connector: fakeConnector(d, {failUrls}), term});
  assert.ok(course().full_synced_at, '3 回目で印を付ける');
  assert.ok(r.events.some((e) => e.level === 'warn' && /3 回試しても/.test(e.message)));
  assert.equal(repo.getSetting(`sync.crawlRetries.${course().id}`, null), null);
});

test('ログインが必要・授業一覧の失敗・1 授業の失敗はほかを止めない', async (t) => {
  const {repo, term, connection, engine} = await setup(t);
  const need = await engine.run({connection, connector: fakeConnector(data(), {session: 'login-required'}), term});
  assert.equal(need.status, 'login-required');
  assert.equal(repo.get('connection', connection.id).status, 'login-required');

  const failed = await engine.run({connection, connector: fakeConnector(data(), {failCourses: true}), term});
  assert.equal(failed.status, 'failed');
  assert.equal(failed.events[0].code, 'network');

  const d = data();
  d.courses[1].throw = 'selector-missing: #div';
  const partial = await engine.run({connection, connector: fakeConnector(d), term, kind: 'initial'});
  assert.equal(partial.status, 'ok');
  assert.equal(partial.failures, 1);
  assert.equal(partial.materials, 5, '意思決定論が失敗しても管理会計Ⅱの 5 件は保存される');
  assert.equal(repo.get('connection', connection.id).status, 'ok', 'ログインできれば ok に戻る');
});

test('失敗の分類と並行実行', async () => {
  assert.equal(classify(Object.assign(new Error('x'), {code: 'selector-missing'})), 'selector-missing');
  assert.equal(classify(new Error('fetch failed')), 'network');
  assert.equal(classify(new Error('Request timed out')), 'timeout');
  assert.equal(classify(new Error('ENOSPC: no space')), 'write');
  assert.equal(classify(new Error('???')), 'unknown');
  const order = [];
  await parallel([1, 2, 3, 4, 5], 2, async (n) => {
    await new Promise((r) => setTimeout(r, (6 - n) * 5));
    order.push(n);
  });
  assert.deepEqual([...order].sort(), [1, 2, 3, 4, 5]);
});
