// Google のデスクトップ アプリのクライアントの秘密（docs/SYNC.md §2）。リポジトリには入れない：
// - 配布物：Release が GitHub の Secrets（GOOGLE_DESKTOP_CLIENT_SECRET）から google-client-secret.txt に書いて入れる
// - 手元で動かすとき：環境変数 GOOGLE_DESKTOP_CLIENT_SECRET
// インストール型のアプリの秘密は配布物に入るので、Google の決まりでは秘密として扱われない（リポジトリに置かないのは、置き場を絞るため）
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const SECRET_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'google-client-secret.txt');

export function loadClientSecret({env = process.env, file = SECRET_FILE, read = readFileSync} = {}) {
  const fromEnv = String(env.GOOGLE_DESKTOP_CLIENT_SECRET ?? '').trim();
  if (fromEnv) return fromEnv;
  try {
    return String(read(file, 'utf8')).trim();
  } catch {
    return '';
  }
}
