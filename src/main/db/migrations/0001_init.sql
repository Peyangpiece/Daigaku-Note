-- 大学ノート 0001：初期スキーマ（SPEC §13）
CREATE TABLE IF NOT EXISTS connection (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  label TEXT NOT NULL,
  base_url TEXT,
  university_host TEXT,
  recipe_version TEXT,
  save_password INTEGER NOT NULL DEFAULT 0,
  session_json TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  last_sync_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS term (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  year INTEGER NOT NULL,
  folder TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  rounds INTEGER NOT NULL DEFAULT 15,
  holidays_json TEXT,
  periods_json TEXT,
  source TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS course (
  id TEXT PRIMARY KEY,
  term_id TEXT NOT NULL REFERENCES term(id),
  connection_id TEXT REFERENCES connection(id),
  lms_id TEXT,
  lms_url TEXT,
  name TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  weekday TEXT,
  period INTEGER,
  weekday_from TEXT,
  color INTEGER NOT NULL DEFAULT 1,
  tape_pattern TEXT NOT NULL DEFAULT 'plain',
  sort_order INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  sync_enabled INTEGER NOT NULL DEFAULT 1,
  generic_json TEXT,
  font_json TEXT,
  quiz_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connection_id, lms_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS course_folder ON course(term_id, folder_name);

CREATE TABLE IF NOT EXISTS round (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES course(id),
  number INTEGER NOT NULL,
  title TEXT,
  title_user TEXT,
  folder_name TEXT NOT NULL,
  date TEXT,
  lms_ref TEXT,
  UNIQUE(course_id, number),
  UNIQUE(course_id, folder_name)
);

CREATE TABLE IF NOT EXISTS round_note (
  round_id TEXT PRIMARY KEY REFERENCES round(id),
  body TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS material (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES course(id),
  round_id TEXT REFERENCES round(id),
  round_from TEXT NOT NULL DEFAULT 'lms',
  url TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT,
  pages INTEGER,
  layout INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  lms_modified TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  read_at TEXT,
  downloaded_at TEXT NOT NULL,
  UNIQUE(course_id, sha256)
);
CREATE INDEX IF NOT EXISTS material_url ON material(url);
CREATE INDEX IF NOT EXISTS material_round ON material(round_id);

CREATE TABLE IF NOT EXISTS material_text (
  sha256 TEXT NOT NULL,
  page INTEGER NOT NULL,
  text TEXT NOT NULL,
  method TEXT NOT NULL,
  PRIMARY KEY(sha256, page)
);

CREATE TABLE IF NOT EXISTS annotation (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  page INTEGER NOT NULL,
  kind TEXT NOT NULL,
  rect_json TEXT NOT NULL,
  body TEXT,
  style_json TEXT,
  memorized INTEGER,
  z INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS annotation_file ON annotation(sha256, page);

CREATE TABLE IF NOT EXISTS quiz (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES round(id),
  version INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  source_json TEXT NOT NULL,
  generated_by TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quiz(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  q TEXT NOT NULL,
  a TEXT NOT NULL,
  o_json TEXT,
  n TEXT NOT NULL,
  src_sha256 TEXT,
  src_page INTEGER,
  src_quote TEXT,
  tags_json TEXT,
  difficulty INTEGER,
  review TEXT,
  report_reason TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempt (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES question(id),
  mode TEXT NOT NULL,
  ok INTEGER NOT NULL,
  answer TEXT,
  seconds INTEGER,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attempt_q ON attempt(question_id, at);

CREATE TABLE IF NOT EXISTS srs (
  question_id TEXT PRIMARY KEY REFERENCES question(id),
  s INTEGER NOT NULL,
  due TEXT NOT NULL,
  at TEXT NOT NULL,
  c INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  quiz_id TEXT,
  model TEXT NOT NULL,
  input INTEGER,
  output INTEGER,
  cache_read INTEGER,
  cache_write INTEGER,
  cost_usd REAL,
  purpose TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_run (
  id TEXT PRIMARY KEY,
  connection_id TEXT,
  kind TEXT NOT NULL,
  course_id TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  courses INTEGER,
  materials INTEGER,
  failures INTEGER,
  timing_json TEXT
);

CREATE TABLE IF NOT EXISTS sync_event (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES sync_run(id),
  level TEXT NOT NULL,
  course_id TEXT,
  code TEXT,
  message TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result_json TEXT,
  tries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_status ON job(status, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
