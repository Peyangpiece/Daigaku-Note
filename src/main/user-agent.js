// 通信の名乗り（User-Agent）を英字だけにする（v0.19.1）。
// Electron は名乗りにアプリ名を入れる（… パレットノート/0.19.0 Chrome/… Electron/…）。HTTP の見出しは英数字（ASCII）だけのもので、
// 日本語の名前に変えた v0.18.0 から、Mac の更新の .dmg のダウンロードが 400 や net::ERR_HTTP2_PROTOCOL_ERROR で止まっていた
// （新しい版の確認は electron-updater が英字の名乗りで取るので通っていた）。英字でない語は PaletteNote にする

/** 名乗りの中の英字でない語（「名前/版」）を PaletteNote に替え、残った英字でない文字も外す */
export function asciiUserAgent(ua) {
  return String(ua ?? '')
    .replace(/[^\x20-\x7e]+(?=\/)/g, 'PaletteNote')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
