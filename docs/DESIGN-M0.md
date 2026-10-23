# 大学ノート 詳細設計 M0（土台）

| 項目         | 内容                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 版           | 0.2                                                                                                                                                                                               |
| 作成日       | 2026-10-17                                                                                                                                                                                        |
| 実装の状態   | §13 の 1〜7 と 8〜10 の骨格まで実装済み（テスト 62 件）。残りは実機での確認と配布物の作成                                                                                                         |
| 元になる仕様 | [SPEC.md](SPEC.md) 0.4                                                                                                                                                                            |
| 範囲         | §16 の M0：Electron の常駐・SQLite・コネクタの枠・汎用ログイン・Moodle（API）・レシピ実行器＋レシピ 1 本・学期の設定・保存先・回フォルダ・1up・複製整理・初回セットアップ・デザイントークンの土台 |

本書は M0 を実装する人が読む文書。モジュールの切り方・関数の入出力・データの流れ・エラーの扱い・テストの方法を決める。仕様書に書いた決まりは繰り返さず、節番号で参照する。

---

## 1. リポジトリ構成

```
Daigaku-Note/
├── package.json                 ESM。scripts と依存の版（§9）
├── electron-builder.yml          配布物の設定（appId: jp.daigakunote.app）
├── src/
│   ├── main/                     メインプロセス（Node）。ファイル・LMS・DB・秘密はここだけ
│   │   ├── main.js               Electron の入口：常駐・トレイ・窓・起動手順（§3）
│   │   ├── ipc.js                レンダラとの通信の窓口（§4）
│   │   ├── jobs.js               ジョブの待ち行列（SPEC §13.6）
│   │   ├── scheduler.js          毎日の同期・授業開始の同期・定期の確認（§6）
│   │   ├── secrets.js            safeStorage の薄い包み（§7）
│   │   ├── paths.js              userData・ログ・レシピの置き場所
│   │   ├── log.js                ログ（7 日ローテーション。秘密を書かない）
│   │   ├── db/
│   │   │   ├── db.js             node:sqlite を開き、マイグレーションを当てる（§5）
│   │   │   ├── repo.js           表ごとの読み書き（SQL はここに閉じ込める）
│   │   │   └── migrations/0001_init.sql
│   │   ├── sync/
│   │   │   ├── engine.js         同期エンジン（§8.1）。コネクタとファイル管理を組み合わせる
│   │   │   └── files.js          ファイル管理（§8.2）。ダウンロード・ハッシュ・回フォルダ・同名・検疫
│   │   ├── connectors/
│   │   │   ├── index.js          登録と判定（detect）
│   │   │   ├── moodle.js         API 型 Moodle（§8.3）
│   │   │   ├── recipe-executor.js 画面操作型の実行器（§8.4）
│   │   │   └── manual.js         手動（M1 で本格化。M0 は接続の器だけ）
│   │   └── browser/
│   │       └── session.js        Playwright の文脈・Cookie の保存・見えるログイン窓（§8.5）
│   ├── shared/                   メイン・レンダラ・テストが共有する純粋ロジック（副作用なし）
│   │   ├── naming.js             フォルダ名・ファイル名の整え方（SPEC §7.1）
│   │   ├── rounds.js             回の番号の読み取り（SPEC §6.8）
│   │   ├── layout.js             1up/2up/4up の判定（SPEC §6.7）
│   │   ├── paths.js              保存先の検査（SPEC §7.2）
│   │   ├── holidays.js           日本の祝日
│   │   ├── term.js               学期の既定・回の日付（SPEC §6.14）
│   │   ├── schedule.js           授業開始の同期の判定（SPEC §6.5・§8.5）
│   │   ├── srs.js                間隔をあけた復習（SPEC §11.7。M3 で使うが純粋関数なので先に置く）
│   │   ├── recipe.js             レシピの検査・式の解釈・URL の差し込み（SPEC §6.13）
│   │   └── ids.js                ULID
│   ├── preload/preload.js        contextBridge で `window.daigaku` を出す
│   └── renderer/
│       ├── index.html            1 ページ。画面はスクリプトで切り替える
│       ├── styles/tokens.css     デザイントークン（SPEC §8.0.2）
│       ├── styles/notebook.css   罫線ノート・テープ・付箋・タブの部品
│       ├── app.js                画面の土台・経路（ホーム／授業／設定／セットアップ）
│       └── views/*.js            画面ごと
├── recipes/                      画面操作型レシピ（JSON）。同梱分
│   ├── schema.json               レシピの JSON Schema
│   └── manabo.json               M0 の 1 本目（実物で確かめるまで `"verified": false`）
├── tests/                        node --test
└── docs/
```

