# Blender の skills（外から取り込んだもの）

Blender を Python（bpy）で動かして、3D モデルの検査・描画をするときに使う skills。
GitHub の 2 つのリポジトリから取り込み、中身は変えていない（評価用の `evals` は入れていない）。

| skill                      | 元                      | 中身                                                                                |
| -------------------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| blender-pro-workflow       | RobLe3/cc-blender-skill | 作業の順番（形 → カメラ → 照明 → 材質 → 描画）                                      |
| blender-lighting           | 同上                    | 照明（製品向けの三点照明など）                                                      |
| blender-materials          | 同上                    | 材質（Principled BSDF の正しい値）                                                  |
| blender-rendering          | 同上                    | 描画の設定（Cycles・EEVEE・色の変換）                                               |
| blender-cameras            | 同上                    | カメラ（焦点距離・構図）                                                            |
| blender-modeling           | 同上                    | 形づくり（モディファイアー・bmesh）                                                 |
| text-to-blender/references | 同上                    | 上の 6 つが最初に読む共通の参考（SKILL.md は入れていないので skill としては出ない） |
| render-blender-output      | pjt222/agent-almanac    | 背景モードでの描画・出力                                                            |
| script-blender-automation  | 同上                    | bpy での自動化                                                                      |
| create-3d-scene            | 同上                    | 場面の組み立て                                                                      |

## 取り込んだ版

- https://github.com/RobLe3/cc-blender-skill の `plugin/skills/`（コミット `a2634b588e80265e796aa53f8ab178d75105c2af`）
- https://github.com/pjt222/agent-almanac の `skills/`（コミット `ce87dce34c9e6ff9621cb597af3ea3be10d49f3c`）

どちらも MIT ライセンス。各 skill のフォルダの `LICENSE.txt` が元のライセンス文。

## 使うときの注意

- RobLe3 の skills は Blender MCP（画面のある Blender にアドオンを入れて動かす）を前提に書かれている。
  画面のない環境では、レシピの Python を `blender -b --factory-startup -P script.py` で直接実行すればよい。
- 中で名前の出てくるほかの skills（reference-look-calibration・blender-export など）は入れていない。
- 照明の値は約 1 m の物を想定している。10 cm ほどの部品では明るすぎるので、強さを下げる（目安 0.1〜0.2 倍）。
- Ubuntu の Blender（apt の 4.0.2）にはノイズ除去（OpenImageDenoise）が入っていない。サンプル数を増やして補う。
