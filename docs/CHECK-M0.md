# M0 実機確認の手順（Mac／Windows）

| 項目 | 内容 |
|---|---|
| 版 | 0.1（2026-10-17） |
| 対象 | [DESIGN-M0.md](DESIGN-M0.md) §13 の 1〜5 の「実機でしか確かめられないこと」 |
| 要るもの | Mac（Apple シリコンか Intel）または Windows 10/11、Node.js 22.13 以降、Git、インターネット。Moodle の確認にはデモサイト、manabo の確認には在学中の大学のアカウント |

結果は §7 の表に書いて報告してください。失敗したときはログ（§0.3）の該当部分を添えてください。

---

## 0. 共通の準備

### 0.1 取得と依存の導入

コマンドは **1 行ずつ** 貼り付けてください。Mac の zsh では `#` から後ろがコメントになりません（`npm ci # 説明` と貼ると `# 説明` が引数として渡され、npm がヘルプを出して止まります）。本書のコードブロックには説明を入れていません。

```bash
git clone https://github.com/Peyangpiece/Daigaku-Note.git
cd Daigaku-Note
git checkout claude/modest-carson-rtg2dt
node --version
npm ci
```

- `node --version` は v22.13.0 以上であること（v24 でもよい）
- `npm ci` は 2〜5 分。Electron のダウンロードで止まるように見えても待つ。終わりに `added 390 packages` のような行が出れば成功。`npm error` とヘルプが出たら、行末に余計な文字が付いていないか確かめる
- 社内／学内ネットワークでプロキシが要るときは `npm config set proxy …` と、Electron 用に環境変数 `ELECTRON_GET_USE_PROXY=1`・`GLOBAL_AGENT_HTTPS_PROXY=…` を設定する

### 0.2 テストが通ることを確かめる

```bash
npm test
```

- 期待：最後に `pass 62` / `fail 0`。e2e（`tests/e2e/`）は Playwright の Chromium が要る。入っていなければその 2 件は `skipped` になるので、次で入れてからもう一度（約 150 MB。テスト用。アプリ本体は別の場所に自分で取り込む）：

```bash
npx playwright install chromium
npm test
```

### 0.3 データとログの場所

| OS | userData（DB・秘密・ログ・Chromium） |
|---|---|
| Mac | `~/Library/Application Support/daigaku-note/` |
| Windows | `%APPDATA%\daigaku-note\`（例 `C:\Users\<名前>\AppData\Roaming\daigaku-note\`） |

- ログ：`userData/logs/app-YYYY-MM-DD.log`。ターミナルにも出すなら `DAIGAKU_LOG_STDOUT=1 npm start`
- DB：`userData/daigaku-note.sqlite`。確認に `sqlite3` コマンドが使える（Mac は標準で入っている）
- やり直すときは `userData` を丸ごと消せば初回状態に戻る（資料フォルダは消えない）

---

## 1. `npm start` での起動とセットアップ 6 手順

### 1.1 起動

```bash
DAIGAKU_LOG_STDOUT=1 npm start
```

| 確認 | 期待 |
|---|---|
| 窓が開く | 罫線ノートの背景（オフホワイト・32px の横罫・左に赤線）に「大学ノート」の見出し。接続がないので **セットアップ画面**（付箋 6 枚と 1 枚目のカード） |
| トレイ／メニューバー | アイコンが出て、右クリック（Mac は左クリック）で「大学ノートを開く／今すぐ同期／資料のフォルダを開く／設定／終了」 |
| ログ | `起動 0.1.0` のあと `LMS を読むためのブラウザを準備しています…` → 数分後 `Chromium の用意ができました`。準備中はトレイのメニューにも同じ文言 |

起動に失敗する場合の切り分け：

| 症状 | 原因と対処 |
|---|---|
| 「SQLite が使えません（node:sqlite も better-sqlite3 もない）」 | Electron 44 に同梱の Node で `node:sqlite` が使えない。`npm install better-sqlite3 && npx electron-rebuild -f -w better-sqlite3` を実行してからもう一度 `npm start`。これで動いたら報告してください（依存に加えて既定にします） |
| 「この環境では秘密を保存できません」 | Mac：キーチェーンがロックされている。Windows：まれに DPAPI が使えないアカウント。OS にログインし直して再起動 |
| トレイのアイコンが空 | `src/renderer/assets/tray.png` がまだないため（M1 で用意）。動作には影響しない |
| Mac で「開発元を確認できない」 | `npm start` では出ない。配布物（§5）のときだけ |

### 1.2 セットアップ：Moodle（デモサイト）で通す

Moodle のデモサイト Mount Orange School（`https://school.moodledemo.net/`）を使う。学生アカウントは **ID `student` ／ パスワード `moodle`**（デモは 1 時間ごとに初期化される。アカウントが変わっていたらサイトのトップに書かれているものを使う）。

