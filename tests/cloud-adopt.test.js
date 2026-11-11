// iPad のデータをパソコンに取り込む（docs/SYNC.md §12）：iPad が送ったもの（createPusher の origin: 'ipad'）を、
// パソコンの場所に置き直し、データベースは次の起動で入れ替える。このパソコンだけの設定はパソコンのものを残す
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase} from '../src/main/db/db.js';
import {exportBackup, RESTORE_FILE} from '../src/main/backup.js';
import {createPusher} from '../src/main/cloud/sync.js';
import {newMasterKey} from '../src/main/cloud/keys.js';
import {ADOPTED, IPAD_ROOT, adoptIpad, mapPath} from '../src/main/cloud/adopt.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');

function memDrive() {
  const files = new Map();
  let n = 0;
  return {
    files,
    list: async () => [...files].map(([id, f]) => ({id, name: f.name, size: f.bytes.length})),
    put: async (name, bytes, id = null) => {
      const key = id ?? `id${++n}`;
      files.set(key, {name: id ? files.get(id).name : name, bytes});
      return {id: key};
    },
    get: async (id) => files.get(id).bytes,
    remove: async (id) => void files.delete(id)
  };
}

/** iPad だけで使っていた人のデータを、iPad と同じやり方でドライブへ送る */
async function ipadPushed() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dn-adopt-ipad-'));
  const {db} = await openDatabase(path.join(dir, 'ipad.sqlite'));
  db.exec('PRAGMA foreign_keys = OFF');
  const pdf = Buffer.from('%PDF-元');
  const doc = Buffer.from('DOCX');
  const ins = db.prepare(
    `INSERT INTO material (id, course_id, name, path, sha256, size, source, downloaded_at, base_sha256)
     VALUES (?, 'C1', ?, ?, ?, ?, 'ipad', '2026-11-01', ?)`
  );
  ins.run('M1', 'a.pdf', `${IPAD_ROOT}/2026前期/線形代数/第1回/a.pdf`, sha(Buffer.from('描き込み済み')), 9, sha(pdf));
  ins.run('M2', 'b.docx', '/app/inbox/b.docx', sha(doc), 4, null);
  const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  set.run('ui.theme', JSON.stringify('dark')); // iPad で決めた見た目：取り込む
  set.run('storage.root', JSON.stringify(null));
  set.run('pdf.saving', JSON.stringify({M1: {}}));
  const userData = path.join(dir, 'userData');
  mkdirSync(path.join(userData, 'photos'), {recursive: true});
  writeFileSync(path.join(userData, 'photos', 'p1.jpg'), 'JPG');
  const drive = memDrive();
  const master = newMasterKey();
  const r = await createPusher({
    drive,
    master,
    exportDb: (file) => exportBackup(db, file),
    materials: () => [
      {id: 'M1', status: 'ok', path: 'x.pdf', base_sha256: sha(pdf)},
      {id: 'M2', status: 'ok', path: 'b.docx', sha256: sha(doc)}
    ],
    readMaterial: async (m) => (m.id === 'M1' ? pdf : doc),
    userData,
    device: 'iPad-1',
    origin: 'ipad'
  }).push();
  db.close();
  return {drive, master, pdf, doc, at: r.manifest.at};
}

test('場所：iPad の保存先の下は同じ並びで、それ以外は 保存先/iPad/ に置く（.. は使わない）', () => {
  const root = '/Users/me/Desktop/パレットノート';
  assert.equal(mapPath(`${IPAD_ROOT}/前期/線形代数/a.pdf`, {root}), path.join(root, '前期', '線形代数', 'a.pdf'));
  assert.equal(mapPath('/app/inbox/b.docx', {root}), path.join(root, 'iPad', 'b.docx'));
  assert.equal(mapPath(`${IPAD_ROOT}/../../etc/passwd`, {root}), path.join(root, 'iPad', 'passwd'));
  assert.equal(mapPath('/x/a:b?.pdf', {root}), path.join(root, 'iPad', 'a_b_.pdf'));
});

