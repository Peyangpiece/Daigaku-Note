// 表ごとの読み書き（DESIGN-M0 §5）。SQL はこのファイルの外に出さない。列名は表ごとの一覧で縛る。
import {ulid} from '../../shared/ids.js';

const COLUMNS = {
  connection: [
    'id', 'kind', 'connector_id', 'label', 'base_url', 'university_host', 'recipe_version', 'save_password',
    'session_json', 'status', 'last_sync_at', 'allowed_hosts_json', 'created_at', 'updated_at'
  ],
  term: ['id', 'label', 'year', 'folder', 'start_date', 'end_date', 'rounds', 'holidays_json', 'periods_json', 'source'],
  course: [
    'id', 'term_id', 'connection_id', 'lms_id', 'lms_url', 'name', 'folder_name', 'weekday', 'period', 'weekday_from',
    'color', 'tape_pattern', 'sort_order', 'hidden', 'sync_enabled', 'generic_json', 'font_json', 'quiz_json', 'full_synced_at',
    'created_at', 'updated_at'
  ],
  round: ['id', 'course_id', 'number', 'title', 'title_user', 'folder_name', 'date', 'lms_ref'],
  round_note: ['round_id', 'body', 'updated_at'],
  material: [
    'id', 'course_id', 'round_id', 'round_from', 'url', 'name', 'path', 'sha256', 'size', 'mime', 'pages', 'layout',
    'version', 'lms_modified', 'source', 'status', 'read_at', 'downloaded_at'
  ],
  sync_run: ['id', 'connection_id', 'kind', 'course_id', 'started_at', 'finished_at', 'courses', 'materials', 'failures', 'timing_json'],
  sync_event: ['id', 'run_id', 'level', 'course_id', 'code', 'message', 'at'],
  job: ['id', 'kind', 'payload_json', 'status', 'result_json', 'tries', 'created_at', 'updated_at'],
  annotation: ['id', 'sha256', 'page', 'kind', 'rect_json', 'body', 'style_json', 'memorized', 'z', 'created_at', 'updated_at']
};

const now = () => new Date().toISOString();

function pick(table, row) {
  const cols = COLUMNS[table];
  if (!cols) throw new Error(`知らない表: ${table}`);
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (!cols.includes(k)) throw new Error(`${table} に列 ${k} はありません`);
    out[k] = v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  return out;
}

export class Repo {
  constructor(db) {
    this.db = db;
  }