| 手順 | 入力・操作 | 期待 |
|---|---|---|
| 1. LMS の URL | `https://school.moodledemo.net/` を入れて「種類を判定」 | 候補の先頭が **Moodle（api・確からしさ 90% 以上）**。規約のチェックを入れて「次へ」 |
| 2. ログイン | ID `student`・パスワード `moodle` → 「ログインして次へ」 | 「ログイン中…」のあと手順 3 へ。失敗なら赤字の理由（ID・パスワード違い／ネットワーク／「Moodle API が 4xx」） |
| 3. 授業の確認 | 授業の一覧が出る（デモでは数件） | 全部にチェックが入っている。「次へ」 |
| 4. 学期の設定 | 年度 2026・学期「秋学期」・回数 15・時限「90分・9:00開始・休み15分」。開始日・終了日は空のまま | 「保存して次へ」で手順 5 へ |
| 5. 保存先 | 既定 `~/Desktop/大学ノート`（Windows は `デスクトップ\大学ノート`）のまま | 「次へ」 |
| 6. 最初の同期 | 「同期を始めてホームへ」 | ホームに切り替わり、下部に「同期中 n/m（授業名）」→ 数十秒で「同期しました：資料 n 件保存」のトースト |

同期後の確認：

| 確認 | 期待 |
|---|---|
| デスクトップ | `大学ノート/2026_秋学期/<授業名>/第NN回_<タイトル>/<ファイル>` ができている。デモのコースはセクション名が「Week 1」などなので回フォルダは `第01回` の形。番号のないトピック形式のコースは `その他/` に入る |
| ホーム | 授業ごとにテープ付きのフォルダ。未読の資料があれば「新着 n」の丸シール |
| 授業画面 | フォルダをダブルクリック → 左にインデックスタブ（回）、右に資料の紙片。「開く」で既定のアプリ、📁 で Finder／エクスプローラー |
| 2 回目の同期 | 「同期」を押す → 「資料 0 件保存」（同じ URL は取りに行かない） |
| 設定 | 歯車 → 接続・学期・保存先・同期・見た目が出る。テーマを「暗い」にすると濃紺のノートになる |

Moodle のデモでは「ファイル」モジュールが少ないコースがある。資料が 0 件でも、授業と回のフォルダができていれば同期の仕組みは動いている。

---

## 2. 見えるログイン窓（統合認証・2 段階認証）

統合認証（SSO）の大学や、manaba・manabo のようにパスワードを保存しない接続で使う。M0 では **設定 → 接続 → 「ログインし直す」** から開く（セットアップの手順 2 で画面操作型を選んだ場合は「次へ」で進めてから、設定で開く）。

| 手順 | 操作 | 期待 |
|---|---|---|
| 1 | 設定 → 接続の「ログインし直す」 | 別の Chromium の窓が開き、LMS のトップ（またはログインページ）が出る。ボタンは「ログイン窓を開いています…」 |
| 2 | 窓の中で、いつもどおりログインする（統合認証 → ID・パスワード → 認証コード） | アプリは何も入力しない。本人が全部入れる |
| 3 | ログインが終わり LMS のトップに戻る | レシピの `login.loggedIn` の要素（manabo は `#button-logout`）が出た時点で **窓が自動で閉じ**、トースト「ログインしました」。接続の状態が `ok` に |
| 4 | ホームの「同期」 | ログイン窓なしで同期が進む（Cookie を保存している） |
| 5 | 10 分放置 | 「ログインが 10 分以内に完了しませんでした」で窓が閉じる（失敗の経路の確認） |
| 6 | 窓を手で閉じる | 「ログイン窓が閉じられました」 |