**依存の方向**：`renderer → preload → main`（IPC だけ）。`main → shared`。`shared` は何にも依存しない（Node の標準モジュールだけ）。`renderer` から `main` のモジュールを直接読まない。

---

## 2. プロセスと責務

| プロセス               | 持つもの                                                   | 持たないもの                                    |
| ---------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| メイン                 | DB・ファイル・LMS・Playwright・秘密・スケジューラ・ジョブ  | 画面の状態                                      |
| レンダラ               | 画面・入力・表示用の状態（メインから受け取ったものの写し） | ファイルパスの組み立て・秘密・LMS の URL の生成 |
| Playwright の Chromium | LMS のページ                                               | 大学ノートのデータ                              |

レンダラは `sandbox: true`・`contextIsolation: true`。`nodeIntegration: false`。IPC は §4 の一覧にある種類だけを preload で公開する。

---

## 3. 起動の手順（main.js）

```
1. 単一インスタンスの確保（2 つ目は既存の窓を前に出して終了）
2. userData の下に work/・logs/・recipes/・debug/・backups/ を作る
3. ログを開く
4. DB を開き、マイグレーションを当てる（§5）
5. 秘密の可用性を確かめる（safeStorage.isEncryptionAvailable）。使えなければ「秘密を保存できません」を画面に出し、手動取り込みだけで動く
6. 設定を読む（保存先・同期時刻・テーマ）
7. トレイを作る（メニュー：開く／今すぐ同期／資料のフォルダを開く／設定／終了）
8. 接続（connection）が 0 件 → セットアップ画面で窓を開く。1 件以上 → ホームで窓を開く（起動時に窓を開くかは設定。既定は開く。ログイン時の自動起動は常駐だけ）
9. スケジューラを開始（§6）
10. 複製の整理を 1 回走らせる（SPEC §7.4）
11. 更新確認（アプリ・レシピ）を裏で始める
```

終了：`before-quit` でジョブが実行中なら「同期中です。終了しますか」。Playwright の文脈を閉じ、DB を閉じる。

窓：`BrowserWindow`（1100×820、最小 900×640）。閉じても常駐は続く（Mac はドックから、Windows はトレイから開き直す）。

---

## 4. IPC の契約

preload が `window.daigaku` に次を出す。すべて `invoke`（往復）か `on`（メイン → レンダラの通知）。引数と戻りは JSON にできる値だけ。レンダラが渡した文字列はメインで必ず検査する（ID は ULID の形、URL は `https:` のみ、パスはレンダラから受け取らない）。

| 呼び出し（invoke）         | 引数                               | 戻り                                                                                       | 内容                                                                                  |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `state.get`                | —                                  | `{ connections, terms, courses, rounds, materialsSummary, settings, attention, lastSync }` | 画面の初期描画に要るものを 1 回で返す                                                 |
| `setup.detect`             | `{ url }`                          | `{ candidates: [{connectorId, kind, score}], base }`                                       | LMS の種類の判定（SPEC §6.3）                                                         |
| `setup.createConnection`   | `{ connectorId, baseUrl, label }`  | `{ connectionId }`                                                                         | 接続を作る（まだログインしない）                                                      |
| `connection.login`         | `{ connectionId }`                 | `{ ok, reason? }`                                                                          | 見えるブラウザ窓でログイン（§8.5）。終わるまで返らない（最大 10 分）                  |
| `connection.savePassword`  | `{ connectionId, user, password }` | `{ ok }`                                                                                   | 単純なフォームのときだけ（SPEC §6.4）。メインが `login.form` の有無を確かめてから保存 |
| `connection.remove`        | `{ connectionId }`                 | `{ ok }`                                                                                   | Cookie・秘密も消す。授業・資料・注釈は残す                                            |
| `term.save`                | `{ term }`                         | `{ ok, term }`                                                                             | 学期の設定（SPEC §6.14）。フォルダ名はメインが作る                                    |
| `courses.list`             | `{ connectionId }`                 | `[{ lmsId, name, url }]`                                                                   | セットアップ手順 3 のための一覧（同期はしない）                                       |
| `courses.setEnabled`       | `{ courseId, enabled }`            | `{ ok }`                                                                                   | 同期する授業の選択                                                                    |
| `course.update`            | `{ courseId, patch }`              | `{ course }`                                                                               | 色・テープ・曜日時限・並び・非表示・フォント・クイズ設定                              |
| `sync.run`                 | `{ connectionId?, courseId? }`     | `{ jobId }`                                                                                | ジョブを積む。進み具合は `sync.progress` で届く                                       |
| `material.open`            | `{ materialId }`                   | `{ ok }`                                                                                   | 既定のアプリで開く（書類・画像・音声・動画だけ）                                      |
| `material.reveal`          | `{ materialId }`                   | `{ ok }`                                                                                   | Finder/エクスプローラーで表示                                                         |
| `material.move`            | `{ materialId, roundId }`          | `{ material }`                                                                             | 回の変更（ファイルも移動。SPEC §8.3）                                                 |
| `settings.pickDownloadDir` | —                                  | `{ dir }`                                                                                  | OS のフォルダ選択。検査（shared/paths.js）して保存                                    |
| `settings.update`          | `{ patch }`                        | `{ settings }`                                                                             | 同期時刻・テーマ・通知など                                                            |
| `shell.openExternal`       | `{ url }`                          | `{ ok }`                                                                                   | `https:` だけ。LMS を開くリンク用                                                     |
| `app.version`              | —                                  | `{ version, recipes: {id, version}[] }`                                                    |                                                                                       |

