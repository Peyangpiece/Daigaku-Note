-- LMS の一覧から外れたので同期を止めた授業の印（1）。一覧に戻ってきたら同期を戻す。本人が止めた授業は 0 のまま
ALTER TABLE course ADD COLUMN lms_missing INTEGER NOT NULL DEFAULT 0;
-- 前の版で、一覧から外れて止まったままの LMS の授業に印を付ける（次に一覧に出てきたら同期が戻る）。
-- 本人が止めた授業は、ホームから外したときに hidden も 1 になっているので当たらない
UPDATE course SET lms_missing = 1 WHERE sync_enabled = 0 AND hidden = 0 AND connection_id IS NOT NULL;
