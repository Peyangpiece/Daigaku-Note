// iPad アプリ：パソコンの QR（スマホを追加の URL）を読む。副作用なし（テストで読む）
/** QR の中身（パソコンのページの URL）→ {base, hash}。違う形なら null */
export function fromQr(text) {
  let u;
  try {
    u = new URL(String(text).trim());
  } catch {
    return null;
  }
  const p = new URLSearchParams(u.hash.replace(/^#/, ''));
  if (!p.get('d') || !p.get('k') || u.pathname !== '/m/') return null;
  const hp = Number(p.get('hp'));
  const base = Number.isInteger(hp) && hp > 0 ? `http://${u.hostname}:${hp}` : u.protocol === 'http:' ? u.origin : null;
  return base ? {base, hash: u.hash} : null;
}
