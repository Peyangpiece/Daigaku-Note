import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase, migrate} from '../src/main/db/db.js';
import {Repo} from '../src/main/db/repo.js';
import {normalizeTemplate, rotationFor} from '../src/shared/skin.js';

test('マイグレーションが当たり、2 回当てても変わらない', async () => {
  const {db, applied} = await openDatabase(':memory:');
  assert.deepEqual(applied, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(migrate(db), []);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  for (const t of ['connection', 'term', 'course', 'round', 'material', 'annotation', 'quiz', 'question', 'srs', 'sync_run', 'job', 'settings', 'skin_template', 'sticker'])
    assert.ok(tables.includes(t), t);
});

test('repo の往復：接続・学期・授業・回・資料・設定・ジョブ', async () => {
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  const conn = repo.createConnection({kind: 'api', connector_id: 'moodle', label: 'Moodle', base_url: 'https://lms.example.ac.jp'});
  assert.equal(repo.listConnections().length, 1);
  repo.updateConnection(conn.id, {status: 'login-required'});
  assert.equal(repo.get('connection', conn.id).status, 'login-required');

  const term = repo.upsertTerm({id: '2026-fall', label: '秋学期', year: 2026, folder: '2026_秋学期', start_date: '2026-10-01', end_date: '2027-03-31', rounds: 15});
  assert.equal(term.folder, '2026_秋学期');
  repo.upsertTerm({...term, rounds: 14});
  assert.equal(repo.get('term', '2026-fall').rounds, 14);

  const c1 = repo.createCourse({term_id: term.id, connection_id: conn.id, lms_id: '1', name: '管理会計Ⅱ', folder_name: '管理会計Ⅱ'});
  const c2 = repo.createCourse({term_id: term.id, connection_id: conn.id, lms_id: '2', name: '意思決定論', folder_name: '意思決定論'});
  assert.equal(c1.color, 1);
  assert.equal(c2.color, 2);
  assert.equal(c2.sort_order, 2);
  assert.equal(repo.findCourseByLms(conn.id, '2').id, c2.id);
  assert.deepEqual(repo.courseFolderNames(term.id).sort(), ['意思決定論', '管理会計Ⅱ']);
  assert.throws(() => repo.createCourse({term_id: term.id, connection_id: conn.id, lms_id: '1', name: 'dup', folder_name: 'x'}), /UNIQUE/);

  const r3 = repo.createRound({course_id: c1.id, number: 3, title: '原価企画', folder_name: '第03回_原価企画'});
  assert.equal(repo.findRound(c1.id, 3).id, r3.id);
  repo.updateRound(r3.id, {date: '2026-10-16'});
  assert.equal(repo.listRounds(c1.id)[0].date, '2026-10-16');

  const m = repo.createMaterial({course_id: c1.id, round_id: r3.id, url: 'https://x/file/1', name: 'a.pdf', path: '/tmp/a.pdf', sha256: 'h1', size: 3, source: 'lms'});
  assert.equal(repo.findMaterialsByUrl('https://x/file/1')[0].id, m.id);
  assert.equal(repo.findMaterialByHash(c1.id, 'h1').id, m.id);
  assert.equal(repo.countUnread(c1.id), 1);
  repo.updateMaterial(m.id, {read_at: new Date().toISOString()});
  assert.equal(repo.countUnread(c1.id), 0);

  repo.setSetting('sync.time', '16:30');
  assert.equal(repo.getSetting('sync.time'), '16:30');
  assert.equal(repo.getSetting('nothing', 'x'), 'x');

  const job = repo.enqueueJob('sync', {connectionId: conn.id});
  const claimed = repo.claimJob();
  assert.equal(claimed.id, job.id);
  assert.deepEqual(claimed.payload, {connectionId: conn.id});
  assert.equal(repo.claimJob(), null);
  repo.finishJob(job.id, 'done', {ok: true});
  assert.equal(repo.get('job', job.id).status, 'done');

  const run = repo.startSyncRun({connection_id: conn.id, kind: 'full'});
  repo.addSyncEvent(run.id, {level: 'error', course_id: c1.id, code: 'download', message: 'x'.repeat(600)});
  repo.finishSyncRun(run.id, {courses: 2, materials: 1, failures: 1, timing: {total: 10}});
  assert.equal(repo.lastSyncRun(conn.id).failures, 1);
  assert.equal(db.prepare('SELECT message FROM sync_event').get().message.length, 500);
});

test('知らない表・列は拒む', async () => {
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  assert.throws(() => repo.insert('evil', {id: 'x'}), /知らない表/);
  assert.throws(() => repo.insert('settings', {key: 'x', value: 'y'}), /知らない表/);
  assert.throws(() => repo.update('course', 'id', {'name = 1; DROP TABLE course; --': 1}), /列/);
});

test('着せ替え：新しい授業にはテンプレートを順に割り当て、消したテンプレートの授業は全体と同じに戻す', async () => {
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  const conn = repo.createConnection({kind: 'manual', connector_id: 'manual', label: '手動'});
  const term = repo.upsertTerm({id: '2026-fall', label: '秋学期', year: 2026, folder: 'f', start_date: '2026-10-01', end_date: '2027-03-31', rounds: 15});
  const a = repo.createCourse({term_id: term.id, connection_id: conn.id, lms_id: '1', name: 'A', folder_name: 'A'});
  const b = repo.createCourse({term_id: term.id, connection_id: conn.id, lms_id: '2', name: 'B', folder_name: 'B'});
  assert.equal(a.skin_template_id, rotationFor(0));
  assert.equal(b.skin_template_id, rotationFor(1));
  assert.notEqual(a.skin_template_id, b.skin_template_id);
  assert.equal(repo.get('course', a.id).sticker_mode, 'global');
  const t = normalizeTemplate({name: 'わたしの'}, {id: 'MINE'});
  repo.saveSkinTemplate(t);
  repo.saveSkinTemplate({...t, name: '直した'});
  assert.deepEqual(repo.listSkinTemplates().map((x) => x.name), ['直した']);
  repo.updateCourse(a.id, {skin_template_id: 'MINE'});
  repo.removeSkinTemplate('MINE');
  assert.equal(repo.get('course', a.id).skin_template_id, null);
  assert.deepEqual(repo.listSkinTemplates(), []);
});

test('着せ替え：前の版で保存したテンプレート（あとから足した部品がない）も、読むときに今の形に整える', async () => {
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  const old = {format: 'daigaku-note.skin', formatVersion: 1, id: 'OLD', name: 'ピンク', parts: {note: {type: 'grid'}, folder: {card: '#ffffff'}, tape: {color: '#f7a1c4', pattern: 'stripe'}}, stickers: []};
  db.prepare('INSERT INTO skin_template (id, json, created_at, updated_at) VALUES (?, ?, ?, ?)').run('OLD', JSON.stringify(old), 'a', 'a');
  db.prepare('INSERT INTO skin_template (id, json, created_at, updated_at) VALUES (?, ?, ?, ?)').run('NEW', JSON.stringify({...old, formatVersion: 99}), 'b', 'b');
  const [t, ...rest] = repo.listSkinTemplates();
  assert.equal(rest.length, 0, '読めない版は出さない');
  assert.equal(t.name, 'ピンク');
  assert.equal(t.parts.note.type, 'grid');
  assert.deepEqual(t.parts.sticky, {round: 'default', pdf: 'default'});
  assert.deepEqual(t.parts.bookmark, {color: 'default', shape: 'tag'});
  assert.equal(t.parts.file.pdf, 'default');
});
