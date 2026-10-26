-- 0009：学年暦の授業回（SPEC §6.14）。曜日ごとの第 1 回〜最終回の授業日（学年暦の丸数字の日）を学期に持つ
-- class_dates_json：{"月": ["YYYY-MM-DD", …], …}。第 N 回の日付はその曜日の N 番目の日（計算より優先）
ALTER TABLE term ADD COLUMN class_dates_json TEXT;
