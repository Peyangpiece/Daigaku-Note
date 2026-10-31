// 文房具の 3D モデル（GLB）を three.js で描く（model3d.js から遅れて読み込む）。
// 材質は GLB のまま（部品ごとの設計上の材質があればそれ）。光は写真スタジオ風：暗い部屋に大きなソフトボックスと
// 両側のストリップライトを置いた環境（金属の軸に長い映り込みが出る）＋弱い主光源と、机に落ちる柔らかい影。
// 色は ACES フィルミックのトーンマッピングで、金属のハイライトが白飛びせず階調が残るようにする。
// WebGL の描画は 1 つだけ作り（コンテキストの数に上限があるため）、描いた結果を各表示の canvas に写す。
// モデルは「ペン先が左・クリップが上」に向け、長さ 1 にそろえる（stationery.js の絵と同じ向き）
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const api = window.daigaku;
let renderer = null;
let envMap = null;
const models = new Map(); // 「model id|品の id」→ Promise<{scene, group, ground}>

/**
 * 品の色で塗り替える（公式の品：形の種類ごとの GLB を、品の body・accent・color で）。材質は名前で見分ける
 * （scripts/pens3d/build.py）。Body 軸・Accent 先の円すい・天冠・ノック・Grip グリップ・Print 印字・Cap キャップ・Felt 芯・Plug 尻栓。
 * 字幅の印字（Print_mm_05 など）は品の字幅のものだけを出す。ペンケースは CaseBase・CaseTrim などを base・trim で
 */
function tint(obj, item) {
  if (!item) return;
  const color = (hex) => new THREE.Color(hex);
  const lum = (hex) => {
    const c = new THREE.Color(hex);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // リニアの明るさ
  };
  const mm = item.mm ? `Print_mm_${item.mm.replace('.', '')}` : null;
  const seen = new Set();
  obj.traverse((o) => {
    if (/^Print_mm_/.test(o.name) || /^Print_mm_/.test(o.parent?.name ?? '')) {
      const n = /^Print_mm_/.test(o.name) ? o.name : o.parent.name;
      o.visible = n.startsWith(mm ?? '-');
    }
    if (!o.isMesh || seen.has(o.material)) return;
    const m = o.material;
    seen.add(m);
    const name = m.name ?? '';
    if (name === 'Body' && !m.map) m.color = color(item.body);
    else if (name === 'Accent') {
      m.color = color(item.trim === 'gold' ? '#c9a227' : item.accent);
      if (item.trim === 'gold') {
        m.metalness = 1;
        m.roughness = 0.22;
      }
    } else if (name === 'Grip') {
      // ゴムのグリップは差し色を暗くした色。金の飾りの品は金のゴムにならないよう、軸の色から作る
      m.color = color(item.trim === 'gold' ? item.body : item.accent).lerp(new THREE.Color('#1b1b1d'), 0.62);
    } else if (name === 'Print') m.color = color(lum(item.body) > 0.35 ? '#3a3b3f' : '#f2f2ee');
    else if (['Cap', 'Felt', 'Plug', 'Ink'].includes(name)) m.color = color(item.color);
    // ペンケース（scripts/pens3d/build.py の case_*）：本体は base、縁・タブ・ステッチ・テープは trim、織りネームの字は base を暗く
    else if (name === 'CaseLabelText') m.color = color(item.base).lerp(new THREE.Color('#1b1b1d'), 0.35);
    else if (name === 'CaseBase') {
      m.color = color(item.base);
      // 透明の品（クリアケース）：透過（transmission）は後ろが白く写って不透明に見えるので、半透明で描く。
      // 表面の映り込みは残す
      if (m.transmission > 0) {
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.14;
        m.depthWrite = false;
        m.side = THREE.DoubleSide;
      }
    } else if (name === 'CaseTrim') m.color = color(item.trim);
    else if (name === 'CaseZipCoil') m.color = color(item.trim).lerp(new THREE.Color('#1b1b1d'), 0.25);
    else if (name === 'CaseZipTape') m.color = color(item.base).lerp(new THREE.Color('#1b1b1d'), 0.45);
    else if (name === 'CaseDeboss') m.color = color(item.base).lerp(new THREE.Color('#1b1b1d'), 0.55);
  });
}

