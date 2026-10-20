-- 0006：PDF の上書き保存。注釈を描き込んでファイルを上書きしたら、元の PDF の SHA-256 を base_sha256 に残す。
-- 注釈・しおりは base_sha256（なければ sha256）に結び付いたまま。元の PDF の写しは userData/originals/<base_sha256>.pdf
ALTER TABLE material ADD COLUMN base_sha256 TEXT;
