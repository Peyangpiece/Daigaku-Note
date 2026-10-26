// ダウンロードのボタンを、GitHub の最新版のファイルに直接つなぐ（取れなければ Releases のページのまま）。
// ファイル名は release.yml の決まり：daigaku-note-<版>-mac-arm64.dmg・-mac-x64.dmg・-win-x64.exe
(async () => {
  try {
    const r = await fetch('https://api.github.com/repos/Peyangpiece/Daigaku-Note/releases/latest', {
      headers: {Accept: 'application/vnd.github+json'}
    });
    if (!r.ok) return;
    const rel = await r.json();
    const version = String(rel.tag_name ?? '').replace(/^v/, '');
    const files = {
      'mac-arm64': `-mac-arm64.dmg`,
      'mac-x64': `-mac-x64.dmg`,
      'win-x64': `-win-x64.exe`
    };
    for (const [key, tail] of Object.entries(files)) {
      const asset = (rel.assets ?? []).find((a) => a.name.endsWith(tail));
      if (!asset) continue;
      for (const a of document.querySelectorAll(`[data-dl="${key}"]`)) {
        a.href = asset.browser_download_url;
        a.title = `${asset.name}（${Math.round(asset.size / 1e6)} MB）`;
      }
    }
    if (version) {
      const date = rel.published_at ? new Date(rel.published_at).toLocaleDateString('ja-JP') : '';
      for (const el of document.querySelectorAll('[data-version]')) el.textContent = `最新版 ${version}・Mac・Windows`;
      const line = document.querySelector('[data-release-line]');
      if (line) line.textContent = `最新版は ${version}${date ? `（${date}）` : ''}です。`;
    }
    // Windows なら、上の「ダウンロード」ボタンから直接（Mac は Apple シリコンか Intel かを選んでもらうので、下の欄へ）
    const main = document.querySelector('[data-dl-main]');
    const win = document.querySelector('[data-dl="win-x64"]');
    if (main && win && /Windows/i.test(navigator.userAgent) && win.href.includes('/download/')) {
      main.href = win.href;
      main.textContent = 'Windows 版をダウンロード';
    }
  } catch {
    // 取れなくても、ボタンは Releases のページを開く
  }
})();