/** 面光源の材質（明るさ 1 を超える色で、環境の映り込みに光として写る） */
function lightPanel(w, h, intensity, tint = [1, 1, 1]) {
  const m = new THREE.MeshBasicMaterial();
  m.color.setRGB(intensity * tint[0], intensity * tint[1], intensity * tint[2]);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
}

/** 写真スタジオ風の環境：暗い部屋・頭上の大きなソフトボックス・左右のストリップライト・背面の弱い光 */
function studioScene() {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(10, 10, 10),
    new THREE.MeshStandardMaterial({color: 0x1a1a1a, roughness: 1, metalness: 0, side: THREE.BackSide})
  );
  scene.add(room);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({color: 0x3a3a3a, roughness: 1})
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -4.99;
  scene.add(floor);
  const top = lightPanel(5, 2.4, 6, [1, 0.98, 0.95]);
  top.rotation.x = Math.PI / 2;
  top.position.set(0, 4.9, 0.6);
  scene.add(top);
  const left = lightPanel(1, 6, 3, [1, 0.96, 0.9]);
  left.rotation.y = Math.PI / 2;
  left.position.set(-4.9, 0.8, 0);
  scene.add(left);
  const right = lightPanel(1, 6, 2.2, [0.92, 0.96, 1]);
  right.rotation.y = -Math.PI / 2;
  right.position.set(4.9, 0.8, 0);
  scene.add(right);
  const back = lightPanel(6, 2, 1.2);
  back.position.set(0, 1.2, -4.9);
  scene.add(back);
  const front = lightPanel(6, 1.2, 0.8);
  front.rotation.y = Math.PI;
  front.position.set(0, -1.5, 4.9);
  scene.add(front);
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  return scene;
}

function gl() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true});
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap; // ぼかせる影（radius・blurSamples が効く）
  const pmrem = new THREE.PMREMGenerator(renderer);
  envMap = pmrem.fromScene(studioScene(), 0.04).texture;
  pmrem.dispose();
  return renderer;
}

/**
 * 部品ごとの設計上の材質を使う。GLB には、写真を貼った材質のほかに「〜_look」という名前の材質（部品の数だけ。
 * 金属の軸・ローレット・クリップなどの色と粗さ）が入っていることがある。写真は解像度が低くぼやけるので、
 * 「〜_look」が部品（プリミティブ）の数とそろっていれば、順に割り当てて描く（参考の描画と同じ見え方）
 */
async function useLookMaterials(gltf) {
  const defs = gltf.parser.json.materials ?? [];
  const looks = defs.map((m, i) => ({name: m.name ?? '', i})).filter((m) => /_look$/i.test(m.name));
  if (!looks.length) return;
  const parts = [];
  gltf.scene.traverse((o) => o.isMesh && parts.push(o));
  // プリミティブの順（ノード → メッシュ → プリミティブ）。traverse はこの順に子を回る
  if (parts.length !== looks.length) return;
  const mats = await Promise.all(looks.map((m) => gltf.parser.getDependency('material', m.i)));
  parts.forEach((mesh, k) => {
    mesh.material = mats[k];
  });
}