Moodle を統合認証で使う大学の場合：接続の「ログインし直す」で `launch.php`（Moodle アプリと同じ入口）が開く。ログインが終わると「ログインできました。この窓は自動で閉じます」の白い画面になり、トークンを保存して閉じる。もし大学の Moodle がモバイルサービスを無効にしていると、`launch.php` が「サービスが有効ではありません」と出す。その場合は API 型では使えないので報告してください（画面操作型の Moodle レシピを M1 で用意します）。

確認したいこと：

- 認証コード（メール・アプリ）の画面で止まらず、本人が入れれば進む
- ログイン後に別のホスト（`idp.…ac.jp` など）を経由しても閉じる（訪れたホストは接続の `allowed_hosts_json` に保存され、以後の同期で許可される）
- Cookie の期限が切れたときに、ホームの付箋「〇〇へのログインが必要です」が出ること（数日後に確かめる）

---

## 3. 本物の Moodle と manabo での同期

### 3.1 Moodle（デモサイト以外）

§1.2 と同じ手順を、自分の大学の Moodle で行う。パスワード認証の大学は手順 2 でそのまま、統合認証の大学は §2 の窓で。確かめること：

| 確認 | 見るところ |
|---|---|
| 授業一覧の名前から曜日・時限が読めているか | ホームのフォルダの「金曜 2限」の表示。読めなければ授業の設定で入れる（M0 では DB 直接。M1 でフォーム） |
| 回の番号 | セクション名が「第3回」「Week 3」なら `第03回_…`。番号のないトピック名（「原価企画」だけ）は `その他/` に入る。この場合は §7 に「セクション名の形」を書いてください（並び順で回を決める設定を M1 で足す判断材料） |
| 更新されたファイル | 教員が同名で差し替えた資料が `名前 (v2).pdf` で保存される（`timemodified` が新しくなったとき） |

### 3.2 manabo（レシピの実物検証）

`recipes/manabo.json` は SaBoRo の実装で分かっていた構造を元に書いたもので、**実物で確かめるまで `verified: false`**。次の順で確かめ、違っていればレシピを直す。

1. **ブラウザで構造を確かめる**（アプリより先に）。Chrome で manabo にログインし、DevTools（F12）の Elements で次を確かめる：

   | レシピの項目 | いまの値 | 確かめ方 |
   |---|---|---|
   | `login.loggedIn.selector` | `#button-logout, a[href*='logout']` | ログイン後のトップで Console に `document.querySelector("#button-logout, a[href*='logout']")` → 要素が返る |
   | `courses.items` | `a[href*='/class/']` | トップで `document.querySelectorAll("a[href*='/class/']").length` → 授業数と同じかそれ以上（重複はアプリが除く） |
   | `courses.weekday` / `period` | リンク文の「（金曜／2限）」 | 授業リンクの `textContent` に曜日と時限が含まれるか。含まれないなら授業ページ側の表記を探す（別の要素なら `courses` にその式を足す） |
   | `rounds.items` | `#div-class-directories .a-open-contents` | 授業ページで `document.querySelectorAll("#div-class-directories .a-open-contents")` → 回の数。各要素に `directory_id` 属性があるか |
   | `files.openBeforeRead` → `files.items` | クリック後の `#div-class-contents a[href*='/file/']` | 回を 1 つクリックしてから `document.querySelectorAll("#div-class-contents a[href*='/file/']")` → ファイル数 |
   | `notices.items` / `openBeforeRead` / `files` | `#div-class-news` の中 | お知らせ欄の [+] を押すと添付のリンクが出るか。要素の形（`li` か `div.news-item` か）を見てレシピに合わせる |

