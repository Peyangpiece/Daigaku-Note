#!/bin/bash
# Mac に大学ノートをアプリとして入れて Dock に置く（README「Mac に入れる」）。更新したら（git pull のあと）もう一度実行する。
set -euo pipefail
# 変数は ${...} で囲む（Mac の bash 3.2 は $ARCH（ のように日本語が続くと、変数名の続きと読んでしまう）
cd "$(dirname "$0")/.."

APP_NAME='大学ノート.app'
DEST="/Applications/${APP_NAME}"
# Dock の登録に書く URL（「大学ノート」を UTF-8 でパーセント符号化したもの）
DOCK_URL='file:///Applications/%E5%A4%A7%E5%AD%A6%E3%83%8E%E3%83%BC%E3%83%88.app/'

[ "$(uname -s)" = Darwin ] || { echo 'これは Mac 用です。'; exit 1; }
# node_modules の Electron（npm が Node と同じ CPU 向けに入れたもの）をそのまま使うので、CPU も Node に合わせる
ARCH=$(node -p process.arch)

echo '1/5 部品をそろえます…'
[ -d node_modules/electron ] || npm ci

echo "2/5 アプリを作ります（${ARCH}）…"
rm -rf release/mac release/mac-arm64
npx electron-builder --mac dir "--${ARCH}" --publish never -c.electronDist=node_modules/electron/dist
BUILT=$(ls -d release/mac*/"${APP_NAME}" | head -1)
[ -d "${BUILT}" ] || { echo 'アプリを作れませんでした。'; exit 1; }

echo '3/5 動いている大学ノートを終了します…'
osascript -e 'tell application id "jp.daigakunote.app" to quit' >/dev/null 2>&1 || true
pkill -f "$(pwd)/node_modules/electron/dist/Electron.app" >/dev/null 2>&1 || true
sleep 1

echo "4/5 ${DEST} に入れます…"
rm -rf "${DEST}"
ditto "${BUILT}" "${DEST}"
# ダウンロード由来の隔離の印が付いていれば外す（自分で作ったアプリなので）
xattr -dr com.apple.quarantine "${DEST}" 2>/dev/null || true
# Apple シリコンは署名のないアプリを開けないので、このパソコンだけで通る署名（アドホック署名）を付け直す
codesign --force --deep --sign - "${DEST}" >/dev/null 2>&1 || true

echo '5/5 Dock に置きます…'
if defaults read com.apple.dock persistent-apps 2>/dev/null | grep -q "${DOCK_URL}"; then
  echo '  もう Dock にあります。'
else
  defaults write com.apple.dock persistent-apps -array-add \
    "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>${DOCK_URL}</string><key>_CFURLStringType</key><integer>15</integer></dict></dict></dict>"
  killall Dock
fi

open "${DEST}"
echo '入れました。Dock の大学ノートから開けます（窓を閉じても裏で動き続け、同期します）。'
