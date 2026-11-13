# パレットノート

大学の LMS に上がった授業資料を、何もしなくても授業ごと・回ごとのフォルダにそろえ、そのまま PDF に書き込んで学び、資料から作ったクイズで回ごとに復習できる、**全国の大学生**のための電子ノートアプリ（Mac・Windows のデスクトップアプリ）。

- 大学アカウントと同期し、新しい資料を自動でダウンロードして、デスクトップの「パレットノート → 学期 → 授業 → 回」フォルダに保存する
- LMS は 4 階層で対応する設計：API 型・画面操作型（手順は JSON のレシピ）・汎用型・手動取り込み。**いま同期できるのは Moodle（API 型）と manabo（レシピ。実物では未検証）だけ**。Canvas・manaba・WebClass・Google Classroom・Microsoft Teams・汎用型はまだない。LMS がなくても、パソコンの授業フォルダの取り込みや自分のフォルダで使える
- ホームは罫線ノートの上にマスキングテープで貼った授業フォルダ。ポップでシンプル、余白が主役のデザイン
- アプリ内の PDF ビューアで「文字入れ」（ヒラギノ角ゴ。サイズ・太字・色）「付箋（メモ）」「文字隠し」（水色のマーカー。赤シートをかぶせたところだけ黒く隠れる）。取り消し・やり直し、注釈付き PDF の書き出し。編集できるのは PDF だけ。文字入れのフォントサイズは授業ごとに変えられる
- 回ごとの資料から Claude API でクイズを作り、間隔をあけた復習で定着させる
- 資料を授業をまたいで探せる（名前・本文・書き込み。ホームの検索欄か ⌘K）。文字隠しのマーカーを 1 つずつ確かめる暗記モード

## 文書

| 文書                                   | 内容                                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/SPEC.md](docs/SPEC.md)           | 仕様書 0.4（要件・全体構成・LMS 連携の 4 階層・フォルダ・デザイン方針・画面・PDF 編集・フォント・クイズ・データモデル・非機能・フェーズ・決定事項）                   |
| [docs/DESIGN-M0.md](docs/DESIGN-M0.md) | 詳細設計 M0（リポジトリ構成・プロセスと責務・起動手順・IPC の契約・DB・スケジューラ・秘密・同期エンジン・ファイル管理・Moodle・レシピ実行器・テスト計画・作業の順番） |
| [docs/CHECK-M0.md](docs/CHECK-M0.md)   | M0 実機確認の手順（起動とセットアップ・ログイン窓・Moodle と manabo・検疫属性とゴミ箱・配布物。報告の形）                                                             |

## 参考にした自作アプリ

| アプリ   | リポジトリ                      | 参考にした仕組み                                                                                       |
| -------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| SaBoRo   | `Peyangpiece/coursecue`         | LMS の画面操作による同期・資料の自動ダウンロード・保存先の決まり・1up 優先・複製整理・常駐アプリの作り |
| カテキョ | `Peyangpiece/kateikyoushi-quiz` | 問題の形・Claude API による生成と検算・間隔をあけた復習                                                |

いずれも **仕組みを参考にするだけ** で、パレットノートは完全に別のアプリとして作る。コード・データ・フォルダ・アカウントの共有や連携はしない（仕様書 §4.5）。

## 開発

```
npm ci        # 依存を入れる（Electron・Playwright など）
npm test      # node --test（純粋ロジック・DB・ファイル管理・同期エンジン・Moodle コネクタ・バックアップ・通知）
npm run lint  # eslint
npm run format:check  # prettier（CI でも確かめる。直すには npm run format）
npm start     # Electron で起動
```

Node 22.13 以降（SQLite は `node:sqlite` を使う）。

### 配布（GitHub Actions）

- `.github/workflows/ci.yml`：push とプルリクエストのたびに lint とテスト
- `.github/workflows/release.yml`：Mac（dmg・zip、Apple シリコン・Intel）と Windows（インストーラー）を作り、Releases に公開する
  1. `package.json` の `version` を上げてコミットし、既定のブランチに入れる（例 `0.2.0`。プルリクエストのマージでよい）
  2. それだけで自動で公開される（版がまだ公開されていなければ。版を上げていない変更は公開しない）。タグ `v0.2.0` は GitHub が作る。
     手で公開し直すときは、Actions の「Release」→「Run workflow」で「Releases に公開する」に印を付けて動かす。同じ版のタグを push してもよい：`git tag v0.2.0 && git push origin v0.2.0`
  3. 数分で Releases に公開される。入れてあるパレットノートは、起動時と 1 時間ごとに新しい版を見つけて自動で更新する（Windows は裏でダウンロードして再起動を聞く。Mac は「今すぐ更新」で入れ替えて開き直す）
  - 「Releases に公開する」に印を付けずに動かすと、作るだけ（実行結果の Artifacts から取れる）
  - Mac は Apple の Developer ID（チーム 9G78U9XD92）で署名し、公証を受ける（v0.18.6。下の「Mac の署名と公証」）。Windows は証明書がなく、SmartScreen に止められたら「詳細情報 → 実行」

