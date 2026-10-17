-- 0003：授業ごとに「全部の回を確かめ終えた日時」を持つ（SPEC §6.7）。NULL なら次の同期で全部の回を見る
ALTER TABLE course ADD COLUMN full_synced_at TEXT;