2. **レシピを直す**：`recipes/manabo.json` のセレクタを実物に合わせる。式の文法は SPEC §6.13（`セレクタ@属性:/正規表現/`）。保存したら `npm test` で `同梱のレシピはすべて検査に通る` が通ること。

3. **アプリで同期**：セットアップで manabo の URL を入れる（判定は `manabo.` を含む URL と `div-class-directories` の印）→ 「次へ」→ 設定の「ログインし直す」で §2 の窓からログイン → 「同期」。

4. **失敗したとき**：ログの `[sync] error 〈授業名〉 selector-missing 要素が見つかりません（…）` を見る。括弧の中が合わなかったセレクタ。`userData/debug/` に失敗時の HTML を残す仕組みは M1 で足すので、M0 では DevTools で見比べる。

5. **通ったら**：`recipes/manabo.json` の `verified` を `true`、`version` を `2026.10.2` に上げてコミット。

### 3.3 回の判定の確認（共通）

同期後に `sqlite3 userData/daigaku-note.sqlite "select c.name, r.number, r.title, r.folder_name, r.date from round r join course c on c.id=r.course_id order by c.name, r.number"` で、回の番号・タイトル・フォルダ名・日付が意図どおりか見る。日付は学期の設定の曜日から計算（祝日を飛ばす）。

---

## 4. 検疫属性と `shell.trashItem`

### 4.1 検疫属性（ダウンロードしたファイルの「インターネットから来た」印）

| OS | 確かめ方 | 期待 |
|---|---|---|
| Mac | ターミナルで `xattr -l "~/Desktop/大学ノート/2026_秋学期/<授業>/<回>/<ファイル>.pdf"` | `com.apple.quarantine: 0083;<16進の時刻>;大学ノート;<UUID>` の行が出る |
| Windows | PowerShell で `Get-Content "C:\Users\<名前>\Desktop\大学ノート\...\<ファイル>.pdf" -Stream Zone.Identifier` | `[ZoneTransfer]` `ZoneId=3` `HostUrl=https://…` が出る |

- Mac の `xattr` コマンドがない（Xcode のコマンドラインツールが未導入）と印が付かずログに出ない（失敗しても同期は止めない設計）。`xcode-select --install` で入る。付かなくても動作には影響しない。報告だけしてください
- 外付けドライブや exFAT の保存先では付かないことがある（正常）

### 4.2 ゴミ箱への移動（複製の整理）

複製の整理は「`名前 (2).pdf` の形の記録で、中身が記録のハッシュと同じで、元の名前のファイルも残っているもの」をゴミ箱へ移す。ふだんの同期では起きにくいので、作って確かめる：

```bash
cd ~/Desktop/大学ノート/2026_秋学期/<授業>/<回>
cp "資料.pdf" "資料 (2).pdf"
sqlite3 ~/Library/Application\ Support/daigaku-note/daigaku-note.sqlite \
  "insert into material (id, course_id, round_id, round_from, url, name, path, sha256, size, source, status, downloaded_at)
   select 'TESTDUP00000000000000000000', course_id, round_id, 'lms', 'https://test/dup', '資料 (2).pdf', replace(path,'資料.pdf','資料 (2).pdf'), sha256 || '', size, 'lms', 'ok', downloaded_at
   from material where name='資料.pdf' limit 1"
```

`sha256 || ''` は UNIQUE(course_id, sha256) に当たるので、実際には **元の記録を一時的に消すか、別の授業で試す**。簡単なのは「元の記録は残し、複製の記録の sha256 を `'x' || sha256` にする」ことだが、それだと中身が一致せず移動されない（本人が編集したとみなす経路の確認になる）。確実な手順：

```bash
sqlite3 … "update material set sha256 = 'moved-' || sha256 where name='資料.pdf'"
```

3. アプリで「同期」（または再起動）。期待：`資料 (2).pdf` が **OS のゴミ箱** に移り、ホームのお知らせ（M1 で表示）／ログに `trashed`。DB では `status='trashed'`。
4. 戻す：`sqlite3 … "update material set sha256 = substr(sha256, 7) where name='資料.pdf'; delete from material where id='TESTDUP00000000000000000000'"`

