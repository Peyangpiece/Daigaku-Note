-- 資料の本文の、探すときに比べる形（NFKC・小文字・空白なし。shared/search.js）。前からある行は、探すときに足す（main/search.js）
ALTER TABLE material_text ADD COLUMN norm TEXT;
