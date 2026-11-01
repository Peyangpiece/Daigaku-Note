// レンダラへの知らせを、窓の中のすべての画面（フレーム）に送る。PDF とノートを 1 つの窓に並べるとき（SPEC §8.6）、
// 左右の編集画面は窓の中の iframe なので、webContents.send（いちばん上の画面だけ）では届かない。
// except は送らない画面（書いた画面自身。WebFrameMain）
export function sendAll(wc, channel, payload, except = null) {
  if (!wc || wc.isDestroyed?.()) return;
  const frames = wc.mainFrame?.framesInSubtree ?? [];
  if (!frames.length) {
    if (!except) wc.send(channel, payload);
    return;
  }
  for (const f of frames) {
    if (f === except) continue;
    try {
      f.send(channel, payload);
    } catch {
      // 閉じた・読み込み直している画面には送らない
    }
  }
}
