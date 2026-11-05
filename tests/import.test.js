import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, stat, utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  domainOf,
  judgeSource,
  parseWhereFroms,
  parseZoneIdentifier,
  readSource,
  siteHost
} from '../src/main/import-source.js';
import {createImporter, guessPlace} from '../src/main/import-watch.js';

// 授業資料の自動取り込み（v0.17.0）

/** kMDItemWhereFroms と同じ形のバイナリの plist（文字列の配列）を作る */
function bplist(strings) {
  const objs = [];
  const str = (s) => {
    const ascii = /^[\x00-\x7f]*$/.test(s);
    const body = ascii ? Buffer.from(s, 'latin1') : Buffer.from(s, 'utf16le').swap16();
    const n = ascii ? s.length : s.length;
    const head = n < 15 ? Buffer.from([(ascii ? 0x50 : 0x60) | n]) : Buffer.from([ascii ? 0x5f : 0x6f, 0x10, n]);
    return Buffer.concat([head, body]);
  };
  objs.push(Buffer.concat([Buffer.from([0xa0 | strings.length]), Buffer.from(strings.map((_, i) => i + 1))]));
  for (const s of strings) objs.push(str(s));
  const header = Buffer.from('bplist00', 'latin1');
  const offsets = [];
  let at = header.length;
  for (const o of objs) (offsets.push(at), (at += o.length));
  const table = Buffer.from(offsets.flatMap((o) => [o >> 8, o & 255]));
  const trailer = Buffer.alloc(32);
  trailer[6] = 2;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(objs.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(at), 24);
  return Buffer.concat([header, ...objs, table, trailer]);
}

test('ダウンロード元を読む：Windows の Zone.Identifier・Mac の kMDItemWhereFroms', async () => {
  const zone =
    '[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://lcu.iris-info.aichi-edu.ac.jp/lcu-web/SC_01\r\nHostUrl=https://lcu.iris-info.aichi-edu.ac.jp/file.pdf\r\n';
  assert.deepEqual(parseZoneIdentifier(zone), [
    'https://lcu.iris-info.aichi-edu.ac.jp/lcu-web/SC_01',
    'https://lcu.iris-info.aichi-edu.ac.jp/file.pdf'
  ]);
  assert.deepEqual(parseZoneIdentifier('[ZoneTransfer]\nZoneId=3\n'), [], 'URL がなければ空');
  assert.deepEqual(parseZoneIdentifier('HostUrl=about:internet'), [], 'http(s) 以外は使わない');
  const long = 'https://drive.example.com/' + 'a'.repeat(40);
  assert.deepEqual(parseWhereFroms(bplist(['https://lms.example-u.ac.jp/f.pdf', long])), [
    'https://lms.example-u.ac.jp/f.pdf',
    long
  ]);
  assert.deepEqual(parseWhereFroms(Buffer.from('not a plist')), []);
  // 読み方は OS ごと（Mac は [ファイル, ページ] を [ページ, ファイル] にそろえる）
  const win = await readSource('C:/d/a.pdf', {
    platform: 'win32',
    readFile: async (f) => (assert.equal(f, 'C:/d/a.pdf:Zone.Identifier'), zone)
  });
  assert.equal(win[0], 'https://lcu.iris-info.aichi-edu.ac.jp/lcu-web/SC_01');
  const hex = bplist(['https://a.example-u.ac.jp/f.pdf', 'https://a.example-u.ac.jp/page']).toString('hex');
  const mac = await readSource('/d/a.pdf', {platform: 'darwin', exec: async () => hex.replace(/(..)/g, '$1 ')});
  assert.deepEqual(mac, ['https://a.example-u.ac.jp/page', 'https://a.example-u.ac.jp/f.pdf']);
  assert.deepEqual(await readSource('/d/a.pdf', {platform: 'linux'}), []);
});

