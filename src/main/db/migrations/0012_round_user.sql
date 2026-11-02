-- 0012：自分で足した付箋（回）の印（SPEC §8.2「付箋を足す」）。足した付箋だけ消せる（LMS の回は消さない）
ALTER TABLE round ADD COLUMN user_made INTEGER NOT NULL DEFAULT 0;
