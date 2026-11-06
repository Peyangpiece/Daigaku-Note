# パレットノートのアイコンとロゴ

v0.18.7 で作った。すべて線を塗りの形に変換した SVG（`<text>` を使っていないので、フォントがなくても同じ形で表示される）。

## アイコンの考え方

紙のノートの端に、月〜金の曜日の色のタブ（アプリの曜日の色 `src/shared/skin.js` の `TAB_WEEKDAY`）。
色を自分で選んで作るノート（パレット）を、アプリの中で実際に使っている曜日のタブで表した。

| 色                 | HEX                                               | 使う場所                    |
| ------------------ | ------------------------------------------------- | --------------------------- |
| 紺（インク）       | `#22304A`                                         | アイコンの地、ロゴの文字    |
| 紙                 | `#FBF8F1`                                         | アイコンのノート            |
| 罫線               | `#C5CFDB`                                         | アイコンの罫線              |
| 珊瑚（アクセント） | `#F0675B`                                         | ロゴの「パ」の半濁点と「O」 |
| 曜日のタブ         | `#F28B82` `#FFAB70` `#8AB4F8` `#7FD1AE` `#F6C445` | 月・火・水・木・金          |

## ファイル

| ファイル                                          | 中身                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `logo-ja.svg` / `logo-en.svg`                     | 文字だけのロゴ（明るい地用）                                                                  |
| `logo-ja-white.svg` / `logo-en-white.svg`         | 暗い地用（白。線を 4 % 細らせてある）                                                         |
| `logo-ja-black.svg` / `logo-en-black.svg`         | 黒 1 色                                                                                       |
| `lockup-ja.svg` / `lockup-en.svg`                 | 記号と文字を横に並べたもの（明るい地用）                                                      |
| `lockup-ja-dark.svg` / `lockup-en-dark.svg`       | 紺の地に置いたもの                                                                            |
| `lockup-ja-stacked.svg` / `lockup-en-stacked.svg` | 記号の下に文字（正方形に近い場所用）                                                          |
| `source/icon-mac.svg`                             | アプリのアイコン（Mac の格子：1024 の中に 824 の角丸、影つき）。`build/icon.png` の元         |
| `source/icon-flat.svg`                            | 角を丸めない正方形（iPhone のホーム画面。角は OS が丸める）。`src/mobile/icon.png` の元       |
| `source/icon-small.svg`                           | 小さい表示用（タブ 3 つ・罫線 2 本）。`site/favicon.png`・`src/renderer/assets/tray.png` の元 |
| `source/tray-template.svg`                        | Mac のメニューバー用（黒 1 色）。`src/renderer/assets/trayTemplate*.png` の元                 |
| `source/symbol.svg` / `symbol-black.svg`          | 地のない記号                                                                                  |

## ロゴの文字

- カタカナ「パレットノート」は `.claude/skills/katakana-logotype` に沿って線から作った（字面を大きめにして親しみやすく、横画は縦画の約 92 %、促音「ッ」は 76 % で下にそろえ、長音「ー」は中心線の高さ、字間は字と字の空きの面積でそろえた）
- 英字「PALETTE NOTE」は同じ太さ・丸い端の線で作り、組ごとに字間を詰めた
- アクセントの色は、カタカナでは「パ」の半濁点、英字では「O」。どちらも珊瑚色の輪

## 作り直すとき

`source/` の Python で SVG を作り、picosvg で線を塗りの形に変換する（`pip install cairosvg picosvg pillow`）。

```sh
cd brand/source
python3 icon.py            # final-*.svg（アイコン）
python3 logo.py            # stroke-*.svg（ロゴ。線のまま）
for f in stroke-*.svg; do picosvg "$f" > "../${f#stroke-}"; done
```

商標の調査はしていない。使う前に、専門家による調査（特許情報プラットフォームなど）を勧める。
