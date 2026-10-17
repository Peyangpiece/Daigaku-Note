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
      if (!opts.loginOk) throw Object.assign(new Error('no'), {code: 'login-required'});
    },
    async listCourses() {
      if (opts.failCourses) throw new Error('fetch failed');
      return data.courses.map(({lmsId, name, weekday, period}) => ({lmsId, name, url: `https://lms/c/${lmsId}`, weekday, period}));
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
      for (const c of data.courses) for (const r of [...c.rounds, {files: c.notices ?? []}]) for (const f of r.files) if (f.url === ref.url) return {ok: true, status: 200, contentType: 'application/pdf', body: Buffer.from(f.body)};
      return {ok: false, status: 404, contentType: '', body: Buffer.alloc(0)};
    }
  };
}

async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dn-engine-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  const term = repo.upsertTerm({id: '2026-fall', label: '秋学期', year: 2026, folder: '2026_秋学期', start_date: '2026-09-21', end_date: '2027-01-31', rounds: 15, holidays_json: '[]'});
  const connection = repo.createConnection({kind: 'recipe', connector_id: 'fake', label: 'LMS', base_url: 'https://lms'});
  const files = new FileManager({repo, root: () => root, trash: async () => {}});
  const progress = [];
  const engine = new SyncEngine({repo, files, today: () => '2026-10-16', onProgress: (p) => progress.push(p), courseTimeoutMs: 5000});
  return {root, repo, term, connection, files, engine, progress};
}

const data = () => ({
  courses: [
    {
      lmsId: '1', name: '管理会計Ⅱ', weekday: '金', period: 2,
      rounds: [
        {title: '第1回 イントロダクション', files: [{url: 'https://lms/f/1', name: '第1回 資料.pdf', body: 'r1'}]},
        {title: '第4回 原価企画', files: [{url: 'https://lms/f/4', name: '第4回 資料.pdf', body: 'r4'}, {url: 'https://lms/f/4b', name: '第4回 資料 4up.pdf', body: 'r4-4up'}]},
        {title: '第5回 原価維持', files: [{url: 'https://lms/f/5', name: '第5回 資料.pdf', body: 'r5'}]},
        {title: 'その他の資料', files: [{url: 'https://lms/f/x', name: 'シラバス.pdf', body: 'syl'}]}
      ],
      notices: [{url: 'https://lms/f/n3', name: 'お知らせ添付.pdf', body: 'n3', noticeTitle: '【第03回，10/09】休講のお知らせ'}]
    },
    {lmsId: '2', name: '意思決定論', weekday: '月', period: 3, rounds: [{title: 'Week 2', files: [{url: 'https://lms/f/w2', name: 'w2.pdf', body: 'w2'}]}]}
  ]
});