#### Mac の署名と公証

保存した LMS のログインは、キーチェーンの「パレットノート Safe Storage」の鍵で暗号化している。この鍵を読めるのは「常に許可」したときのアプリの署名だけ。
v0.18.6 から、公開する版は Apple の Developer ID（チーム 9G78U9XD92）で署名し、Apple の公証を受ける（署名と公証は electron-builder。`.github/workflows/release.yml`）。
チームで決まる署名なので、一度「常に許可」すれば版を上げても聞かれない。Gatekeeper にも止められない。

GitHub のこのリポジトリの Settings → Secrets and variables → Actions に 5 つ置く（どれかがないと公開のジョブは止まる）

- `MAC_DEVID_P12`：「Developer ID Application: Hiroki Oya (9G78U9XD92)」の証明書と秘密鍵を .p12 で書き出し、`base64 -i <.p12> | pbcopy` でコピーしたもの
  - 証明書は developer.apple.com の Certificates →「＋」→ Developer ID Application（G2 Sub-CA）で作る。作れるのは Account Holder だけ。
    要求ファイル（.certSigningRequest）は、キーチェーンアクセスの「証明書アシスタント」→「認証局に証明書を要求」→「ディスクに保存」で作る
  - 書き出しは、キーチェーンアクセスの「ログイン」→「自分の証明書」で、証明書の行を右クリック →「書き出す」→ 形式「個人情報交換（.p12）」
- `MAC_DEVID_PASSWORD`：.p12 を書き出したときのパスワード
- `APPLE_API_KEY`：App Store Connect の「ユーザとアクセス」→「統合」→「App Store Connect API」→「チームキー」で作った鍵（.p8）の中身（`pbcopy < AuthKey_<キー ID>.p8`）
- `APPLE_API_KEY_ID`：その鍵のキー ID
- `APPLE_API_ISSUER`：同じ画面の Issuer ID

証明書の有効期限（いまのものは 2027 年 12 月 7 日）の前に作り直して、`MAC_DEVID_P12`・`MAC_DEVID_PASSWORD` を入れ替える。同じチームの証明書なので、自動更新もキーチェーンの許可もそのまま続く。

v0.18.5 までは自分で作った証明書（`Daigaku Note Signing`。Secrets の `MAC_SIGN_P12`・`MAC_SIGN_PASSWORD`）で署名していた。自動更新は、この証明書の版も Developer ID の版も受け入れる（`src/main/mac-update.js`）。
Developer ID の証明書がないときに作るだけなら、この証明書（なければ ad-hoc）で署名する（`build/after-pack.cjs`）。

## ホームページ（daigakunote.com）

- `site/` の静的なページ（HTML・CSS・JS だけ。組み立ての手順はない）。ダウンロードのボタンは、開いたときに GitHub の最新版のファイルへつなぐ（`site/download.js`）
- `site/` を変えたコミットが既定のブランチに入ると、`.github/workflows/pages.yml` が GitHub Pages に公開する。独自ドメインは `site/CNAME`
- はじめに 1 回だけ：リポジトリの Settings → Pages の「Source」を「GitHub Actions」にし、「Custom domain」に `daigakunote.com` を入れる。ドメインの DNS に、GitHub Pages の A レコード（`185.199.108.153`・`185.199.109.153`・`185.199.110.153`・`185.199.111.153`）と、`www` の CNAME（`peyangpiece.github.io`）を足す。証明書ができたら「Enforce HTTPS」に印を付ける
- 利用規約（`site/terms.html`）とプライバシーポリシー（`site/privacy.html`）は、アプリの文章（`src/shared/policy.js`・`src/shared/lms-terms.js`）から `node scripts/site-policy.mjs && npm run format` で作る。文章がずれると `tests/site.test.js` が失敗する
- 手元で見るには `site/index.html` をブラウザで開く

## Mac に入れて Dock から開く