| 通知（on）          | 内容                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `state.changed`     | 授業・資料・設定が変わった。レンダラは `state.get` を呼び直す（差分は送らない。M0 では単純さを優先） |
| `sync.progress`     | `{ jobId, phase, current, total, courseName }`。「同期中 3/9（管理会計Ⅱ）」                          |
| `sync.finished`     | `{ jobId, courses, materials, failures }`                                                            |
| `attention.changed` | 要確認の一覧が変わった                                                                               |
| `login.required`    | `{ connectionId, label }`。ホームに付箋を出す                                                        |

---

## 5. データベース

- ファイル：`<userData>/daigaku-note.sqlite`。`PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000`
- ドライバ：`node:sqlite`（Node 22 以降に同梱。Electron 44 の Node でも使える前提。起動時に `require('node:sqlite')` が失敗したら `better-sqlite3` に切り替える包みを `db.js` に置く）
- マイグレーション：`migrations/NNNN_name.sql` を番号順に当てる。当てた番号は `schema_migrations(version, applied_at)` に記録。1 ファイル 1 トランザクション。後方互換を壊す変更は新しい番号で足す（既存の SQL は書き換えない）
- 表は SPEC §13 のとおり（0001 に全部入れる）。M0 で使うのは `connection`・`term`・`course`・`round`・`material`・`sync_run`・`sync_event`・`settings`・`job`。ほかは表だけ作る
- `repo.js` は表ごとに `get/list/upsert/remove` を持つ。SQL 文字列はこのファイルの外に出さない。値の束縛は必ずプレースホルダ

---

## 6. スケジューラ（scheduler.js）

1 分ごとの tick で次を確かめる（タイマーは 1 本）。

| 判定                                                          | 動き                                                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 今日の全体の同期がまだで、現在時刻 ≥ 設定の時刻（既定 16:30） | `sync` ジョブ（全体）を積む。`settings.lastFullSyncDay` を今日にする（積んだ時点で）                                                              |
| 授業開始の同期（SPEC §6.5）                                   | `shared/schedule.js` の `dueClassSyncs(state, now)` が返した授業ごとに `sync {courseId}` を積む。`settings.classSyncedDay[courseId]` を今日にする |
| 定期の確認がオンで、前回から N 時間以上                       | `sync`（全体）                                                                                                                                    |
| 日付が変わった                                                | バックアップ（SPEC §12.3）を積む。`classSyncedDay` を消す                                                                                         |
| 1 日 1 回                                                     | `recipes` ジョブ（レシピの更新確認）                                                                                                              |

パソコンが寝ていた場合：tick の間隔が 1 分より大きく空いたら「寝ていた」とみなし、その tick で上の判定を全部やり直す（取りこぼさない）。

---

## 7. 秘密（secrets.js）

| 鍵                             | 中身                                   |
| ------------------------------ | -------------------------------------- |
| `conn:<connectionId>:password` | `{ user, password }` の JSON           |
| `conn:<connectionId>:token`    | API のトークン                         |
| `conn:<connectionId>:cookies`  | Playwright の `storageState()` の JSON |
| `ai:apiKey`                    | Claude API キー（M3）                  |

