-- 0002：接続に、ログイン中に訪れた認証のホスト（許可するホスト）を持たせる（SPEC §6.4、DESIGN-M0 §8.5）
ALTER TABLE connection ADD COLUMN allowed_hosts_json TEXT;
