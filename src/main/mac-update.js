// Mac の自動更新（SPEC §14.5）。Apple の署名がないと electron-updater（Squirrel.Mac）は入れ替えられないので、
// 新しい版の .dmg を自分で落とし、配布物の sha512 で確かめてから、終了後に動く小さなシェルスクリプトで「アプリケーション」の
// 大学ノートを入れ替えて開き直す。仕組みは SaBoRo を参考にしたが、コードは大学ノート用に書いた。
// ここは副作用のない部品とスクリプトの本文だけ。ダウンロードと起動は updater.js が行う。
import path from 'node:path';

export const RELEASE_BASE = 'https://github.com/Peyangpiece/Daigaku-Note/releases/download';
/**
 * 配布物に署名する証明書（Daigaku Note Signing）の指紋（SHA-1）。新しい版は、この証明書で署名されていることを
 * codesign の要件（certificate leaf = H"…"）で確かめてから入れ替える。名前（Authority=）は誰でも同じものを作れるので見ない。
 * 証明書を作り直したときは、ここを新しい指紋にした版を、古い証明書で署名して先に出す（そうしないと更新が止まる）
 */
export const MAC_SIGNING_LEAF = '37e5ee427fb4249f301d4633725d5ef641d10014';

/** electron-builder.yml の artifactName（daigaku-note-${version}-${os}-${arch}.${ext}）に合わせた名前 */
export const macInstallerName = (version, arch) =>
  `daigaku-note-${version}-mac-${arch === 'arm64' ? 'arm64' : 'x64'}.dmg`;
export const macInstallerUrl = (version, arch) => `${RELEASE_BASE}/v${version}/${macInstallerName(version, arch)}`;

