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
const models = new Map(); // model id → Promise<{scene, group, ground}>

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

async function loadNow(id) {
  const r = await api['stationery.model']({model: id});
  if (r?.error) throw new Error(r.error);
  const b = r.bytes;
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  gl(); // 環境光を先に用意する
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const obj = gltf.scene;
  await useLookMaterials(gltf);
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.material.envMapIntensity = 1;
    }
  });
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  // GLB の軸：ペン先が y=0、クリップが +z。→ Z で −90°（y→x）、X で −90°（z→y）の順に回す
  const inner = new THREE.Group();
  obj.position.set(-c.x, -c.y, -c.z);
  inner.add(obj);
  inner.rotation.set(-Math.PI / 2, 0, -Math.PI / 2, 'XYZ');
  inner.scale.setScalar(1 / size.y);
  const group = new THREE.Group();
  group.add(inner);
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
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  scene.add(ground);
  return {scene, group, ground};
}

function load(id) {
  if (!models.has(id)) {
    const p = loadNow(id);
    p.catch(() => models.delete(id));
    models.set(id, p);
  }
  return models.get(id);
}

/** 横から描いた画像（data URL の PNG）。stationery.js の絵の viewBox（200×28）と同じ比率 */
export async function snapshot(id, {w = 1600, h = 224} = {}) {
  const m = await load(id);
  const g = gl();
  g.setSize(w, h, false);
  const viewW = 1.04;
  const viewH = (viewW * h) / w;
  const cam = new THREE.OrthographicCamera(-viewW / 2, viewW / 2, viewH / 2, -viewH / 2, 0.01, 10);
  cam.position.set(0, 0, 3);
  cam.lookAt(0, 0, 0);
  m.group.rotation.set(0, 0, 0);
  m.ground.visible = false;
  g.render(m.scene, cam);
  m.ground.visible = true;
  return g.domElement.toDataURL('image/png');
}

/**
 * el の中に、ドラッグで回せる 3D 表示を作る。見えている間だけ描き、el が画面から消えたらやめる。
 * zoom: ホイール・ピンチで近づける（大きな表示用）。戻り値：{reset()} 向きと距離を戻す
 */
export function mount(el, id, {zoom = false} = {}) {
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
    home.set(0.06 * d, 0.22 * d, d);
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
    // ペンを軸のまわりにゆっくり転がす（ドラッグ中は止める）
    if (!dragging) model.group.rotation.x += Math.min(0.05, (t - last) / 1000) * 0.6;
    last = t;
    if (!moved) cam.position.copy(home); // 動かすまでは、いつも収まる位置
    controls.update();
    const g = gl();
    if (g.domElement.width !== canvas.width || g.domElement.height !== canvas.height)
      g.setSize(canvas.width, canvas.height, false);
    g.render(model.scene, cam);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(g.domElement, 0, 0);
    raf = requestAnimationFrame(tick);
  };
  size();
  io.observe(el);
  ro.observe(el);
  load(id).then(
    (m) => {
      model = m;
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
