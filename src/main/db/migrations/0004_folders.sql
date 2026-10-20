-- 0004：自分のフォルダ。kind = 'folder' の授業は LMS ではなく、パソコンのフォルダ（dir）の中身をそのまま見せる。
-- scope：'term'（その学期のあいだホームに出す）・'always'（マイフォルダ。学期が変わっても出す）
ALTER TABLE course ADD COLUMN kind TEXT NOT NULL DEFAULT 'lms';
ALTER TABLE course ADD COLUMN dir TEXT;
ALTER TABLE course ADD COLUMN scope TEXT;
