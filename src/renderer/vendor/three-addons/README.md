# three.js の addons（写し）

`node_modules/three/examples/jsm` から、使うものだけを写したもの（three 0.170.0、MIT ライセンス。LICENSE を同梱）。

- `loaders/GLTFLoader.js`（`utils/BufferGeometryUtils.js` を使う）
- `controls/OrbitControls.js`

electron-builder は `node_modules` の中の `examples` フォルダを配布物から自動で外すため、`node_modules/three/examples/jsm` を
そのまま読み込むと公開版で 3D モデルが描けない。ここに写し、`index.html` の importmap で `three/addons/` をここに向けている。
three を上げるときは、同じ版のファイルで写し直す。