```
npm run install:mac   # アプリを作って /Applications/パレットノート.app に入れ、Dock に置いて開く
```

- 初回の前に、`npm start` で動いているパレットノートを ⌘Q で終わらせる（スクリプトも終了を試みる）
- 更新は `git pull` のあとにもう一度 `npm run install:mac`（入れ直したアプリは自動では更新されない）
- データ（ログイン・授業・クイズ）は `npm start` と同じ `~/Library/Application Support/パレットノート` を使うので、そのまま引き継ぐ
- 窓を閉じても裏で動き続ける（メニューバーのアイコンから終了）。同期はアプリが動いている間だけ動くので、設定 → 同期 の「パソコンにログインしたらパレットノートを起動する」を入れておくとよい

## データの場所と削除

| OS      | アプリのデータ（授業・注釈・クイズ・設定・ログ・バックアップ）                       | 資料のファイル                                           |
| ------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Mac     | `~/Library/Application Support/パレットノート`（0.17 までに入れた人は `大学ノート`） | 設定した保存先（既定はデスクトップの「パレットノート」） |
| Windows | `%APPDATA%\パレットノート`（0.17 までに入れた人は `大学ノート`）                     | 同上                                                     |

設定 →「情報」の「データの場所を開く」で開けます。アプリを消してもこの 2 つは残るので、全部消すときは両方を消してください。LMS のアカウントの情報は OS の鍵で暗号化してアプリのデータに入っており、接続を削除すると消えます。利用規約とプライバシーポリシーは `src/shared/policy.js`（アプリの設定 →「情報」からも読めます）。

## 状態

仕様 0.4 確定。M0（土台）〜M3（クイズ）は動く状態で、**α 版（試験中）** を GitHub Releases で公開中（いまの版は `package.json` と [Releases](https://github.com/Peyangpiece/Daigaku-Note/releases) を参照。変更の中身は [CHANGELOG.md](CHANGELOG.md)）：

- 済：`src/shared/`（命名・回の判定・1up・保存先・祝日・学期・時限・復習・レシピ式）、SQLite のマイグレーションと repo、ファイル管理（取り込み・回の移動・追跡・複製整理・検疫属性・保存先の変更）、同期エンジン（全回の確認と取りこぼしの再試行）、Moodle（API 型）コネクタ、**レシピ実行器**（Playwright。模擬 LMS への e2e 済）、**ブラウザ文脈と見えるログイン窓**（Cookie の保存・許可ホスト・Moodle の launch.php トークン捕捉）、Chromium の初回取り込み、コネクタの登録と判定、Electron の入口・IPC・ジョブ・スケジューラ・秘密・ログ・**日次バックアップ**（`userData/backups/` に 7 日分）・**OS の通知**、デザイントークンと罫線ノート・テープ・付箋の CSS、ホーム／授業／設定／セットアップの画面、着せ替えと文房具、electron-builder の設定、manabo レシピ（実物は未検証）、**クイズ**（資料の文字の読み取り・Claude API での生成と検査・根拠照合・検算、回ごとのクイズと授業のテスト、今日の復習、問題の編集）、**自分のファイルの追加と回への振り分け**、**PDF ビューアと編集**（pdf.js。文字入れ・付箋・文字隠しマーカーと赤シート・ボールペン・しおり、取り消し・やり直し、注釈付き PDF の書き出しと上書き保存。注釈は SHA-256 に結び付けて DB へ自動保存）、**配布と自動更新**（GitHub Actions・Releases・electron-updater。Mac は自分の証明書で署名し、指紋を確かめて入れ替える。MSIX での動作確認の仕組み）
- 未：本物の Moodle・manabo での確認、レシピの GitHub からの更新と Ed25519 の署名検証（SPEC §6.15。userData/recipes は検証ができるまで読まない）、取り込みフォルダの監視（§6.10）、PDF 編集の残り（サムネイル・注釈のコピー＆ペースト。暗記モードと資料をまたぐ検索は v0.26.0 で入れた。文字の層は v0.10.3 で入れ、文字の選択とコピーはできる）、同期後の自動生成（§11.3。文字隠しマーカーからの機械的穴埋めは v0.10.4 で入れた）、画像 PDF の入力（§11.4）、振り分け待ちの通知（§12.1）、Canvas・manaba・WebClass・Google Classroom・Microsoft Teams・汎用型のコネクタ。手動バックアップの書き出し／読み込み（§12.3）は入れた（読み込みは「置き換え」で、新しい方を優先して合わせる統合はしない）
