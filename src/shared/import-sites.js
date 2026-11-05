// 授業資料の自動取り込み（v0.17.2）：大学のサイトとして足せるホストの決まり。main（import-source.js・設定）と画面（設定）で使う
const matchHost = (host, h) => host === h || host.endsWith('.' + h);

// 共通のサービス（v0.17.2）：だれの資料でも同じホストなので、「大学のサイト」として足せない（足すと、大学と関係のない
// ファイルまで大学の資料として扱ってしまう）。SharePoint・Box は大学ごとのホスト（〇〇.sharepoint.com・〇〇.app.box.com）なら足せる
const SHARED_EXACT = ['sharepoint.com', 'app.box.com', 'box.com'];
const SHARED_ALL = [
  'microsoft.com',
  'microsoftonline.com',
  'office.com',
  'office.net',
  'office365.com',
  'live.com',
  '1drv.ms',
  'google.com',
  'googleusercontent.com',
  'googleapis.com',
  'dropbox.com',
  'dropboxusercontent.com',
  'icloud.com',
  'amazonaws.com',
  'github.com'
];
/** 共通のサービスのホストか（足せないホスト） */
export const sharedHost = (host) => {
  const h = String(host ?? '').toLowerCase();
  return SHARED_EXACT.includes(h) || SHARED_ALL.some((root) => matchHost(h, root));
};
/** 大学ごとの SharePoint のホストか（〇〇.sharepoint.com。Teams で配った資料の置き場所） */
export const tenantSharePoint = (host) => {
  const h = String(host ?? '').toLowerCase();
  return /^[a-z0-9-]+\.sharepoint\.com$/.test(h);
};
