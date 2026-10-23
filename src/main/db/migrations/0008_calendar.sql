-- 0008：学年暦（SPEC §6.14）。振替授業日（その日に別の曜日の授業を行う。祝日に授業を行う日も含む）を学期に持つ
-- swaps_json：[{date: 'YYYY-MM-DD', weekday: '月'}, …]。休講日は今までどおり holidays_json（日付の配列）
ALTER TABLE term ADD COLUMN swaps_json TEXT;