test('取り込み：資料を保存先に置き、データベースの場所と設定を直して、次の起動での入れ替えを予約する', async () => {
  const {drive, master, pdf, doc, at} = await ipadPushed();
  const pc = mkdtempSync(path.join(tmpdir(), 'dn-adopt-pc-'));
  const userData = path.join(pc, 'userData');
  const root = path.join(pc, 'Desktop', 'パレットノート');
  mkdirSync(userData, {recursive: true});
  // 同じ名前の違うファイルがすでにある → 「(iPad)」をつけて置く
  mkdirSync(path.join(root, 'iPad'), {recursive: true});
  writeFileSync(path.join(root, 'iPad', 'b.docx'), 'ちがう');
  const r = await adoptIpad({
    drive,
    master,
    userData,
    root,
    settings: [
      ['storage.root', root],
      ['cloud.account', {email: 'a@example.com'}],
      ['ui.theme', 'light'], // このパソコンのもの：iPad のもので置き換わる
      ['folder.added', ['/Users/me/x']]
    ],
    open: (f) => new DatabaseSync(f)
  });
  assert.deepEqual([r.materials, r.files, r.device], [2, 1, 'iPad-1']);
  const a = path.join(root, '2026前期', '線形代数', '第1回', 'a.pdf');
  assert.deepEqual(readFileSync(a), pdf);
  assert.deepEqual(readFileSync(path.join(userData, 'originals', `${sha(pdf)}.pdf`)), pdf, '上書き保存の写し');
  const b = path.join(root, 'iPad', 'b (iPad).docx');
  assert.deepEqual(readFileSync(b), doc);
  assert.equal(readFileSync(path.join(root, 'iPad', 'b.docx'), 'utf8'), 'ちがう', 'もとのファイルは消さない');
  assert.equal(readFileSync(path.join(userData, 'photos', 'p1.jpg'), 'utf8'), 'JPG');
  // 予約したデータベース
  const staged = path.join(userData, RESTORE_FILE);
  assert.ok(existsSync(staged));
  assert.ok(!existsSync(path.join(userData, 'palette-adopt.sqlite')), '一時のファイルは消す');
  const db = new DatabaseSync(staged, {readOnly: true});
  const rows = Object.fromEntries(
    db
      .prepare('SELECT id, path, sha256 FROM material')
      .all()
      .map((x) => [x.id, x])
  );
  assert.equal(rows.M1.path, a);
  assert.equal(rows.M1.sha256, sha(pdf));
  assert.equal(rows.M2.path, b);
  const s = Object.fromEntries(
    db
      .prepare('SELECT key, value FROM settings')
      .all()
      .map((x) => [x.key, JSON.parse(x.value)])
  );
  db.close();
  assert.equal(s['storage.root'], root);
  assert.deepEqual(s['cloud.account'], {email: 'a@example.com'});
  assert.deepEqual(s['folder.added'], ['/Users/me/x']);
  assert.equal(s['ui.theme'], 'dark');
  assert.equal(s[ADOPTED], at);
  assert.ok(!('pdf.saving' in s));
});

test('取り込み：パソコンが送ったデータ・鍵が違うときは取り込まない', async () => {
  const {drive, master} = await ipadPushed();
  const pc = mkdtempSync(path.join(tmpdir(), 'dn-adopt-pc2-'));
  const deps = {userData: pc, root: pc, settings: [], open: (f) => new DatabaseSync(f)};
  await assert.rejects(adoptIpad({drive, master: newMasterKey(), ...deps}));
  const pcDrive = memDrive();
  await createPusher({
    drive: pcDrive,
    master,
    exportDb: (f) => writeFileSync(f, 'x'),
    materials: () => [],
    readMaterial: async () => new Uint8Array(),
    userData: pc,
    device: 'pc'
  }).push();
  await assert.rejects(adoptIpad({drive: pcDrive, master, ...deps}), /iPad が送ったものではありません/);
  assert.ok(!existsSync(path.join(pc, RESTORE_FILE)));
});
