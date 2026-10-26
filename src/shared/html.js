// HTML のエスケープ（画面の描画・SVG の文字）。副作用なし。レンダラ（ui-kit.js）も shared（図・文房具の絵）もこれを使う
export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]
  );
