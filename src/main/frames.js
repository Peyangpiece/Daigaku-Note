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

// iPad（パソコンと同じ画面。docs/MOBILE.md §8）：パソコンの画面への知らせを、つないだ iPad の画面にも渡す（main.js が setPadTap で入れる）
let padTap = null;
export function setPadTap(fn) {
  padTap = fn;
}
/** iPad にも知らせる（1 回の知らせにつき 1 回）。except は書いた画面（iPad の画面なら、その画面には返さない） */
export function tapPad(channel, payload, except = null) {
  try {
    padTap?.(channel, payload, except);
  } catch {
    // iPad に渡せなくても、パソコンの画面には届いている
  }
}
/** パソコンの窓（いちばん前の窓のすべての画面）と iPad に知らせる */
export function sendMain(wc, channel, payload) {
  sendAll(wc, channel, payload);
  tapPad(channel, payload);
}