- 保存は `safeStorage.encryptString` → base64 を `<userData>/secrets.json` に。読むときは復号。ファイルのモードは 0600
- 鍵の一覧は出せるが、値はメインの中だけ。IPC で値を返す API は作らない（`connection.savePassword` は受け取るだけ）
- 接続を消すときは、その接続の鍵を全部消す

---

## 8. 同期

### 8.1 同期エンジン（sync/engine.js）

入口：`runSync({ connection, courseIds?, kind })`。戻りは `{ courses, materials, failures, events }`。

```
runSync:
  run = sync_run を 1 行作る（started_at）
  connector = connectors.forConnection(connection)
  ctx = connector.createContext(connection)             # Cookie・トークン・base URL・Playwright の文脈
  try:
    r = await connector.ensureSession(ctx)
    if r == 'login-required':
      if 保存したパスワードがある and connector.login(ctx,'headless') が成功 → 続ける
      else → connection.status='login-required'; 通知 login.required; failures++ で終わる
    courses = await connector.listCourses(ctx)
    reconcileCourses(connection, courses)              # 追加・名前変更・消えた授業の記録（消えても削除しない）
    targets = 対象の授業（courseIds があればそれ、なければ sync_enabled=1 の全部）
    await parallel(targets, 並行数, async course => {
      try:
        rounds = await connector.listRounds(ctx, course)
        reconcileRounds(course, rounds)                 # round 表と回フォルダ名（naming.roundFolderName）
        wanted = 対象の回（初回 or 保存先が変わった → 全回。ふだん → 実行日の前後 7 日の回 ＋ 回が分からないもの）
        files = []
        for round of wanted: files.push(...await connector.listFiles(ctx, course, round))
        files.push(...await connector.listNoticeFiles(ctx, course))
        files = layout.preferLayout(files)             # 1up 優先
        for f of files: await filesManager.ingest(ctx, connector, course, f)   # §8.2
      catch e: events.push({level:'error', course, code: classify(e), message})
    })
    sync_run を閉じる（件数・timing）
    state.changed / sync.finished を通知
  finally:
    connector.releaseContext(ctx)
```

並行数：API 型 5、画面操作型 3（Playwright のタブを 3 つ）。1 授業の処理に 2 分以上かかったら打ち切って失敗にする。

`reconcileCourses` の決まり（SPEC §6.6）：LMS の `lmsId` で突き合わせる。新しい授業は末尾に足す（`sort_order` 最大＋1、色は順番に）。名前が変わったら `name` と `folder_name` を更新し、授業フォルダを改名する。LMS から消えた授業は `sync_enabled=0` にして残す（資料・注釈は消さない）。

### 8.2 ファイル管理（sync/files.js）

`ingest(ctx, connector, course, fileRef)`：

```
1. 既存の判定（SPEC §6.7 の 1・2）
   m = material where url = fileRef.url and path が今の保存先の中
   if m and (fileRef.modified が無い or fileRef.modified <= m.lms_modified): return 'skip'
   if m and fileRef.modified > m.lms_modified: 新しい版として続ける（version+1、名前に (v2)）
2. 取得
   res = await connector.fetchFile(ctx, fileRef)
   if !res.ok or res.contentType が text/html: 失敗として記録して return
3. ハッシュ
   h = sha256(res.body)
   if material where course_id and sha256 = h が今の保存先の中: return 'dup'
4. 回フォルダの決定
   round = rounds.resolve(fileRef, course)              # コネクタの round → 名前 → お知らせ → ファイル名 → 0
   dir = <保存先>/<term.folder>/<course.folder_name>/<round.folder_name>/ を mkdir -p
5. ファイル名
   name = fileRef.name か Content-Disposition か URL 末尾。naming.sanitizeFileName
   path = files.uniquePath(dir, name, h)               # 同名で中身が同じならそのパス、違えば (2)
6. 書き込み
   一時ファイル（同じフォルダの .daigaku-tmp-<ulid>）に書き、fsync してから rename（途中で落ちても壊れたファイルを残さない）
   quarantine(path)                                    # Mac: xattr com.apple.quarantine、Windows: Zone.Identifier（失敗しても続ける）
7. 記録
   material を 1 行 insert（round_from・source・layout・size・mime・lms_modified・downloaded_at）
   return 'saved'
```

`trashDuplicates(course)`（起動時・同期後。SPEC §7.4）：同じ回フォルダの記録で `名前 (n).ext` の形のもののうち、中身が記録の sha256 と同じで、元の名前のファイルが残っているものを `shell.trashItem` でゴミ箱へ。`status='trashed'`。

