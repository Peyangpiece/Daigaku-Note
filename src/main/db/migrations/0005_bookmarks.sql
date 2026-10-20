-- 0005：しおり（PDF のページの位置に名前を付けて、すぐ戻れるようにする）。注釈と同じくファイルの SHA-256 に結び付ける（パスではない）
-- y：ページの上端からの位置（0〜1。ページの高さに対する割合なので、拡大率が変わっても同じ場所を指す）
CREATE TABLE IF NOT EXISTS bookmark (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  page INTEGER NOT NULL,
  y REAL NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bookmark_sha256 ON bookmark(sha256);