Windows は `Get-Content … -Stream` の代わりに `sqlite3` を https://sqlite.org/download.html から入れる（または DB Browser for SQLite）。

### 4.3 ファイルを動かしたときの追跡

| 操作 | 期待（次の同期後） |
|---|---|
| 回フォルダ内でファイル名を変える | 授業画面の名前が新しい名前になる。ダウンロードし直さない |
| 別の回フォルダへ移す | その回に表示が移る（`round_from='user'`）。同期で元に戻されない |
| ファイルを消す | 「（見つかりません）」の表示。ダウンロードし直さない |
| 回フォルダごと消す | 記録は「見つかりません」。フォルダは必要になったときだけ作り直す |

---

## 5. 配布物の作成（`npm run build`）

配布物はその OS の上で作る（Mac の .dmg は Mac で、Windows の .exe は Windows で）。

```bash
npm run build
ls release/
```

| 確認 | 期待 |
|---|---|
| 作成が終わる | 3〜8 分。`release/` に .dmg（Mac）か .exe（Windows）。アイコン未設定の警告（`default Electron icon is used`）は想定内（アイコンは M1） |
| Mac で開く | .dmg を開き「大学ノート」をアプリケーションへ。初回は Gatekeeper に止められる → **システム設定 → プライバシーとセキュリティ → 「このまま開く」**。署名がないため毎回ではなく初回だけ |
| Windows で開く | SmartScreen「WindowsによってPCが保護されました」→ **「詳細情報」→「実行」**。インストーラー（NSIS）が出て、インストール先を選べる |
| 起動 | §1.1 と同じ画面。userData も同じ場所（`npm start` と共有する） |
| Chromium の取り込み | 配布版は Playwright の CLI を Electron 自身で動かす（`ELECTRON_RUN_AS_NODE`）。ログに `Chromium の用意ができました` が出るか。失敗なら `ブラウザの準備に失敗しました（コード）` とその後ろの文字を報告 |

失敗しやすいところ：

| 症状 | 対処 |
|---|---|
| Mac：`Cannot find module 'dmg-license'` | `npm install --no-save dmg-license` を実行してからもう一度 |
| Mac：`code signing` の警告 | 署名の証明書がないので想定内（ad-hoc 署名になる） |
| Windows：`Cannot create symbolic link` | 開発者モードをオンにする（設定 → システム → 開発者向け）か、管理者の PowerShell で実行 |
| 両方：`asarUnpack` 後に Playwright が見つからない | 配布版の起動ログに `Cannot find module 'playwright'` が出たら報告（`files` の設定を直す） |

---

## 6. 報告の形

次の表を埋めて（コピーして）報告してください。失敗はログの該当行（`userData/logs/app-*.log`）を添えてください。秘密（パスワード・Cookie・トークン）はログに書かれない設計ですが、念のため目を通してください。

```
OS / 版：           例）macOS 15.1（Apple M2）／ Windows 11 23H2
Node：              例）v22.14.0
§1 起動：           OK / NG（症状）
§1 セットアップ：   手順 1〜6 のどこまで / 資料 n 件・授業 n 件 / フォルダ構成の例
§2 ログイン窓：     OK / NG（統合認証の種類・2 段階認証の種類）
§3 Moodle：         OK / NG（セクション名の形、曜日時限が読めたか）
§3 manabo：         レシピの項目ごとに OK / 直した値
§4 検疫：           xattr / Zone.Identifier の出力
§4 ゴミ箱：         OK / NG
§4 追跡：           OK / NG
§5 配布物：         作成 OK / NG、初回起動 OK / NG、Chromium 取り込み OK / NG
その他：            気づいたこと・見た目の違和感
```

## 7. 結果（記入欄）

| 項目 | Mac | Windows |
|---|---|---|
| §1 起動 | | |
| §1 セットアップ 6 手順 | | |
| §2 ログイン窓 | | |
| §3 Moodle | | |
| §3 manabo レシピ | | |
| §4 検疫属性 | | |
| §4 ゴミ箱 | | |
| §4 追跡 | | |
| §5 配布物 | | |