/** a が b より新しい版か（x.y.z を数で比べる。足りない桁は 0） */
export function isNewer(a, b) {
  const x = String(a)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const y = String(b)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/**
 * latest-mac.yml の files（electron-updater の updateInfo.files）から、その .dmg の sha512（base64）を取る。
 * url は名前だけのことも URL のこともある。見つからない・形が違えば null（確かめられない .dmg は使わない）
 */
export function installerDigest(files, name) {
  const f = (Array.isArray(files) ? files : []).find(
    (x) =>
      String(x?.url ?? '')
        .split('/')
        .pop() === name
  );
  const d = String(f?.sha512 ?? '').trim();
  return /^[A-Za-z0-9+/]{86}==$/.test(d) ? d : null;
}

/** 実行ファイルのパスから .app を取る（/Applications/大学ノート.app/Contents/MacOS/大学ノート → /Applications/大学ノート.app） */
export function appBundle(exe) {
  const s = String(exe);
  const i = s.lastIndexOf('.app/');
  return i < 0 ? null : s.slice(0, i + 4);
}

/**
 * 自動で入れ替えられる場所か。.dmg の中（/Volumes）や、移動せずに開いたときの読み取り専用の場所（App Translocation）は不可。
 * 置き場所と .app に書き込めること
 */
export function canReplace(bundle, writable) {
  if (!bundle || !bundle.endsWith('.app')) return false;
  if (bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) return false;
  return writable(path.dirname(bundle)) && writable(bundle);
}

/**
 * 入れ替えのスクリプト。引数：$1 終了を待つプロセス番号、$2 .dmg、$3 入れ替える .app、$4 新しい版、$5 記録のファイル、$6 .dmg の sha512（base64）、
 * $7 署名の証明書の指紋（MAC_SIGNING_LEAF）
 * 流れ：終了を待つ → .dmg を作業用フォルダへ写して sha512 を確かめる（写したものだけを使う。元の場所は書き換えられうるため）
 * → 見えない形でつなぐ → 同じ CFBundleIdentifier の .app を隣に書き出す → 版と署名を確かめる → 入れ替える → 外す → 開く。
 * どこかで失敗したら元のまま開き直す。コマンドは環境変数で差し替えられる（テスト用）
 */
export const REPLACE_SCRIPT = `pid=$1 dmg=$2 app=$3 want=$4 log=$5 sum=$6 leaf=$7
HDIUTIL=\${HDIUTIL:-/usr/bin/hdiutil} PLIST=\${PLIST:-/usr/libexec/PlistBuddy} DITTO=\${DITTO:-/usr/bin/ditto} OPEN=\${OPEN:-/usr/bin/open}
XATTR=\${XATTR:-/usr/bin/xattr} CODESIGN=\${CODESIGN:-/usr/bin/codesign} OPENSSL=\${OPENSSL:-/usr/bin/openssl} WAIT=\${WAIT:-240}
say(){ printf '%s %-5s %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$log"; }
n=0; while kill -0 "$pid" 2>/dev/null; do n=$((n+1)); if [ "$n" -gt "$WAIT" ]; then say ERROR "大学ノートが終了しないため入れ替えられません"; exit 1; fi; sleep 0.5; done
work=$(mktemp -d "\${TMPDIR:-/tmp}/daigaku-update.XXXXXX") || { say ERROR "作業用のフォルダを作れません"; "$OPEN" "$app"; exit 1; }
mnt=$work/mnt copy=$work/installer.dmg attached=
fail(){ say ERROR "$1"; if [ -n "$attached" ]; then "$HDIUTIL" detach "$mnt" -quiet; fi; rm -rf "$work" "$app.new"; "$OPEN" "$app"; exit 1; }
[ -n "$sum" ] || fail ".dmg を確かめる値がありません"
[ -n "$leaf" ] || fail "署名を確かめる証明書の指紋がありません"
cp "$dmg" "$copy" || fail ".dmg を写せません"
got=$("$OPENSSL" dgst -sha512 -binary "$copy" | "$OPENSSL" base64 -A)
[ "$got" = "$sum" ] || fail ".dmg が配布物と一致しません"
mkdir "$mnt" || fail "作業用のフォルダを作れません"
"$HDIUTIL" attach -nobrowse -readonly -noautoopen -mountpoint "$mnt" "$copy" >/dev/null 2>&1 || fail ".dmg を開けません"
attached=1
id=$("$PLIST" -c "Print :CFBundleIdentifier" "$app/Contents/Info.plist" 2>/dev/null)
[ -n "$id" ] || fail "いまの大学ノートの CFBundleIdentifier を読めません"
src=; for a in "$mnt"/*.app; do if [ -d "$a" ] && [ "$("$PLIST" -c "Print :CFBundleIdentifier" "$a/Contents/Info.plist" 2>/dev/null)" = "$id" ]; then src=$a; break; fi; done
[ -n "$src" ] || fail ".dmg の中に大学ノート（$id）がありません"
rm -rf "$app.new"
"$DITTO" "$src" "$app.new" || fail "新しい版を書き出せません"
got=$("$PLIST" -c "Print :CFBundleShortVersionString" "$app.new/Contents/Info.plist" 2>/dev/null)
[ "$got" = "$want" ] || fail "書き出した版が $want ではありません（$got）"
"$CODESIGN" --verify --deep --strict "$app.new" >/dev/null 2>&1 || fail "新しい版の署名が壊れています"
"$CODESIGN" --verify --strict -R="certificate leaf = H\\"$leaf\\"" "$app.new" >/dev/null 2>&1 || fail "新しい版が大学ノートの証明書で署名されていません"
rm -rf "$app.old"
mv "$app" "$app.old" || fail "いまの大学ノートを動かせません"
if ! mv "$app.new" "$app"; then mv "$app.old" "$app"; fail "新しい版に入れ替えられません"; fi
rm -rf "$app.old"
"$XATTR" -dr com.apple.quarantine "$app" 2>/dev/null
"$HDIUTIL" detach "$mnt" -quiet; rm -rf "$work"
say INFO "$want に入れ替えました"
"$OPEN" "$app"
`;