  // ---- 共通 ----
  insert(table, row) {
    const r = pick(table, row);
    const keys = Object.keys(r);
    this.db
      .prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .run(...keys.map((k) => r[k]));
    return r;
  }
  update(table, id, patch, idColumn = 'id') {
    const r = pick(table, patch);
    const keys = Object.keys(r);
    if (!keys.length) return;
    this.db
      .prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${idColumn} = ?`)
      .run(...keys.map((k) => r[k]), id);
  }
  get(table, id, idColumn = 'id') {
    if (!COLUMNS[table]) throw new Error(`知らない表: ${table}`);
    return this.db.prepare(`SELECT * FROM ${table} WHERE ${idColumn} = ?`).get(id) ?? null;
  }
  remove(table, id, idColumn = 'id') {
    if (!COLUMNS[table]) throw new Error(`知らない表: ${table}`);
    this.db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = ?`).run(id);
  }
  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---- settings ----
  getSetting(key, fallback = null) {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return r ? JSON.parse(r.value) : fallback;
  }
  setSetting(key, value) {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  // ---- connection ----
  createConnection({kind, connector_id, label, base_url = null, university_host = null, recipe_version = null}) {
    const t = now();
    return this.insert('connection', {
      id: ulid(), kind, connector_id, label, base_url, university_host, recipe_version,
      save_password: 0, session_json: null, status: 'ok', last_sync_at: null, created_at: t, updated_at: t
    });
  }
  listConnections() {
    return this.db.prepare('SELECT * FROM connection ORDER BY created_at').all();
  }
  updateConnection(id, patch) {
    this.update('connection', id, {...patch, updated_at: now()});
  }

  // ---- term ----
  upsertTerm(term) {
    const r = pick('term', term);
    const keys = Object.keys(r);
    this.db
      .prepare(
        `INSERT INTO term (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})
         ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== 'id').map((k) => `${k} = excluded.${k}`).join(', ')}`
      )
      .run(...keys.map((k) => r[k]));
    return this.get('term', r.id);
  }
  listTerms() {
    return this.db.prepare('SELECT * FROM term ORDER BY start_date').all();
  }

  // ---- course ----
  listCourses({termId = null, connectionId = null} = {}) {
    const where = [],
      args = [];
    if (termId) where.push('term_id = ?'), args.push(termId);
    if (connectionId) where.push('connection_id = ?'), args.push(connectionId);
    return this.db
      .prepare(`SELECT * FROM course ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sort_order, name`)
      .all(...args);
  }
  findCourseByLms(connectionId, lmsId) {
    return this.db.prepare('SELECT * FROM course WHERE connection_id = ? AND lms_id = ?').get(connectionId, String(lmsId)) ?? null;
  }
  courseFolderNames(termId) {
    return this.db.prepare('SELECT folder_name FROM course WHERE term_id = ?').all(termId).map((r) => r.folder_name);
  }
  createCourse(row) {
    const t = now();
    const maxOrder = this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM course WHERE term_id = ?').get(row.term_id).m;
    const count = this.db.prepare('SELECT COUNT(*) c FROM course WHERE term_id = ?').get(row.term_id).c;
    return this.insert('course', {
      id: ulid(), color: (count % 8) + 1, sort_order: maxOrder + 1, created_at: t, updated_at: t, ...row
    });
  }
  updateCourse(id, patch) {
    this.update('course', id, {...patch, updated_at: now()});
    return this.get('course', id);
  }

  // ---- round ----
  listRounds(courseId) {
    return this.db.prepare('SELECT * FROM round WHERE course_id = ? ORDER BY number').all(courseId);
  }
  findRound(courseId, number) {
    return this.db.prepare('SELECT * FROM round WHERE course_id = ? AND number = ?').get(courseId, number) ?? null;
  }
  createRound(row) {
    return this.insert('round', {id: ulid(), ...row});
  }
  updateRound(id, patch) {
    this.update('round', id, patch);
    return this.get('round', id);
  }

  // ---- material ----
  listMaterials(courseId) {
    return this.db.prepare('SELECT * FROM material WHERE course_id = ? ORDER BY downloaded_at').all(courseId);
  }
  listMaterialsByRound(roundId) {
    return this.db.prepare('SELECT * FROM material WHERE round_id = ? ORDER BY name').all(roundId);
  }
  findMaterialsByUrl(url) {
    return this.db.prepare('SELECT * FROM material WHERE url = ?').all(url);
  }
  findMaterialByHash(courseId, sha256) {
    return this.db.prepare('SELECT * FROM material WHERE course_id = ? AND sha256 = ?').get(courseId, sha256) ?? null;
  }
  createMaterial(row) {
    return this.insert('material', {id: ulid(), downloaded_at: now(), ...row});
  }
  updateMaterial(id, patch) {
    this.update('material', id, patch);
    return this.get('material', id);
  }
  countUnread(courseId) {
    return this.db.prepare("SELECT COUNT(*) c FROM material WHERE course_id = ? AND read_at IS NULL AND status = 'ok'").get(courseId).c;
  }

  // ---- annotation（SPEC §9.6：ファイルの SHA-256 に結び付ける。パスではない）----
  listAnnotations(sha256) {
    return this.db.prepare('SELECT * FROM annotation WHERE sha256 = ? ORDER BY page, z, created_at').all(sha256);
  }
  /** 新しい注釈は id なしで渡す。既存の注釈は同じファイルのものだけ書き換える */
  saveAnnotation(sha256, id, row) {
    const t = now();
    if (!id) {
      const z = this.db.prepare('SELECT COALESCE(MAX(z), 0) m FROM annotation WHERE sha256 = ? AND page = ?').get(sha256, row.page).m;
      return this.insert('annotation', {id: ulid(), sha256, z: z + 1, created_at: t, updated_at: t, ...row});
    }
    const cur = this.get('annotation', id);
    if (!cur || cur.sha256 !== sha256) throw new Error('注釈がありません');
    this.update('annotation', id, {...row, updated_at: t});
    return this.get('annotation', id);
  }
  removeAnnotation(sha256, id) {
    this.db.prepare('DELETE FROM annotation WHERE id = ? AND sha256 = ?').run(id, sha256);
  }

  // ---- sync ----
  startSyncRun({connection_id = null, kind, course_id = null}) {
    return this.insert('sync_run', {id: ulid(), connection_id, kind, course_id, started_at: now()});
  }
  finishSyncRun(id, {courses, materials, failures, timing}) {
    this.update('sync_run', id, {finished_at: now(), courses, materials, failures, timing_json: JSON.stringify(timing ?? {})});
  }
  addSyncEvent(run_id, {level, course_id = null, code = null, message}) {
    return this.insert('sync_event', {id: ulid(), run_id, level, course_id, code, message: String(message).slice(0, 500), at: now()});
  }
  lastSyncRun(connectionId = null) {
    return connectionId
      ? this.db.prepare('SELECT * FROM sync_run WHERE connection_id = ? AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1').get(connectionId) ?? null
      : this.db.prepare('SELECT * FROM sync_run WHERE finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1').get() ?? null;
  }

  // ---- job ----
  enqueueJob(kind, payload = {}) {
    const t = now();
    return this.insert('job', {id: ulid(), kind, payload_json: JSON.stringify(payload), status: 'pending', tries: 0, created_at: t, updated_at: t});
  }
  claimJob() {
    const j = this.db.prepare("SELECT * FROM job WHERE status IN ('pending','waiting') ORDER BY created_at LIMIT 1").get();
    if (!j) return null;
    this.update('job', j.id, {status: 'running', tries: j.tries + 1, updated_at: now()});
    return {...j, status: 'running', tries: j.tries + 1, payload: JSON.parse(j.payload_json)};
  }
  finishJob(id, status, result = null) {
    this.update('job', id, {status, result_json: result == null ? null : JSON.stringify(result), updated_at: now()});
  }
  pendingJobs() {
    return this.db.prepare("SELECT * FROM job WHERE status IN ('pending','waiting','running') ORDER BY created_at").all();
  }
}