async function loadNow(id, item) {
  const r = await api['stationery.model']({model: id});
  if (r?.error) throw new Error(r.error);
  const b = r.bytes;
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  gl(); // 環境光を先に用意する
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const obj = gltf.scene;
  await useLookMaterials(gltf);
  tint(obj, item);
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = !o.material.transparent; // 透明の品は濃い影を落とさない
      o.material.envMapIntensity = 1;
    }
  });
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  // 回る軸：クリップを除いた本体（軸・ペン先・天冠）の外接箱の中心を結ぶ線。クリップを含めると中心がクリップ側へ
  // ずれ、転がすときに揺れる。クリップは名前（Clip）で見分ける。見分けられなければ全体の中心
  const parts = [];
  obj.traverse((o) => o.isMesh && parts.push(o));
  const isClip = (o) => /clip/i.test(o.name) || /clip/i.test(o.parent?.name ?? '');
  const body = parts.filter((o) => !isClip(o));
  const axisBox = new THREE.Box3();
  for (const m of body.length ? body : parts) axisBox.expandByObject(m, true);
  const c = axisBox.getCenter(new THREE.Vector3());
  // GLB の軸：ペン先が y=0、クリップが +z。→ Z で −90°（y→x）、X で −90°（z→y）の順に回す
  const inner = new THREE.Group();
  obj.position.set(-c.x, -c.y, -c.z);
  inner.add(obj);
  inner.rotation.set(-Math.PI / 2, 0, -Math.PI / 2, 'XYZ');
  inner.scale.setScalar(1 / size.y);
  const group = new THREE.Group();
  group.add(inner);
  // ペンケースは机に置いた向きで、縦の軸のまわりに回す（ペンは軸のまわりに転がす）
  // 机に置く物（ペンケース・消しゴム）は 'case'：置いた向きで回し、小さな絵は斜め上から
  const kind = /^(case-|eraser$)/.test(id) ? 'case' : 'pen';
  const scene = new THREE.Scene();
  scene.add(group);
  scene.environment = envMap;
  scene.environmentIntensity = 0.9;
  const key = new THREE.DirectionalLight(0xfff6ea, 1.1);
  key.position.set(-0.8, 1.6, 1.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -0.8;
  key.shadow.camera.right = key.shadow.camera.top = 0.8;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 6;
  key.shadow.radius = 10;
  key.shadow.blurSamples = 16;
  key.shadow.bias = -0.0005;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xe8f0ff, 0.5);
  rim.position.set(0.9, 0.6, -1.4);
  scene.add(rim);
  // 机に落ちる影（影だけを描く面。横からの絵では真横から見るので見えない）
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({opacity: 0.22}));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = kind === 'case' ? new THREE.Box3().setFromObject(group).min.y - 0.001 : -0.08;
  ground.receiveShadow = true;
  scene.add(ground);
  return {scene, group, ground, kind};
}

function load(id, item = null) {
  const key = `${id}|${item?.id ?? ''}`;
  if (!models.has(key)) {
    const p = loadNow(id, item);
    p.catch(() => models.delete(key));
    models.set(key, p);
  }
  return models.get(key);
}

/**
 * 横から描いた画像（data URL の PNG）。ペンは stationery.js の絵の viewBox（200×28）と同じ比率で真横から。
 * ペンケースは 200×80 で、斜め上から（ふたや上のファスナーも見える）。外接箱が画像に収まる範囲を写す
 */
export async function snapshot(id, {w = 1600, h = 224, item = null} = {}) {
  const m = await load(id, item);
  const g = gl();
  g.setSize(w, h, false);
  m.group.rotation.set(0, 0, 0);
  let cam;
  if (m.kind === 'case') {
    cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    cam.position.set(0, 1.25, 3);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    // 外接箱の角をカメラから見た座標にし、縦横比を保って収める（ふちに 4% の余白）
    const box = new THREE.Box3().setFromObject(m.group);
    const inv = cam.matrixWorldInverse;
    const r = new THREE.Box3();
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) r.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(inv));
    const c = r.getCenter(new THREE.Vector3());
    const sz = r.getSize(new THREE.Vector3());
    const halfW = Math.max(sz.x / 2, ((sz.y / 2) * w) / h) * 1.04;
    const halfH = (halfW * h) / w;
    Object.assign(cam, {left: c.x - halfW, right: c.x + halfW, top: c.y + halfH, bottom: c.y - halfH});
    cam.updateProjectionMatrix();
  } else {
    const viewW = 1.04;
    const viewH = (viewW * h) / w;
    cam = new THREE.OrthographicCamera(-viewW / 2, viewW / 2, viewH / 2, -viewH / 2, 0.01, 10);
    cam.position.set(0, 0, 3);
    cam.lookAt(0, 0, 0);
  }
  m.ground.visible = false;
  g.render(m.scene, cam);
  m.ground.visible = true;
  return g.domElement.toDataURL('image/png');
}