test('大学のサイトか見分ける：つないだホスト・同じ組織のドメイン・足したサイト。分からなければ unknown', () => {
  const o = {hosts: ['manabo.example-u.ac.jp'], domain: 'aichi-edu.ac.jp', sites: ['drive.example.com']};
  assert.deepEqual(judgeSource(['https://lcu.iris-info.aichi-edu.ac.jp/x'], o), {
    kind: 'university',
    host: 'lcu.iris-info.aichi-edu.ac.jp'
  });
  assert.equal(judgeSource(['https://manabo.example-u.ac.jp/class/1'], o).kind, 'university');
  assert.equal(judgeSource(['https://drive.example.com/file'], o).kind, 'university');
  assert.equal(judgeSource(['https://x.drive.example.com/file'], o).kind, 'university', '足したサイトの下のホスト');
  assert.deepEqual(judgeSource(['https://shop.example.com/a.pdf'], o), {kind: 'other', host: 'shop.example.com'});
  assert.equal(
    judgeSource(['https://www.nagoya-u.ac.jp/a.pdf'], o).kind,
    'other',
    'ほかの大学の ac.jp は大学のサイトにしない'
  );
  assert.equal(judgeSource(['https://evil.example.com/?u=aichi-edu.ac.jp'], o).kind, 'other');
  // 開いていたページが大学なら、ファイルがほかのサービスにあっても大学
  assert.equal(
    judgeSource(['https://lcu.iris-info.aichi-edu.ac.jp/p', 'https://cdn.example.net/f.pdf'], o).kind,
    'university'
  );
  assert.deepEqual(judgeSource([], o), {kind: 'unknown', host: ''});
  assert.equal(
    judgeSource(['https://lcu.iris-info.aichi-edu.ac.jp/x'], {}).kind,
    'other',
    '大学を登録していなければ大学とは分からない'
  );
  assert.equal(domainOf('https://www.aichi-edu.ac.jp/'), 'aichi-edu.ac.jp');
  assert.equal(domainOf('lcu.iris-info.aichi-edu.ac.jp'), 'aichi-edu.ac.jp');
  assert.equal(domainOf(''), '');
  assert.equal(domainOf('not a url'), '');
  assert.equal(siteHost('https://Drive.Example.com/x'), 'drive.example.com');
  assert.equal(siteHost('localhost'), '');
});

const COURSES = [
  {id: 'c1', name: '管理会計Ⅱ（金曜／2限）', kind: 'lms', weekday: '金', period: 2},
  {id: 'c2', name: '経済学原論', kind: 'lms', weekday: '月', period: 1},
  {id: 'f1', name: 'ゼミ', kind: 'folder'}
];
const ROUNDS = {
  c1: [
    {id: 'r1', course_id: 'c1', number: 1, date: '2026-10-02'},
    {id: 'r3', course_id: 'c1', number: 3, date: '2026-10-16'}
  ],
  c2: [{id: 'r21', course_id: 'c2', number: 2, date: '2026-10-12'}]
};
const PERIODS = {1: '09:00', 2: '10:45'};
const at = (iso) => new Date(iso); // 日本時間は +09:00 で書く

test('授業と回の推定：ファイル名の授業名・落とした時刻と時間割・回の番号・授業日', () => {
  const g = (name, when) =>
    guessPlace({name, at: at(when), courses: COURSES, roundsOf: (id) => ROUNDS[id] ?? [], periodsOf: () => PERIODS});
  // ① 授業名（添え書きの曜日・時限は見ない）＋ 回の番号
  assert.deepEqual(g('管理会計Ⅱ_第3回.pdf', '2026-10-20T20:00:00+09:00'), {courseId: 'c1', roundId: 'r3', by: 'name'});
  // ② 金曜 2 限（10:45〜）の最中に落とした → 管理会計Ⅱ。回は授業日（10/16）
  assert.deepEqual(g('slide.pdf', '2026-10-16T11:30:00+09:00'), {courseId: 'c1', roundId: 'r3', by: 'time'});
  // 授業の 20 分前から終わって 1 時間後まで
  assert.equal(g('slide.pdf', '2026-10-16T10:20:00+09:00').courseId, null);
  assert.equal(g('slide.pdf', '2026-10-16T13:30:00+09:00').courseId, 'c1');
  // 回の番号があるのにその回がまだないときは、日付で決めない（振り分けで選ぶ）
  assert.deepEqual(g('経済学原論 第5回.pptx', '2026-10-12T20:00:00+09:00'), {
    courseId: 'c2',
    roundId: null,
    by: 'name'
  });
  // 番号がなければ、今日か 6 日前までの授業日の回
  assert.equal(g('経済学原論 資料.pdf', '2026-10-14T20:00:00+09:00').roundId, 'r21');
  assert.equal(g('経済学原論 資料.pdf', '2026-10-30T20:00:00+09:00').roundId, null);
  // 自分のフォルダ（回はない）
  assert.deepEqual(g('ゼミ発表.docx', '2026-10-14T20:00:00+09:00'), {courseId: 'f1', roundId: null, by: 'name'});
  // 何も分からない
  assert.deepEqual(g('document.pdf', '2026-10-14T20:00:00+09:00'), {courseId: null, roundId: null, by: null});
});

