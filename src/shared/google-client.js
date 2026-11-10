// Google のクライアント ID（docs/SYNC.md §2）。Google Cloud のコンソール（API とサービス → 認証情報）で作ったもの。
// インストール型のアプリ（デスクトップ・iOS）のクライアントの秘密は、配布物に入るので秘密として扱われない（Google の決まり）。
// まだ作っていないときは空：設定の画面は「準備中」と出し、連携のボタンを出さない
export const GOOGLE_DESKTOP = {
  clientId: '',
  clientSecret: ''
};
export const GOOGLE_IOS = {
  clientId: ''
};

/** ドライブの、このアプリだけの見えない領域と、アカウントを画面に出すためのメールアドレス */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.appdata', 'openid', 'email'];

export const googleReady = (c = GOOGLE_DESKTOP) => !!(c.clientId && c.clientSecret);
