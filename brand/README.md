# パレットノートのアイコンとロゴ

v0.18.7 で作った。すべて線を塗りの形に変換した SVG（`<text>` を使っていないので、フォントがなくても同じ形で表示される）。

## アイコンの考え方

紙のノートの端に、月〜金の曜日の色のタブ（アプリの曜日の色 `src/shared/skin.js` の `TAB_WEEKDAY`）。
色を自分で選んで作るノート（パレット）を、アプリの中で実際に使っている曜日のタブで表した。

| 色                 | HEX                                               | 使う場所                                                 |
| ------------------ | ------------------------------------------------- | -------------------------------------------------------- |
| 紺（インク）       | `#22304A`                                         | アイコンの地、ロゴの文字                                 |
| 紙                 | `#FBF8F1`                                         | アイコンのノート                                         |
| 罫線               | `#C5CFDB`                                         | アイコンの罫線                                           |
| 珊瑚（アクセント） | `#F0675B`                                         | ロゴの「パ」の半濁点と「O」                              |
| 曜日のタブ         | `#F28B82` `#FFAB70` `#8AB4F8` `#7FD1AE` `#F6C445` | 月・火・水・木・金。カタカナのロゴの蛍光ペン（淡くして） |

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

- カタカナ「パレットノート」は、Kiwi Maru（Medium。SIL Open Font License 1.1。ライセンス文は `OFL-KiwiMaru.txt`）の字の形をもとに、線をごく少し太らせ（縦画が高さ 120 に対して約 16）、字と字の空きの面積で字間を詰め、「パ」の半濁点を珊瑚色にした。ノートらしさとして、字の下の端にかかる低い位置に蛍光ペンを全体に引き、ブランドの 5 色（曜日の色）で左から月〜金の順に塗り分けた（明るい地では各色を白に 35 % 寄せた淡い色、紺の地では紺に 45 % 寄せた暗い色）。黒 1 色では蛍光ペンを外す。図形にしてあるので、フォントのファイルは含まない
- 英字「Palette Note」は、Zen Maru Gothic（Medium。SIL Open Font License 1.1。ライセンス文は `src/renderer/fonts/OFL-ZenMaruGothic.txt`）の字の形を 0.9 倍にしてベースラインをカタカナの字面の下端にそろえ、字間を空きの面積で詰め、「P」はふくらみを大きな円に近い形に描き直し、「o」を珊瑚色にした。蛍光ペンはカタカナと同じ
- アクセントの色は、カタカナでは「パ」の半濁点、英字では「o」。どちらも珊瑚色

## 作り直すとき

`source/` の Python で SVG を作り、picosvg で線を塗りの形に変換する（`pip install cairosvg picosvg pillow fonttools`）。カタカナには Kiwi Maru の `KiwiMaru-Medium.ttf`（google/fonts の `ofl/kiwimaru`）、英字には Zen Maru Gothic の `ZenMaruGothic-Medium.ttf`（`ofl/zenmarugothic`）を `source/` に置く。

```sh
cd brand/source
python3 icon.py            # final-*.svg（アイコン）
python3 logo.py            # stroke-*.svg（ロゴ。線のまま）
for f in stroke-*.svg; do picosvg "$f" > "../${f#stroke-}"; done
```

商標の調査はしていない。使う前に、専門家による調査（特許情報プラットフォームなど）を勧める。
