-- 誤答ごとの「なぜ違うか」（クイズの解説。o と同じ順の文字列の配列。前の版の問題は NULL）
ALTER TABLE question ADD COLUMN why_json TEXT;