`relocate(material, round)`（SPEC §8.3）：移動先の回フォルダに `uniquePath` で移し、`path`・`round_id`・`round_from='user'` を更新。両方の回の quiz を `stale` に（M3 で意味を持つ）。

`reconcileFiles(course)`（同期の前。SPEC §7.3）：記録のパスにファイルがないものについて、授業フォルダの下を 2 階層まで走査し、同じ sha256 のファイルがあればパスを付け替える（別の回フォルダにあれば `round_from='user'` で回も変える）。なければ `status='missing'`。記録にないファイルがあれば `source='user'` で足す。走査はファイル数 2,000 までで打ち切る。

### 8.3 API 型 Moodle（connectors/moodle.js）

| 関数                            | 実装                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `detect(url, html)`             | URL に `/moodle` を含む、または HTML に `M.cfg` か `moodle` を含む `<meta name="keywords">`、または `<base>/login/index.php` が 200 で `loginform` を含む → 0.9。`<base>/lib/ajax/service.php` の応答が JSON → +0.05                                                                                                                                                                                                                                                     |
| `ensureSession(ctx)`            | トークンがなければ `login-required`。あれば `core_webservice_get_site_info` を呼び、`userid` が返れば `ok`。`invalidtoken` → `login-required`                                                                                                                                                                                                                                                                                                                            |
| `login(ctx, mode)`              | (a) 保存したパスワードがあれば `login/token.php?username&password&service=moodle_mobile_app`（POST）。`token` が返れば保存。(b) なければ見えるブラウザ窓で `admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=<乱数>&urlscheme=daigakunote` を開き、ログイン後に `daigakunote://token=<base64>` への遷移を Playwright の `route`/`framenavigated` で捕まえ、base64 を復号（`passport のハッシュ:::token:::privatetoken`）してトークンを保存。10 分で諦める |
| `listCourses(ctx)`              | `core_enrol_get_users_courses(userid)`。`{ lmsId: id, name: fullname, url: <base>/course/view.php?id=, startDate: startdate }`。コース名の末尾の「（金2）」「金曜2限」から曜日・時限を試みる（rounds.js の隣に `slot.js`。取れなければ空）                                                                                                                                                                                                                               |
| `listRounds(ctx, course)`       | `core_course_get_contents(courseid)`。各 `section` → `{ number: section, title: name, lmsRef: id }`。番号は `rounds.parse(name)` が取れればそれ、取れなければ `section`（週形式のとき 1 始まり。`section=0` の「一般」は 0）                                                                                                                                                                                                                                             |
| `listFiles(ctx, course, round)` | その section の `modules[]` のうち `modname in ('resource','folder')` の `contents[]` で `type='file'` → `{ url: fileurl, name: filename, size: filesize, modified: timemodified, round }`                                                                                                                                                                                                                                                                               |
| `listNoticeFiles`               | `mod_forum_get_forum_discussions` は M0 ではやらない（空配列）                                                                                                                                                                                                                                                                                                                                                                                                           |
| `fetchFile(ctx, ref)`           | `GET fileurl?token=<token>`（`fileurl` に `?` があれば `&token=`）。`Content-Type`・本体を返す                                                                                                                                                                                                                                                                                                                                                                           |
| `openUrl(course, round)`        | `course.url`（＋`#section-<n>`）                                                                                                                                                                                                                                                                                                                                                                                                                                         |

API の呼び出しは `POST <base>/webservice/rest/server.php` に `wstoken`・`wsfunction`・`moodlewsrestformat=json`。応答に `exception` があれば `MoodleApiError(errorcode)`。`invalidtoken`・`accessexception` は `login-required` に写す。429・5xx は 3 回まで指数で待つ。

### 8.4 レシピ実行器（connectors/recipe-executor.js）

レシピ（SPEC §6.13）を Playwright で実行する汎用のコネクタ。レシピにコードは含まれないので、実行器が解釈する。

**式の文法**（`shared/recipe.js` が解釈。テスト可）：

```
field := selector ( '@' attr )? ( ':' '/' regex '/' flags? )?
  selector  … CSS セレクタ。空なら項目そのもの
  attr      … 'text'（textContent をトリム）| 'html' | 任意の属性名（href は絶対 URL に解決）。省略時 text
  regex     … 最初のキャプチャ群を値にする。合わなければ空
URL テンプレート := '{base}' '{course.url}' '{course.lmsId}' '{round.url}' '{round.lmsRef}' を差し込む
```

**手順**：

