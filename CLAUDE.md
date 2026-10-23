# 大学ノート：作業の決まり

- 説明は日本語で、論理的に。誤った情報がないか確かめてから書く
- 機能を変えたら `package.json` の版を上げる（`npm version <版> --no-git-tag-version`）
  - 上げるのは、ふだんは一番右の数字（0.5.0 → 0.5.1）。大幅な更新のときだけ真ん中を上げる
- プルリクエストは、CI（test と Release の build）がすべて通ったら、確認を待たずにマージする。
  版を上げたコミットが既定のブランチに入ると、Release のワークフローが自動で公開する（手で Run workflow しない。二重になる）
- 公開のあとは、Releases の最新版がその版で 12 個のファイルがそろうこと、Mac の署名が `Authority=Daigaku Note Signing`（証明書の指紋 `37e5ee42…`）であることを確かめて報告する
- テストは `node --test "tests/*.test.js"`、lint は `npm run lint`、整形は `npm run format:check`（CI で確かめる。直すには `npm run format`）