test('初回は全回、2 回目は前後 7 日の回だけ。回フォルダ・1up 優先・お知らせの回', async (t) => {
  const {root, repo, term, connection, engine, progress} = await setup(t);
  const d = data();
  const conn = fakeConnector(d);
  const r1 = await engine.run({connection, connector: conn, term, kind: 'initial'});
  assert.equal(r1.status, 'ok');
  assert.equal(r1.courses, 2);
  assert.equal(r1.materials, 6, '管理会計Ⅱ 5 件（1up を優先するので 4up は保存しない。お知らせの添付を含む）＋意思決定論 1 件');
  assert.equal(r1.failures, 0);
  assert.equal(progress.length, 2);

  const courseDir = path.join(root, '2026_秋学期', '管理会計Ⅱ');
  const dirs = (await readdir(courseDir)).sort();
  assert.deepEqual(dirs, ['その他', '第01回_イントロダクション', '第03回', '第04回_原価企画', '第05回_原価維持']);
  assert.deepEqual(await readdir(path.join(courseDir, '第04回_原価企画')), ['第4回 資料.pdf']);
  assert.deepEqual(await readdir(path.join(courseDir, '第03回')), ['お知らせ添付.pdf']);
  assert.deepEqual(await readdir(path.join(courseDir, 'その他')), ['シラバス.pdf']);
  assert.deepEqual(await readdir(path.join(root, '2026_秋学期', '意思決定論')), ['第02回'], '「Week 2」は番号だけ。その他フォルダは資料が入るまで作らない');

  const course = repo.findCourseByLms(connection.id, '1');
  const rounds = repo.listRounds(course.id);
  assert.equal(rounds.find((r) => r.number === 4).date, '2026-10-16', '金曜の 4 回目（9/25,10/2,10/9,10/16）');
  assert.equal(rounds.find((r) => r.number === 4).title, '原価企画');
  assert.equal(repo.get('connection', connection.id).last_sync_at !== null, true);

  // 2 回目：今日 10/16 の前後 7 日 → 第 4 回（10/16）だけ。第 1 回（9/25）・第 5 回（10/23 は範囲内）
  conn.calls.listFiles = 0;
  const r2 = await engine.run({connection: repo.get('connection', connection.id), connector: conn, term, kind: 'full'});
  assert.equal(r2.materials, 0);
  assert.equal(conn.calls.listFiles, 3, '管理会計Ⅱ：第4回(10/16)・第5回(10/23)・LMS の「その他の資料」（日付なし）。意思決定論：Week 2 は 10/5 で範囲外');

  // 途中から増えた授業（まだ資料がない）は、接続が初回でなくても全部の回を確かめる
  const d3 = data();
  d3.courses.push({lmsId: '3', name: '新しい授業', weekday: '月', period: 1, rounds: [{title: '第1回 ガイダンス', files: [{url: 'https://lms/f/g1', name: 'ガイダンス.pdf', body: 'g1'}]}]});
  const conn3 = fakeConnector(d3);
  const r3 = await engine.run({connection: repo.get('connection', connection.id), connector: conn3, term, kind: 'full'});
  assert.equal(r3.materials, 1, '第1回（9/21）は範囲外だが、まだ全部の回を確かめていない授業なので取り込む');
  assert.ok(r3.events.some((e) => e.course === '新しい授業' && /全部の回/.test(e.message)));
  const c3 = repo.listCourses().find((c) => c.name === '新しい授業');
  assert.ok(c3.full_synced_at, '確かめ終えた印が付く');
  // 途中で止まった同期（回の一覧が読めなかった）では印が付かず、次も全部の回を見る
  const d4 = d3; // 授業 3 も含めたまま 4 を足す
  d4.courses.push({lmsId: '4', name: '途中で止まる授業', weekday: '月', period: 2, throw: 'network down', rounds: []});
  await engine.run({connection: repo.get('connection', connection.id), connector: fakeConnector(d4), term, kind: 'full'});
  assert.equal(repo.listCourses().find((c) => c.name === '途中で止まる授業').full_synced_at, null);
  d4.courses.at(-1).throw = null;
  d4.courses.at(-1).rounds = [{title: '第2回', files: [{url: 'https://lms/f/s2', name: '第2回.pdf', body: 's2'}]}];
  const conn4 = fakeConnector(d4);
  const r4 = await engine.run({connection: repo.get('connection', connection.id), connector: conn4, term, kind: 'full'});
  assert.equal(r4.materials, 1, '第2回（9/28）は範囲外だが、印がないので全部の回を見て取り込む');
  // 印の付いた授業は、full: true で全部の回を見直せる
  conn4.calls.listFiles = 0;
  await engine.run({connection: repo.get('connection', connection.id), connector: conn4, term, kind: 'course', courseIds: [c3.id], full: true});
  assert.equal(conn4.calls.listFiles, 1, '新しい授業の第1回を見直す');
});

test('授業の改名でフォルダも改名。消えた授業は sync_enabled=0。授業ごとの同期', async (t) => {
  const {root, repo, term, connection, engine} = await setup(t);
  const d = data();
  await engine.run({connection, connector: fakeConnector(d), term, kind: 'initial'});
  d.courses[0].name = '管理会計Ⅱ（新）';
  d.courses.pop();
  const conn2 = fakeConnector(d);
  await engine.run({connection: repo.get('connection', connection.id), connector: conn2, term, kind: 'full', full: true});
  const names = (await readdir(path.join(root, '2026_秋学期'))).sort();
  assert.deepEqual(names, ['意思決定論', '管理会計Ⅱ（新）']);
  const c1 = repo.findCourseByLms(connection.id, '1');
  assert.equal(c1.folder_name, '管理会計Ⅱ（新）');
  assert.equal(repo.listMaterials(c1.id)[0].path.includes('管理会計Ⅱ（新）'), true, '記録のパスも追従');
  assert.equal(repo.findCourseByLms(connection.id, '2').sync_enabled, 0);

  // 授業ごとの同期では消えた判定をしない
  d.courses.push({lmsId: '3', name: '新しい授業', rounds: []});
  await engine.run({connection: repo.get('connection', connection.id), connector: fakeConnector(d), term, kind: 'course', courseIds: [c1.id]});
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