/**
 * el の中に、ドラッグで回せる 3D 表示を作る。見えている間だけ描き、el が画面から消えたらやめる。
 * zoom: ホイール・ピンチで近づける（大きな表示用）。戻り値：{reset()} 向きと距離を戻す
 */
export function mount(el, id, {zoom = false, item = null} = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'model-view__canvas';
  el.replaceChildren(canvas);
  const ctx = canvas.getContext('2d');
  const cam = new THREE.PerspectiveCamera(26, 1, 0.01, 20);
  const home = new THREE.Vector3(0.06, 0.34, 1.55);
  let moved = false; // 利用者が回した・近づけた
  cam.position.copy(home);
  /** ペン（長さ 1）が幅の 9 割に収まる距離（視野 26°・縦横比から） */
  const fit = () => {
    const halfW = Math.tan((cam.fov / 2) * (Math.PI / 180)) * cam.aspect;
    const d = Math.max(0.8, 0.5 / 0.9 / halfW);
    home.set(0.06 * d, (model?.kind === 'case' ? 0.42 : 0.22) * d, d); // ペンケースは少し上から（上の面も見える）
    controls.minDistance = d * 0.3;
    controls.maxDistance = d * 1.35; // 離しても小さくなりすぎない
    if (!moved) cam.position.copy(home);
  };
  const controls = new OrbitControls(cam, canvas);
  controls.enablePan = false;
  controls.enableZoom = zoom;
  controls.minDistance = 0.3;
  controls.maxDistance = 2;
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);
  let dragging = false;
  controls.addEventListener('start', () => {
    dragging = true;
    moved = true;
  });
  controls.addEventListener('end', () => (dragging = false));
  let model = null;
  let visible = true;
  let raf = 0;
  let last = 0;
  // 「動きを減らす」設定では、勝手に回さず、利用者が回したときだけ描く
  const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // 描き直しは次のフレームに 1 回だけ頼む（tick の中の controls.update() がまた change を出すので、その場で描くと
  // 呼び出しが果てしなく重なって止まっていた）
  controls.addEventListener('change', () => {
    if (reduceMotion && visible && model) raf = requestAnimationFrame(tick);
  });
  const size = () => {
    const r = el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    cam.aspect = Math.max(0.1, r.width / Math.max(1, r.height));
    cam.updateProjectionMatrix();
    fit();
  };
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) tick();
  });
  const ro = new ResizeObserver(size);
  const stop = () => {
    cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    controls.dispose();
  };
  const tick = (t = 0) => {
    cancelAnimationFrame(raf);
    if (!canvas.isConnected) return stop();
    if (!visible || !model) return;
    // ペンは軸のまわりにゆっくり転がし、ペンケースは机の上で回す（ドラッグ中・動きを減らす設定では止める）
    if (!dragging && !reduceMotion)
      model.group.rotation[model.kind === 'case' ? 'y' : 'x'] +=
        Math.min(0.05, (t - last) / 1000) * (model.kind === 'case' ? 0.35 : 0.6);
    last = t;
    if (!moved) cam.position.copy(home); // 動かすまでは、いつも収まる位置
    controls.update();
    const g = gl();
    if (g.domElement.width !== canvas.width || g.domElement.height !== canvas.height)
      g.setSize(canvas.width, canvas.height, false);
    g.render(model.scene, cam);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(g.domElement, 0, 0);
    if (!reduceMotion || dragging) raf = requestAnimationFrame(tick);
  };
  size();
  io.observe(el);
  ro.observe(el);
  load(id, item).then(
    (m) => {
      model = m;
      fit(); // ペンケースは見る高さが違う
      el.classList.add('is-ready');
      tick();
    },
    (e) => {
      stop();
      throw e;
    }
  );
  return {
    reset() {
      moved = false;
      cam.position.copy(home);
      controls.target.set(0, 0, 0);
      if (model) model.group.rotation.set(0, 0, 0);
      controls.update();
    }
  };
}

