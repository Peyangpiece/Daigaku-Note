// Google のクライアント ID（docs/SYNC.md §2）。Google Cloud のコンソール（API とサービス → 認証情報）で作ったもの。
// インストール型のアプリ（デスクトップ・iOS）のクライアントの秘密は、配布物に入るので秘密として扱われない（Google の決まり）。
// クライアントの秘密はリポジトリに入れず、作るときに GitHub の Secrets（GOOGLE_DESKTOP_CLIENT_SECRET）から配布物に入れる
// （main/cloud/client-secret.js）。ないときは設定の画面に「準備中」と出し、連携のボタンを出さない
// プロジェクト palette-note-514306（v0.22.1）。iOS は バンドル ID jp.daigakunote.ipad・チーム ID 9G78U9XD92
export const GOOGLE_DESKTOP = {
  clientId: '201000811340-iq76qhsgvu0f960asr664as77a36l1e8.apps.googleusercontent.com',
  clientSecret: '' // リポジトリには入れない。作るときに入れる（main/cloud/client-secret.js）
};
export const GOOGLE_IOS = {
  clientId: '201000811340-l3lu4n3hif3o1dqoqr26d145h4mavh7u.apps.googleusercontent.com'
};

/** ドライブの、このアプリだけの見えない領域と、アカウントを画面に出すためのメールアドレス */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.appdata', 'openid', 'email'];

export const googleReady = (c = GOOGLE_DESKTOP) => !!(c.clientId && c.clientSecret);