/** 見張りを動かさずに、1 つのファイルを処理する（handle）。repo・files・folders はテスト用の小さなもの */
async function setup(t, settings = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dn-import-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const store = {'import.enabled': true, 'profile.universityDomain': 'aichi-edu.ac.jp', ...settings};
  const added = [];
  const term = {
    id: 't1',
    year: 2026,
    label: '後期',
    start_date: '2026-10-01',
    end_date: '2027-02-01',
    periods_json: JSON.stringify(PERIODS)
  };
  const courses = COURSES.map((c) => ({
    ...c,
    term_id: 't1',
    ...(c.kind === 'folder' ? {scope: 'always', dir: path.join(dir, 'ゼミ')} : {})
  }));
  const repo = {
    getSetting: (k, d) => (k in store ? store[k] : d),
    setSetting: (k, v) => (store[k] = v),
    listTerms: () => [term],
    listCourses: () => courses,
    listConnections: () => [],
    listRounds: (id) => ROUNDS[id] ?? [],
    get: (table, id) =>
      table === 'term'
        ? term
        : table === 'course'
          ? courses.find((c) => c.id === id)
          : Object.values(ROUNDS)
              .flat()
              .find((r) => r.id === id)
  };
  const files = {
    addOwn: async (p) => (
      added.push({course: p.course.id, round: p.round?.id ?? null, name: p.name, size: p.data.length}),
      {result: 'saved'}
    )
  };
  const folders = {roundOf: () => ({id: 'f1-root'})};
  const events = [];
  const urls = {};
  const importer = createImporter({
    repo,
    files,
    folders,
    rootDir: () => dir,
    downloadsDir: () => dir,
    notify: (ch, p) => events.push([ch, p]),
    now: () => new Date('2026-10-16T11:30:00+09:00'),
    source: async (f) => urls[path.basename(f)] ?? []
  });
  const put = async (name, body = 'pdf', when = '2026-10-16T11:30:00+09:00') => {
    const f = path.join(dir, name);
    await writeFile(f, body);
    const t0 = new Date(when); // 落とした時刻（既定は見張りの「今」と同じ。金曜 2 限の最中）
    await utimes(f, t0, t0);
    return f;
  };
  return {dir, store, added, events, urls, importer, put};
}

test('ダウンロード：大学と関係のないサイトのものは何もしない。大学のものは聞く（自動にすれば入れる）。分からないものは聞く', async (t) => {
  const s = await setup(t);
  s.urls['shop.pdf'] = ['https://shop.example.com/shop.pdf'];
  assert.equal((await s.importer.handle(await s.put('shop.pdf'), 'downloads')).skipped, 'other');
  assert.equal(s.importer.list().length, 0, '振り分け待ちにも入れない');

  s.urls['管理会計Ⅱ 第3回.pdf'] = ['https://lcu.iris-info.aichi-edu.ac.jp/lcu-web/SC'];
  const r = await s.importer.handle(await s.put('管理会計Ⅱ 第3回.pdf'), 'downloads');
  assert.ok(r.pending, '既定は聞く');
  const [p] = s.importer.list();
  assert.equal(p.courseId, 'c1');
  assert.equal(p.roundId, 'r3');
  assert.equal(p.source, 'university');
  assert.equal(s.events.at(-1)[0], 'import.pending');
  assert.deepEqual(s.added, [], 'まだ入れていない');

  // 本人が選んで入れる（元のファイルは残す）
  const done = await s.importer.accept(p.id, 'c1', 'r3');
  assert.equal(done.result, 'saved');
  assert.deepEqual(s.added, [{course: 'c1', round: 'r3', name: '管理会計Ⅱ 第3回.pdf', size: 3}]);
  assert.ok(await stat(path.join(s.dir, '管理会計Ⅱ 第3回.pdf')), 'ダウンロードしたファイルは消さない');
  assert.equal(s.importer.list().length, 0);

  // ダウンロード元が分からない：勝手には入れず聞く
  s.store['import.mode'] = 'auto';
  const u = await s.importer.handle(await s.put('経済学原論 資料.pdf'), 'downloads');
  assert.ok(u.pending);
  assert.equal(s.importer.list()[0].source, 'unknown');
  // 自動にすると、大学のサイトのもので授業と回が分かれば聞かずに入れる
  s.urls['slide.pdf'] = ['https://www.aichi-edu.ac.jp/x'];
  const a = await s.importer.handle(await s.put('slide.pdf', 'slide'), 'downloads');
  assert.equal(a.imported, 'saved');
  assert.equal(s.added.at(-1).course, 'c1', '金曜 2 限の最中に落とした');
  assert.equal(s.events.at(-1)[0], 'import.done');
  // 同じファイルは 2 度扱わない・種類の違うもの・書きかけは見ない
  assert.equal((await s.importer.handle(path.join(s.dir, 'slide.pdf'), 'downloads')).skipped, 'seen');
  assert.equal((await s.importer.handle(await s.put('a.zip'), 'downloads')).skipped, 'type');
  assert.equal((await s.importer.handle(await s.put('a.pdf.crdownload'), 'downloads')).skipped, 'type');
  // 外すだけならファイルはそのまま
  const id = s.importer.list()[0].id;
  s.importer.dismiss(id);
  assert.equal(s.importer.list().length, 0);
});