// ---- 筆箱の横のペンケース（開いた形）：選んでいるペンケースの GLB の材質（帆布・革・缶・透明）で、
// 筆箱の大きさに合わせた「開いたケース」を真上から描く。ふちは厚みと丸み、内側は裏地、ふちにファスナー ----
const TILE_MM = {'case-pouch': 9.6, 'case-leather': 16, 'case-tin': 24, 'case-clear': 20}; // 模様の 1 枚の大きさ（build.py）

function findMat(root, name) {
  let m = null;
  root.traverse((o) => {
    if (!m && o.isMesh && o.material?.name === name) m = o.material;
  });
  return m;
}

/** 角を丸めた四角の輪郭（左下が x, y） */
function roundRect(path, x, y, w, h, r) {
  r = Math.max(0.5, Math.min(r, w / 2, h / 2));
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

function scaleUV(geo, k) {
  const uv = geo.attributes.uv;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
}

/**
 * 開いたペンケースを真上から描いた画像（data URL の PNG）。w・h は筆箱の大きさ（CSS の px）、inner は中の
 * ペンを並べる所（筆箱の左上からの x・y・w・h）。そこを裏地の見える内側にし、まわりをケースのふちにする
 */
export async function caseTray(id, {item = null, w, h, inner, radius = 18, dpr = 1} = {}) {
  const m = await load(id, item);
  const g = gl();
  const kind = id.replace(/^case-/, '');
  const base = findMat(m.scene, 'CaseBase');
  const trim = findMat(m.scene, 'CaseTrim') ?? base;
  const teethMat = findMat(m.scene, 'CaseZipCoil') ?? findMat(m.scene, 'Brass');
  const tapeMat = findMat(m.scene, 'CaseZipTape') ?? trim;
  const metal = findMat(m.scene, 'ZipMetal') ?? findMat(m.scene, 'Brass');
  // 模様の大きさ：筆箱の幅をケースの長さ（約 200 mm）とみなす
  const k = 200 / w / (TILE_MM[id] ?? 10);
  const scene = new THREE.Scene();
  scene.environment = envMap;
  scene.environmentIntensity = 1.1;
  scene.environmentRotation.x = Math.PI / 2; // 真上から見るので、スタジオの頭上のソフトボックスをカメラの側（+Z）へ向ける
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 0.9));
  const disposables = [];
  const add = (geo, mat, {cast = true, receive = true} = {}) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    scene.add(mesh);
    disposables.push(geo);
    return mesh;
  };
  // DOM の座標（y が下向き）→ 描く座標（y が上向き）
  const cy = (y, hh) => h - y - hh;
  const cav = {x: inner.x, y: cy(inner.y, inner.h), w: inner.w, h: inner.h};
  const wall = 14; // ふちの高さ
  const bv = 5; // ふちの丸み
  // ふち（外の形から、中の形をくりぬいて押し出す。丸み〔bevel〕の分だけ外を小さく、穴を大きくしておく）
  const outer = roundRect(new THREE.Shape(), bv, bv, w - 2 * bv, h - 2 * bv, radius - bv);
  outer.holes.push(roundRect(new THREE.Path(), cav.x - bv, cav.y - bv, cav.w + 2 * bv, cav.h + 2 * bv, 10 + bv));
  const rimGeo = new THREE.ExtrudeGeometry(outer, {
    depth: wall,
    bevelEnabled: true,
    bevelThickness: bv,
    bevelSize: bv,
    bevelSegments: 6,
    curveSegments: 20
  });
  scaleUV(rimGeo, k);
  let rimMat = base;
  if (base?.transparent) {
    // 透明のケース：ふちは少し濃く（ペンが浮いて見えないように）
    rimMat = base.clone();
    rimMat.opacity = 0.5;
    rimMat.depthWrite = true;
    disposables.push(rimMat);
  }
  add(rimGeo, rimMat);
  // 内側の底（裏地。缶は金属のまま少し暗く）
  const floorShape = roundRect(new THREE.Shape(), cav.x - 2, cav.y - 2, cav.w + 4, cav.h + 4, 12);
  const floorGeo = new THREE.ShapeGeometry(floorShape, 16);
  scaleUV(floorGeo, k);
  let lining;
  if (kind === 'tin') {
    lining = base.clone();
    lining.color = base.color.clone().multiplyScalar(0.85);
  } else {
    lining = (trim ?? base).clone();
    lining.color = new THREE.Color(item?.trim ?? '#d9d2c3').lerp(new THREE.Color('#ffffff'), 0.35);
    lining.transparent = false;
    lining.opacity = 1;
    lining.metalness = 0;
  }
  disposables.push(lining);
  add(floorGeo, lining, {cast: false}).position.z = 1;
  // ファスナー（缶にはない）：ふちの上、内側のふちに沿ってテープと歯、右上にスライダー
  if (kind !== 'tin' && teethMat) {
    const top = wall + bv;
    const tape = roundRect(new THREE.Shape(), cav.x - 8, cav.y - 8, cav.w + 16, cav.h + 16, 18);
    tape.holes.push(roundRect(new THREE.Path(), cav.x - 1, cav.y - 1, cav.w + 2, cav.h + 2, 11));
    const tapeGeo = new THREE.ExtrudeGeometry(tape, {depth: 1.2, bevelEnabled: false, curveSegments: 20});
    scaleUV(tapeGeo, k);
    add(tapeGeo, tapeMat, {cast: false}).position.z = top - 0.4;
    const path = roundRect(new THREE.Path(), cav.x - 4.5, cav.y - 4.5, cav.w + 9, cav.h + 9, 14.5);
    const len = path.getLength();
    const n = Math.round(len / (kind === 'leather' ? 3.4 : 2.8));
    const pts = path.getSpacedPoints(n);
    const tooth = new THREE.BoxGeometry(kind === 'leather' ? 2.2 : 1.6, kind === 'leather' ? 6 : 5, 1.8);
    disposables.push(tooth);
    // 歯は小さいので、テープより少し濃くして見分けられるようにする
    const tMat = teethMat.clone();
    if (kind !== 'leather') tMat.color = teethMat.color.clone().lerp(new THREE.Color('#1b1b1d'), 0.35);
    disposables.push(tMat);
    const teeth = new THREE.InstancedMesh(tooth, tMat, n);
    const q = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      q.setFromAxisAngle(zAxis, Math.atan2(b.y - a.y, b.x - a.x));
      mtx.compose(new THREE.Vector3(a.x, a.y, top + 1.4), q, new THREE.Vector3(1, 1, 1));
      teeth.setMatrixAt(i, mtx);
    }
    teeth.castShadow = true;
    scene.add(teeth);
    if (metal) {
      // スライダーは右の辺の上のほう、引き手はふちに沿って下へ（見出しや消しゴムにかからない所）
      const sx = cav.x + cav.w + 4.5;
      const sy = cav.y + cav.h - 46;
      const slider = new THREE.BoxGeometry(11, 15, 5);
      disposables.push(slider);
      add(slider, metal).position.set(sx, sy, top + 3.2);
      const pull = new THREE.BoxGeometry(7, 24, 1.8);
      disposables.push(pull);
      add(pull, kind === 'leather' ? base : metal).position.set(sx, sy - 18, top + 2.2);
    }
  }
  // 光：左上からの主光源（ふちの影が内側に落ちる）と、環境の映り込み
  const key = new THREE.DirectionalLight(0xfff6ea, 1.6);
  key.position.set(w * 0.2, h * 1.1, 260);
  key.target.position.set(w / 2, h / 2, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const ext = Math.max(w, h);
  Object.assign(key.shadow.camera, {left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 2000});
  key.shadow.radius = 6;
  key.shadow.blurSamples = 12;
  key.shadow.bias = -0.0008;
  scene.add(key, key.target);
  const cam = new THREE.OrthographicCamera(0, w, h, 0, 1, 2000);
  cam.position.set(0, 0, 1000);
  g.setSize(Math.round(w * dpr), Math.round(h * dpr), false);
  g.render(scene, cam);
  const url = g.domElement.toDataURL('image/png');
  for (const d of disposables) d.dispose();
  return url;
}
