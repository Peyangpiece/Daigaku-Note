-- 0007：着せ替え（SPEC-KISEKAE.md §9）
-- skin_template：自作のテンプレート。json は shared/skin.js の normalizeTemplate を通した形（はじめからあるものはコードの中）
CREATE TABLE IF NOT EXISTS skin_template (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- sticker：シールの素。id は画像（PNG に描き直したもの）の SHA-256。画像はアプリのデータの場所の stickers/<id>.png
-- shape：形（cut 形どおり・square そのまま・round 角丸・circle 丸・framed 白いふち付き）
CREATE TABLE IF NOT EXISTS sticker (
  id TEXT PRIMARY KEY,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  shape TEXT NOT NULL DEFAULT 'cut',
  folder TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
-- 授業のテンプレート（空なら全体と同じ）と、シールの重ね方（global・course・both）
ALTER TABLE course ADD COLUMN skin_template_id TEXT;
ALTER TABLE course ADD COLUMN sticker_mode TEXT NOT NULL DEFAULT 'global';