test('取り込みフォルダ：本人が置いたものは推定できたら入れて取り込みフォルダから消す。できなければ聞く', async (t) => {
  const s = await setup(t);
  const f = await s.put('ゼミ 資料.pdf');
  const r = await s.importer.handle(f, 'folder');
  assert.equal(r.imported, 'saved');
  assert.deepEqual(s.added[0], {course: 'f1', round: 'f1-root', name: 'ゼミ 資料.pdf', size: 3});
  await assert.rejects(stat(f), '入れたら取り込みフォルダから消す');
  const g = await s.importer.handle(await s.put('document.pdf', 'pdf', '2026-10-16T20:00:00+09:00'), 'folder');
  assert.ok(g.pending);
  assert.equal(s.importer.list()[0].from, 'folder');
  // 置いたファイルが消えていたら、振り分け待ちからも外して知らせる
  await rm(path.join(s.dir, 'document.pdf'));
  await assert.rejects(s.importer.accept(s.importer.list()[0].id, 'c2'), /見つかりません/);
  assert.equal(s.importer.list().length, 0);
});

test('すでにダウンロードにあったファイル：今学期の期間にダウンロードしたものだけ取り込む。探し直しても同じものは聞かない', async (t) => {
  const s = await setup(t);
  s.urls['old-term.pdf'] = ['https://www.aichi-edu.ac.jp/a'];
  s.urls['in-term.pdf'] = ['https://www.aichi-edu.ac.jp/b'];
  s.urls['shop.pdf'] = ['https://shop.example.com/c'];
  await s.put('old-term.pdf', 'a', '2026-09-20T12:00:00+09:00'); // 学期（10/1〜）の前
  await s.put('in-term.pdf', 'b', '2026-10-05T20:00:00+09:00');
  await s.put('shop.pdf', 'c', '2026-10-06T20:00:00+09:00');
  await s.put('notes.txt', 'd', '2026-10-06T20:00:00+09:00'); // 種類が違う
  const r = await s.importer.scanExisting();
  assert.deepEqual(r, {term: '2026 後期', checked: 2, outside: 1, other: 1, pending: 1, imported: 0});
  assert.deepEqual(
    s.importer.list().map((p) => p.name),
    ['in-term.pdf']
  );
  assert.deepEqual(
    s.events.map(([ch]) => ch),
    ['import.scanned'],
    '知らせはまとめて 1 回'
  );
  // 外してから探し直しても、もう聞かない
  s.importer.dismiss(s.importer.list()[0].id);
  const again = await s.importer.scanExisting();
  assert.equal(again.pending, 0);
  assert.equal(s.importer.list().length, 0);
});

test('すでにダウンロードにあったファイル：今学期がなければ探さない', async (t) => {
  const s = await setup(t);
  s.importer.close();
  const none = createImporter({
    repo: {getSetting: (k, d) => d, setSetting: () => {}, listTerms: () => []},
    files: {},
    folders: {},
    rootDir: () => s.dir,
    downloadsDir: () => s.dir
  });
  assert.deepEqual(await none.scanExisting(), {noTerm: true});
});