```
listCourses:  page.goto(fill(recipe.courses.url)); container があれば中身が入るまで待つ（8 秒）; openBeforeRead があれば順に click して waits.afterClick（'auto' なら欄の折りたたみを全部開く）; items が 'auto' なら開いた見出しごとに項目を決める
              items = page.$$(recipe.courses.items)
              各 item で name/link/lmsId/weekday/period を式で取る。name か link が空なら飛ばす
listRounds:   同様に recipe.rounds。round = regex の群 → rounds.parse(title) → 並び順（設定が許せば）→ 0
listFiles:    recipe.files.url を回の URL で差し込み、openBeforeRead、items から name/link。link が '/file' 等のパターンに合うか、拡張子がファイルか、を確かめる
listNoticeFiles: recipe.notices（なければ空）
fetchFile:    ctx.request.get(url)（ページの Cookie を共有する Playwright の APIRequestContext）
ensureSession: page.goto(base) → recipe.login.loggedIn のセレクタがあれば ok、なければ login-required
login(headless): recipe.login.form があり保存したパスワードがあれば入力して submit → loggedIn を待つ（30 秒）
login(visible): §8.5
```

安全の決まり：`page.goto` できるのは接続の `base_url` のホストと、レシピの `allowedHosts`、ログイン中に遷移した認証のホスト（`login` の間だけ記録）に限る。それ以外へ飛んだら止める。レシピの `click` は CSS セレクタで指す要素だけ（座標クリックや JS 実行はしない）。

失敗の分類：セレクタが 1 つも合わない → `selector-missing`（SPEC §6.11 の「レシピの確認が必要」に数える）。ログインページに戻された → `login-required`。タイムアウト → `timeout`。

レシピを直すための手がかり：`selector-missing` のときと、`ensureSession` が `login-required` を返すとき、その画面の HTML を `userData/debug/〈レシピ id〉_〈節〉_〈日時〉.html` に保存し（直近 20 件だけ残す）、URL・タイトル・リンクの経路（上位 12 件と本数）・id の一覧（30 件まで）を `[recipe]` のログに出す。

ページの使い回しと待ち方：同じ URL のページは `ctx.pageByUrl`（最大 4 枚）で開いたまま使い回し、授業ごとに 回 → ファイル（回の数だけ押して読む）→ お知らせ の順で同じページを使う（お知らせの読み取りで閉じる）。`container` のある節では、押したあと「欄の innerHTML が変わり、`.loading` 系の印が消える」まで待ち（最長 8 秒）、項目の待ちは 1.5 秒にする。通信が落ち着くのを待つ（networkidle）方式は、常に通信のある LMS で毎回 5 秒を失うので使わない。

授業の時間切れ：合計ではなく「進みがない時間」（`courseTimeoutMs`、既定 2 分）で切る。回ごとの読み取りと保存のたびに `touch()` で延びるので、全部の回を確かめる初回に授業 1 つが数分かかっても切れない。

値の式の候補（`||`）と歩き方（`^sel`・`<`・`>`）は SPEC §6.13。ページの中で候補ごとの生の値を配列で取り、正規表現と候補の選択は実行器側で行う（ページに渡す関数は外の変数を使えないため）。

ログイン済みの判定：`login.loggedIn.selector` が合えば済み。合わないときは予備の判定として「パスワード欄がなく、`a`/`button`/`input[type=submit]` 等の文字・href・onclick に ログアウト／logout／sign out／サインアウト がある」ならログイン済みとみなし、レシピの見直しを促すログを接続ごとに 1 回出す。未検証のレシピや LMS の改修で同期が止まらないようにするための保険で、レシピの修正を代わりにするものではない。

### 8.5 ブラウザの文脈とログイン窓（browser/session.js）

- 接続ごとに Playwright の `BrowserContext` を 1 つ。Chromium は `PLAYWRIGHT_BROWSERS_PATH=<userData>/pw-browsers` に初回起動時に取り込む（SaBoRo と同じ流れ。アプリ更新で Playwright の版が変わったら取り込み直す）
- Cookie：同期の終わりに `context.storageState()` を `secrets` に保存。開始時に `storageState` を渡して復元
- 画像・フォント・動画の読み込みは `route` で止める（同期を速くする。ログイン窓では止めない）
- **見えるログイン窓**：`chromium.launch({ headless: false })` で別の Chromium を立て、`BrowserWindow` の隣に置く（Electron の窓の中に埋め込むのは M1 で検討。M0 は独立した窓）。LMS のログインページを開き、「ログインできたら自動で閉じます」の案内を Electron 側に出す。`loggedIn` の判定（レシピ、または Moodle の launch.php のトークン、または base URL に戻って `login` の形跡がない）が成立したら `storageState` を保存して閉じる。10 分で諦める。この間、同じ接続の同期は待つ
- 見えるログイン窓でも `goto` 先の制限（§8.4）はかける。ただし認証のホスト（最初の遷移先から辿った）は許す

