// iPad アプリ：パソコンの QR（スマホを追加の URL）を読む。副作用なし（テストで読む）
/**
 * 家庭や大学の内向きの番号（10.x・172.16〜31.x・192.168.x）か。パソコンが QR に入れるのはこの番号だけ（main/mobile/server.js の lanAddresses）。
 * アプリの中で開いたページは iPad の機能（ファイル・設定の保存）に届くので、外の番号や名前の先は開かない（細工した QR を読ませても開かない）
 */
export function lanHost(hostname) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(hostname ?? ''));
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** 覚えてあるパソコンの入口（http://<LAN の番号>:<番号>）として正しいか */
export function lanBase(base) {
  try {
    const u = new URL(String(base));
    return u.protocol === 'http:' && lanHost(u.hostname) && u.origin === String(base);
  } catch {
    return false;
  }
}

/** QR の中身（パソコンのページの URL）→ {base, hash}。違う形・LAN の番号でない先なら null */
export function fromQr(text) {
  let u;
  try {
    u = new URL(String(text).trim());
  } catch {
    return null;
  }
  const p = new URLSearchParams(u.hash.replace(/^#/, ''));
  if (!p.get('d') || !p.get('k') || u.pathname !== '/m/' || !lanHost(u.hostname)) return null;
  const hp = Number(p.get('hp'));
  const base = Number.isInteger(hp) && hp > 0 ? `http://${u.hostname}:${hp}` : u.protocol === 'http:' ? u.origin : null;
  return base ? {base, hash: u.hash} : null;
}