---

## 9. package.json（抜粋）

```json
{
  "name": "daigaku-note",
  "productName": "大学ノート",
  "version": "0.1.0",
  "type": "module",
  "main": "src/main/main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test tests/",
    "lint": "eslint .",
    "format": "prettier --write .",
    "build": "electron-builder --publish never"
  },
  "dependencies": {
    "playwright": "1.64.1",
    "pdfjs-dist": "6.4.299",
    "pdf-lib": "1.17.1",
    "mammoth": "1.13.0",
    "@anthropic-ai/sdk": "0.135.0",
    "electron-updater": "6.8.9"
  },
  "devDependencies": {
    "electron": "44.8.0",
    "electron-builder": "26.15.3",
    "eslint": "9.39.1",
    "prettier": "3.6.2"
  }
}
```

版は 2026-10-17 時点の最新で固定する（`^` を付けない。再現性のため）。`better-sqlite3` は `node:sqlite` が Electron で使えないと分かったときだけ足す。

---

## 10. 画面の土台（M0 の範囲）

- `tokens.css`：SPEC §8.0.2 の CSS 変数をそのまま。`data-theme` で明暗
- `notebook.css`：`.paper`（罫線の背景。`repeating-linear-gradient` で 32px ごとの 1px 線、左 72px に赤線）、`.folder`（タブ付きカード）、`.tape`（`clip-path: polygon(...)` の鋸歯。角度は `--tape-angle` 変数）、`.sticky`（付箋）、`.index-tab`、`.badge`
- M0 で作る画面：セットアップ（6 手順）・ホーム（フォルダのグリッド。バッジは「新着」だけ）・授業（資料一覧。回のインデックスタブ）・設定（接続・学期・保存先・同期）。ビューアとクイズは M2・M3
- テープの角度：`hash(course.id) % 13 - 6` 度。`shared/ids.js` の `hash32`

---

## 11. エラーコードと表示文言

| code                 | いつ                       | 表示（要確認）                                                                                       |
| -------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `network`            | 接続できない・タイムアウト | 「LMS に接続できませんでした。ネットワークを確かめてください」                                       |
| `login-required`     | Cookie 切れ・トークン無効  | 「〈接続名〉へのログインが必要です」＋「ログインする」ボタン                                         |
| `selector-missing`   | レシピの要素が見つからない | 「〈授業名〉を読み取れませんでした（画面の構成が変わった可能性）」。半数以上で「レシピの更新を確認」 |
| `download`           | ファイル取得の失敗         | 「〈資料名〉をダウンロードできませんでした」＋「LMS で開く」                                         |
| `write`              | 保存先に書けない           | 「保存先に書き込めません：〈パス〉」                                                                 |
| `timeout`            | 1 授業 2 分超              | 「〈授業名〉の読み取りが時間切れになりました。次回また試します」                                     |
| `blocked-navigation` | 許可外のホストへ飛んだ     | 「想定外のページに移動したため中断しました」（ログに URL のホストだけ）                              |

英語のメッセージをそのまま画面に出さない。元のメッセージはログにだけ残す。

---

## 12. テスト計画（M0）

| ファイル                 | 対象                                                                                                                             | 方法                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `tests/naming.test.js`   | 回フォルダ名の規則（40 文字・禁止文字・末尾・空白・予約名・衝突）、授業フォルダ名、ファイル名                                    | 入力と期待値の表            |
| `tests/rounds.test.js`   | 第N回・第三回・3回目・第3講・Week 3・Lecture 3・L03・#3・ファイル名、取れないもの                                                | 表                          |
| `tests/layout.test.js`   | 4up/2up/4in1/2分割/分割なし、組の 1up 優先                                                                                       | 表                          |
| `tests/paths.test.js`    | ホーム内・隠し・Library・`..`・相対                                                                                              | 表                          |
| `tests/holidays.test.js` | 2026 年の祝日（振替・春分秋分）                                                                                                  | 既知の日付                  |
| `tests/term.test.js`     | 学期名からの既定期間、回の日付（祝日・休講を飛ばす）、学期フォルダ名                                                             | 2026 秋学期の金曜 15 回     |
| `tests/calendar.test.js` | 学年暦の読み取り（休講日・範囲・振替授業日・祝日に授業を行う日・全角・令和）、その日に行う授業の曜日、振替授業日を数えた回の日付 | 2026 秋学期の学年暦の抜粋   |
| `tests/schedule.test.js` | 授業開始の同期の判定（時限の時刻・2 時間・1 日 1 回・曜日不明）                                                                  | 時刻を与える                |
| `tests/srs.test.js`      | 復習の段階の遷移・2 択・今日の復習の並びと上限                                                                                   | 表                          |
| `tests/recipe.test.js`   | 式の解釈・URL の差し込み・レシピの検査                                                                                           | 表                          |
| `tests/db.test.js`       | マイグレーションが当たる・2 回当てても変わらない・repo の往復                                                                    | `node:sqlite` の `:memory:` |
| `tests/files.test.js`    | ingest（新規・同 URL・同ハッシュ・同名別内容・HTML 応答・新しい版）、uniquePath、relocate、reconcileFiles                        | 偽のコネクタ＋一時フォルダ  |
| `tests/engine.test.js`   | 授業の追加・改名・消失、対象の回の絞り込み、失敗の分類、並行                                                                     | 偽のコネクタ                |
| `tests/moodle.test.js`   | 判定・サイト情報・授業一覧・セクション・ファイル・トークン無効・429                                                              | `node:http` の模擬サーバー  |

Playwright を使うテスト（レシピ実行器・ログイン窓）は `npm ci` 後に `tests/e2e/` で別に動かす（CI では Linux の headless）。M0 ではレシピ実行器の式の解釈だけを `tests/recipe.test.js` で押さえる。

---

## 13. M0 の作業の順番と状態

| #   | 作業                                                           | 依存 | 確認                                                                                       | 状態                                                                   |
| --- | -------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1   | `shared/` の純粋モジュールとテスト                             | —    | `npm test` が通る                                                                          | 済                                                                     |
| 2   | DB（マイグレーション・repo）                                   | 1    | `tests/db.test.js`                                                                         | 済                                                                     |
| 3   | ファイル管理                                                   | 1・2 | `tests/files.test.js`                                                                      | 済（検疫属性は `sync/quarantine.js`。Mac・Windows の実機で確認が要る） |
| 4   | 同期エンジン                                                   | 2・3 | `tests/engine.test.js`                                                                     | 済                                                                     |
| 5   | Moodle コネクタ                                                | 4    | `tests/moodle.test.js`。本物の Moodle（デモサイト `school.moodledemo.net` など）で手動確認 | 済（模擬サーバーで検証。実物は未）                                     |
| 6   | Playwright の文脈・ログイン窓                                  | —    | 手動                                                                                       | 済（`browser/session.js`。見えるログイン窓は実機で確認が要る）         |
| 7   | レシピ実行器＋manabo レシピ                                    | 1・6 | 模擬 HTML の e2e（`tests/e2e/`）。実物で確認                                               | 済（e2e 2 件。manabo の実物は未検証 `verified: false`）                |
| 8   | Electron の入口・トレイ・IPC・preload                          | 2〜7 | `npm start` で起動                                                                         | 骨格済（起動確認は実機）                                               |
| 9   | 画面の土台（トークン・部品・セットアップ・ホーム・授業・設定） | 8    | 目で確認。コントラストの検査                                                               | 骨格済（ドラッグでの回の移動は M1）                                    |
| 10  | スケジューラ・秘密・ログ・Chromium の取り込み                  | 8    | 手動（時刻を変えて）                                                                       | 骨格済                                                                 |
| 11  | 配布物（electron-builder）・更新確認                           | 8    | Mac・Windows で入れて起動                                                                  | 設定ファイルのみ（`electron-builder.yml`）。更新確認は未               |

実機での確認手順（Mac／Windows）：`npm ci` → `npm test`（e2e は `PLAYWRIGHT_BROWSERS_PATH` か `DAIGAKU_CHROMIUM` で Chromium を指す）→ `npm start` → セットアップ 6 手順 → デスクトップ `大学ノート/<学期>/<授業>/<回>/` に資料が入ることを確かめる。Moodle はデモサイト、manabo は在学中の大学のアカウントで。

---

## 14. M0 で決めずに残すこと（M1 以降）

- ログイン窓を Electron の窓の中に埋め込むか（M0 は独立した Chromium の窓）
- `state.changed` を差分にするか（M0 は全体を読み直す）
- 汎用型・手動取り込み・Canvas・ほかのレシピ（M1）
- 回の「並び順で決める」設定の既定（M0 は常にオフ）
